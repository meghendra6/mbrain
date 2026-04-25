import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
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
  expect(resume.code_claim_verification).toEqual([]);
  expect(resume.stale).toBe(true);
});

test('resume reports branch-sensitive code claim verification from recent traces', async () => {
  const repoPath = mkdtempSync(join(tmpdir(), 'mbrain-task-resume-code-claim-'));

  try {
    mkdirSync(join(repoPath, 'src'), { recursive: true });
    writeFileSync(join(repoPath, 'src/example.ts'), 'export function presentSymbol() { return true; }\n');

    const engine = {
      getTaskThread: async () => ({
        id: 'task-1',
        scope: 'work',
        title: 'Branch sensitive task',
        goal: 'Avoid stale code claims',
        status: 'active',
        repo_path: repoPath,
        branch_name: 'branch-b',
        current_summary: 'Historical answer was from branch A',
        created_at: new Date('2026-04-25T00:00:00.000Z'),
        updated_at: new Date('2026-04-25T00:01:00.000Z'),
      }),
      getTaskWorkingSet: async () => null,
      listTaskAttempts: async () => [],
      listTaskDecisions: async () => [],
      listRetrievalTraces: async () => [
        {
          id: 'trace-latest',
          task_id: 'task-1',
          scope: 'work',
          route: ['code_claim_reverification'],
          source_refs: ['retrieval_trace:trace-source'],
          verification: ['code_claim_result:src/example.ts:stale:branch_mismatch'],
          outcome: 'stale marker',
          created_at: new Date('2026-04-25T00:02:00.000Z'),
        },
      ],
      getRetrievalTrace: async (id: string) => id === 'trace-source' ? {
          id: 'trace-source',
          task_id: 'task-1',
          scope: 'work',
          route: ['task_resume'],
          source_refs: ['task-thread:task-1'],
          verification: ['code_claim:src/example.ts:presentSymbol:branch=branch-a'],
          outcome: 'historical branch A answer',
          created_at: new Date('2026-04-25T00:01:00.000Z'),
        } : null,
    } as any;

    const resume = await buildTaskResumeCard(engine, 'task-1');

    expect(resume.latest_trace_route).toEqual(['code_claim_reverification']);
    expect(resume.code_claim_verification[0]?.status).toBe('stale');
    expect(resume.code_claim_verification[0]?.reason).toBe('branch_mismatch');
    expect(resume.code_claim_verification[0]?.claim.source_trace_id).toBe('trace-source');
  } finally {
    rmSync(repoPath, { recursive: true, force: true });
  }
});

test('resume reports code claims as unverifiable when the task repo path is missing', async () => {
  const engine = {
    getTaskThread: async () => ({
      id: 'task-1',
      scope: 'work',
      title: 'Missing repo task',
      goal: 'Expose unverifiable claims',
      status: 'active',
      repo_path: null,
      branch_name: 'main',
      current_summary: 'Historical trace has code claims',
      created_at: new Date('2026-04-25T00:00:00.000Z'),
      updated_at: new Date('2026-04-25T00:01:00.000Z'),
    }),
    getTaskWorkingSet: async () => null,
    listTaskAttempts: async () => [],
    listTaskDecisions: async () => [],
    listRetrievalTraces: async () => [
      {
        id: 'trace-source',
        task_id: 'task-1',
        scope: 'work',
        route: ['task_resume'],
        source_refs: ['task-thread:task-1'],
        verification: ['code_claim:src/example.ts:presentSymbol'],
        outcome: 'historical answer referenced code',
        created_at: new Date('2026-04-25T00:01:00.000Z'),
      },
    ],
    getRetrievalTrace: async () => null,
  } as any;

  const resume = await buildTaskResumeCard(engine, 'task-1');

  expect(resume.code_claim_verification[0]?.status).toBe('unverifiable');
  expect(resume.code_claim_verification[0]?.reason).toBe('repo_missing');
  expect(resume.code_claim_verification[0]?.claim.source_trace_id).toBe('trace-source');
});
