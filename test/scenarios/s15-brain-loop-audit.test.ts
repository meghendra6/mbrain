/**
 * Scenario S15 — brain-loop audit reads structured trace fidelity columns.
 */

import { describe, expect, test } from 'bun:test';
import { allocateSqliteBrain } from './helpers.ts';
import { auditBrainLoop } from '../../src/core/services/brain-loop-audit-service.ts';

describe('S15 — brain-loop audit distributions', () => {
  test('audit distributions come from structured trace columns, including legacy null intent', async () => {
    const handle = await allocateSqliteBrain('s15-audit');
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const until = new Date(Date.now() + 60 * 60 * 1000);

    try {
      await handle.engine.putRetrievalTrace({
        id: 'trace-s15-task-resume',
        task_id: null,
        scope: 'work',
        route: ['task_thread'],
        source_refs: ['task-thread:s15'],
        derived_consulted: [],
        verification: ['intent:task_resume'],
        selected_intent: 'task_resume',
        scope_gate_policy: 'allow',
        outcome: 'task resume route selected',
      });
      await handle.engine.putRetrievalTrace({
        id: 'trace-s15-mixed-defer',
        task_id: null,
        scope: 'mixed',
        route: ['context_map'],
        source_refs: [],
        derived_consulted: ['context-map:workspace'],
        verification: ['intent:mixed_scope_bridge'],
        selected_intent: 'mixed_scope_bridge',
        scope_gate_policy: 'defer',
        scope_gate_reason: 'personal_scope_requires_explicit_intent',
        outcome: 'mixed bridge deferred to explicit user consent',
      });
      await handle.engine.putRetrievalTrace({
        id: 'trace-s15-legacy',
        task_id: null,
        scope: 'unknown',
        route: [],
        source_refs: [],
        verification: [],
        selected_intent: null,
        scope_gate_policy: null,
        outcome: 'legacy trace without structured intent',
      });

      const report = await auditBrainLoop(handle.engine, { since, until });

      expect(report.total_traces).toBe(3);
      expect(report.by_selected_intent.task_resume).toBe(1);
      expect(report.by_selected_intent.mixed_scope_bridge).toBe(1);
      expect(report.by_selected_intent.unknown_legacy).toBe(1);
      expect(report.by_scope.work).toBe(1);
      expect(report.by_scope.mixed).toBe(1);
      expect(report.by_scope.unknown).toBe(1);
      expect(report.by_scope_gate_policy.allow).toBe(1);
      expect(report.by_scope_gate_policy.defer).toBe(1);
      expect(report.most_common_defer_reason).toBe('personal_scope_requires_explicit_intent');
      expect(report.canonical_vs_derived.canonical_ref_count).toBe(1);
      expect(report.canonical_vs_derived.derived_ref_count).toBe(1);
    } finally {
      await handle.teardown();
    }
  });
});
