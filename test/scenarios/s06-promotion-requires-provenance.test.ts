/**
 * Scenario S6 — Candidate lifecycle → promotion requires provenance.
 *
 * Falsifies invariants I4 (provenance mandatory), G1 (governance state is
 * canonical for review history, not truth), and L6 (explicit outcomes).
 */

import { describe, expect, test } from 'bun:test';
import { allocateSqliteBrain, seedMemoryCandidate } from './helpers.ts';
import {
  advanceMemoryCandidateStatus,
  MemoryInboxServiceError,
  preflightPromoteMemoryCandidate,
  rejectMemoryCandidateEntry,
} from '../../src/core/services/memory-inbox-service.ts';
import { promoteMemoryCandidateEntry } from '../../src/core/services/memory-inbox-promotion-service.ts';
import { recordCanonicalHandoff } from '../../src/core/services/canonical-handoff-service.ts';

describe('S6 — candidate lifecycle → promotion requires provenance', () => {
  test('forward-only FSM: captured → candidate → staged_for_review', async () => {
    const handle = await allocateSqliteBrain('s06-fsm');

    try {
      await seedMemoryCandidate(handle.engine, { id: 'c1' });

      // Skipping captured → staged_for_review must fail.
      await expect(
        advanceMemoryCandidateStatus(handle.engine, {
          id: 'c1',
          next_status: 'staged_for_review',
        }),
      ).rejects.toThrow(MemoryInboxServiceError);

      await advanceMemoryCandidateStatus(handle.engine, { id: 'c1', next_status: 'candidate' });

      // Going backward must fail.
      await expect(
        advanceMemoryCandidateStatus(handle.engine, { id: 'c1', next_status: 'candidate' }),
      ).rejects.toThrow(MemoryInboxServiceError);

      await advanceMemoryCandidateStatus(handle.engine, {
        id: 'c1',
        next_status: 'staged_for_review',
      });

      const stored = await handle.engine.getMemoryCandidateEntry('c1');
      expect(stored?.status).toBe('staged_for_review');
    } finally {
      await handle.teardown();
    }
  });

  test('promotion preflight denies candidate with empty source_refs', async () => {
    const handle = await allocateSqliteBrain('s06-preflight');

    try {
      await seedMemoryCandidate(handle.engine, {
        id: 'no-provenance',
        status: 'staged_for_review',
        source_refs: [],
      });

      const result = await preflightPromoteMemoryCandidate(handle.engine, { id: 'no-provenance' });
      expect(result.decision).not.toBe('allow');
      expect(result.reasons).toContain('candidate_missing_provenance');
    } finally {
      await handle.teardown();
    }
  });

  test('promotion without provenance must not succeed even if preflight is bypassed', async () => {
    // Invariant I4 at the data-layer level: even if a caller bypasses preflight
    // and calls the promotion service directly, the system must not produce a
    // canonical handoff for a claim that has no source refs.
    const handle = await allocateSqliteBrain('s06-bypass');

    try {
      await seedMemoryCandidate(handle.engine, {
        id: 'bypass-no-provenance',
        status: 'staged_for_review',
        source_refs: [],
      });

      // Current code routes promotion through preflight internally, so we
      // expect the service to throw `promotion_preflight_failed`. If a future
      // refactor splits preflight from the promotion path, this test must
      // still fail-closed: no canonical handoff may exist for a claim with
      // empty source_refs.
      let raised = false;
      try {
        await promoteMemoryCandidateEntry(handle.engine, { id: 'bypass-no-provenance' });
      } catch (error) {
        raised = true;
        expect(error).toBeInstanceOf(MemoryInboxServiceError);
      }
      expect(raised).toBe(true);

      const handoffEntries = await handle.engine.listCanonicalHandoffEntries({
        scope_id: 'workspace:default',
      });
      expect(handoffEntries.map((entry) => entry.candidate_id)).not.toContain('bypass-no-provenance');

      const stored = await handle.engine.getMemoryCandidateEntry('bypass-no-provenance');
      expect(stored?.status).toBe('staged_for_review');
    } finally {
      await handle.teardown();
    }
  });

  test('happy path: promote preserves source_refs byte-for-byte into canonical handoff', async () => {
    const handle = await allocateSqliteBrain('s06-happy');

    const sourceRefs = [
      'Meeting notes, "Phase 5 sync", 2026-04-22 3:15 PM KST',
      'User, direct message, 2026-04-22 4:02 PM KST',
    ];

    try {
      await seedMemoryCandidate(handle.engine, {
        id: 'happy-c',
        status: 'staged_for_review',
        source_refs: sourceRefs,
        target_object_type: 'curated_note',
        target_object_id: 'concepts/graph-retrieval',
      });

      const preflight = await preflightPromoteMemoryCandidate(handle.engine, { id: 'happy-c' });
      expect(preflight.decision).toBe('allow');

      const promoted = await promoteMemoryCandidateEntry(handle.engine, {
        id: 'happy-c',
        review_reason: 'Scenario promotion happy path.',
      });
      expect(promoted.status).toBe('promoted');
      expect(promoted.reviewed_at).toBeInstanceOf(Date);

      // Promotion and canonical handoff are two separate governance steps:
      // promotion flips the candidate's status; handoff creates the canonical
      // record that I4 requires to carry provenance to the curated store.
      const handoffResult = await recordCanonicalHandoff(handle.engine, {
        candidate_id: 'happy-c',
        review_reason: 'Scenario handoff for promoted candidate.',
      });

      // Invariant I4 at the handoff boundary: source_refs must survive
      // byte-for-byte through promotion + handoff.
      expect(handoffResult.handoff.source_refs).toEqual(sourceRefs);

      // The handoff is also retrievable by scope.
      const handoffEntries = await handle.engine.listCanonicalHandoffEntries({
        scope_id: 'workspace:default',
      });
      const storedHandoff = handoffEntries.find((entry) => entry.candidate_id === 'happy-c');
      expect(storedHandoff).toBeDefined();
      expect(storedHandoff!.source_refs).toEqual(sourceRefs);

      // Double-handoff is rejected (unique constraint per candidate).
      await expect(
        recordCanonicalHandoff(handle.engine, { candidate_id: 'happy-c' }),
      ).rejects.toThrow(MemoryInboxServiceError);
    } finally {
      await handle.teardown();
    }
  });

  /**
   * I4 at the DB/engine level — all three engines (SQLite, PGLite, Postgres)
   * refuse to promote a candidate whose source_refs is empty via a
   * `json(b)_array_length(source_refs) > 0` predicate on the promotion UPDATE.
   * Defense-in-depth behind the service-layer preflight check.
   */
  test(
    'engine.promoteMemoryCandidateEntry refuses empty source_refs (I4 at engine level)',
    async () => {
      const handle = await allocateSqliteBrain('s06-engine-bypass');

      try {
        await seedMemoryCandidate(handle.engine, {
          id: 'engine-bypass',
          status: 'staged_for_review',
          source_refs: [],
        });

        // Bypass the service: call the engine directly.
        const promoted = await handle.engine.promoteMemoryCandidateEntry('engine-bypass', {
          expected_current_status: 'staged_for_review',
        });

        // Contract expectation: the engine must refuse promotion for a
        // candidate with no provenance. Today it does not — so this test
        // currently passes the `expect(promoted).toBeNull()` assertion only
        // once the engine-level check is added.
        expect(promoted).toBeNull();
      } finally {
        await handle.teardown();
      }
    },
  );
});
