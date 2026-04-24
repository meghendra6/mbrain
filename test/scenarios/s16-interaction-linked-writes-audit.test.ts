/**
 * Scenario S16 — interaction_id links reads to write events for audit.
 */

import { describe, expect, test } from 'bun:test';
import { allocateSqliteBrain, seedMemoryCandidate } from './helpers.ts';
import type { BrainEngine } from '../../src/core/engine.ts';
import { recordCanonicalHandoff } from '../../src/core/services/canonical-handoff-service.ts';
import { auditBrainLoop } from '../../src/core/services/brain-loop-audit-service.ts';
import { promoteMemoryCandidateEntry } from '../../src/core/services/memory-inbox-promotion-service.ts';
import { resolveMemoryCandidateContradiction } from '../../src/core/services/memory-inbox-contradiction-service.ts';
import { supersedeMemoryCandidateEntry } from '../../src/core/services/memory-inbox-supersession-service.ts';

async function seedTrace(engine: BrainEngine, traceId: string): Promise<void> {
  await engine.putRetrievalTrace({
    id: traceId,
    task_id: null,
    scope: 'work',
    route: ['curated_notes'],
    source_refs: [],
    verification: ['intent:precision_lookup'],
    selected_intent: 'precision_lookup',
    outcome: 'precision lookup before write event',
  });
}

async function auditCurrentWindow(engine: BrainEngine) {
  return auditBrainLoop(engine, {
    since: new Date(Date.now() - 60 * 60 * 1000),
    until: new Date(Date.now() + 60 * 60 * 1000),
  });
}

describe('S16 — interaction-linked write audit', () => {
  test('canonical handoff with interaction_id counts as a linked write', async () => {
    const handle = await allocateSqliteBrain('s16-handoff');
    const traceId = 'trace-s16-handoff';

    try {
      await seedTrace(handle.engine, traceId);
      await seedMemoryCandidate(handle.engine, {
        id: 'candidate-s16-handoff',
        status: 'staged_for_review',
        target_object_id: 'concepts/s16-handoff',
      });
      await promoteMemoryCandidateEntry(handle.engine, { id: 'candidate-s16-handoff' });
      await recordCanonicalHandoff(handle.engine, {
        candidate_id: 'candidate-s16-handoff',
        interaction_id: traceId,
      });

      const report = await auditCurrentWindow(handle.engine);

      expect(report.linked_writes.handoff_count).toBe(1);
      expect(report.linked_writes.traces_with_any_linked_write).toBe(1);
      expect(report.linked_writes.traces_without_linked_write).toBe(0);
    } finally {
      await handle.teardown();
    }
  });

  test('supersession with interaction_id counts as a linked write', async () => {
    const handle = await allocateSqliteBrain('s16-supersession');
    const traceId = 'trace-s16-supersession';

    try {
      await seedTrace(handle.engine, traceId);
      await seedMemoryCandidate(handle.engine, {
        id: 'candidate-s16-old',
        status: 'staged_for_review',
        target_object_id: 'concepts/s16-old',
      });
      await seedMemoryCandidate(handle.engine, {
        id: 'candidate-s16-new',
        status: 'staged_for_review',
        target_object_id: 'concepts/s16-new',
      });
      await promoteMemoryCandidateEntry(handle.engine, { id: 'candidate-s16-old' });
      await promoteMemoryCandidateEntry(handle.engine, { id: 'candidate-s16-new' });
      await supersedeMemoryCandidateEntry(handle.engine, {
        superseded_candidate_id: 'candidate-s16-old',
        replacement_candidate_id: 'candidate-s16-new',
        interaction_id: traceId,
      });

      const report = await auditCurrentWindow(handle.engine);

      expect(report.linked_writes.supersession_count).toBe(1);
      expect(report.linked_writes.traces_with_any_linked_write).toBe(1);
      expect(report.linked_writes.traces_without_linked_write).toBe(0);
    } finally {
      await handle.teardown();
    }
  });

  test('contradiction with interaction_id counts as a linked write', async () => {
    const handle = await allocateSqliteBrain('s16-contradiction');
    const traceId = 'trace-s16-contradiction';

    try {
      await seedTrace(handle.engine, traceId);
      await seedMemoryCandidate(handle.engine, {
        id: 'candidate-s16-claim',
        status: 'staged_for_review',
        target_object_id: 'concepts/s16-claim',
      });
      await seedMemoryCandidate(handle.engine, {
        id: 'candidate-s16-challenged',
        status: 'staged_for_review',
        target_object_id: 'concepts/s16-challenged',
      });
      await resolveMemoryCandidateContradiction(handle.engine, {
        candidate_id: 'candidate-s16-claim',
        challenged_candidate_id: 'candidate-s16-challenged',
        outcome: 'unresolved',
        interaction_id: traceId,
      });

      const report = await auditCurrentWindow(handle.engine);

      expect(report.linked_writes.contradiction_count).toBe(1);
      expect(report.linked_writes.traces_with_any_linked_write).toBe(1);
      expect(report.linked_writes.traces_without_linked_write).toBe(0);
    } finally {
      await handle.teardown();
    }
  });
});
