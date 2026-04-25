import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { BrainEngine } from '../src/core/engine.ts';
import { OperationError, operations } from '../src/core/operations.ts';
import type { Operation, OperationContext } from '../src/core/operations.ts';
import { SQLiteEngine } from '../src/core/sqlite-engine.ts';

function getOperation(name: string): Operation {
  const operation = operations.find((candidate) => candidate.name === name);
  if (!operation) {
    throw new Error(`${name} operation is missing`);
  }
  return operation;
}

async function withSqliteEngine<T>(fn: (ctx: OperationContext) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'mbrain-page-write-precondition-'));
  const engine = new SQLiteEngine();
  try {
    await engine.connect({ engine: 'sqlite', database_path: join(dir, 'brain.db') });
    await engine.initSchema();
    return await fn({
      engine: engine as unknown as BrainEngine,
      config: {} as any,
      logger: console,
      dryRun: false,
    });
  } finally {
    await engine.disconnect();
    rmSync(dir, { recursive: true, force: true });
  }
}

function pageContent(title: string, body: string, timeline: string): string {
  return `---
type: concept
title: ${title}
---

${body}

---

${timeline}
`;
}

describe('put_page content hash preconditions and mutation ledger', () => {
  test('stale expected_content_hash rejects without mutating existing page and records one conflict event', async () => {
    await withSqliteEngine(async (ctx) => {
      const put = getOperation('put_page');
      const slug = 'concepts/precondition-stale';
      const sessionId = 'put-page-stale-session';
      const initial = pageContent(
        'Precondition Stale',
        'Original compiled truth.',
        '- 2026-04-25 | Initial evidence.',
      );
      const updated = pageContent(
        'Precondition Stale',
        'Updated compiled truth should not be written.',
        '- 2026-04-25 | Updated evidence should not appear.',
      );

      await put.handler(ctx, { slug, content: initial });
      const before = await ctx.engine.getPage(slug);
      expect(before?.content_hash).toBeTruthy();

      let error: unknown;
      try {
        await put.handler(ctx, {
          slug,
          content: updated,
          expected_content_hash: 'stale-hash',
          session_id: sessionId,
          source_refs: ['Source: stale precondition test'],
        });
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(OperationError);
      expect((error as OperationError).code).toBe('write_conflict');
      expect((error as Error).message).toContain('content hash mismatch');

      const after = await ctx.engine.getPage(slug);
      expect(after?.content_hash).toBe(before?.content_hash);
      expect(after?.compiled_truth).toBe(before?.compiled_truth);
      expect(after?.compiled_truth).not.toContain('Updated compiled truth');

      const events = await ctx.engine.listMemoryMutationEvents({ session_id: sessionId });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        session_id: sessionId,
        realm_id: 'work',
        actor: 'mbrain:put_page',
        operation: 'put_page',
        target_kind: 'page',
        target_id: slug,
        scope_id: 'workspace:default',
        source_refs: ['Source: stale precondition test'],
        expected_target_snapshot_hash: 'stale-hash',
        current_target_snapshot_hash: before?.content_hash,
        result: 'conflict',
        dry_run: false,
      });
      expect(events[0].conflict_info).toEqual({
        reason: 'content_hash_mismatch',
        expected_content_hash: 'stale-hash',
        current_content_hash: before?.content_hash,
      });
    });
  });

  test('expected_content_hash on missing page rejects and records a conflict event', async () => {
    await withSqliteEngine(async (ctx) => {
      const put = getOperation('put_page');
      const slug = 'concepts/precondition-missing';
      const sessionId = 'put-page-missing-session';

      let error: unknown;
      try {
        await put.handler(ctx, {
          slug,
          content: pageContent(
            'Precondition Missing',
            'This page should not be created.',
            '- 2026-04-25 | Missing page attempted update.',
          ),
          expected_content_hash: 'expected-hash',
          session_id: sessionId,
          source_refs: ['Source: missing precondition test'],
        });
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(OperationError);
      expect((error as OperationError).code).toBe('write_conflict');
      expect((error as Error).message).toContain('Page not found');

      expect(await ctx.engine.getPage(slug)).toBeNull();

      const events = await ctx.engine.listMemoryMutationEvents({ session_id: sessionId });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        session_id: sessionId,
        operation: 'put_page',
        target_kind: 'page',
        target_id: slug,
        result: 'conflict',
        expected_target_snapshot_hash: 'expected-hash',
        current_target_snapshot_hash: null,
        source_refs: ['Source: missing precondition test'],
      });
      expect(events[0].conflict_info).toEqual({
        reason: 'missing_page',
        expected_content_hash: 'expected-hash',
      });
    });
  });

  test('correct expected_content_hash allows update and records applied event with final hash', async () => {
    await withSqliteEngine(async (ctx) => {
      const put = getOperation('put_page');
      const slug = 'concepts/precondition-correct';
      const sessionId = 'put-page-correct-session';

      await put.handler(ctx, {
        slug,
        content: pageContent(
          'Precondition Correct',
          'Original compiled truth.',
          '- 2026-04-25 | Initial evidence.',
        ),
      });
      const before = await ctx.engine.getPage(slug);
      expect(before?.content_hash).toBeTruthy();

      const result = await put.handler(ctx, {
        slug,
        content: pageContent(
          'Precondition Correct',
          'Updated compiled truth is written.',
          '- 2026-04-25 | Updated evidence appears.',
        ),
        expected_content_hash: before?.content_hash,
        session_id: sessionId,
        realm_id: 'realm-correct',
        actor: 'agent-correct',
        scope_id: 'scope-correct',
        source_refs: ['Source: correct precondition test'],
      }) as any;

      expect(result).toMatchObject({ slug, status: 'created_or_updated' });

      const after = await ctx.engine.getPage(slug);
      expect(after?.content_hash).toBeTruthy();
      expect(after?.content_hash).not.toBe(before?.content_hash);
      expect(after?.compiled_truth).toContain('Updated compiled truth is written.');

      const events = await ctx.engine.listMemoryMutationEvents({ session_id: sessionId });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        session_id: sessionId,
        realm_id: 'realm-correct',
        actor: 'agent-correct',
        operation: 'put_page',
        target_kind: 'page',
        target_id: slug,
        scope_id: 'scope-correct',
        result: 'applied',
        expected_target_snapshot_hash: before?.content_hash,
        current_target_snapshot_hash: after?.content_hash,
        source_refs: ['Source: correct precondition test'],
        dry_run: false,
      });
      expect(events[0].conflict_info).toBeNull();
    });
  });

  test('normal put_page without audit params records an applied ledger event using defaults', async () => {
    await withSqliteEngine(async (ctx) => {
      const put = getOperation('put_page');
      const slug = 'concepts/default-audit';

      const result = await put.handler(ctx, {
        slug,
        content: pageContent(
          'Default Audit',
          'Default audit fields should be used.',
          '- 2026-04-25 | Default audit test.',
        ),
      }) as any;
      expect(result).toMatchObject({ slug, status: 'created_or_updated' });

      const page = await ctx.engine.getPage(slug);
      const events = await ctx.engine.listMemoryMutationEvents({ session_id: 'put_page:direct' });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        session_id: 'put_page:direct',
        realm_id: 'work',
        actor: 'mbrain:put_page',
        operation: 'put_page',
        target_kind: 'page',
        target_id: slug,
        scope_id: 'workspace:default',
        source_refs: ['Source: mbrain put_page operation'],
        expected_target_snapshot_hash: null,
        current_target_snapshot_hash: page?.content_hash,
        result: 'applied',
        dry_run: false,
      });
    });
  });

  test('ctx.dryRun does not write and does not record', async () => {
    await withSqliteEngine(async (ctx) => {
      const put = getOperation('put_page');
      const dryCtx = { ...ctx, dryRun: true };
      const slug = 'concepts/dry-run-precondition';

      const result = await put.handler(dryCtx, {
        slug,
        content: pageContent(
          'Dry Run Precondition',
          'This dry run should not be written.',
          '- 2026-04-25 | Dry run attempted update.',
        ),
        expected_content_hash: 'expected-hash',
        session_id: 'put-page-dry-run-session',
      }) as any;

      expect(result).toEqual({ dry_run: true, action: 'put_page', slug });
      expect(await ctx.engine.getPage(slug)).toBeNull();
      expect(await ctx.engine.listMemoryMutationEvents({ session_id: 'put-page-dry-run-session' })).toEqual([]);
    });
  });
});
