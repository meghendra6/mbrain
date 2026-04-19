import { expect, test } from 'bun:test';
import { formatResult, operations } from '../src/core/operations.ts';

test('task operations are registered with CLI hints', () => {
  const start = operations.find((operation) => operation.name === 'start_task');
  const resume = operations.find((operation) => operation.name === 'resume_task');
  const attempt = operations.find((operation) => operation.name === 'record_attempt');
  const decision = operations.find((operation) => operation.name === 'record_decision');

  expect(start?.cliHints?.name).toBe('task-start');
  expect(resume?.cliHints?.name).toBe('task-resume');
  expect(attempt?.cliHints?.name).toBe('task-attempt');
  expect(decision?.cliHints?.name).toBe('task-decision');
});

test('start_task seeds an empty working set', async () => {
  const calls: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const start = operations.find((operation) => operation.name === 'start_task');
  if (!start) throw new Error('start_task operation is missing');

  const result = await start.handler({
    engine: {
      createTaskThread: async (payload: Record<string, unknown>) => {
        calls.push({ type: 'thread', payload });
        return {
          ...payload,
          goal: payload.goal ?? '',
          current_summary: payload.current_summary ?? '',
          created_at: new Date(),
          updated_at: new Date(),
        };
      },
      upsertTaskWorkingSet: async (payload: Record<string, unknown>) => {
        calls.push({ type: 'working_set', payload });
        return {
          ...payload,
          last_verified_at: null,
          updated_at: new Date(),
        };
      },
      getTaskThread: async (id: string) => ({
        id,
        scope: 'work',
        title: 'Phase 1 MVP',
        goal: 'Ship operational memory',
        status: 'active',
        repo_path: process.cwd(),
        branch_name: null,
        current_summary: '',
        created_at: new Date(),
        updated_at: new Date(),
      }),
    } as any,
    config: {} as any,
    logger: console,
    dryRun: false,
  }, {
    title: 'Phase 1 MVP',
    goal: 'Ship operational memory',
    scope: 'work',
  });

  expect(calls[0]?.type).toBe('thread');
  expect(calls[1]?.type).toBe('working_set');
  expect(calls[1]?.payload).toMatchObject({
    active_paths: [],
    active_symbols: [],
    blockers: [],
    open_questions: [],
    next_steps: [],
    verification_notes: [],
  });
  expect((result as any).title).toBe('Phase 1 MVP');
});

test('formatResult renders a resume card', () => {
  const output = formatResult('resume_task', {
    task_id: 'task-1',
    title: 'Phase 1 MVP',
    status: 'blocked',
    goal: 'Ship operational memory',
    current_summary: 'Schema and engine layers are done',
    active_paths: ['src/core/operations.ts'],
    active_symbols: ['operations'],
    blockers: ['task commands missing'],
    open_questions: ['should resume emit trace ids'],
    next_steps: ['add shared operations'],
    failed_attempts: ['CLI-only task path'],
    active_decisions: ['keep working set canonical in DB'],
    latest_trace_route: ['task_thread', 'working_set', 'attempts', 'decisions'],
    stale: true,
  });

  expect(output).toContain('Phase 1 MVP');
  expect(output).toContain('CLI-only task path');
  expect(output).toContain('stale');
});
