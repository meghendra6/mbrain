import type { BrainEngine } from '../engine.ts';
import type { CodeClaimVerificationResult, TaskThread } from '../types.ts';
import {
  extractCodeClaimsFromTrace,
  verifyCodeClaims,
} from './code-claim-verification-service.ts';

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
  code_claim_verification: CodeClaimVerificationResult[];
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
  const traces = await expandCodeClaimSourceTraces(
    engine,
    await engine.listRetrievalTraces(taskId, { limit: 10 }),
  );

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
    code_claim_verification: verifyTraceCodeClaims(thread, traces),
    stale: workingSet?.last_verified_at == null,
  };
}

function verifyTraceCodeClaims(
  thread: TaskThread,
  traces: Awaited<ReturnType<BrainEngine['listRetrievalTraces']>>,
): CodeClaimVerificationResult[] {
  const claims = traces.flatMap((trace) => extractCodeClaimsFromTrace(trace));
  if (claims.length === 0) {
    return [];
  }
  if (!thread.repo_path) {
    const checkedAt = new Date().toISOString();
    return claims.map((claim) => ({
      claim,
      status: 'unverifiable',
      reason: 'repo_missing',
      checked_at: checkedAt,
    }));
  }

  return verifyCodeClaims({
    repo_path: thread.repo_path,
    branch_name: thread.branch_name,
    claims,
  });
}

async function expandCodeClaimSourceTraces(
  engine: BrainEngine,
  traces: Awaited<ReturnType<BrainEngine['listRetrievalTraces']>>,
): Promise<Awaited<ReturnType<BrainEngine['listRetrievalTraces']>>> {
  const byId = new Map(traces.map((trace) => [trace.id, trace]));
  const referencedTraceIds = traces.flatMap((trace) =>
    trace.source_refs
      .filter((sourceRef) => sourceRef.startsWith('retrieval_trace:'))
      .map((sourceRef) => sourceRef.slice('retrieval_trace:'.length)));

  for (const traceId of referencedTraceIds) {
    if (byId.has(traceId)) continue;
    const sourceTrace = await engine.getRetrievalTrace(traceId);
    if (sourceTrace) {
      byId.set(sourceTrace.id, sourceTrace);
    }
  }

  return [...byId.values()];
}
