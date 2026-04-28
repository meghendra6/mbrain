import { describe, expect, test } from 'bun:test';
import { selectActivationPolicy } from '../src/core/services/memory-activation-policy-service.ts';

describe('memory activation policy', () => {
  test('allows compiled truth as answer ground', () => {
    const result = selectActivationPolicy({
      scenario: 'knowledge_qa',
      artifacts: [{
        id: 'page:people/pedro',
        artifact_kind: 'compiled_truth',
        source_ref: 'page:people/pedro',
      }],
    });

    expect(result.decisions[0]).toMatchObject({
      artifact_id: 'page:people/pedro',
      decision: 'answer_ground',
      authority: 'canonical_compiled_truth',
    });
    expect(result.next_tool).toBe('answer_now');
  });

  test('keeps timeline hits citation-only for current synthesis', () => {
    const result = selectActivationPolicy({
      scenario: 'knowledge_qa',
      artifacts: [{
        id: 'timeline:people/pedro:2026-04-01',
        artifact_kind: 'timeline',
        source_ref: 'page:people/pedro',
      }],
    });

    expect(result.decisions[0]?.decision).toBe('citation_only');
    expect(result.decisions[0]?.authority).toBe('source_or_timeline_evidence');
  });

  test('treats context maps as orientation only', () => {
    const result = selectActivationPolicy({
      scenario: 'project_qa',
      artifacts: [{
        id: 'map:workspace',
        artifact_kind: 'context_map',
        source_ref: 'context-map:workspace',
      }],
    });

    expect(result.decisions[0]?.decision).toBe('orientation_only');
    expect(result.next_tool).toBe('get_page');
  });

  test('requires verification for stale codemap pointers', () => {
    const result = selectActivationPolicy({
      scenario: 'project_qa',
      artifacts: [{
        id: 'codemap:systems/mbrain#selectRetrievalRoute',
        artifact_kind: 'codemap_pointer',
        source_ref: 'page:systems/mbrain',
        stale: true,
      }],
    });

    expect(result.decisions[0]?.decision).toBe('verify_first');
    expect(result.verification_required).toBe(true);
    expect(result.next_tool).toBe('reverify_code_claims');
  });

  test('suppresses failed attempts only when anchors are valid', () => {
    const result = selectActivationPolicy({
      scenario: 'coding_continuation',
      artifacts: [{
        id: 'attempt:failed-1',
        artifact_kind: 'task_attempt_failed',
        source_ref: 'task-attempt:failed-1',
        anchors_valid: true,
      }],
    });

    expect(result.decisions[0]?.decision).toBe('suppress_if_valid');
    expect(result.writeback_hint).toBe('record_trace');
  });

  test('ignores scope-denied artifacts', () => {
    const result = selectActivationPolicy({
      scenario: 'personal_recall',
      artifacts: [{
        id: 'profile:secret',
        artifact_kind: 'profile_memory',
        source_ref: 'profile-memory:secret',
        scope_policy: 'deny',
      }],
    });

    expect(result.decisions[0]?.decision).toBe('ignore');
    expect(result.next_tool).toBe('evaluate_scope_gate');
  });
});
