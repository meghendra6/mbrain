import type { BrainEngine } from '../engine.ts';
import type {
  AuditApproximateCounts,
  AuditBrainLoopInput,
  AuditBrainLoopReport,
  AuditLinkedWriteCounts,
  AuditTaskCompliance,
  CanonicalHandoffEntry,
  MemoryCandidateContradictionEntry,
  MemoryCandidateFilters,
  MemoryCandidateSupersessionEntry,
  RetrievalTrace,
  ScopeGateScope,
  TaskScope,
  TaskThread,
} from '../types.ts';

const TRACE_BATCH_SIZE = 500;
const LINKED_WRITE_LOOKUP_BATCH_SIZE = 500;
const TASK_BATCH_SIZE = 500;
const TASK_SCAN_CAP = 5000;
const CANDIDATE_BATCH_SIZE = 100;
const TRACE_HISTORY_START = new Date(0);

export async function auditBrainLoop(
  engine: BrainEngine,
  input: AuditBrainLoopInput = {},
): Promise<AuditBrainLoopReport> {
  const now = new Date();
  const until = normalizeDate(input.until, now);
  const since = normalizeDate(input.since, new Date(until.getTime() - 24 * 60 * 60 * 1000));
  validateAuditWindow(since, until);
  const limit = clampLimit(input.limit ?? 50, 1, 500);
  const traces = await listAllRetrievalTracesInWindow(engine, {
    since,
    until,
    task_id: input.task_id,
    scope: input.scope,
  });
  const traceIds = traces.map((trace) => trace.id);
  const linkedWrites = await countLinkedWrites(engine, traceIds);
  const approximate = await approximateUnlinkedCandidateEvents(engine, since, until, {
    task_id: input.task_id,
    scope: input.scope,
  });
  const taskCompliance = await computeTaskCompliance(
    engine,
    traces,
    limit,
    { until },
    {
      task_id: input.task_id,
      scope: input.scope,
    },
  );
  const canonicalRefCount = traces.reduce((sum, trace) => sum + trace.source_refs.length, 0);
  const derivedRefCount = traces.reduce((sum, trace) => sum + trace.derived_consulted.length, 0);

  return {
    window: {
      since: since.toISOString(),
      until: until.toISOString(),
    },
    total_traces: traces.length,
    by_selected_intent: countBy(traces, (trace) => trace.selected_intent ?? 'unknown_legacy'),
    by_scope: countBy(traces, (trace) => trace.scope),
    by_scope_gate_policy: countPresentBy(traces, (trace) => trace.scope_gate_policy),
    most_common_defer_reason: mostCommon(
      traces
        .filter((trace) => trace.scope_gate_policy === 'defer')
        .map((trace) => trace.scope_gate_reason)
        .filter((reason): reason is string => reason != null && reason.length > 0),
    ),
    canonical_vs_derived: {
      canonical_ref_count: canonicalRefCount,
      derived_ref_count: derivedRefCount,
      canonical_ratio: ratio(canonicalRefCount, derivedRefCount),
    },
    linked_writes: linkedWrites,
    approximate,
    task_compliance: taskCompliance,
    summary_lines: buildSummaryLines(traces, linkedWrites, canonicalRefCount, derivedRefCount),
  };
}

async function listAllRetrievalTracesInWindow(
  engine: BrainEngine,
  filters: {
    since: Date;
    until: Date;
    task_id?: string;
    scope?: ScopeGateScope;
  },
): Promise<RetrievalTrace[]> {
  const traces: RetrievalTrace[] = [];
  for (let offset = 0; ; offset += TRACE_BATCH_SIZE) {
    const batch = await engine.listRetrievalTracesByWindow({
      ...filters,
      limit: TRACE_BATCH_SIZE,
      offset,
    });
    traces.push(...batch);
    if (batch.length < TRACE_BATCH_SIZE) break;
  }
  return traces;
}

async function countLinkedWrites(
  engine: BrainEngine,
  traceIds: string[],
): Promise<AuditLinkedWriteCounts> {
  if (traceIds.length === 0) {
    return {
      handoff_count: 0,
      supersession_count: 0,
      contradiction_count: 0,
      traces_with_any_linked_write: 0,
      traces_without_linked_write: 0,
    };
  }

  const handoffs: CanonicalHandoffEntry[] = [];
  const supersessions: MemoryCandidateSupersessionEntry[] = [];
  const contradictions: MemoryCandidateContradictionEntry[] = [];
  for (const chunk of chunkArray(traceIds, LINKED_WRITE_LOOKUP_BATCH_SIZE)) {
    const [handoffBatch, supersessionBatch, contradictionBatch] = await Promise.all([
      engine.listCanonicalHandoffEntriesByInteractionIds(chunk),
      engine.listMemoryCandidateSupersessionEntriesByInteractionIds(chunk),
      engine.listMemoryCandidateContradictionEntriesByInteractionIds(chunk),
    ]);
    handoffs.push(...handoffBatch);
    supersessions.push(...supersessionBatch);
    contradictions.push(...contradictionBatch);
  }

  const linkedTraceIds = new Set<string>();
  for (const handoff of handoffs) {
    if (handoff.interaction_id) linkedTraceIds.add(handoff.interaction_id);
  }
  for (const supersession of supersessions) {
    if (supersession.interaction_id) linkedTraceIds.add(supersession.interaction_id);
  }
  for (const contradiction of contradictions) {
    if (contradiction.interaction_id) linkedTraceIds.add(contradiction.interaction_id);
  }

  return {
    handoff_count: handoffs.length,
    supersession_count: supersessions.length,
    contradiction_count: contradictions.length,
    traces_with_any_linked_write: linkedTraceIds.size,
    traces_without_linked_write: traceIds.length - linkedTraceIds.size,
  };
}

async function approximateUnlinkedCandidateEvents(
  engine: BrainEngine,
  since: Date,
  until: Date,
  filters: {
    task_id?: string;
    scope?: ScopeGateScope;
  },
): Promise<AuditApproximateCounts> {
  if (filters.task_id !== undefined || filters.scope !== undefined) {
    return {
      candidate_creation_same_window: 0,
      candidate_rejection_same_window: 0,
      note: 'suppressed for filtered audits; precise correlation requires interaction_id-linked writes',
    };
  }

  const candidateCreationCount = await countMemoryCandidateEntries(engine, {
    created_since: since,
    created_until: until,
  });
  const candidateRejectionCount = await countMemoryCandidateEntries(engine, {
    status: 'rejected',
    reviewed_since: since,
    reviewed_until: until,
  });

  return {
    candidate_creation_same_window: candidateCreationCount,
    candidate_rejection_same_window: candidateRejectionCount,
    note: 'approximate; precise correlation requires memory_candidate_status_events',
  };
}

async function countMemoryCandidateEntries(
  engine: BrainEngine,
  filters: MemoryCandidateFilters,
): Promise<number> {
  let count = 0;
  for (let offset = 0; ; offset += CANDIDATE_BATCH_SIZE) {
    const batch = await engine.listMemoryCandidateEntries({
      ...filters,
      limit: CANDIDATE_BATCH_SIZE,
      offset,
    });
    count += batch.length;
    if (batch.length < CANDIDATE_BATCH_SIZE) break;
  }
  return count;
}

async function computeTaskCompliance(
  engine: BrainEngine,
  traces: RetrievalTrace[],
  limit: number,
  window: {
    until: Date;
  },
  filters: {
    task_id?: string;
    scope?: ScopeGateScope;
  } = {},
): Promise<AuditTaskCompliance> {
  const { tasks, cappedAt } = await listTaskThreadsForCompliance(engine, filters);

  const lastTraceByTask = new Map<string, RetrievalTrace>();
  for (const trace of traces) {
    if (!trace.task_id) continue;
    const previous = lastTraceByTask.get(trace.task_id);
    if (!previous || previous.created_at < trace.created_at) {
      lastTraceByTask.set(trace.task_id, trace);
    }
  }
  const tasksWithoutWindowTrace = tasks.filter((task) => !lastTraceByTask.has(task.id));
  const backlog: AuditTaskCompliance['top_backlog'] = [];
  for (const task of tasksWithoutWindowTrace.slice(0, limit)) {
    const latestTrace = await getLatestTaskTraceBefore(engine, task.id, window.until);
    backlog.push({
      task_id: task.id,
      last_trace_at: latestTrace?.created_at.toISOString() ?? null,
      last_route_kind: latestTrace ? traceRouteKind(latestTrace) : null,
    });
  }

  return {
    tasks_with_traces: tasks.filter((task) => lastTraceByTask.has(task.id)).length,
    tasks_without_traces: tasksWithoutWindowTrace.length,
    task_scan_capped_at: cappedAt,
    top_backlog: backlog,
  };
}

async function getLatestTaskTraceBefore(
  engine: BrainEngine,
  taskId: string,
  until: Date,
): Promise<RetrievalTrace | null> {
  const traces = await engine.listRetrievalTracesByWindow({
    since: TRACE_HISTORY_START,
    until,
    task_id: taskId,
    limit: 1,
    offset: 0,
  });
  return traces[0] ?? null;
}

function traceRouteKind(trace: RetrievalTrace): string | null {
  if (trace.selected_intent) {
    return trace.selected_intent;
  }
  const intentMarker = trace.verification.find((item) => item.startsWith('intent:'));
  if (intentMarker) {
    return intentMarker.slice('intent:'.length) || null;
  }
  return trace.route[0] ?? null;
}

async function listTaskThreadsForCompliance(
  engine: BrainEngine,
  filters: {
    task_id?: string;
    scope?: ScopeGateScope;
  },
): Promise<{ tasks: TaskThread[]; cappedAt: number | null }> {
  if (filters.task_id !== undefined) {
    const task = await engine.getTaskThread(filters.task_id);
    if (!task || (filters.scope !== undefined && task.scope !== filters.scope)) {
      return { tasks: [], cappedAt: null };
    }
    return { tasks: [task], cappedAt: null };
  }

  if (filters.scope !== undefined && !isTaskScope(filters.scope)) {
    return { tasks: [], cappedAt: null };
  }

  const tasks: TaskThread[] = [];
  const baseFilters = filters.scope === undefined ? {} : { scope: filters.scope };
  for (let offset = 0; tasks.length < TASK_SCAN_CAP; offset += TASK_BATCH_SIZE) {
    const remaining = TASK_SCAN_CAP - tasks.length;
    const limit = Math.min(TASK_BATCH_SIZE, remaining);
    const batch = await engine.listTaskThreads({ ...baseFilters, limit, offset });
    tasks.push(...batch);
    if (batch.length < limit) {
      return { tasks, cappedAt: null };
    }
  }

  const overflow = await engine.listTaskThreads({
    ...baseFilters,
    limit: 1,
    offset: TASK_SCAN_CAP,
  });
  return { tasks, cappedAt: overflow.length > 0 ? TASK_SCAN_CAP : null };
}

function isTaskScope(scope: ScopeGateScope): scope is TaskScope {
  return scope === 'work' || scope === 'personal' || scope === 'mixed';
}

function normalizeDate(input: Date | string | undefined, fallback: Date): Date {
  if (input === undefined) return fallback;
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) {
      throw new Error(`Invalid audit date: ${String(input)}`);
    }
    return input;
  }
  const relative = input.match(/^(\d+)([hd])$/);
  if (relative) {
    const amount = Number(relative[1]);
    const millis = relative[2] === 'h'
      ? amount * 60 * 60 * 1000
      : amount * 24 * 60 * 60 * 1000;
    return new Date(Date.now() - millis);
  }
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid audit date: ${input}`);
  }
  return parsed;
}

function validateAuditWindow(since: Date, until: Date): void {
  if (since >= until) {
    throw new Error('Invalid audit window: since must be before until');
  }
}

function clampLimit(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function countBy<K extends string>(
  traces: RetrievalTrace[],
  selector: (trace: RetrievalTrace) => K,
): Partial<Record<K, number>> {
  const counts: Partial<Record<K, number>> = {};
  for (const trace of traces) {
    const key = selector(trace);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function countPresentBy<K extends string>(
  traces: RetrievalTrace[],
  selector: (trace: RetrievalTrace) => K | null,
): Partial<Record<K, number>> {
  const counts: Partial<Record<K, number>> = {};
  for (const trace of traces) {
    const key = selector(trace);
    if (key == null) continue;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function mostCommon(values: string[]): string | null {
  if (values.length === 0) return null;
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}

function ratio(canonicalRefCount: number, derivedRefCount: number): number {
  const total = canonicalRefCount + derivedRefCount;
  if (total === 0) return 1;
  return canonicalRefCount / total;
}

function chunkArray<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function buildSummaryLines(
  traces: RetrievalTrace[],
  linkedWrites: AuditLinkedWriteCounts,
  canonicalRefCount: number,
  derivedRefCount: number,
): string[] {
  if (traces.length === 0) {
    return ['No brain-loop activity in the selected window.'];
  }
  return [
    `traces=${traces.length}`,
    `linked_writes=${linkedWrites.traces_with_any_linked_write}`,
    `read_without_linked_write=${linkedWrites.traces_without_linked_write}`,
    `canonical_refs=${canonicalRefCount}`,
    `derived_refs=${derivedRefCount}`,
  ];
}
