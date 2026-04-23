/**
 * Scenario S18 — handoff carries interaction_id.
 */

import { describe, expect, test } from 'bun:test';
import { allocateSqliteBrain, seedMemoryCandidate } from './helpers.ts';
import { selectRetrievalRoute } from '../../src/core/services/retrieval-route-selector-service.ts';
import { promoteMemoryCandidateEntry } from '../../src/core/services/memory-inbox-promotion-service.ts';
import { recordCanonicalHandoff } from '../../src/core/services/canonical-handoff-service.ts';

describe('S18 — handoff carries interaction_id', () => {
  test('handoff row records interaction_id from the preceding retrieval trace', async () => {
    const handle = await allocateSqliteBrain('s18-happy');

    try {
      const traceResult = await selectRetrievalRoute(handle.engine, {
        intent: 'broad_synthesis',
        query: 'anchor interaction',
        persist_trace: true,
      });
      expect(traceResult.trace).toBeDefined();
      const interactionId = traceResult.trace!.id;

      await seedMemoryCandidate(handle.engine, {
        id: 'cand-s18',
        status: 'staged_for_review',
        source_refs: ['User, direct message, 2026-04-24 KST'],
        target_object_type: 'curated_note',
        target_object_id: 'concepts/s18-target',
      });
      await promoteMemoryCandidateEntry(handle.engine, { id: 'cand-s18' });
      const handoff = await recordCanonicalHandoff(handle.engine, {
        candidate_id: 'cand-s18',
        interaction_id: interactionId,
      });

      expect(handoff.handoff.interaction_id).toBe(interactionId);

      const entries = await handle.engine.listCanonicalHandoffEntries({
        scope_id: 'workspace:default',
      });
      const stored = entries.find((e) => e.candidate_id === 'cand-s18');
      expect(stored).toBeDefined();
      expect(stored!.interaction_id).toBe(interactionId);
    } finally {
      await handle.teardown();
    }
  });
});
