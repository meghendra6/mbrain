import type { BrainEngine } from '../engine.ts';

export interface TaskResumeCard {
  task_id: string;
  title: string;
  status: string;
  goal: string;
  current_summary: string;
  active_paths: string[];
  active_symbols: string[];
  blockers: string[];
  open_questions: string[];
  next_steps: string[];
  failed_attempts: string[];
  active_decisions: string[];
  latest_trace_route: string[];
  stale: boolean;
}

export async function buildTaskResumeCard(engine: BrainEngine, taskId: string): Promise<TaskResumeCard> {
  const thread = await engine.getTaskThread(taskId);
  if (!thread) {
    throw new Error(`Task thread not found: ${taskId}`);
  }

  const workingSet = await engine.getTaskWorkingSet(taskId);
  const attempts = await engine.listTaskAttempts(taskId, { limit: 5 });
  const decisions = await engine.listTaskDecisions(taskId, { limit: 5 });
  const traces = await engine.listRetrievalTraces(taskId, { limit: 1 });

  return {
    task_id: thread.id,
    title: thread.title,
    status: thread.status,
    goal: thread.goal,
    current_summary: thread.current_summary,
    active_paths: workingSet?.active_paths ?? [],
    active_symbols: workingSet?.active_symbols ?? [],
    blockers: workingSet?.blockers ?? [],
    open_questions: workingSet?.open_questions ?? [],
    next_steps: workingSet?.next_steps ?? [],
    failed_attempts: attempts
      .filter((attempt) => attempt.outcome === 'failed')
      .map((attempt) => attempt.summary),
    active_decisions: decisions.map((decision) => decision.summary),
    latest_trace_route: traces[0]?.route ?? [],
    stale: workingSet?.last_verified_at == null,
  };
}
