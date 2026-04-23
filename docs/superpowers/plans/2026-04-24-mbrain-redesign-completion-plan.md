# Mbrain Redesign Completion Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the remaining redesign work after Sprint 1.0 so mbrain can prove the brain-agent loop ran, prefer canonical knowledge over derived suggestions, re-verify stale code claims before reuse, decompose mixed-intent requests beyond the current point solution, and enforce repo-wide TypeScript quality gates.

**Architecture:** The remaining work is not a new redesign. It is the completion pass for the architecture already chosen in `docs/architecture/mbrain_memory_architecture_graphify_final.md`: task-aware operational memory, canonical Markdown-first knowledge, derived context maps that never outrank curated truth, governance through inbox/promotion, and verification before reusing code-sensitive claims. Execution is split into PR-sized tracks so each lands green, is independently reviewable, and does not mix unrelated concerns.

**Tech Stack:** Bun, TypeScript, SQLite, PGLite, Postgres (`pgvector/pgvector:pg16` for real DB verification), GitHub Actions, Bun test, monolithic operations registry in `src/core/operations.ts`

---

## 1. Current Baseline

### 1.1 Merged state

- `PR #38` is merged on `master` via merge commit `5d336f32012ad5edfea1e72b51ee242b4329bb05`.
- Sprint 1.0 foundation is complete:
  - task-less trace persistence is allowed
  - immutable write-event rows carry `interaction_id`
  - service layer threads optional `interaction_id`
  - S17 / S18 / S19 / S20 are real scenario tests
- Review follow-up commit `5e1b967 fix: harden sprint 1.0 review follow-ups` is included in that merge.

### 1.2 Verified baseline

- Local full suite at merge time: `bun test` → `1124 pass / 136 skip / 6 todo / 0 fail`
- Scenario suite at merge time: `bun run test:scenarios` remains green except intentional `todo` markers
- GitHub CI for PR #38 was green on:
  - `gitleaks`
  - `Tier 1 (Mechanical)`
  - `test`

### 1.3 Remaining contract gaps

These are the remaining redesign gaps that still need code:

| Gap | Contract source | Current evidence |
|---|---|---|
| L6 trace fidelity | `test/scenarios/s14-retrieval-trace-fidelity.test.ts` | `derived_consulted` is still not persisted |
| Sprint 1.1 audit surface | `docs/superpowers/specs/2026-04-24-mbrain-sprint-1-1-loop-observability-design.md` | no windowed trace read API, no audit service, no audit operation |
| L2 canonical-first synthesis | `test/scenarios/s09-curated-over-map.test.ts` | broad synthesis still lacks curated-vs-derived ranking/conflict surfacing |
| L4 code-claim verification | `test/scenarios/s11-code-claim-verification.test.ts` | no `reverify_code_claims`, no freshness gate in resume flow |
| L1 general mixed-intent decomposition | `test/scenarios/s05-mixed-intent-decomposition.test.ts` | current system only has `mixed_scope_bridge` point solution |
| Track A typecheck gate | `docs/superpowers/specs/2026-04-24-mbrain-sprint-0-tsc-baseline-design.md` | `bunx tsc --noEmit --pretty false` still fails |

### 1.4 Newly discovered prerequisite

During real Postgres verification for PR #38, `memory_candidate_entries.source_refs` was found to be stored as a JSON **string** instead of a JSON array. The immediate path was fixed, but the write pattern `\${JSON.stringify(value)}::jsonb` still exists across `src/core/postgres-engine.ts`.

This is a blocking correctness issue for any further Postgres work that depends on JSONB, especially Sprint 1.1 trace fields. Therefore the first remaining track is a Postgres JSONB correctness sweep.

## 2. Definition Of Complete

Do not call the redesign complete until every item below is true:

- [ ] `bun test` is green on the repo tip.
- [ ] `bun run test:scenarios` has **zero** remaining `todo` markers for S5, S9, S11, S14.
- [ ] Sprint 1.1 scenarios (`S21`–`S25`) exist and are green.
- [ ] `bunx tsc --noEmit --pretty false` exits `0`.
- [ ] CI runs both `bunx tsc --noEmit --pretty false` and `bun test`.
- [ ] Postgres JSONB writes are verified with a real Postgres DB, not just SQLite/PGLite parity.
- [ ] Retrieval traces can answer “what happened in the last 24h?” without string parsing.
- [ ] Broad synthesis never presents map-derived claims as co-equal with conflicting curated truth.
- [ ] Code-sensitive claims are re-verified before reuse and marked stale when verification fails.
- [ ] The remaining plan artifacts and scenario index are updated so the repo documents the closed gaps.

## 3. Execution Order And Dependencies

Follow this order. Do not reorder without a concrete reason.

| Order | Track | Depends on | Why this order is correct |
|---|---|---|---|
| 1 | Track P1 — Postgres JSONB correctness sweep | merged `master` | Further Postgres work is unsafe until JSONB writes are real JSONB, not strings |
| 2 | Track B1 — Sprint 1.1A trace fidelity foundation | P1 | Adds new JSONB trace columns; must not land on a broken PG JSONB layer |
| 3 | Track B2 — Sprint 1.1B audit surface | B1 | Audit requires the new trace fields and task-less trace read path |
| 4 | Track C1 — L2 canonical-first synthesis | B1 | Ranking should populate and rely on the canonical-vs-derived distinction from B1 |
| 5 | Track C2 — L4 code-claim reverification | B1 | Freshness results should write into the richer trace structure introduced in B1 |
| 6 | Track C3 — L1 general mixed-intent classifier | B1 | This touches the route selector and is cleaner after trace shape stabilizes |
| 7 | Track A — Sprint 0 TypeScript cleanup slices S0.1–S0.6 | independent | Can run in parallel, but should not block functional tracks |
| 8 | Track A7 — CI typecheck gate | A S0.1–S0.6 only | Must land last, after local typecheck is already green |

## 4. Branch And PR Map

Use one branch per track:

| Track | Branch name | PR title template |
|---|---|---|
| P1 | `postgres-jsonb-correctness` | `fix: store Postgres JSONB columns as real JSON` |
| B1 | `sprint-1.1-trace-fidelity` | `feat: sprint 1.1A trace fidelity foundation` |
| B2 | `sprint-1.1-brain-loop-audit` | `feat: sprint 1.1B brain loop audit surface` |
| C1 | `canonical-first-synthesis` | `feat: prefer curated notes over derived map claims` |
| C2 | `code-claim-reverification` | `feat: reverify stale code claims before reuse` |
| C3 | `mixed-intent-classifier` | `feat: decompose mixed requests into multiple retrieval intents` |
| A S0.1 | `tsc-cleanup-cli` | `chore: fix TypeScript baseline in commands and CLI` |
| A S0.2 | `tsc-cleanup-core-non-pg` | `chore: fix TypeScript baseline in core engines` |
| A S0.3 | `tsc-cleanup-postgres` | `chore: fix TypeScript baseline in postgres engine` |
| A S0.4 | `tsc-cleanup-services` | `chore: fix TypeScript baseline in services` |
| A S0.5 | `tsc-cleanup-tests` | `chore: fix TypeScript baseline in non-scenario tests` |
| A S0.6 | `tsc-cleanup-scenarios` | `chore: fix TypeScript baseline in scenario tests` |
| A S0.7 | `ci-typecheck-gate` | `ci: run TypeScript typecheck in test workflow` |

## 5. Track P1 — Postgres JSONB Correctness Sweep

**Purpose:** Eliminate the broken `JSON.stringify(... )::jsonb` write pattern from `src/core/postgres-engine.ts` before any more Postgres-dependent redesign work lands.

**Files:**
- Modify: `src/core/postgres-engine.ts`
- Modify: `test/canonical-handoff-engine.test.ts`
- Modify: `test/task-memory-engine.test.ts`
- Modify: `test/retrieval-route-trace-service.test.ts`
- Modify: `test/memory-inbox-engine.test.ts`
- Create: `test/postgres-jsonb-engine.test.ts`

- [ ] **Step 1: Add failing Postgres regression tests for representative JSONB tables**

Test the tables that matter most to remaining work:

```ts
test('postgres stores retrieval_traces.route/source_refs/verification as json arrays', async () => {
  const trace = await engine.putRetrievalTrace({
    id: 'pg-trace-jsonb',
    task_id: null,
    scope: 'unknown',
    route: ['task_thread'],
    source_refs: ['page:concepts/x'],
    verification: ['intent:task_resume'],
    outcome: 'task_resume route selected',
  });

  const rows = await sql`
    SELECT
      jsonb_typeof(route) AS route_kind,
      jsonb_typeof(source_refs) AS source_refs_kind,
      jsonb_typeof(verification) AS verification_kind
    FROM retrieval_traces
    WHERE id = ${trace.id}
  `;

  expect(rows[0]?.route_kind).toBe('array');
  expect(rows[0]?.source_refs_kind).toBe('array');
  expect(rows[0]?.verification_kind).toBe('array');
});
```

Run:

```bash
docker run --rm --name mbrain-test-pg \
  -e POSTGRES_DB=mbrain_test \
  -e POSTGRES_PASSWORD=postgres \
  -p 5434:5432 -d pgvector/pgvector:pg16

DATABASE_URL=postgresql://postgres:postgres@localhost:5434/mbrain_test \
  bun test test/postgres-jsonb-engine.test.ts
```

Expected before the fix: at least one assertion fails with `jsonb_typeof(...) = 'string'`.

- [ ] **Step 2: Replace every JSONB write in `src/core/postgres-engine.ts` with a real JSON parameter**

Use one local helper inside `src/core/postgres-engine.ts` and apply it to every JSONB column write:

```ts
const jsonb = (value: unknown) => sql.json(value);
```

Replace patterns like:

```ts
${JSON.stringify(input.route ?? [])}::jsonb
```

with:

```ts
${jsonb(input.route ?? [])}
```

Minimum call sites to sweep in this PR:

- `putPage`
- `putRawData`
- `logIngest`
- `upsertTaskWorkingSet`
- `recordTaskAttempt`
- `recordTaskDecision`
- `putRetrievalTrace`
- `createMemoryCandidateEntry`
- `supersedeMemoryCandidateEntry`
- `upsertNoteManifestEntry`
- `replaceNoteSectionEntries`
- `upsertContextMapEntry`
- `upsertContextAtlasEntry`

Do not leave mixed patterns in the file.

- [ ] **Step 3: Prove the sweep with real Postgres tests**

Run:

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5434/mbrain_test \
  bun test \
    test/postgres-jsonb-engine.test.ts \
    test/task-memory-engine.test.ts \
    test/retrieval-route-trace-service.test.ts \
    test/memory-inbox-engine.test.ts \
    test/canonical-handoff-engine.test.ts
```

Expected: all green on real Postgres.

- [ ] **Step 4: Guard against regression with a grep check**

Run:

```bash
rg -n "JSON\\.stringify\\(.*\\)::jsonb" src/core/postgres-engine.ts
```

Expected: no results.

- [ ] **Step 5: Commit**

```bash
git add \
  src/core/postgres-engine.ts \
  test/postgres-jsonb-engine.test.ts \
  test/task-memory-engine.test.ts \
  test/retrieval-route-trace-service.test.ts \
  test/memory-inbox-engine.test.ts \
  test/canonical-handoff-engine.test.ts
git commit -m "fix: store Postgres JSONB columns as real JSON"
```

## 6. Track B1 — Sprint 1.1A Trace Fidelity Foundation

**Purpose:** Close the remaining L6 trace fidelity gap by extending `retrieval_traces` with structured fields and persisting canonical-vs-derived read distinctions.

**Files:**
- Modify: `src/core/migrate.ts`
- Modify: `src/core/sqlite-engine.ts`
- Modify: `src/core/pglite-engine.ts`
- Modify: `src/core/postgres-engine.ts`
- Modify: `src/core/types.ts`
- Modify: `src/core/services/retrieval-route-selector-service.ts`
- Modify: `test/retrieval-route-trace-service.test.ts`
- Modify: `test/scenarios/s14-retrieval-trace-fidelity.test.ts`
- Modify: `test/phase0-contract-parity.test.ts`

- [ ] **Step 1: Flip S14 from `todo` to a real failing test**

Add a real broad-synthesis trace test that distinguishes canonical and derived sources:

```ts
test('broad synthesis trace stores canonical source_refs separately from derived_consulted', async () => {
  const result = await selectRetrievalRoute(engine, {
    intent: 'broad_synthesis',
    query: 'graph retrieval',
    persist_trace: true,
  });

  expect(result.trace).toBeDefined();
  const traces = await engine.listRetrievalTraces('task-trace', { limit: 5 });
  const trace = traces[0]!;

  expect(trace.source_refs.length).toBeGreaterThan(0);
  expect(trace.derived_consulted).toEqual([expect.stringMatching(/^map:/)]);
  expect(trace.source_refs.some((ref) => ref.startsWith('page:') || ref.startsWith('section:'))).toBe(true);
});
```

Also add unit tests for:

- `selected_intent` being populated directly on new rows
- `scope_gate_policy` and `scope_gate_reason` being stored when the gate runs
- `write_outcome` defaulting to `'no_durable_write'`

Run:

```bash
bun test test/scenarios/s14-retrieval-trace-fidelity.test.ts test/retrieval-route-trace-service.test.ts
```

Expected before implementation: failing assertions because the new fields do not exist yet.

- [ ] **Step 2: Add migration 22 and type definitions**

Implement migration 22 exactly as the Sprint 1.1 spec requires:

```sql
ALTER TABLE retrieval_traces
  ADD COLUMN derived_consulted JSONB NOT NULL DEFAULT '[]';
ALTER TABLE retrieval_traces
  ADD COLUMN write_outcome TEXT NOT NULL DEFAULT 'no_durable_write';
ALTER TABLE retrieval_traces
  ADD COLUMN selected_intent TEXT NULL;
ALTER TABLE retrieval_traces
  ADD COLUMN scope_gate_policy TEXT NULL;
ALTER TABLE retrieval_traces
  ADD COLUMN scope_gate_reason TEXT NULL;
```

In `src/core/types.ts`, add:

```ts
export type RetrievalTraceWriteOutcome =
  | 'no_durable_write'
  | 'operational_write'
  | 'candidate_created'
  | 'promoted'
  | 'rejected'
  | 'superseded';

export type ScopeGatePolicy = 'allow' | 'deny' | 'defer';
```

Also widen `RetrievalTrace` / `RetrievalTraceInput` to include:

- `derived_consulted: string[]`
- `write_outcome`
- `selected_intent`
- `scope_gate_policy`
- `scope_gate_reason`

- [ ] **Step 3: Backfill legacy `selected_intent` from `verification`**

Add an idempotent migration handler in `src/core/migrate.ts` that:

- scans rows where `selected_intent IS NULL`
- extracts the `intent:<name>` entry from `verification`
- updates `selected_intent` when found
- leaves the field `NULL` when parsing fails

The handler must not invent a constant default such as `'task_resume'`.

- [ ] **Step 4: Persist the new fields from the route selector**

In `src/core/services/retrieval-route-selector-service.ts`, add:

```ts
function collectDerivedConsulted(selection: RetrievalRouteSelection | null): string[] {
  if (!selection) return [];
  if (selection.route_kind === 'broad_synthesis') {
    const payload = selection.payload as BroadSynthesisRoute;
    return payload.map_id ? [`map:${payload.map_id}`] : [];
  }
  if (selection.route_kind === 'mixed_scope_bridge') {
    const payload = selection.payload as MixedScopeBridgeRoute;
    return payload.work_route.map_id ? [`map:${payload.work_route.map_id}`] : [];
  }
  return [];
}
```

Then persist:

- `derived_consulted`
- `selected_intent`
- `scope_gate_policy`
- `scope_gate_reason`
- `write_outcome: 'no_durable_write'`

Do not add writer-triggered trace rows in this PR. This PR only extends the read-side trace.

- [ ] **Step 5: Verify all three engines return the richer trace shape**

Run:

```bash
bun test \
  test/retrieval-route-trace-service.test.ts \
  test/scenarios/s14-retrieval-trace-fidelity.test.ts \
  test/phase0-contract-parity.test.ts
```

Then run targeted Postgres verification:

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5434/mbrain_test \
  bun test test/retrieval-route-trace-service.test.ts test/scenarios/s14-retrieval-trace-fidelity.test.ts
```

Expected: green on SQLite/PGLite and on real Postgres.

- [ ] **Step 6: Commit**

```bash
git add \
  src/core/migrate.ts \
  src/core/sqlite-engine.ts \
  src/core/pglite-engine.ts \
  src/core/postgres-engine.ts \
  src/core/types.ts \
  src/core/services/retrieval-route-selector-service.ts \
  test/retrieval-route-trace-service.test.ts \
  test/scenarios/s14-retrieval-trace-fidelity.test.ts \
  test/phase0-contract-parity.test.ts
git commit -m "feat: persist structured retrieval trace fidelity fields"
```

## 7. Track B2 — Sprint 1.1B Brain-Loop Audit Surface

**Purpose:** Make the loop observable over a time window by joining `retrieval_traces.id` with immutable write events via `interaction_id`.

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/engine.ts`
- Modify: `src/core/sqlite-engine.ts`
- Modify: `src/core/pglite-engine.ts`
- Modify: `src/core/postgres-engine.ts`
- Modify: `src/core/operations.ts`
- Create: `src/core/services/brain-loop-audit-service.ts`
- Modify: `test/task-memory-engine.test.ts`
- Create: `test/brain-loop-audit-service.test.ts`
- Create: `test/scenarios/s21-task-audit-pagination.test.ts`
- Create: `test/scenarios/s22-linked-write-audit.test.ts`
- Create: `test/scenarios/s23-structured-trace-distribution.test.ts`
- Create: `test/scenarios/s24-approximate-candidate-correlation.test.ts`
- Create: `test/scenarios/s25-empty-window-audit.test.ts`

- [ ] **Step 1: Add the missing read APIs the audit service actually needs**

The current engine API is insufficient because:

- `listRetrievalTraces(taskId)` cannot scan task-less traces or a time window
- `getCanonicalHandoffEntry(id)` is by id only
- supersession/contradiction rows have no list API
- `TaskThreadFilters` has no `offset`

Add these types in `src/core/types.ts`:

```ts
export interface TaskThreadFilters {
  scope?: TaskScope;
  status?: TaskStatus;
  limit?: number;
  offset?: number;
}

export interface RetrievalTraceWindowFilters {
  since?: Date | string;
  until?: Date | string;
  task_id?: string;
  scope?: ScopeGateScope;
  limit?: number;
  offset?: number;
}

export interface InteractionEventFilters {
  interaction_ids?: string[];
  since?: Date | string;
  until?: Date | string;
  limit?: number;
  offset?: number;
}
```

Add engine methods:

- `listRetrievalTracesByWindow(filters?: RetrievalTraceWindowFilters)`
- `listMemoryCandidateSupersessionEntries(filters?: InteractionEventFilters)`
- `listMemoryCandidateContradictionEntries(filters?: InteractionEventFilters)`
- extend `listCanonicalHandoffEntries(filters)` to accept `interaction_ids`, `since`, `until`

- [ ] **Step 2: Implement `brain-loop-audit-service.ts`**

Create a service with this public shape:

```ts
export interface AuditBrainLoopInput {
  since?: Date | string;
  until?: Date | string;
  task_id?: string;
  scope?: ScopeGateScope;
  limit?: number;
}

export interface AuditBrainLoopReport {
  window: { since: string; until: string };
  total_traces: number;
  by_selected_intent: Record<string, number>;
  by_scope: Record<string, number>;
  by_scope_gate_policy: Record<string, number>;
  most_common_defer_reason: string | null;
  canonical_vs_derived: {
    canonical_ref_count: number;
    derived_ref_count: number;
    canonical_ratio: number;
  };
  linked_writes: {
    canonical_handoffs: number;
    supersessions: number;
    contradictions: number;
    read_without_linked_write: number;
  };
  approximate_candidate_events: {
    count: number;
    note: string;
  };
  task_scan_capped_at: number | null;
  summary_lines: string[];
}
```

The service must compute linked writes by joining:

- `retrieval_traces.id`
- `canonical_handoff_entries.interaction_id`
- `memory_candidate_supersession_entries.interaction_id`
- `memory_candidate_contradiction_entries.interaction_id`

It must **not** infer linked writes by parsing free-form strings.

- [ ] **Step 3: Expose the audit through operations and CLI**

Add a new operation in `src/core/operations.ts`:

```ts
{
  name: 'audit_brain_loop',
  cliHints: { name: 'audit-brain-loop' },
  ...
}
```

Accepted params:

- `since?: string`
- `until?: string`
- `task_id?: string`
- `scope?: 'work' | 'personal' | 'mixed' | 'unknown'`
- `limit?: number`
- `json?: boolean`

`--json` must return the raw report; plain output must render concise summary lines plus key counters.

- [ ] **Step 4: Add scenario tests S21–S25**

Each scenario must correspond to the Sprint 1.1 design:

- `S21`: task pagination is capped and reported
- `S22`: a trace with linked canonical handoff is counted as linked write
- `S23`: distributions come from structured columns, not `verification` parsing
- `S24`: unlinked candidate transitions are labeled approximate, not exact
- `S25`: empty window returns zeroed counts without throwing

Run:

```bash
bun test \
  test/brain-loop-audit-service.test.ts \
  test/scenarios/s21-task-audit-pagination.test.ts \
  test/scenarios/s22-linked-write-audit.test.ts \
  test/scenarios/s23-structured-trace-distribution.test.ts \
  test/scenarios/s24-approximate-candidate-correlation.test.ts \
  test/scenarios/s25-empty-window-audit.test.ts
```

- [ ] **Step 5: Verify the public surface end to end**

Run:

```bash
bun run test:scenarios
bun test test/brain-loop-audit-service.test.ts
bun run src/cli.ts audit-brain-loop --since 24h --json
```

Expected:

- the command exits `0`
- JSON contains `total_traces`, `linked_writes`, and `summary_lines`
- no string parsing dependency in the implementation

- [ ] **Step 6: Commit**

```bash
git add \
  src/core/types.ts \
  src/core/engine.ts \
  src/core/sqlite-engine.ts \
  src/core/pglite-engine.ts \
  src/core/postgres-engine.ts \
  src/core/operations.ts \
  src/core/services/brain-loop-audit-service.ts \
  test/task-memory-engine.test.ts \
  test/brain-loop-audit-service.test.ts \
  test/scenarios/s21-task-audit-pagination.test.ts \
  test/scenarios/s22-linked-write-audit.test.ts \
  test/scenarios/s23-structured-trace-distribution.test.ts \
  test/scenarios/s24-approximate-candidate-correlation.test.ts \
  test/scenarios/s25-empty-window-audit.test.ts
git commit -m "feat: add brain loop audit surface"
```

## 8. Track C1 — L2 Canonical-First Synthesis

**Purpose:** Ensure broad synthesis uses context maps for orientation, but never lets derived map claims outrank curated notes when they conflict.

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/services/broad-synthesis-route-service.ts`
- Modify: `src/core/services/context-map-query-service.ts`
- Modify: `src/core/services/map-derived-candidate-service.ts`
- Modify: `src/core/operations.ts`
- Modify: `test/retrieval-route-selector-service.test.ts`
- Modify: `test/scenarios/s09-curated-over-map.test.ts`
- Create: `test/broad-synthesis-route-ranking.test.ts`

- [ ] **Step 1: Make S9 real and failing**

Replace both `test.todo` markers in `test/scenarios/s09-curated-over-map.test.ts` with concrete assertions:

- curated note is ranked first
- disagreement becomes either an explicit contradiction annotation or a Memory Candidate capture suggestion

Target payload shape:

```ts
expect(route.entrypoints[0]?.source_kind).toBe('curated_note');
expect(route.disagreements).toEqual([
  expect.objectContaining({
    kind: 'curated_vs_derived_conflict',
  }),
]);
```

Run:

```bash
bun test test/scenarios/s09-curated-over-map.test.ts
```

Expected before implementation: fail because `entrypoints` / `disagreements` are not defined yet.

- [ ] **Step 2: Extend the broad-synthesis route shape**

In `src/core/types.ts`, add explicit separation between canonical and derived material:

```ts
export interface BroadSynthesisEntrypoint {
  source_kind: 'curated_note' | 'map_derived';
  source_ref: string;
  label: string;
  confidence?: number;
}

export interface BroadSynthesisDisagreement {
  kind: 'curated_vs_derived_conflict';
  curated_ref: string;
  derived_ref: string;
  summary: string;
}
```

Then add to `BroadSynthesisRoute`:

- `entrypoints: BroadSynthesisEntrypoint[]`
- `disagreements: BroadSynthesisDisagreement[]`

- [ ] **Step 3: Rank curated notes ahead of derived map material**

In `src/core/services/broad-synthesis-route-service.ts`:

- derive curated entrypoints from `recommended_reads`
- derive map-derived entrypoints from `matched_nodes`
- group by entity or focal subject when possible
- if both sides exist for the same subject, emit:
  - curated entrypoint first
  - disagreement record if the summaries conflict

The service must not suppress the derived signal completely. It must demote it and label it.

- [ ] **Step 4: Surface disagreement into governance**

If the disagreement is substantive, create the input shape needed for `captureMapDerivedCandidates` rather than silently discarding it. This PR does not need to auto-write candidates during broad synthesis; it does need to make the disagreement machine-readable so the next caller can promote it into governance instead of treating it as equal truth.

- [ ] **Step 5: Verify route ranking and scenario closure**

Run:

```bash
bun test \
  test/broad-synthesis-route-ranking.test.ts \
  test/retrieval-route-selector-service.test.ts \
  test/scenarios/s09-curated-over-map.test.ts
```

Expected: S9 is now fully green.

- [ ] **Step 6: Commit**

```bash
git add \
  src/core/types.ts \
  src/core/services/broad-synthesis-route-service.ts \
  src/core/services/context-map-query-service.ts \
  src/core/services/map-derived-candidate-service.ts \
  src/core/operations.ts \
  test/retrieval-route-selector-service.test.ts \
  test/broad-synthesis-route-ranking.test.ts \
  test/scenarios/s09-curated-over-map.test.ts
git commit -m "feat: prefer curated notes over derived map claims"
```

## 9. Track C2 — L4 Code-Claim Reverification

**Purpose:** Reconfirm file, symbol, test, and branch-sensitive claims before reusing them in present-tense answers.

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/engine.ts`
- Modify: `src/core/services/task-memory-service.ts`
- Modify: `src/core/services/retrieval-route-selector-service.ts`
- Create: `src/core/services/code-claim-reverification-service.ts`
- Modify: `src/core/operations.ts`
- Modify: `test/retrieval-route-trace-service.test.ts`
- Modify: `test/scenarios/s11-code-claim-verification.test.ts`
- Create: `test/code-claim-reverification-service.test.ts`

- [ ] **Step 1: Make S11 real and failing**

Replace the two `test.todo` markers in `test/scenarios/s11-code-claim-verification.test.ts` with real fixtures:

- branch A trace says `src/X.ts` exists and symbol `fooBar` exists
- branch B fixture renames the file and removes the symbol

Assertions:

```ts
expect(result.code_claim_status).toBe('stale');
expect(result.summary_lines.some((line) => line.includes('branch mismatch'))).toBe(true);
expect(historicalTrace.verification.some((entry) => entry.startsWith('code_claim:stale'))).toBe(true);
```

- [ ] **Step 2: Implement a reverification service**

Create `src/core/services/code-claim-reverification-service.ts` with:

```ts
export interface CodeClaimReverificationResult {
  status: 'current' | 'stale' | 'unverifiable';
  branch_status: 'same_branch' | 'different_branch' | 'unknown_branch';
  checked_paths: string[];
  checked_symbols: string[];
  notes: string[];
}
```

The service must:

- read the prior trace or resume card context
- inspect current files through the existing file-resolution/codebase utilities
- compare branch metadata from the task thread if present
- return `stale` when a remembered code claim no longer verifies

- [ ] **Step 3: Thread reverification into the resume path**

In `src/core/services/task-memory-service.ts` and the route selector:

- run reverification for task-resume flows when active paths or symbols exist
- append structured verification entries such as:

```ts
`code_claim:${status}`
`code_claim_branch:${branchStatus}`
`code_claim_checked_paths:${checkedPaths.length}`
```

Do not delete or mutate the historical trace. Add fresh verification about the old claim.

- [ ] **Step 4: Expose a direct operation**

Add `reverify_code_claims` to `src/core/operations.ts` so the behavior is testable without going through the whole resume flow.

Expected params:

- `trace_id?: string`
- `task_id?: string`
- `repo_path?: string`

At least one of `trace_id` or `task_id` must be required.

- [ ] **Step 5: Verify scenario and unit coverage**

Run:

```bash
bun test \
  test/code-claim-reverification-service.test.ts \
  test/retrieval-route-trace-service.test.ts \
  test/scenarios/s11-code-claim-verification.test.ts
```

Expected: S11 is fully green and the trace preserves history while adding new freshness results.

- [ ] **Step 6: Commit**

```bash
git add \
  src/core/types.ts \
  src/core/engine.ts \
  src/core/services/task-memory-service.ts \
  src/core/services/retrieval-route-selector-service.ts \
  src/core/services/code-claim-reverification-service.ts \
  src/core/operations.ts \
  test/retrieval-route-trace-service.test.ts \
  test/code-claim-reverification-service.test.ts \
  test/scenarios/s11-code-claim-verification.test.ts
git commit -m "feat: reverify code claims before reuse"
```

## 10. Track C3 — L1 General Mixed-Intent Classifier

**Purpose:** Replace the single special-case `mixed_scope_bridge` mechanism with a general request-level decomposition path that can emit multiple sub-intents from one request.

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/services/retrieval-route-selector-service.ts`
- Modify: `src/core/services/mixed-scope-bridge-service.ts`
- Create: `src/core/services/request-intent-classifier-service.ts`
- Modify: `src/core/operations.ts`
- Modify: `test/retrieval-route-selector-service.test.ts`
- Modify: `test/scenarios/s05-mixed-intent-decomposition.test.ts`
- Create: `test/request-intent-classifier-service.test.ts`

- [ ] **Step 1: Replace the remaining S5 `todo` with a real test**

Use a request that should decompose into more than the existing bridge, for example:

- “Resume task T and summarize what Alex said about X”

Expected decomposition:

- `task_resume`
- `broad_synthesis`
- `personal_profile_lookup`

Assertion shape:

```ts
expect(result.decomposed_intents).toEqual([
  'task_resume',
  'broad_synthesis',
  'personal_profile_lookup',
]);
expect(result.route?.route_kind).toBe('composed_multi_intent');
```

- [ ] **Step 2: Add a request classifier service**

Create `src/core/services/request-intent-classifier-service.ts` that takes the current selector input and returns a normalized ordered list of intents.

Minimal first version rules:

- if `task_id` exists and `intent` is not explicitly set, include `task_resume`
- if `query` exists, include `broad_synthesis`
- if `subject` plus personal context exists, include `personal_profile_lookup`
- if `episode_title` plus personal context exists, include `personal_episode_lookup`
- preserve explicit `mixed_scope_bridge` behavior for backwards compatibility

The classifier is deterministic. Do not introduce an LLM classifier here.

- [ ] **Step 3: Compose multiple sub-routes without flattening**

In `src/core/services/retrieval-route-selector-service.ts`:

- if one intent is returned, keep today’s behavior
- if multiple intents are returned, run sub-selectors in a fixed order and wrap them in a composed result
- preserve scope-gate behavior per sub-intent
- record the decomposed intent list in the trace verification array

- [ ] **Step 4: Verify the new decomposition path**

Run:

```bash
bun test \
  test/request-intent-classifier-service.test.ts \
  test/retrieval-route-selector-service.test.ts \
  test/scenarios/s05-mixed-intent-decomposition.test.ts
```

Expected: S5 no longer has a remaining `todo`.

- [ ] **Step 5: Commit**

```bash
git add \
  src/core/types.ts \
  src/core/services/retrieval-route-selector-service.ts \
  src/core/services/mixed-scope-bridge-service.ts \
  src/core/services/request-intent-classifier-service.ts \
  src/core/operations.ts \
  test/request-intent-classifier-service.test.ts \
  test/retrieval-route-selector-service.test.ts \
  test/scenarios/s05-mixed-intent-decomposition.test.ts
git commit -m "feat: decompose mixed requests into multiple retrieval intents"
```

## 11. Track A — Sprint 0 TypeScript Baseline Cleanup

**Purpose:** Make `bunx tsc --noEmit --pretty false` green and then enforce it in CI without mixing mechanical cleanup into feature PRs.

This track follows `docs/superpowers/specs/2026-04-24-mbrain-sprint-0-tsc-baseline-design.md` exactly. Do not mix behavior changes into these slices.

### 11.1 Slice S0.1 — Commands and CLI

**Files:**
- Modify: `src/commands/migrate-engine.ts`
- Modify: `src/commands/files.ts`
- Modify: `src/commands/export.ts`
- Modify: `src/cli.ts`

- [ ] Run a fresh baseline scoped to commands:

```bash
bunx tsc --noEmit --pretty false 2>&1 | rg "src/commands/|src/cli.ts"
```

- [ ] Fix only command/CLI typing errors.
- [ ] Verify:

```bash
bunx tsc --noEmit --pretty false
bun test
```

- [ ] Commit:

```bash
git add src/commands/migrate-engine.ts src/commands/files.ts src/commands/export.ts src/cli.ts
git commit -m "chore: fix TypeScript baseline in commands and CLI"
```

### 11.2 Slice S0.2 — Core engines except Postgres

**Files:**
- Modify: `src/core/engine-factory.ts`
- Modify: `src/core/sqlite-engine.ts`
- Modify: `src/core/pglite-engine.ts`
- Modify: `src/core/db.ts`
- Modify: `src/core/pglite-lock.ts`

- [ ] Fix the non-Postgres core engine type errors.
- [ ] Ban `as any`; use explicit narrowing or `assertNever`.
- [ ] Verify:

```bash
bunx tsc --noEmit --pretty false
bun test
```

- [ ] Commit:

```bash
git add src/core/engine-factory.ts src/core/sqlite-engine.ts src/core/pglite-engine.ts src/core/db.ts src/core/pglite-lock.ts
git commit -m "chore: fix TypeScript baseline in core engines"
```

### 11.3 Slice S0.3 — Postgres engine and shared DB typing

**Files:**
- Modify: `src/core/postgres-engine.ts`
- Modify: `src/core/db.ts`
- Modify: `src/core/utils.ts`

- [ ] Fix the Postgres generic and tuple typing issues without changing runtime behavior.
- [ ] Re-run the real Postgres targeted suite after any risky narrowing:

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5434/mbrain_test \
  bun test test/postgres-jsonb-engine.test.ts test/canonical-handoff-engine.test.ts
```

- [ ] Verify:

```bash
bunx tsc --noEmit --pretty false
bun test
```

- [ ] Commit:

```bash
git add src/core/postgres-engine.ts src/core/db.ts src/core/utils.ts
git commit -m "chore: fix TypeScript baseline in postgres engine"
```

### 11.4 Slice S0.4 — Services and operations helpers

**Files:**
- Modify: `src/core/services/**/*.ts`
- Modify: `src/core/operations-memory-inbox.ts`
- Modify: `src/core/operations.ts`

- [ ] Fix service-layer typing, especially:
  - `historical-validity-service.ts`
  - `map-derived-candidate-service.ts`
  - route-selector helper typing
- [ ] Verify:

```bash
bunx tsc --noEmit --pretty false
bun test
```

- [ ] Commit:

```bash
git add src/core/services src/core/operations-memory-inbox.ts src/core/operations.ts
git commit -m "chore: fix TypeScript baseline in services"
```

### 11.5 Slice S0.5 — Non-scenario tests

**Files:**
- Modify: `test/**/*.test.ts`
- Exclude: `test/scenarios/**`

- [ ] Fix non-scenario test typing mismatches.
- [ ] Verify:

```bash
bunx tsc --noEmit --pretty false
bun test
```

- [ ] Commit:

```bash
git add test
git commit -m "chore: fix TypeScript baseline in non-scenario tests"
```

### 11.6 Slice S0.6 — Scenario helpers and scenario tests

**Files:**
- Modify: `test/scenarios/helpers.ts`
- Modify: `test/scenarios/**/*.test.ts`

- [ ] Fix the remaining scenario typing errors only after the functional tracks above have landed.
- [ ] Verify:

```bash
bunx tsc --noEmit --pretty false
bun run test:scenarios
```

- [ ] Commit:

```bash
git add test/scenarios
git commit -m "chore: fix TypeScript baseline in scenario tests"
```

### 11.7 Slice S0.7 — CI typecheck gate

**Files:**
- Modify: `.github/workflows/test.yml`

- [ ] Add exactly one typecheck step before `bun test`:

```yaml
- name: Typecheck
  run: bunx tsc --noEmit --pretty false
```

- [ ] Verify locally:

```bash
bunx tsc --noEmit --pretty false
bun test
```

- [ ] Commit:

```bash
git add .github/workflows/test.yml
git commit -m "ci: run TypeScript typecheck in test workflow"
```

## 12. Final Verification Pass

After all tracks land on a single branch for the final completion check, run this exact sequence:

```bash
bunx tsc --noEmit --pretty false
bun run test:scenarios
bun test
DATABASE_URL=postgresql://postgres:postgres@localhost:5434/mbrain_test bun test \
  test/postgres-jsonb-engine.test.ts \
  test/retrieval-route-trace-service.test.ts \
  test/brain-loop-audit-service.test.ts \
  test/scenarios/s09-curated-over-map.test.ts \
  test/scenarios/s11-code-claim-verification.test.ts
git diff --check
rg -n "test\\.todo" test/scenarios docs/superpowers/plans/2026-04-24-mbrain-redesign-completion-plan.md
```

Expected results:

- `tsc` exits `0`
- scenario suite contains no remaining redesign gap `todo`
- full test suite is green
- targeted real-Postgres regression set is green
- no diff whitespace errors
- no placeholder text remains in the completion plan or scenario files

## 13. Architectural Success Criteria

A merge is not enough. The redesign is only complete when the behavior matches the architecture document’s goals.

### 13.1 Task continuity

- `task_resume` still provides working set, attempts, decisions, and latest trace context
- stale code claims are not repeated as current facts

### 13.2 Canonical-first knowledge

- broad synthesis uses context maps to orient
- curated Markdown notes remain the authority when derived map claims disagree

### 13.3 Governance

- disagreements and inferred claims surface into governance paths instead of silently becoming truth
- immutable write events stay linkable to the originating interaction

### 13.4 Observability

- the loop can answer “did it run?” and “did read lead to linked write?” over a real window
- audit uses structure and joins, not regex scraping

### 13.5 Quality gate

- repo-wide strict TypeScript is enforced in CI
- Postgres parity is validated with a real database

## 14. Stop Conditions

Stop and re-plan instead of continuing if any of these happen:

- a track needs schema rollback instead of forward-only migration
- real Postgres behavior diverges from SQLite/PGLite in a way that changes the contract
- S0 type cleanup reveals a runtime bug rather than a pure type error
- L1 decomposition requires an LLM classifier rather than deterministic rules

If one of these occurs, write a narrow corrective design spec first instead of improvising in code.
