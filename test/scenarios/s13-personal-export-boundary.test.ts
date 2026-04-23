/**
 * Scenario S13 — Personal export honors scope, sensitivity, supersession.
 *
 * Falsifies I5 (scope isolation) and G2 (explicit governance outcomes
 * survive) applied to the export surface.
 */

import { describe, expect, test } from 'bun:test';
import { allocateSqliteBrain } from './helpers.ts';
import { previewPersonalExport } from '../../src/core/services/personal-export-visibility-service.ts';

describe('S13 — personal export boundary', () => {
  test('export returns only exportable, non-superseded profile entries and real episode metadata', async () => {
    const handle = await allocateSqliteBrain('s13-export-ok');
    const scopeId = 'personal:travel';

    try {
      // 3 exportable entries.
      for (let i = 0; i < 3; i += 1) {
        await handle.engine.upsertProfileMemoryEntry({
          id: `exportable-${i}`,
          scope_id: scopeId,
          profile_type: 'routine',
          subject: `routine-${i}`,
          content: `Exportable routine ${i}.`,
          source_refs: ['User, direct message, 2026-04-23 3:00 PM KST'],
          sensitivity: 'personal',
          export_status: 'exportable',
          last_confirmed_at: null,
          superseded_by: null,
        });
      }

      // 1 superseded entry (must be filtered out).
      await handle.engine.upsertProfileMemoryEntry({
        id: 'superseded-entry',
        scope_id: scopeId,
        profile_type: 'routine',
        subject: 'replaced-routine',
        content: 'Old routine, superseded by exportable-0.',
        source_refs: ['User, direct message, 2026-04-22 3:00 PM KST'],
        sensitivity: 'personal',
        export_status: 'exportable',
        last_confirmed_at: null,
        superseded_by: 'exportable-0',
      });

      // 1 entry with export_status !== 'exportable' (must be filtered out).
      await handle.engine.upsertProfileMemoryEntry({
        id: 'private-only-entry',
        scope_id: scopeId,
        profile_type: 'stable_fact',
        subject: 'home-address',
        content: 'Private home address, not for export.',
        source_refs: ['User, direct message, 2026-04-22 3:05 PM KST'],
        sensitivity: 'secret',
        export_status: 'private_only',
        last_confirmed_at: null,
        superseded_by: null,
      });

      // 1 personal episode in the same scope.
      await handle.engine.createPersonalEpisodeEntry({
        id: 'travel-episode',
        scope_id: scopeId,
        title: 'Tokyo trip 2026-04',
        start_time: new Date('2026-04-20T00:00:00.000Z'),
        end_time: new Date('2026-04-22T00:00:00.000Z'),
        source_kind: 'chat',
        summary: 'Three days in Tokyo.',
        source_refs: ['User, direct message, 2026-04-22 9:00 AM KST'],
        candidate_ids: [],
      });

      const result = await previewPersonalExport(handle.engine, {
        requested_scope: 'personal',
        scope_id: scopeId,
        query: 'export my travel routine notes',
      });

      expect(result.selection_reason).toBe('direct_personal_export_preview');
      expect(result.scope_gate.policy).toBe('allow');

      const profileIds = result.profile_memory_entries.map((entry) => entry.id).sort();
      expect(profileIds).toEqual(['exportable-0', 'exportable-1', 'exportable-2']);

      // Episode metadata is present (not silently dropped).
      expect(result.personal_episode_entries.map((entry) => entry.id)).toEqual(['travel-episode']);
    } finally {
      await handle.teardown();
    }
  });

  test('export deferrs when signals are insufficient and scope is not explicit', async () => {
    const handle = await allocateSqliteBrain('s13-export-defer');

    try {
      const result = await previewPersonalExport(handle.engine, {
        query: 'abcdef',
      });
      expect(result.scope_gate.policy).toBe('defer');
      expect(result.profile_memory_entries).toEqual([]);
      expect(result.personal_episode_entries).toEqual([]);
    } finally {
      await handle.teardown();
    }
  });

  test('export denies work-scoped requests', async () => {
    const handle = await allocateSqliteBrain('s13-export-deny');

    try {
      const result = await previewPersonalExport(handle.engine, {
        requested_scope: 'work',
        query: 'summarize the architecture docs',
      });
      expect(result.scope_gate.policy).toBe('deny');
      expect(result.profile_memory_entries).toEqual([]);
      expect(result.personal_episode_entries).toEqual([]);
    } finally {
      await handle.teardown();
    }
  });

  test('export paginates past the 500-row batch boundary without silent truncation', async () => {
    // 501 entries — the pagination helper in the service batches at 500, so
    // this crosses the boundary that caused the original PR #32 truncation bug.
    const handle = await allocateSqliteBrain('s13-export-paginate');
    const scopeId = 'personal:many';

    try {
      for (let i = 0; i < 501; i += 1) {
        await handle.engine.upsertProfileMemoryEntry({
          id: `bulk-${i}`,
          scope_id: scopeId,
          profile_type: 'routine',
          subject: `routine-${i}`,
          content: `Bulk routine ${i}.`,
          source_refs: ['User, direct message, 2026-04-23 3:10 PM KST'],
          sensitivity: 'personal',
          export_status: 'exportable',
          last_confirmed_at: null,
          superseded_by: null,
        });
      }

      const result = await previewPersonalExport(handle.engine, {
        requested_scope: 'personal',
        scope_id: scopeId,
      });

      expect(result.profile_memory_entries).toHaveLength(501);
    } finally {
      await handle.teardown();
    }
  });
});
