/**
 * Scenario S21 — candidate status events join lifecycle writes to interaction ids.
 *
 * Falsifies L6/G1: an interaction-linked candidate lifecycle must be auditable
 * through retrieval_traces.id without mutating memory_candidate_entries.
 */

import { describe, expect, test } from 'bun:test';
import { allocateSqliteBrain } from './helpers.ts';
import { auditBrainLoop } from '../../src/core/services/brain-loop-audit-service.ts';
import {
  advanceMemoryCandidateStatus,
  createMemoryCandidateEntryWithStatusEvent,
  rejectMemoryCandidateEntry,
} from '../../src/core/services/memory-inbox-service.ts';

describe('S21 — candidate status events audit', () => {
  test('interaction-linked candidate lifecycle is counted through status events', async () => {
    const handle = await allocateSqliteBrain('s21-candidate-status-events');
    const traceId = 'trace-s21-candidate-status-events';
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const until = new Date(Date.now() + 60 * 60 * 1000);

    try {
      await handle.engine.createTaskThread({
        id: 'task-s21-candidate-status-events',
        scope: 'work',
        title: 'S21 candidate status events',
        status: 'active',
      });
      await handle.engine.putRetrievalTrace({
        id: traceId,
        task_id: 'task-s21-candidate-status-events',
        scope: 'work',
        route: ['memory_inbox'],
        source_refs: ['scenario:s21'],
        verification: ['intent:precision_lookup'],
        selected_intent: 'precision_lookup',
        scope_gate_policy: 'allow',
        outcome: 'scenario status-event lifecycle',
      });

      await createMemoryCandidateEntryWithStatusEvent(handle.engine, {
        id: 'candidate-s21-status-events',
        scope_id: 'workspace:default',
        candidate_type: 'fact',
        proposed_content: 'S21 candidate status events are auditable.',
        source_refs: ['Scenario S21'],
        generated_by: 'manual',
        extraction_kind: 'manual',
        confidence_score: 0.9,
        importance_score: 0.8,
        recurrence_score: 0,
        sensitivity: 'work',
        status: 'captured',
        target_object_type: 'curated_note',
        target_object_id: 'concepts/s21',
        interaction_id: traceId,
      });
      await advanceMemoryCandidateStatus(handle.engine, {
        id: 'candidate-s21-status-events',
        next_status: 'candidate',
        interaction_id: traceId,
      });
      await advanceMemoryCandidateStatus(handle.engine, {
        id: 'candidate-s21-status-events',
        next_status: 'staged_for_review',
        interaction_id: traceId,
      });
      await rejectMemoryCandidateEntry(handle.engine, {
        id: 'candidate-s21-status-events',
        review_reason: 'Scenario closes with rejection.',
        interaction_id: traceId,
      });

      const report = await auditBrainLoop(handle.engine, {
        since,
        until,
        task_id: 'task-s21-candidate-status-events',
      });

      expect(report.candidate_status_events.created_count).toBe(1);
      expect(report.candidate_status_events.advanced_count).toBe(2);
      expect(report.candidate_status_events.rejected_count).toBe(1);
      expect(report.candidate_status_events.linked_event_count).toBe(4);
      expect(report.candidate_status_events.traces_with_candidate_events).toBe(1);
      expect(report.linked_writes.traces_with_any_linked_write).toBe(1);
      expect(report.linked_writes.traces_without_linked_write).toBe(0);
      expect(report.summary_lines).toContain('linked_writes=1');
      expect(report.summary_lines).toContain('read_without_linked_write=0');
      expect(report.approximate.candidate_creation_same_window).toBe(0);
      expect(report.approximate.candidate_rejection_same_window).toBe(0);
    } finally {
      await handle.teardown();
    }
  });
});
