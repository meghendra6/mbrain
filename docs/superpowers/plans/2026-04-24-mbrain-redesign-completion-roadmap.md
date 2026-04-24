# MBrain Redesign Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the remaining redesign work after PR #40 so `mbrain` can prove the brain-agent loop runs, keep strict type regressions out of CI, and close the remaining scenario contract gaps.

**Architecture:** The completion path stays loop-first: retrieval traces are the agent-turn identity, linked governance event rows attach by `interaction_id`, audit reads trace/write joins instead of strings, and later quality work consumes that evidence. Candidate creation/rejection remains approximate until a future status-event log exists. The plan is split into independently reviewable PRs so observability, type-safety cleanup, ranking, request decomposition, and code verification can each be tested and reverted without entangling unrelated concerns.

**Tech Stack:** Bun, TypeScript, SQLite (`bun:sqlite`), PGLite, Postgres, existing `BrainEngine` boundary, `operations.ts` operation registry, scenario tests under `test/scenarios`, GitHub Actions.

---

## Current Integrated State

As of 2026-04-24 on `origin/master` after PR #39 and PR #40:

- PR #38 is merged: Sprint 1.0 interaction identity foundation.
- PR #39 is merged: Postgres JSONB persistence correctness and legacy scalar-string repair.
- PR #40 is merged: Sprint 1.1A retrieval trace fidelity fields.
- `bun test` passed locally with `1127 pass / 138 skip / 5 todo / 0 fail`.
- `bun run test:scenarios` passed locally with `51 pass / 2 skip / 5 todo / 0 fail`.
- `DATABASE_URL=postgresql://postgres:postgres@localhost:5434/mbrain_test bun test test/task-memory-schema.test.ts test/retrieval-route-trace-service.test.ts test/task-memory-operations.test.ts test/scenarios/s14-retrieval-trace-fidelity.test.ts test/postgres-jsonb-engine.test.ts` passed with `34 pass / 0 fail`.
- `bun run build` passed.
- `bunx tsc --noEmit --pretty false` still fails with 853 TypeScript errors across 1533 output lines.

The redesign is not complete. The remaining contract gaps are:

- Loop observability audit is not implemented: no `audit_brain_loop` operation exists.
- `tsc` is not green and therefore cannot be enforced in CI.
- Scenario contract placeholders remain for L1 request-level intent decomposition, L2 canonical-first broad synthesis, and L4 code claim verification.
- Final acceptance does not yet require zero scenario placeholders, clean `tsc`, and a working loop audit report.

## Completion Definition

`mbrain` is considered complete against the current redesign set when all of these are true:

- `mbrain audit-brain-loop --since 24h --json` returns a structured report with trace counts, intent/scope/gate distributions, canonical-vs-derived counts, linked-write counts, approximate unlinked-candidate counts, task compliance, and summary lines.
- Linked write counts are computed by joining `retrieval_traces.id` to event-table `interaction_id`, not by parsing free-form text.
- Every scenario placeholder in `test/scenarios` is replaced by a real test or intentionally removed because the scenario is covered by a stricter test.
- `bun run test:scenarios` reports zero failing tests and zero scenario placeholders.
- `bun test` reports zero failing tests.
- `bunx tsc --noEmit --pretty false` reports zero errors locally and runs in CI before `bun test`.
- GitHub Actions include the existing default test job, gitleaks, E2E Tier 1, and the Postgres JSONB job from PR #39.
- The final docs state which invariants are implemented and which future product extensions are outside the redesign completion boundary.

## PR Dependency Graph

| Order | PR Scope | Branch Name | Depends On | Merge Gate |
|---|---|---|---|---|
| 1 | Sprint 1.1B loop audit | `sprint-1.1b-loop-audit` | `master` after PR #40 | Audit scenarios green, full tests green |
| 2 | Sprint 0 typecheck baseline | `sprint-0-tsc-baseline` | `master`; can run in parallel with PR 1 but merge after PR 1 if conflicts appear | `bunx tsc --noEmit --pretty false` green, CI updated |
| 3 | L1 request decomposition | `sprint-2-request-decomposition` | PR 1 preferred, PR 2 required before CI typecheck gate | S5 placeholder replaced and green |
| 4 | L2 canonical-first ranking | `sprint-3-canonical-first-ranking` | PR 1 preferred, PR 2 required before CI typecheck gate | S9 placeholders replaced and green |
| 5 | L4 code claim verification | `sprint-4-code-claim-verification` | PR 1 preferred, PR 2 required before CI typecheck gate | S11 placeholders replaced and green |
| 6 | Final acceptance closure | `sprint-final-acceptance-closure` | PRs 1-5 | No scenario placeholders, `tsc` green, full suite green |

Recommended next PR: Sprint 1.1B loop audit. It is the highest leverage because it gives every later PR a way to prove whether reads and writes are actually paired.

---

## PR 1: Sprint 1.1B Loop Audit

**Goal:** Ship `audit_brain_loop` on top of trace identity and trace fidelity.

**Files:**

- Create: `src/core/services/brain-loop-audit-service.ts`
- Create: `src/core/operations-brain-loop-audit.ts`
- Modify: `src/core/types.ts`
- Modify: `src/core/engine.ts`
- Modify: `src/core/sqlite-engine.ts`
- Modify: `src/core/pglite-engine.ts`
- Modify: `src/core/postgres-engine.ts`
- Modify: `src/core/operations.ts`
- Modify: `test/scenarios/README.md`
- Create: `test/brain-loop-audit-service.test.ts`
- Create: `test/brain-loop-audit-operations.test.ts`
- Create: `test/scenarios/s15-brain-loop-audit.test.ts`
- Create: `test/scenarios/s16-interaction-linked-writes-audit.test.ts`

### Task 1.1: Add Audit Types and Engine Query Surfaces

- [ ] **Step 1: Add failing type-level and service tests**

Create `test/brain-loop-audit-service.test.ts` with tests that call a not-yet-existing `auditBrainLoop` service. The first test seeds two traces in a SQLite engine and expects:

```ts
expect(report.total_traces).toBe(2);
expect(report.by_selected_intent.task_resume).toBe(1);
expect(report.by_selected_intent.broad_synthesis).toBe(1);
expect(report.canonical_vs_derived.canonical_ref_count).toBe(1);
expect(report.canonical_vs_derived.derived_ref_count).toBe(1);
expect(report.linked_writes.traces_without_linked_write).toBe(2);
```

Run:

```bash
bun test test/brain-loop-audit-service.test.ts
```

Expected: FAIL because `src/core/services/brain-loop-audit-service.ts` does not exist.

- [ ] **Step 2: Add shared types**

Modify `src/core/types.ts` with these public report types:

```ts
export interface AuditBrainLoopInput {
  since?: Date | string;
  until?: Date | string;
  task_id?: string;
  scope?: ScopeGateScope;
  limit?: number;
}

export interface AuditLinkedWriteCounts {
  handoff_count: number;
  supersession_count: number;
  contradiction_count: number;
  traces_with_any_linked_write: number;
  traces_without_linked_write: number;
}

export interface AuditApproximateCounts {
  candidate_creation_same_window: number;
  candidate_rejection_same_window: number;
  note: string;
}

export interface AuditTaskCompliance {
  tasks_with_traces: number;
  tasks_without_traces: number;
  task_scan_capped_at: number | null;
  top_backlog: Array<{
    task_id: string;
    last_trace_at: string | null;
    last_route_kind: string | null;
  }>;
}

export interface AuditBrainLoopReport {
  window: { since: string; until: string };
  total_traces: number;
  by_selected_intent: Partial<Record<RetrievalRouteIntent | 'unknown_legacy', number>>;
  by_scope: Partial<Record<ScopeGateScope, number>>;
  by_scope_gate_policy: Partial<Record<ScopeGatePolicy, number>>;
  most_common_defer_reason: string | null;
  canonical_vs_derived: {
    canonical_ref_count: number;
    derived_ref_count: number;
    canonical_ratio: number;
  };
  linked_writes: AuditLinkedWriteCounts;
  approximate: AuditApproximateCounts;
  task_compliance: AuditTaskCompliance;
  summary_lines: string[];
}

export interface RetrievalTraceWindowFilters {
  since: Date;
  until: Date;
  task_id?: string;
  scope?: ScopeGateScope;
  limit?: number;
  offset?: number;
}
```

- [ ] **Step 3: Add engine interface methods**

Modify `src/core/engine.ts`:

```ts
listRetrievalTracesByWindow(filters: RetrievalTraceWindowFilters): Promise<RetrievalTrace[]>;
listCanonicalHandoffEntriesByInteractionIds(interactionIds: string[]): Promise<CanonicalHandoffEntry[]>;
listMemoryCandidateSupersessionEntriesByInteractionIds(interactionIds: string[]): Promise<MemoryCandidateSupersessionEntry[]>;
listMemoryCandidateContradictionEntriesByInteractionIds(interactionIds: string[]): Promise<MemoryCandidateContradictionEntry[]>;
```

Also add `offset?: number` to `TaskThreadFilters` in `src/core/types.ts`.

Run:

```bash
bun test test/task-memory-schema.test.ts
```

Expected: FAIL until all engines implement the new methods.

- [ ] **Step 4: Implement SQLite methods**

Modify `src/core/sqlite-engine.ts`:

```ts
async listRetrievalTracesByWindow(filters: RetrievalTraceWindowFilters): Promise<RetrievalTrace[]> {
  const limit = filters.limit ?? 500;
  const offset = filters.offset ?? 0;
  const where = ['created_at >= ?', 'created_at < ?'];
  const params: Array<string | number> = [
    filters.since.toISOString(),
    filters.until.toISOString(),
  ];
  if (filters.task_id !== undefined) {
    where.push('task_id = ?');
    params.push(filters.task_id);
  }
  if (filters.scope !== undefined) {
    where.push('scope = ?');
    params.push(filters.scope);
  }
  params.push(limit, offset);
  const rows = this.database.query(`
    SELECT * FROM retrieval_traces
    WHERE ${where.join(' AND ')}
    ORDER BY created_at DESC, id DESC
    LIMIT ? OFFSET ?
  `).all(...params) as Record<string, unknown>[];
  return rows.map(mapRetrievalTraceRow);
}
```

Add three `interaction_id IN (...)` methods. For empty arrays, return `[]` immediately. Use chunking at 500 IDs to avoid oversized parameter lists.

Also update `listTaskThreads(filters)` to honor `offset`:

```ts
const limit = filters?.limit ?? 50;
const offset = filters?.offset ?? 0;
...
ORDER BY updated_at DESC, id DESC
LIMIT ? OFFSET ?
```

- [ ] **Step 5: Implement PGLite and Postgres methods**

Modify `src/core/pglite-engine.ts` and `src/core/postgres-engine.ts`. Use `WHERE interaction_id = ANY($1)` style for Postgres/PGLite when available in the local query helper; otherwise use parameterized `IN` generation consistent with nearby list methods.

Also update both `listTaskThreads(filters)` implementations to honor `offset` with the same ordering they already use. Add one cross-engine assertion in `test/task-memory-engine.test.ts` that creates three task threads, calls `listTaskThreads({ limit: 1, offset: 1 })`, and verifies the second row is returned.

Run:

```bash
bun test test/canonical-handoff-engine.test.ts test/memory-inbox-engine.test.ts test/task-memory-engine.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/types.ts src/core/engine.ts src/core/sqlite-engine.ts src/core/pglite-engine.ts src/core/postgres-engine.ts test/brain-loop-audit-service.test.ts
git commit -m "feat(engine): add brain-loop audit query surfaces"
```

### Task 1.2: Implement Audit Service

- [ ] **Step 1: Implement `brain-loop-audit-service.ts`**

Create `src/core/services/brain-loop-audit-service.ts` with:

```ts
export async function auditBrainLoop(
  engine: BrainEngine,
  input: AuditBrainLoopInput = {},
): Promise<AuditBrainLoopReport>
```

Required behavior:

- Default window is `[now - 24h, now)`.
- `limit` defaults to 50 and clamps to 500 for backlog rows.
- Trace pagination scans batches of 500 until no more rows.
- Intent distribution uses `trace.selected_intent ?? 'unknown_legacy'`.
- Scope distribution uses `trace.scope`.
- Gate distribution ignores `null` policies.
- `most_common_defer_reason` is the most frequent non-null reason among `scope_gate_policy === 'defer'`.
- `canonical_ratio` is `canonical_ref_count / (canonical_ref_count + derived_ref_count)`, or `1` when both counts are zero.
- Linked writes use only the three `interaction_id` engine methods.
- Approximate counts use `listMemoryCandidateEntries` with pagination and filter in service code by `created_at` and `reviewed_at`.
- Task compliance scans `listTaskThreads({ limit: 500, offset })` until 5000 rows, then sets `task_scan_capped_at: 5000`.

- [ ] **Step 2: Run service tests**

```bash
bun test test/brain-loop-audit-service.test.ts
```

Expected: PASS.

- [ ] **Step 3: Add edge-case tests**

Extend `test/brain-loop-audit-service.test.ts` with:

- Empty window returns zeroed counts and at least one summary line.
- Legacy row with `selected_intent: null` increments `by_selected_intent.unknown_legacy`.
- Candidate create/reject counts are labeled approximate and do not increment `linked_writes`.
- 5001 seeded task threads produce `task_scan_capped_at === 5000`.

Run:

```bash
bun test test/brain-loop-audit-service.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/core/services/brain-loop-audit-service.ts test/brain-loop-audit-service.test.ts
git commit -m "feat(service): add brain-loop audit report"
```

### Task 1.3: Add Operation and CLI Surface

- [ ] **Step 1: Add operation tests**

Create `test/brain-loop-audit-operations.test.ts`. Assert that:

- `audit_brain_loop` exists in `operationsByName`.
- Dry-run returns parsed params without touching the engine.
- Invalid `limit < 0` returns `invalid_params`.
- `scope` accepts only `work`, `personal`, `mixed`, and `unknown`.
- Relative `since: '24h'` parses successfully.

Run:

```bash
bun test test/brain-loop-audit-operations.test.ts
```

Expected: FAIL because the operation is not registered.

- [ ] **Step 2: Add `operations-brain-loop-audit.ts`**

Create `src/core/operations-brain-loop-audit.ts` following the dependency-injection pattern in `src/core/operations-memory-inbox.ts`. Export:

```ts
export function createBrainLoopAuditOperations(deps: {
  OperationError: OperationErrorCtor;
}): Operation[]
```

Define one operation:

```ts
{
  name: 'audit_brain_loop',
  description: 'Audit whether the brain-agent loop executed in a window.',
  params: {
    since: { type: 'string', description: 'ISO timestamp or relative window such as 24h or 7d. Default: now-24h.' },
    until: { type: 'string', description: 'ISO timestamp. Default: now.' },
    task_id: { type: 'string' },
    scope: { type: 'string', enum: ['work', 'personal', 'mixed', 'unknown'] },
    limit: { type: 'number', description: 'Backlog cap. Default 50, max 500.' },
    json: { type: 'boolean', description: 'Accepted for CLI parity; operation always returns structured data.' },
  },
  mutating: false,
  cliHints: { name: 'audit-brain-loop', aliases: { n: 'limit' } },
}
```

- [ ] **Step 3: Register operation**

Modify `src/core/operations.ts`:

```ts
import { createBrainLoopAuditOperations } from './operations-brain-loop-audit.ts';

const brainLoopAuditOperations = createBrainLoopAuditOperations({ OperationError });
```

Add `...brainLoopAuditOperations` near operational-memory operations.

- [ ] **Step 4: Run operation and CLI tests**

```bash
bun test test/brain-loop-audit-operations.test.ts test/cli.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/operations-brain-loop-audit.ts src/core/operations.ts test/brain-loop-audit-operations.test.ts
git commit -m "feat(ops): expose brain-loop audit operation"
```

### Task 1.4: Add Scenario Coverage and Docs

- [ ] **Step 1: Add S15 and S16**

Create `test/scenarios/s15-brain-loop-audit.test.ts`:

- Seed traces with varied intent/scope/gate values.
- Run `auditBrainLoop`.
- Assert structured distributions come from columns, including a legacy null intent case.

Create `test/scenarios/s16-interaction-linked-writes-audit.test.ts`:

- Seed a trace.
- Create a canonical handoff with `interaction_id: trace.id`.
- Create a supersession and contradiction row with the same trace id in separate assertions.
- Run audit.
- Assert `traces_with_any_linked_write === 1` for each linked-write path.

- [ ] **Step 2: Update scenario README**

Modify `test/scenarios/README.md`:

- Add S15 and S16 rows as green.
- Move S14 status to green trace-fidelity baseline already shipped in PR #40.
- Keep L1/L2/L4 as remaining placeholders.

- [ ] **Step 3: Run scenario and full verification**

```bash
bun run test:scenarios
bun test test/brain-loop-audit-service.test.ts test/brain-loop-audit-operations.test.ts
bun test
bun run build
git diff --check
```

Expected:

- Scenario count increases.
- Full suite has zero failures.
- Placeholder count remains 5 until PRs 3-5.

- [ ] **Step 4: Postgres verification**

With a local Postgres container running:

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5434/mbrain_test bun test test/brain-loop-audit-service.test.ts test/scenarios/s16-interaction-linked-writes-audit.test.ts test/postgres-jsonb-engine.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit and open PR**

```bash
git add src/core/types.ts src/core/engine.ts src/core/sqlite-engine.ts src/core/pglite-engine.ts src/core/postgres-engine.ts src/core/operations.ts src/core/operations-brain-loop-audit.ts src/core/services/brain-loop-audit-service.ts test/brain-loop-audit-service.test.ts test/brain-loop-audit-operations.test.ts test/scenarios/s15-brain-loop-audit.test.ts test/scenarios/s16-interaction-linked-writes-audit.test.ts test/scenarios/README.md
git commit -m "test(scenarios): add brain-loop audit coverage"
git push -u origin sprint-1.1b-loop-audit
gh pr create --base master --head sprint-1.1b-loop-audit --title "Sprint 1.1B: add brain-loop audit" --body-file /tmp/mbrain-pr41-body.md
```

---

## PR 2: Sprint 0 TypeScript Baseline Cleanup

**Goal:** Make `bunx tsc --noEmit --pretty false` green and enforce it in CI.

**Files:**

- Modify: `src/core/engine.ts`
- Modify: `src/core/sqlite-engine.ts`
- Modify: `src/core/postgres-engine.ts`
- Modify: `src/core/pglite-engine.ts`
- Modify: `src/core/db.ts`
- Modify: `src/core/engine-factory.ts`
- Modify: `src/core/file-resolver.ts`
- Modify: `src/core/operations.ts`
- Modify: `src/core/pglite-lock.ts`
- Modify: `src/core/services/historical-validity-service.ts`
- Modify: `src/core/services/map-derived-candidate-service.ts`
- Modify: `src/core/storage/supabase.ts`
- Modify: scenario and operation tests that pass `SQLiteEngine` where `BrainEngine` is expected.
- Modify: `.github/workflows/test.yml`

### Task 2.1: Fix Engine Contract Mismatch

- [ ] **Step 1: Confirm current failure family**

```bash
bunx tsc --noEmit --pretty false 2>&1 | rg -c "runMigration"
```

Expected: nonzero count.

- [ ] **Step 2: Add `runMigration` to `SQLiteEngine`**

Implement in `src/core/sqlite-engine.ts`:

```ts
async runMigration(_version: number, sql: string): Promise<void> {
  this.database.exec(sql);
}
```

This aligns `SQLiteEngine` with `BrainEngine` instead of weakening the interface. Do not update `config.version` here; `runMigrations()` owns version advancement after SQL and any migration handler both succeed.

- [ ] **Step 3: Run focused tests and tsc slice**

```bash
bun test test/task-memory-engine.test.ts test/sqlite-engine.test.ts test/scenarios/helpers.ts
bunx tsc --noEmit --pretty false 2>&1 | rg "runMigration|SQLiteEngine"
```

Expected: tests pass; no `runMigration`-related TypeScript errors remain.

- [ ] **Step 4: Commit**

```bash
git add src/core/sqlite-engine.ts test
git commit -m "fix(tsc): align SQLiteEngine with BrainEngine migration contract"
```

### Task 2.2: Fix SQL Binding and JSON Type Errors

- [ ] **Step 1: Add local binding helpers**

In `src/core/sqlite-engine.ts`, add narrow helper functions close to existing row-mapping helpers:

```ts
type SqliteBinding = string | number | bigint | boolean | null | Uint8Array;

function sqliteBindings(values: unknown[]): SqliteBinding[] {
  return values.map((value) => {
    if (
      typeof value === 'string'
      || typeof value === 'number'
      || typeof value === 'bigint'
      || typeof value === 'boolean'
      || value === null
      || value instanceof Uint8Array
    ) {
      return value;
    }
    throw new TypeError(`Unsupported SQLite binding: ${typeof value}`);
  });
}
```

Use this only where existing code already constructs dynamic parameter arrays.

- [ ] **Step 2: Add Postgres JSON helper**

In `src/core/postgres-engine.ts`, add:

```ts
function jsonParam(value: unknown): postgres.JSONValue {
  return value as postgres.JSONValue;
}
```

Use it at `this.sql.json(jsonParam(value))` call sites that currently pass `Record<string, unknown>` or typed arrays.

- [ ] **Step 3: Fix row mapper callback signatures**

For `.map(mapChunkRow)` style calls where the mapper has a second optional boolean parameter, replace with an explicit wrapper:

```ts
rows.map((row) => mapChunkRow(row, includeEmbedding))
```

- [ ] **Step 4: Run tsc until SQL/JSON families are gone**

```bash
bunx tsc --noEmit --pretty false 2>&1 | rg "SQLQueryBindings|ParameterOrJSON|JSONValue|map\\("
```

Expected: no SQL binding or JSON parameter errors remain.

- [ ] **Step 5: Commit**

```bash
git add src/core/sqlite-engine.ts src/core/postgres-engine.ts src/core/pglite-engine.ts src/core/db.ts
git commit -m "fix(tsc): type SQL bindings and JSON parameters"
```

### Task 2.3: Fix Domain Type Errors

- [ ] **Step 1: Fix config construction**

In `src/commands/migrate-engine.ts`, construct a complete `MBrainConfig` using existing defaults from config-loading code. Do not cast partial objects to `MBrainConfig`.

- [ ] **Step 2: Fix structural node IDs**

In `src/core/operations.ts`, convert strings to `StructuralNodeId` through the existing branded helper. If no helper exists, create a local helper:

```ts
function structuralNodeId(value: string): StructuralNodeId {
  return value as StructuralNodeId;
}
```

Use only at operation boundary inputs after string validation.

- [ ] **Step 3: Fix lock path nullability**

In `src/core/pglite-lock.ts`, guard missing lock directory before `mkdirSync`:

```ts
if (!lockDir) {
  throw new Error('PGLite lock path could not be resolved');
}
mkdirSync(lockDir, { recursive: true });
```

- [ ] **Step 4: Fix service enum/date mismatches**

In `src/core/services/historical-validity-service.ts`, compare dates to dates or numbers to numbers, not mixed.

In `src/core/services/map-derived-candidate-service.ts`, return only `'ready'`, `'stale'`, or `null` for fields typed that way.

- [ ] **Step 5: Fix fetch body type**

In `src/core/storage/supabase.ts`, pass a `Uint8Array` or `Blob` body instead of a Node `Buffer`:

```ts
body: new Uint8Array(buffer)
```

- [ ] **Step 6: Run focused verification**

```bash
bunx tsc --noEmit --pretty false 2>&1 | rg "migrate-engine|StructuralNodeId|pglite-lock|historical-validity|map-derived|supabase"
bun test test/phase6-map-derived-candidates.test.ts test/historical-validity-service.test.ts
```

Expected: no matching TypeScript errors; tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/commands/migrate-engine.ts src/core/operations.ts src/core/pglite-lock.ts src/core/services/historical-validity-service.ts src/core/services/map-derived-candidate-service.ts src/core/storage/supabase.ts
git commit -m "fix(tsc): resolve domain boundary type errors"
```

### Task 2.4: Fix Test Type Errors Without Weakening Production Types

- [ ] **Step 1: Replace one-argument scenario placeholders**

For scenario placeholder tests, use a callback form:

```ts
test.todo('S9 — broad synthesis returns curated note before map-derived edge', () => {});
```

This keeps runtime behavior unchanged but satisfies the TypeScript signature.

- [ ] **Step 2: Fix `TaskStatus` literals**

Replace invalid `'in_progress'` status literals with the actual active status used by `TaskStatus`.

- [ ] **Step 3: Fix scenario fixture casts**

Where tests intentionally create partial objects, cast through `unknown` only at the fixture boundary:

```ts
const fixture = {
  ...
} as unknown as Phase8LongitudinalPhaseSummary;
```

Do not add `any` to production code.

- [ ] **Step 4: Run tests and tsc**

```bash
bun test test/scenarios/ test/scope-gate-service.test.ts test/workspace-system-card-service.test.ts
bunx tsc --noEmit --pretty false
```

Expected: `tsc` still may fail from remaining categories, but no scenario-placeholder signature errors remain.

- [ ] **Step 5: Commit**

```bash
git add test/scenarios/s05-mixed-intent-decomposition.test.ts test/scenarios/s09-curated-over-map.test.ts test/scenarios/s11-code-claim-verification.test.ts test/scenarios/s12-baseline-gated-acceptance.test.ts test/scenarios/s14-retrieval-trace-fidelity.test.ts test/scenarios/helpers.ts test/scenarios/s19-interaction-id-supersession.test.ts test/scope-gate-operations.test.ts test/scope-gate-service.test.ts test/sqlite-engine.test.ts test/task-memory-engine.test.ts test/workspace-corpus-card-operations.test.ts test/workspace-corpus-card-service.test.ts test/workspace-orientation-bundle-operations.test.ts test/workspace-orientation-bundle-service.test.ts test/workspace-project-card-operations.test.ts test/workspace-project-card-service.test.ts test/workspace-system-card-operations.test.ts test/workspace-system-card-service.test.ts
git commit -m "fix(tsc): align test fixtures with strict types"
```

### Task 2.5: Enforce Typecheck in CI

- [ ] **Step 1: Confirm local tsc is clean**

```bash
bunx tsc --noEmit --pretty false
```

Expected: command exits 0 with no output.

- [ ] **Step 2: Add CI step**

Modify `.github/workflows/test.yml` in the main test job before `bun test`:

```yaml
- name: Typecheck
  run: bunx tsc --noEmit --pretty false
```

- [ ] **Step 3: Run local verification**

```bash
bunx tsc --noEmit --pretty false
bun test
bun run build
git diff --check
```

Expected: all pass.

- [ ] **Step 4: Commit and open PR**

```bash
git add .github/workflows/test.yml
git commit -m "ci: enforce TypeScript typecheck"
git push -u origin sprint-0-tsc-baseline
```

---

## PR 3: L1 Request-Level Intent Decomposition

**Goal:** Replace the remaining S5 placeholder with a general request planner that decomposes mixed intents instead of requiring callers to pre-select one route.

**Files:**

- Create: `src/core/services/retrieval-request-planner-service.ts`
- Create: `test/retrieval-request-planner-service.test.ts`
- Modify: `src/core/types.ts`
- Modify: `src/core/operations.ts`
- Modify: `test/scenarios/s05-mixed-intent-decomposition.test.ts`
- Modify: `test/scenarios/README.md`

### Task 3.1: Add Planner Types and Service

- [ ] **Step 1: Write failing planner tests**

Create tests for:

- `task_id + synthesis query` produces ordered steps `task_resume`, then `broad_synthesis`.
- `requested_scope: 'mixed' + query + subject` produces `mixed_scope_bridge`.
- Unknown request shape returns one explicit `precision_lookup` or `broad_synthesis` step only when enough input exists; otherwise returns `selection_reason: 'no_match'`.

Run:

```bash
bun test test/retrieval-request-planner-service.test.ts
```

Expected: FAIL because service does not exist.

- [ ] **Step 2: Add types**

In `src/core/types.ts`:

```ts
export interface RetrievalRequestPlannerInput extends Omit<RetrievalRouteSelectorInput, 'intent'> {
  intent?: RetrievalRouteIntent;
  allow_decomposition?: boolean;
}

export interface RetrievalRequestPlanStep {
  step_id: string;
  intent: RetrievalRouteIntent;
  input: RetrievalRouteSelectorInput;
}

export interface RetrievalRequestPlan {
  selection_reason: 'decomposed_mixed_intent' | 'single_intent' | 'no_match';
  steps: RetrievalRequestPlanStep[];
}
```

- [ ] **Step 3: Implement minimal deterministic planner**

Rules:

- If `allow_decomposition !== true`, return the explicit input intent as one step; if no intent was supplied, infer one narrow route or return `no_match`.
- If `task_id` exists and `query` exists and `intent === 'task_resume'`, return task resume then broad synthesis.
- If `requested_scope === 'mixed'` and `query` plus `subject` or `episode_title` exist, return one `mixed_scope_bridge` step.
- Preserve explicit caller intent over heuristics when decomposition is not requested.

- [ ] **Step 4: Expose operation**

Add `plan_retrieval_request` operation with `cliHints.name = 'plan-retrieval-request'`.

- [ ] **Step 5: Replace S5 placeholder with real test**

Modify `test/scenarios/s05-mixed-intent-decomposition.test.ts` so the remaining placeholder becomes a real test that asserts the resume-plus-synthesis decomposition order.

- [ ] **Step 6: Verify and commit**

```bash
bun test test/retrieval-request-planner-service.test.ts test/scenarios/s05-mixed-intent-decomposition.test.ts test/retrieval-route-selector-service.test.ts
bun run test:scenarios
bunx tsc --noEmit --pretty false
git add src/core/types.ts src/core/services/retrieval-request-planner-service.ts src/core/operations.ts test/retrieval-request-planner-service.test.ts test/scenarios/s05-mixed-intent-decomposition.test.ts test/scenarios/README.md
git commit -m "feat: add request-level retrieval decomposition"
```

---

## PR 4: L2 Canonical-First Broad Synthesis Ranking

**Goal:** Replace S9 placeholders by making broad synthesis prefer curated canonical notes over map-derived suggestions when they compete for the same entity.

**Files:**

- Modify: `src/core/types.ts`
- Modify: `src/core/services/broad-synthesis-route-service.ts`
- Modify: `test/broad-synthesis-route-service.test.ts`
- Modify: `test/scenarios/s09-curated-over-map.test.ts`
- Modify: `test/scenarios/README.md`

### Task 4.1: Add Canonical-First Route Shape

- [ ] **Step 1: Write failing S9 tests**

Replace the two S9 placeholders with tests that seed:

- A curated note page `concepts/a.md` with canonical statement `A is B`.
- A context map whose node or edge suggests `A is C`.

Assert:

```ts
expect(route?.entrypoints[0]?.source_kind).toBe('curated_note');
expect(route?.canonical_reads[0]?.page_slug).toBe('concepts/a');
expect(route?.derived_suggestions[0]?.map_id).toBe(mapId);
expect(route?.conflicts[0]?.resolution).toBe('prefer_canonical');
```

Run:

```bash
bun test test/scenarios/s09-curated-over-map.test.ts
```

Expected: FAIL because route fields do not exist.

- [ ] **Step 2: Extend types**

In `src/core/types.ts`, add:

```ts
export interface BroadSynthesisEntrypoint {
  source_kind: 'curated_note' | 'context_map';
  page_slug?: string;
  map_id?: string;
  label: string;
}

export interface BroadSynthesisDerivedSuggestion {
  map_id: string;
  node_id: string;
  label: string;
  page_slug: string;
}

export interface BroadSynthesisConflict {
  entity_key: string;
  canonical_page_slug: string;
  derived_map_id: string;
  resolution: 'prefer_canonical';
  summary: string;
}
```

Add `entrypoints`, `canonical_reads`, `derived_suggestions`, and `conflicts` to `BroadSynthesisRoute`.

- [ ] **Step 3: Implement ranking**

In `getBroadSynthesisRoute`:

- Use `engine.searchKeyword(input.query, { type: 'concept', limit: input.limit ?? 5 })` to find canonical note candidates before returning map-derived reads. For each candidate slug, call `engine.getPage(slug)` and keep only pages with non-empty `compiled_truth`.
- Promote matching curated note reads to the front of `entrypoints`.
- Keep map-derived results in `derived_suggestions`.
- If canonical and map entries share the same normalized label but differ in summary/source, add a `prefer_canonical` conflict.
- Preserve existing `recommended_reads` for backwards compatibility, ordered with canonical reads first.

- [ ] **Step 4: Verify and commit**

```bash
bun test test/broad-synthesis-route-service.test.ts test/scenarios/s09-curated-over-map.test.ts test/retrieval-route-selector-service.test.ts
bun run test:scenarios
bunx tsc --noEmit --pretty false
git add src/core/types.ts src/core/services/broad-synthesis-route-service.ts test/broad-synthesis-route-service.test.ts test/scenarios/s09-curated-over-map.test.ts test/scenarios/README.md
git commit -m "feat: prefer canonical notes in broad synthesis"
```

---

## PR 5: L4 Code Claim Verification

**Goal:** Replace S11 placeholders with a real code-claim verifier that distinguishes historical memory from current workspace truth.

**Files:**

- Create: `src/core/services/code-claim-verification-service.ts`
- Create: `test/code-claim-verification-service.test.ts`
- Modify: `src/core/types.ts`
- Modify: `src/core/engine.ts`
- Modify: `src/core/sqlite-engine.ts`
- Modify: `src/core/pglite-engine.ts`
- Modify: `src/core/postgres-engine.ts`
- Modify: `src/core/operations.ts`
- Modify: `src/core/services/task-memory-service.ts`
- Modify: `test/task-memory-service.test.ts`
- Modify: `test/scenarios/s11-code-claim-verification.test.ts`
- Modify: `test/scenarios/README.md`

### Task 5.1: Add Verification Service

- [ ] **Step 1: Write failing service tests**

Test cases:

- Existing file and symbol returns `status: 'current'`.
- Missing file returns `status: 'stale'` and reason `file_missing`.
- Existing file with missing symbol returns `status: 'stale'` and reason `symbol_missing`.
- Missing repo path returns `status: 'unverifiable'`.

Run:

```bash
bun test test/code-claim-verification-service.test.ts
```

Expected: FAIL because service does not exist.

- [ ] **Step 2: Add types**

In `src/core/types.ts`:

```ts
export interface CodeClaim {
  path: string;
  symbol?: string;
  branch_name?: string;
  source_trace_id?: string;
}

export type CodeClaimVerificationStatus = 'current' | 'stale' | 'unverifiable';

export interface CodeClaimVerificationResult {
  claim: CodeClaim;
  status: CodeClaimVerificationStatus;
  reason: 'ok' | 'file_missing' | 'symbol_missing' | 'branch_mismatch' | 'repo_missing';
  checked_at: string;
}
```

- [ ] **Step 3: Implement service**

Create `verifyCodeClaims(input)`:

- Resolve `repo_path`.
- Check file existence with `existsSync(join(repo_path, claim.path))`.
- If symbol exists, read the file and search for exact symbol text.
- Compare `claim.branch_name` to the current branch when provided by caller.
- Return results without modifying historical traces.

- [ ] **Step 4: Commit service**

```bash
bun test test/code-claim-verification-service.test.ts
git add src/core/types.ts src/core/services/code-claim-verification-service.ts test/code-claim-verification-service.test.ts
git commit -m "feat: add code claim verification service"
```

### Task 5.2: Expose Operation and Resume Integration

- [ ] **Step 1: Add `reverify_code_claims` operation**

The operation accepts:

- `repo_path`
- `branch_name`
- `claims`
- `trace_id`

It returns `CodeClaimVerificationResult[]`.

- [ ] **Step 2: Add trace lookup support**

Modify `src/core/engine.ts` and all three engines:

```ts
getRetrievalTrace(id: string): Promise<RetrievalTrace | null>;
```

Implement as a primary-key lookup on `retrieval_traces`. This is needed because `reverify_code_claims({ trace_id })` must read the original trace before it can attach a new verification trace to the same task/scope.

- [ ] **Step 3: Record current verification as a new trace**

Do not mutate historical traces. If `trace_id` is provided and at least one result is stale, write a new retrieval trace:

```ts
await engine.putRetrievalTrace({
  id: crypto.randomUUID(),
  task_id: originalTrace.task_id,
  scope: originalTrace.scope,
  route: ['code_claim_reverification'],
  source_refs: [`retrieval_trace:${originalTrace.id}`],
  verification: results.map((r) => `code_claim:${r.claim.path}:${r.status}:${r.reason}`),
  write_outcome: 'operational_write',
  selected_intent: 'task_resume',
  outcome: 'code claims reverified',
});
```

- [ ] **Step 4: Wire task resume status**

Modify `src/core/services/task-memory-service.ts` so resume cards can surface code-claim status when active paths/symbols are present. The resume response must not repeat stale file/symbol claims as current facts.

- [ ] **Step 5: Replace S11 placeholders**

Modify `test/scenarios/s11-code-claim-verification.test.ts`:

- First test verifies stale file/symbol status on branch drift.
- Second test verifies historical trace remains queryable and a new verification trace is written.

- [ ] **Step 6: Verify and commit**

```bash
bun test test/code-claim-verification-service.test.ts test/task-memory-service.test.ts test/scenarios/s11-code-claim-verification.test.ts
bun run test:scenarios
bunx tsc --noEmit --pretty false
git add src/core/types.ts src/core/engine.ts src/core/sqlite-engine.ts src/core/pglite-engine.ts src/core/postgres-engine.ts src/core/services/code-claim-verification-service.ts src/core/operations.ts src/core/services/task-memory-service.ts test/code-claim-verification-service.test.ts test/task-memory-service.test.ts test/scenarios/s11-code-claim-verification.test.ts test/scenarios/README.md
git commit -m "feat: verify stale code claims before reuse"
```

---

## PR 6: Final Acceptance Closure

**Goal:** Make the redesign acceptance state explicit and machine-verifiable.

**Files:**

- Modify: `test/scenarios/README.md`
- Modify: `docs/MBRAIN_VERIFY.md`
- Modify: `docs/architecture/redesign/08-evaluation-and-acceptance.md`
- Create: `docs/superpowers/specs/2026-04-24-mbrain-redesign-completion-retrospective.md`
- Modify: `.github/workflows/test.yml` only if CI needs an additional scenario command after the typecheck PR.

### Task 6.1: Remove Remaining Scenario Placeholders

- [ ] **Step 1: Confirm no scenario placeholders**

```bash
rg -n "test\\.todo|todo\\(" test/scenarios
```

Expected: no output.

- [ ] **Step 2: Update scenario README**

Every row must be green. The deferred follow-up section must only contain future product extensions outside the redesign completion boundary.

- [ ] **Step 3: Run scenario suite**

```bash
bun run test:scenarios
```

Expected: zero failures and zero placeholders.

### Task 6.2: Final Verification Gate

- [ ] **Step 1: Run local gates**

```bash
bunx tsc --noEmit --pretty false
bun run test:scenarios
bun test
bun run build
git diff --check
```

Expected: all pass.

- [ ] **Step 2: Run Postgres gates**

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5434/mbrain_test bun test test/postgres-jsonb-engine.test.ts test/brain-loop-audit-service.test.ts test/scenarios/s16-interaction-linked-writes-audit.test.ts test/scenarios/s19-interaction-id-supersession.test.ts
```

Expected: all pass.

- [ ] **Step 3: Verify CLI audit**

Against an initialized local SQLite brain, run:

```bash
bun run src/cli.ts audit-brain-loop --since 24h --json
```

Expected: valid JSON matching `AuditBrainLoopReport`.

### Task 6.3: Retrospective and Completion Docs

- [ ] **Step 1: Write completion retrospective**

Create `docs/superpowers/specs/2026-04-24-mbrain-redesign-completion-retrospective.md` with:

- Completed PR list and merge commits.
- Invariants implemented.
- Bugs caught by PR review: JSONB scalar-string legacy repair, trace scope precedence, migration backfill, operation API fidelity.
- Verification evidence.
- Explicit future work outside this completion boundary: trace pruning, dashboard, scheduled dream-cycle audit, full status-event log for candidate transitions.

- [ ] **Step 2: Update verification docs**

Modify `docs/MBRAIN_VERIFY.md` with one final command block:

```bash
bunx tsc --noEmit --pretty false
bun run test:scenarios
bun test
bun run build
```

- [ ] **Step 3: Commit and open final PR**

```bash
git add docs/superpowers/specs/2026-04-24-mbrain-redesign-completion-retrospective.md docs/MBRAIN_VERIFY.md docs/architecture/redesign/08-evaluation-and-acceptance.md test/scenarios/README.md .github/workflows/test.yml
git commit -m "docs: close mbrain redesign acceptance plan"
git push -u origin sprint-final-acceptance-closure
```

---

## Review Discipline for Every PR

Each PR follows the same checkpoint loop:

- Before implementation: confirm branch base and current test state.
- For each task: write the failing test first, run it, implement the minimum fix, run focused tests, commit.
- After each meaningful commit: request a critical subagent review focused on correctness, scope creep, backend parity, and missing tests.
- Treat review comments as hypotheses, not commands. Verify against code and tests before changing behavior.
- Before merge: run focused tests, full `bun test`, `bun run build`, `git diff --check`, and `bunx tsc --noEmit --pretty false` once PR 2 is merged.
- Merge only one PR at a time. Rebase or retarget stacked branches after the base PR lands.

## Execution Recommendation

Proceed in this order:

1. Implement PR 1 (`sprint-1.1b-loop-audit`) next.
2. In parallel or immediately after PR 1 review starts, begin PR 2 (`sprint-0-tsc-baseline`) because it is broad and mechanical.
3. Merge PR 2 before PRs 3-5 so scenario-gap work is protected by CI typecheck.
4. Implement PR 3, PR 4, and PR 5 as separate semantic PRs; do not combine L1/L2/L4.
5. Finish with PR 6 acceptance closure.

This order avoids the previous mistake of mixing observability, schema, CI, and feature semantics in one PR. It also makes the audit available early, which is the correct foundation for judging whether later memory improvements are actually used by agent turns.

## Self-Review

- Spec coverage: Sprint 1.1B covers the unimplemented audit section of `2026-04-24-mbrain-sprint-1-1-loop-observability-design.md`; PR 2 covers `2026-04-24-mbrain-sprint-0-tsc-baseline-design.md`; PRs 3-5 cover remaining scenario invariants L1, L2, and L4 from `2026-04-23-mbrain-scenario-test-design.md`; PR 6 closes acceptance criteria from `08-evaluation-and-acceptance.md`.
- Dependency check: Audit can land before typecheck because current CI does not enforce `tsc`; L1/L2/L4 should land after typecheck so new code cannot add strict-mode debt.
- Type consistency: New names are stable across tasks: `AuditBrainLoopReport`, `RetrievalTraceWindowFilters`, `audit_brain_loop`, `plan_retrieval_request`, `reverify_code_claims`.
- Scope control: Candidate status-event logs, dashboards, pruning, and cron automation are explicitly excluded from completion and remain future product extensions.
