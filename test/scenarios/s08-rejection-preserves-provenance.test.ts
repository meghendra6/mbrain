/**
 * Scenario S8 — Rejection preserves provenance forever.
 *
 * Falsifies G2 (candidate provenance must remain attached even when the
 * candidate is eventually rejected) and L5 (explicit reject/supersede, not
 * silent deletion of governance history).
 */

import { describe, expect, test } from 'bun:test';
import { allocateSqliteBrain, seedMemoryCandidate } from './helpers.ts';
import { rejectMemoryCandidateEntry } from '../../src/core/services/memory-inbox-service.ts';

describe('S8 — rejection preserves provenance', () => {
  test('rejected candidate keeps source_refs, status, and stays queryable', async () => {
    const handle = await allocateSqliteBrain('s08-reject');

    const sources = [
      'Meeting notes, "Design review", 2026-04-22 10:00 AM KST',
      'User, direct message, 2026-04-22 10:30 AM KST',
    ];

    try {
      await seedMemoryCandidate(handle.engine, {
        id: 'to-reject',
        status: 'staged_for_review',
        source_refs: sources,
        target_object_id: 'concepts/rejected-subject',
      });

      const rejected = await rejectMemoryCandidateEntry(handle.engine, {
        id: 'to-reject',
        review_reason: 'Claim contradicts a verified source.',
      });

      expect(rejected.status).toBe('rejected');
      expect(rejected.reviewed_at).toBeInstanceOf(Date);
      expect(rejected.review_reason).toBe('Claim contradicts a verified source.');
      // G2: provenance survives rejection.
      expect(rejected.source_refs).toEqual(sources);

      // Still queryable by id.
      const stored = await handle.engine.getMemoryCandidateEntry('to-reject');
      expect(stored).not.toBeNull();
      expect(stored!.source_refs).toEqual(sources);

      // Visible in list filtered by status=rejected.
      const rejectedList = await handle.engine.listMemoryCandidateEntries({
        scope_id: 'workspace:default',
        status: 'rejected',
      });
      expect(rejectedList.map((entry) => entry.id)).toContain('to-reject');
    } finally {
      await handle.teardown();
    }
  });

  test('rejection from non-staged state is denied', async () => {
    const handle = await allocateSqliteBrain('s08-reject-wrong-state');

    try {
      await seedMemoryCandidate(handle.engine, {
        id: 'captured-only',
        status: 'captured',
      });

      await expect(
        rejectMemoryCandidateEntry(handle.engine, {
          id: 'captured-only',
          review_reason: 'Attempted early rejection.',
        }),
      ).rejects.toThrow();

      const stored = await handle.engine.getMemoryCandidateEntry('captured-only');
      expect(stored!.status).toBe('captured');
    } finally {
      await handle.teardown();
    }
  });
});
