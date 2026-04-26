import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { importFromContent } from '../src/core/import-file.ts';
import { SQLiteEngine } from '../src/core/sqlite-engine.ts';
import { DEFAULT_NOTE_MANIFEST_SCOPE_ID } from '../src/core/services/note-manifest-service.ts';
import {
  approveMemoryRedactionPlan,
  applyMemoryRedactionPlan,
  createMemoryRedactionPlan,
  rejectMemoryRedactionPlan,
} from '../src/core/services/memory-redaction-plan-service.ts';
import { importContentHash } from '../src/core/utils.ts';

async function createHarness(label: string): Promise<{
  engine: SQLiteEngine;
  cleanup: () => Promise<void>;
}> {
  const dir = mkdtempSync(join(tmpdir(), `mbrain-redaction-plan-service-${label}-`));
  const engine = new SQLiteEngine();
  await engine.connect({ engine: 'sqlite', database_path: join(dir, 'brain.db') });
  await engine.initSchema();
  return {
    engine,
    cleanup: async () => {
      await engine.disconnect().catch(() => undefined);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe('memory redaction plan service', () => {
  test('creates a draft plan with page items and approves it from draft', async () => {
    const harness = await createHarness('create-approve');
    try {
      await harness.engine.putPage('concepts/redaction-target', {
        type: 'concept',
        title: 'Redaction Target',
        compiled_truth: 'The token alpha-secret appears here. [Source: Test, 2026-04-26 10:00 AM KST]',
        timeline: '- 2026-04-26 | alpha-secret was observed. [Source: Test, 2026-04-26 10:00 AM KST]',
      });

      const plan = await createMemoryRedactionPlan(harness.engine, {
        id: 'redaction-plan:test-create',
        scope_id: 'workspace:default',
        query: 'alpha-secret',
        requested_by: 'agent:test',
        source_refs: ['Source: service create test, 2026-04-26 10:00 AM KST'],
      });

      expect(plan).toMatchObject({
        id: 'redaction-plan:test-create',
        scope_id: 'workspace:default',
        query: 'alpha-secret',
        replacement_text: '[REDACTED]',
        status: 'draft',
        requested_by: 'agent:test',
      });
      expect(plan.created_at).toBeInstanceOf(Date);

      const items = await harness.engine.listMemoryRedactionPlanItems({
        plan_id: plan.id,
      });
      expect(items.map((item) => item.field_path).sort()).toEqual(['compiled_truth', 'timeline']);
      expect(items.every((item) => item.target_object_type === 'page')).toBe(true);
      expect(items.every((item) => item.target_object_id === 'concepts/redaction-target')).toBe(true);
      expect(items.every((item) => item.status === 'planned')).toBe(true);
      expect(items.every((item) => item.before_hash && item.after_hash === null)).toBe(true);

      const approved = await approveMemoryRedactionPlan(harness.engine, {
        id: plan.id,
        review_reason: 'Approved by reviewer.',
      });
      expect(approved).toMatchObject({
        id: plan.id,
        status: 'approved',
        review_reason: 'Approved by reviewer.',
      });
      expect(approved.reviewed_at).toBeInstanceOf(Date);

      const events = await harness.engine.listMemoryMutationEvents({
        operation: 'create_redaction_plan',
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        operation: 'create_redaction_plan',
        target_kind: 'ledger_event',
        target_id: plan.id,
        result: 'staged_for_review',
      });
    } finally {
      await harness.cleanup();
    }
  });

  test('rejects blank required fields and supports rejected draft lifecycle', async () => {
    const harness = await createHarness('reject');
    try {
      await expect(createMemoryRedactionPlan(harness.engine, {
        scope_id: 'workspace:default',
        query: '   ',
      })).rejects.toThrow(/query/i);
      await expect(createMemoryRedactionPlan(harness.engine, {
        scope_id: '   ',
        query: 'secret',
      })).rejects.toThrow(/scope_id/i);
      await expect(createMemoryRedactionPlan(harness.engine, {
        scope_id: 'workspace:default',
        query: 'secret',
        replacement_text: 'still secret',
      })).rejects.toThrow(/replacement_text/i);

      const plan = await createMemoryRedactionPlan(harness.engine, {
        id: 'redaction-plan:test-reject',
        scope_id: 'workspace:default',
        query: 'reject-me',
      });
      const rejected = await rejectMemoryRedactionPlan(harness.engine, {
        id: plan.id,
        review_reason: 'Not enough evidence.',
      });
      expect(rejected).toMatchObject({
        id: plan.id,
        status: 'rejected',
        review_reason: 'Not enough evidence.',
      });
      expect(rejected.reviewed_at).toBeInstanceOf(Date);
      await expect(approveMemoryRedactionPlan(harness.engine, {
        id: plan.id,
      })).rejects.toThrow(/draft/i);
    } finally {
      await harness.cleanup();
    }
  });

  test('apply requires approval and fails closed on unsupported planned items', async () => {
    const harness = await createHarness('unsupported');
    try {
      const unapproved = await createMemoryRedactionPlan(harness.engine, {
        id: 'redaction-plan:test-unapproved',
        scope_id: 'workspace:default',
        query: 'not-approved',
      });
      await expect(applyMemoryRedactionPlan(harness.engine, {
        id: unapproved.id,
      })).rejects.toThrow(/approved/i);

      const unsupported = await createMemoryRedactionPlan(harness.engine, {
        id: 'redaction-plan:test-unsupported',
        scope_id: 'workspace:default',
        query: 'unsupported-secret',
      });
      await harness.engine.createMemoryRedactionPlanItem({
        id: 'redaction-item:test-unsupported',
        plan_id: unsupported.id,
        target_object_type: 'profile_memory',
        target_object_id: 'profile:unsupported',
        field_path: 'content',
        status: 'planned',
        preview_text: 'unsupported-secret',
      });
      await approveMemoryRedactionPlan(harness.engine, { id: unsupported.id });

      await expect(applyMemoryRedactionPlan(harness.engine, {
        id: unsupported.id,
      })).rejects.toThrow(/unsupported/i);
      expect((await harness.engine.getMemoryRedactionPlan(unsupported.id))?.status).toBe('approved');
    } finally {
      await harness.cleanup();
    }
  });

  test('applies page redactions, refreshes derived storage, and records page ledger evidence', async () => {
    const harness = await createHarness('apply-page');
    try {
      await importFromContent(harness.engine, 'concepts/redaction-apply-target', [
        '---',
        'type: concept',
        'title: Redaction Apply Target',
        'tags:',
        '  - privacy',
        '---',
        '# Current State',
        'beta-secret appears twice: beta-secret. [Source: Test, 2026-04-26 10:10 AM KST]',
        '',
        '---',
        '',
        '## Timeline',
        '- 2026-04-26 | beta-secret in timeline. [Source: Test, 2026-04-26 10:10 AM KST]',
      ].join('\n'), { path: 'concepts/redaction-apply-target.md' });
      const beforePage = await harness.engine.getPage('concepts/redaction-apply-target');
      expect(beforePage?.content_hash).toBeTruthy();
      const beforeVersions = await harness.engine.getVersions('concepts/redaction-apply-target');
      expect(beforeVersions).toHaveLength(0);

      const plan = await createMemoryRedactionPlan(harness.engine, {
        id: 'redaction-plan:test-apply',
        scope_id: 'workspace:default',
        query: 'beta-secret',
        replacement_text: '[REMOVED]',
        requested_by: 'agent:test',
        source_refs: ['Source: service apply test, 2026-04-26 10:10 AM KST'],
      });
      await approveMemoryRedactionPlan(harness.engine, {
        id: plan.id,
        review_reason: 'Ready to apply.',
      });

      const applied = await applyMemoryRedactionPlan(harness.engine, {
        id: plan.id,
        actor: 'agent:executor',
        source_refs: ['Source: service apply execution, 2026-04-26 10:11 AM KST'],
      });
      expect(applied.status).toBe('applied');
      expect(applied.applied_at).toBeInstanceOf(Date);

      const page = await harness.engine.getPage('concepts/redaction-apply-target');
      expect(page?.compiled_truth).toContain('[REMOVED] appears twice: [REMOVED].');
      expect(page?.timeline).toContain('[REMOVED] in timeline.');
      expect(page?.compiled_truth).not.toContain('beta-secret');
      expect(page?.timeline).not.toContain('beta-secret');
      expect(page?.content_hash).toBe(importContentHash({
        title: 'Redaction Apply Target',
        type: 'concept',
        compiled_truth: page?.compiled_truth ?? '',
        timeline: page?.timeline ?? '',
        frontmatter: {},
        tags: ['privacy'],
      }));

      const chunks = await harness.engine.getChunks('concepts/redaction-apply-target');
      expect(chunks.map((chunk) => chunk.chunk_text).join('\n')).not.toContain('beta-secret');
      expect(chunks.map((chunk) => chunk.chunk_text).join('\n')).toContain('[REMOVED]');

      const manifest = await harness.engine.getNoteManifestEntry(
        DEFAULT_NOTE_MANIFEST_SCOPE_ID,
        'concepts/redaction-apply-target',
      );
      expect(manifest?.content_hash).toBe(page?.content_hash);
      expect(JSON.stringify(manifest)).not.toContain('beta-secret');

      const sections = await harness.engine.listNoteSectionEntries({
        scope_id: DEFAULT_NOTE_MANIFEST_SCOPE_ID,
        page_slug: 'concepts/redaction-apply-target',
      });
      expect(sections.map((section) => section.section_text).join('\n')).not.toContain('beta-secret');

      const afterVersions = await harness.engine.getVersions('concepts/redaction-apply-target');
      expect(afterVersions).toHaveLength(beforeVersions.length);

      const items = await harness.engine.listMemoryRedactionPlanItems({
        plan_id: plan.id,
      });
      expect(items).toHaveLength(2);
      expect(items.every((item) => item.status === 'applied')).toBe(true);
      expect(items.every((item) => item.before_hash && item.after_hash && item.before_hash !== item.after_hash)).toBe(true);

      const events = await harness.engine.listMemoryMutationEvents({
        operation: 'execute_redaction_plan',
        target_id: 'concepts/redaction-apply-target',
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        operation: 'execute_redaction_plan',
        target_kind: 'page',
        target_id: 'concepts/redaction-apply-target',
        actor: 'agent:executor',
        result: 'redacted',
        source_refs: ['Source: service apply execution, 2026-04-26 10:11 AM KST'],
        metadata: {
          plan_id: plan.id,
          page_slug: 'concepts/redaction-apply-target',
          item_count: 2,
        },
      });
      expect(events[0]!.expected_target_snapshot_hash).toBe(beforePage!.content_hash!);
      expect(events[0]!.current_target_snapshot_hash).toBe(page!.content_hash!);
      expect((events[0]?.metadata as any).item_results).toHaveLength(2);
      expect((events[0]?.metadata as any).item_results.every((entry: any) => entry.before_hash && entry.after_hash)).toBe(true);
    } finally {
      await harness.cleanup();
    }
  });

  test('apply rejects stale page content before mutation and ledger writes', async () => {
    const harness = await createHarness('stale-cas');
    try {
      await importFromContent(harness.engine, 'concepts/redaction-stale-target', [
        '---',
        'type: concept',
        'title: Redaction Stale Target',
        '---',
        'stale-secret reviewed text. [Source: Test, 2026-04-26 10:12 AM KST]',
      ].join('\n'), { path: 'concepts/redaction-stale-target.md' });
      const plan = await createMemoryRedactionPlan(harness.engine, {
        id: 'redaction-plan:test-stale',
        scope_id: 'workspace:default',
        query: 'stale-secret',
      });
      await approveMemoryRedactionPlan(harness.engine, { id: plan.id });
      await harness.engine.putPage('concepts/redaction-stale-target', {
        type: 'concept',
        title: 'Redaction Stale Target',
        compiled_truth: 'stale-secret unreviewed text. [Source: Test, 2026-04-26 10:13 AM KST]',
        timeline: '',
        frontmatter: { type: 'concept', title: 'Redaction Stale Target' },
      });

      await expect(applyMemoryRedactionPlan(harness.engine, {
        id: plan.id,
      })).rejects.toThrow(/stale|changed|hash/i);

      const page = await harness.engine.getPage('concepts/redaction-stale-target');
      expect(page?.compiled_truth).toContain('stale-secret unreviewed text');
      expect((await harness.engine.getMemoryRedactionPlan(plan.id))?.status).toBe('approved');
      const items = await harness.engine.listMemoryRedactionPlanItems({ plan_id: plan.id });
      expect(items.every((item) => item.status === 'planned')).toBe(true);
      expect(items.every((item) => item.after_hash === null)).toBe(true);
      expect(await harness.engine.listMemoryMutationEvents({
        operation: 'execute_redaction_plan',
      })).toEqual([]);
    } finally {
      await harness.cleanup();
    }
  });

  test('page-version matches create unsupported items and make apply fail closed', async () => {
    const harness = await createHarness('page-version-unsupported');
    try {
      await harness.engine.putPage('concepts/redaction-version-target', {
        type: 'concept',
        title: 'Redaction Version Target',
        compiled_truth: 'version-secret old snapshot. [Source: Test, 2026-04-26 10:14 AM KST]',
        timeline: '',
      });
      const version = await harness.engine.createVersion('concepts/redaction-version-target');
      await harness.engine.putPage('concepts/redaction-version-target', {
        type: 'concept',
        title: 'Redaction Version Target',
        compiled_truth: 'Current text no longer contains the query. [Source: Test, 2026-04-26 10:15 AM KST]',
        timeline: '',
      });

      const plan = await createMemoryRedactionPlan(harness.engine, {
        id: 'redaction-plan:test-page-version',
        scope_id: 'workspace:default',
        query: 'version-secret',
      });
      const items = await harness.engine.listMemoryRedactionPlanItems({ plan_id: plan.id });
      expect(items).toEqual([
        expect.objectContaining({
          target_object_type: 'page_version',
          target_object_id: String(version.id),
          field_path: 'compiled_truth',
          status: 'unsupported',
          before_hash: expect.any(String),
        }),
      ]);

      await approveMemoryRedactionPlan(harness.engine, { id: plan.id });
      await expect(applyMemoryRedactionPlan(harness.engine, {
        id: plan.id,
      })).rejects.toThrow(/unsupported/i);
      expect((await harness.engine.getMemoryRedactionPlan(plan.id))?.status).toBe('approved');
      expect(await harness.engine.listMemoryMutationEvents({
        operation: 'execute_redaction_plan',
      })).toEqual([]);
    } finally {
      await harness.cleanup();
    }
  });

  test('title and frontmatter matches create unsupported items and make apply fail closed', async () => {
    const harness = await createHarness('page-metadata-unsupported');
    try {
      await harness.engine.putPage('concepts/redaction-metadata-target', {
        type: 'concept',
        title: 'metadata-secret title',
        compiled_truth: 'Body text does not include the query. [Source: Test, 2026-04-26 10:16 AM KST]',
        timeline: '',
        frontmatter: {
          aliases: ['metadata-secret alias'],
        },
      });

      const plan = await createMemoryRedactionPlan(harness.engine, {
        id: 'redaction-plan:test-metadata',
        scope_id: 'workspace:default',
        query: 'metadata-secret',
      });
      const items = await harness.engine.listMemoryRedactionPlanItems({ plan_id: plan.id });
      expect(items.map((item) => `${item.target_object_type}:${item.field_path}:${item.status}`).sort()).toEqual([
        'page:frontmatter:unsupported',
        'page:title:unsupported',
      ]);

      await approveMemoryRedactionPlan(harness.engine, { id: plan.id });
      await expect(applyMemoryRedactionPlan(harness.engine, {
        id: plan.id,
      })).rejects.toThrow(/unsupported/i);
      expect((await harness.engine.getMemoryRedactionPlan(plan.id))?.status).toBe('approved');
    } finally {
      await harness.cleanup();
    }
  });

  test('page-adjacent persisted matches create unsupported items and block apply', async () => {
    const harness = await createHarness('page-adjacent-unsupported');
    try {
      await harness.engine.putPage('concepts/redaction-adjacent-target', {
        type: 'concept',
        title: 'Redaction Adjacent Target',
        compiled_truth: 'Body text does not include the query. [Source: Test, 2026-04-26 10:17 AM KST]',
        timeline: '',
      });
      await harness.engine.putRawData('concepts/redaction-adjacent-target', 'source-a', {
        payload: 'adjacent-secret raw payload',
      });
      await harness.engine.addTimelineEntry('concepts/redaction-adjacent-target', {
        date: '2026-04-26',
        source: 'test',
        summary: 'adjacent-secret timeline summary',
        detail: 'timeline detail',
      });
      await harness.engine.logIngest({
        source_type: 'test',
        source_ref: 'adjacent-secret ingest ref',
        pages_updated: ['concepts/redaction-adjacent-target'],
        summary: 'ingest summary',
      });

      const plan = await createMemoryRedactionPlan(harness.engine, {
        id: 'redaction-plan:test-adjacent',
        scope_id: 'workspace:default',
        query: 'adjacent-secret',
      });
      const items = await harness.engine.listMemoryRedactionPlanItems({ plan_id: plan.id });
      expect(items).toEqual(expect.arrayContaining([
        expect.objectContaining({
          target_object_type: 'page',
          target_object_id: 'concepts/redaction-adjacent-target',
          field_path: 'raw_data:source-a',
          status: 'unsupported',
        }),
        expect.objectContaining({
          target_object_type: 'page',
          target_object_id: 'concepts/redaction-adjacent-target',
          field_path: expect.stringMatching(/^timeline_entries:/),
          status: 'unsupported',
        }),
        expect.objectContaining({
          target_object_type: 'ingest_log',
          field_path: 'source_ref',
          status: 'unsupported',
        }),
      ]));

      await approveMemoryRedactionPlan(harness.engine, { id: plan.id });
      await expect(applyMemoryRedactionPlan(harness.engine, {
        id: plan.id,
      })).rejects.toThrow(/unsupported/i);
      expect((await harness.engine.getMemoryRedactionPlan(plan.id))?.status).toBe('approved');
    } finally {
      await harness.cleanup();
    }
  });

  test('page-adjacent discovery pages through timeline entries and ingest logs', async () => {
    const harness = await createHarness('adjacent-pagination');
    try {
      await harness.engine.putPage('concepts/redaction-adjacent-pagination', {
        type: 'concept',
        title: 'Redaction Adjacent Pagination',
        compiled_truth: 'Body text does not include the query. [Source: Test, 2026-04-26 10:17 AM KST]',
        timeline: '',
      });
      await harness.engine.addTimelineEntry('concepts/redaction-adjacent-pagination', {
        date: '2026-04-26',
        source: 'test',
        summary: 'deep-adjacent-secret timeline summary',
      });
      await harness.engine.addTimelineEntry('concepts/redaction-adjacent-pagination', {
        date: '2026-04-27',
        source: 'test',
        summary: 'newer nonmatching timeline summary',
      });
      await harness.engine.logIngest({
        source_type: 'test',
        source_ref: 'deep-adjacent-secret ingest ref',
        pages_updated: ['concepts/redaction-adjacent-pagination'],
        summary: 'secret ingest summary',
      });
      await harness.engine.logIngest({
        source_type: 'test',
        source_ref: 'newer nonmatching ingest ref',
        pages_updated: ['concepts/redaction-adjacent-pagination'],
        summary: 'nonmatching ingest summary',
      });

      const originalGetTimeline = harness.engine.getTimeline.bind(harness.engine);
      const originalGetIngestLog = harness.engine.getIngestLog.bind(harness.engine);
      harness.engine.getTimeline = async (slug, opts) => originalGetTimeline(slug, {
        ...opts,
        limit: 1,
      });
      harness.engine.getIngestLog = async (opts) => originalGetIngestLog({
        ...opts,
        limit: 1,
      });
      const plan = await createMemoryRedactionPlan(harness.engine, {
        id: 'redaction-plan:test-adjacent-pagination',
        scope_id: 'workspace:default',
        query: 'deep-adjacent-secret',
      });
      harness.engine.getTimeline = originalGetTimeline;
      harness.engine.getIngestLog = originalGetIngestLog;

      const items = await harness.engine.listMemoryRedactionPlanItems({ plan_id: plan.id });
      expect(items).toEqual(expect.arrayContaining([
        expect.objectContaining({
          target_object_type: 'page',
          target_object_id: 'concepts/redaction-adjacent-pagination',
          field_path: expect.stringMatching(/^timeline_entries:/),
          status: 'unsupported',
        }),
        expect.objectContaining({
          target_object_type: 'ingest_log',
          field_path: 'source_ref',
          status: 'unsupported',
        }),
      ]));
    } finally {
      await harness.cleanup();
    }
  });

  test('apply pages through every redaction item before mutating', async () => {
    const harness = await createHarness('item-pagination');
    try {
      await harness.engine.putPage('concepts/redaction-pagination-target', {
        type: 'concept',
        title: 'Redaction Pagination Target',
        compiled_truth: 'paged-secret body. [Source: Test, 2026-04-26 10:18 AM KST]',
        timeline: '',
      });
      const plan = await createMemoryRedactionPlan(harness.engine, {
        id: 'redaction-plan:test-pagination',
        scope_id: 'workspace:default',
        query: 'paged-secret',
      });
      await harness.engine.createMemoryRedactionPlanItem({
        id: 'redaction-item:test-pagination-late-unsupported',
        plan_id: plan.id,
        target_object_type: 'profile_memory',
        target_object_id: 'profile:late',
        field_path: 'content',
        status: 'unsupported',
        preview_text: 'paged-secret',
        created_at: new Date('2030-01-01T00:00:00.000Z'),
        updated_at: new Date('2030-01-01T00:00:00.000Z'),
      });
      await approveMemoryRedactionPlan(harness.engine, { id: plan.id });

      const originalListItems = harness.engine.listMemoryRedactionPlanItems.bind(harness.engine);
      harness.engine.listMemoryRedactionPlanItems = async (filters) => originalListItems({
        ...filters,
        limit: 1,
        offset: filters?.offset ?? 0,
      });
      await expect(applyMemoryRedactionPlan(harness.engine, {
        id: plan.id,
      })).rejects.toThrow(/unsupported/i);
      harness.engine.listMemoryRedactionPlanItems = originalListItems;

      const page = await harness.engine.getPage('concepts/redaction-pagination-target');
      expect(page?.compiled_truth).toContain('paged-secret body');
      expect((await harness.engine.getMemoryRedactionPlan(plan.id))?.status).toBe('approved');
    } finally {
      await harness.cleanup();
    }
  });

  test('apply clears stale page-level embeddings after redaction', async () => {
    const harness = await createHarness('embedding-clear');
    try {
      await harness.engine.putPage('concepts/redaction-embedding-target', {
        type: 'concept',
        title: 'Redaction Embedding Target',
        compiled_truth: 'embedding-secret body. [Source: Test, 2026-04-26 10:19 AM KST]',
        timeline: '',
      });
      await harness.engine.updatePageEmbedding(
        'concepts/redaction-embedding-target',
        new Float32Array([0.25, 0.75]),
      );
      expect((await harness.engine.getPageEmbeddings('concept')).find(
        (entry) => entry.slug === 'concepts/redaction-embedding-target',
      )?.embedding).toEqual(new Float32Array([0.25, 0.75]));

      const plan = await createMemoryRedactionPlan(harness.engine, {
        id: 'redaction-plan:test-embedding-clear',
        scope_id: 'workspace:default',
        query: 'embedding-secret',
      });
      await approveMemoryRedactionPlan(harness.engine, { id: plan.id });
      await applyMemoryRedactionPlan(harness.engine, { id: plan.id });

      expect((await harness.engine.getPageEmbeddings('concept')).find(
        (entry) => entry.slug === 'concepts/redaction-embedding-target',
      )?.embedding).toBeNull();
    } finally {
      await harness.cleanup();
    }
  });
});
