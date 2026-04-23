/**
 * Scenario S20 — absent interaction_id is valid.
 */

import { describe, expect, test } from 'bun:test';
import { allocateSqliteBrain, seedMemoryCandidate } from './helpers.ts';
import { promoteMemoryCandidateEntry } from '../../src/core/services/memory-inbox-promotion-service.ts';
import { recordCanonicalHandoff } from '../../src/core/services/canonical-handoff-service.ts';
import { resolveMemoryCandidateContradiction } from '../../src/core/services/memory-inbox-contradiction-service.ts';
import { supersedeMemoryCandidateEntry } from '../../src/core/services/memory-inbox-supersession-service.ts';

describe('S20 — absent interaction_id is valid', () => {
  test('canonical handoff without interaction_id has null interaction_id on readback', async () => {
    const handle = await allocateSqliteBrain('s20-handoff');
    try {
      await seedMemoryCandidate(handle.engine, {
        id: 'cand-s20-h',
        status: 'staged_for_review',
        target_object_type: 'curated_note',
        target_object_id: 'concepts/s20-h',
      });
      await promoteMemoryCandidateEntry(handle.engine, { id: 'cand-s20-h' });

      const { handoff } = await recordCanonicalHandoff(handle.engine, {
        candidate_id: 'cand-s20-h',
      });
      expect(handoff.interaction_id).toBeNull();
    } finally {
      await handle.teardown();
    }
  });

  test('supersession without interaction_id has null interaction_id on readback', async () => {
    const handle = await allocateSqliteBrain('s20-super');
    try {
      await seedMemoryCandidate(handle.engine, {
        id: 'cand-s20-old',
        status: 'staged_for_review',
        target_object_id: 'concepts/s20',
      });
      await seedMemoryCandidate(handle.engine, {
        id: 'cand-s20-new',
        status: 'staged_for_review',
        target_object_id: 'concepts/s20',
      });
      await promoteMemoryCandidateEntry(handle.engine, { id: 'cand-s20-old' });
      await promoteMemoryCandidateEntry(handle.engine, { id: 'cand-s20-new' });

      const result = await supersedeMemoryCandidateEntry(handle.engine, {
        superseded_candidate_id: 'cand-s20-old',
        replacement_candidate_id: 'cand-s20-new',
      });
      expect(result.supersession_entry?.interaction_id).toBeNull();
    } finally {
      await handle.teardown();
    }
  });

  test('contradiction without interaction_id has null interaction_id on readback', async () => {
    const handle = await allocateSqliteBrain('s20-contradiction');
    try {
      await seedMemoryCandidate(handle.engine, {
        id: 'cand-s20-candidate',
        status: 'staged_for_review',
        target_object_id: 'concepts/s20-candidate',
      });
      await seedMemoryCandidate(handle.engine, {
        id: 'cand-s20-challenged',
        status: 'staged_for_review',
        target_object_id: 'concepts/s20-challenged',
      });

      const result = await resolveMemoryCandidateContradiction(handle.engine, {
        candidate_id: 'cand-s20-candidate',
        challenged_candidate_id: 'cand-s20-challenged',
        outcome: 'unresolved',
      });

      expect(result.contradiction_entry.interaction_id).toBeNull();
      const stored = await handle.engine.getMemoryCandidateContradictionEntry(result.contradiction_entry.id);
      expect(stored?.interaction_id).toBeNull();
    } finally {
      await handle.teardown();
    }
  });
});
