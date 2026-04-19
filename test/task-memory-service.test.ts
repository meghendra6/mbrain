import { expect, test } from 'bun:test';
import { buildTaskResumeCard } from '../src/core/services/task-memory-service.ts';

test('resume reads task state before raw-source expansion', async () => {
  const calls: string[] = [];
  const engine = {
    getTaskThread: async () => {
      calls.push('thread');
      return {
        id: 'task-1',
        scope: 'work',
        title: 'Phase 1 MVP',
        goal: 'Ship operational memory',
        status: 'blocked',
        repo_path: '/repo',
        branch_name: 'docs/mbrain-redesign-doc-set',
        current_summary: 'Need resume flow',
        created_at: new Date('2026-04-19T00:00:00.000Z'),
        updated_at: new Date('2026-04-19T00:10:00.000Z'),
      };
    },
    getTaskWorkingSet: async () => {
      calls.push('working_set');
      return {
        task_id: 'task-1',
        active_paths: ['src/core/operations.ts'],
        active_symbols: ['operations'],
        blockers: ['task commands missing'],
        open_questions: ['should task resume emit retrieval trace ids'],
        next_steps: ['add shared operations'],
        verification_notes: ['schema verified'],
        last_verified_at: null,
        updated_at: new Date('2026-04-19T00:10:00.000Z'),
      };
    },
    listTaskAttempts: async () => {
      calls.push('attempts');
      return [
        {
          id: 'attempt-1',
          task_id: 'task-1',
          summary: 'CLI-only prototype',
          outcome: 'failed',
          applicability_context: { branch: 'docs/mbrain-redesign-doc-set' },
          evidence: ['would drift from MCP'],
          created_at: new Date('2026-04-19T00:09:00.000Z'),
        },
      ];
    },
    listTaskDecisions: async () => {
      calls.push('decisions');
      return [
        {
          id: 'decision-1',
          task_id: 'task-1',
          summary: 'Keep task surface in operations.ts',
          rationale: 'shared contract first',
          consequences: ['CLI and MCP stay aligned'],
          validity_context: { branch: 'docs/mbrain-redesign-doc-set' },
          created_at: new Date('2026-04-19T00:08:00.000Z'),
        },
      ];
    },
    listRetrievalTraces: async () => {
      calls.push('traces');
      return [
        {
          id: 'trace-1',
          task_id: 'task-1',
          scope: 'work',
          route: ['task_thread', 'working_set', 'attempts', 'decisions'],
          source_refs: ['task-thread:task-1'],
          verification: ['schema verified'],
          outcome: 'resume path assembled',
          created_at: new Date('2026-04-19T00:07:00.000Z'),
        },
      ];
    },
  } as any;

  const resume = await buildTaskResumeCard(engine, 'task-1');

  expect(calls).toEqual(['thread', 'working_set', 'attempts', 'decisions', 'traces']);
  expect(resume.task_id).toBe('task-1');
  expect(resume.failed_attempts).toEqual(['CLI-only prototype']);
  expect(resume.active_decisions).toEqual(['Keep task surface in operations.ts']);
  expect(resume.next_steps).toEqual(['add shared operations']);
  expect(resume.stale).toBe(true);
});
