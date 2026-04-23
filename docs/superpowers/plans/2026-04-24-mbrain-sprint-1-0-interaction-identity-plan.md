# Sprint 1.0 — Agent-Turn Identity Foundation · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `retrieval_traces.id` the canonical agent-turn identifier, allow task-less traces, and add `interaction_id` to three immutable event tables so later sprints can correlate reads and writes.

**Architecture:** One PR, six commits. Each commit is independently green and represents one narrow change. No behavior change is user-visible — all work is foundational. Mutable state rows (`memory_candidate_entries`) are explicitly NOT touched; per-turn attribution for FSM transitions is deferred to a later sprint's event-log table.

**Tech Stack:** TypeScript · Bun test · SQLite (`bun:sqlite`) · PGLite (`@electric-sql/pglite`) · Postgres (`postgres.js`). Existing migration framework in `src/core/migrate.ts` (forward-only) plus per-engine SQLite migration ladder in `src/core/sqlite-engine.ts`.

**Source spec:** `docs/superpowers/specs/2026-04-24-mbrain-sprint-1-0-interaction-identity-design.md`

---

## File structure — what changes and why

Files that will be created or modified:

| File | Role in this sprint |
|---|---|
| `src/core/types.ts` | Widen `RetrievalTrace.scope` to `ScopeGateScope`; add `interaction_id` fields to three event entity + input interfaces |
| `src/core/services/retrieval-route-selector-service.ts` | Relax `persistSelectedRouteTrace` to accept optional `taskId`; fall scope back through `scope_gate.resolved_scope` then `'unknown'` |
| `src/core/migrate.ts` | Add migration 21 — `ALTER TABLE` adding `interaction_id` to three event tables, plus three partial indexes |
| `src/core/sqlite-engine.ts` | Migration ladder case 21; update three `create*` and three `get/list*` methods to carry the new column |
| `src/core/pglite-engine.ts` | Update same three create / read methods |
| `src/core/postgres-engine.ts` | Update same three create / read methods |
| `src/core/services/canonical-handoff-service.ts` | Accept `interaction_id` on input, thread through |
| `src/core/services/memory-inbox-supersession-service.ts` | Accept `interaction_id` on input, thread through |
| `src/core/services/memory-inbox-contradiction-service.ts` | Accept `interaction_id` on input, thread through |
| `test/scenarios/s17-task-less-trace.test.ts` | **NEW.** Task-less trace is persisted with scope falling back to `scope_gate.resolved_scope` then `'unknown'` |
| `test/scenarios/s18-interaction-id-handoff.test.ts` | **NEW.** `canonical_handoff` row carries `interaction_id` and is recoverable by trace id |
| `test/scenarios/s19-interaction-id-supersession.test.ts` | **NEW.** Supersession entry carries `interaction_id`, tested across SQLite + PGLite |
| `test/scenarios/s20-interaction-id-nullable.test.ts` | **NEW.** Absent `interaction_id` is a valid state on all three event tables |
| `test/scenarios/interaction-schema.test.ts` | **NEW.** Cross-engine schema assertion — columns and indexes exist |

Non-goals (do not touch):

- `memory_candidate_entries` — mutable state, excluded by spec §3
- `retrieval_traces` schema — Sprint 1.1 owns those columns
- Task thread filters — Sprint 1.1 adds `offset`
- CI workflow — Sprint 0 owns `tsc --noEmit`
- Operations / CLI surface — Sprint 1.1 adds the audit op

Each of the six tasks below corresponds to one commit.

---

## Task 1: Widen `RetrievalTrace.scope` to `ScopeGateScope`

**Files:**
- Modify: `src/core/types.ts`

Task-less traces are impossible today partly because `RetrievalTrace.scope` is typed as `TaskScope = 'work' | 'personal' | 'mixed'`. When there is no task thread, there is no `TaskScope` value to copy. This task widens the type so a task-less trace can carry `'unknown'`.

This task does not change any runtime code path. Downstream callers that consume `trace.scope` as `TaskScope` will now produce TS errors; fix those inline in this commit.

- [ ] **Step 1: Find all consumers of `RetrievalTrace.scope`**

```bash
grep -rn "RetrievalTrace" src/ test/ | grep -v "\.test\.ts" | head
grep -rn "\.scope" src/core/services | head
```

Expected: `persistSelectedRouteTrace` in `retrieval-route-selector-service.ts` assigns `thread.scope` to the trace. A few reads of trace rows elsewhere.

- [ ] **Step 2: Widen the type**

Edit `src/core/types.ts`. Find `export interface RetrievalTrace` (locate via `grep -n "export interface RetrievalTrace" src/core/types.ts`). Replace the `scope` field's type.

Before:
```ts
export interface RetrievalTrace {
  id: string;
  task_id: string | null;
  scope: TaskScope;
  route: string[];
  source_refs: string[];
  verification: string[];
  outcome: string;
  created_at: Date;
}
```

After:
```ts
export interface RetrievalTrace {
  id: string;
  task_id: string | null;
  scope: ScopeGateScope;           // widened from TaskScope — supports task-less traces
  route: string[];
  source_refs: string[];
  verification: string[];
  outcome: string;
  created_at: Date;
}
```

Also update `RetrievalTraceInput` if it has a `scope` field of type `TaskScope`. Confirm by searching for `export interface RetrievalTraceInput` in the same file.

If `ScopeGateScope` is not already imported at the point where `RetrievalTrace` is defined, it should already be in scope in the same file — confirm with `grep -n "ScopeGateScope" src/core/types.ts`.

- [ ] **Step 3: Run tsc and fix downstream narrowings**

```bash
bunx tsc --noEmit --pretty false 2>&1 | grep -E "retrieval_trace|trace\.scope|RetrievalTrace" | head -30
```

Expected output: zero or a small number of errors. The widening is a supertype relationship — existing `'work' | 'personal' | 'mixed'` values remain valid. Errors most likely appear only if some consumer explicitly asserted `TaskScope`.

If a consumer assumes `TaskScope`, narrow locally:
```ts
// Example narrowing pattern if required
const taskScope = trace.scope === 'unknown' ? 'work' : trace.scope;  // pick an explicit policy
```

- [ ] **Step 4: Run unit tests**

```bash
bun test test/retrieval-route-trace-service.test.ts test/retrieval-route-selector-service.test.ts
```

Expected: all pass (no runtime logic changed yet).

- [ ] **Step 5: Commit**

```bash
git add src/core/types.ts
git commit -m "feat(types): widen RetrievalTrace.scope to ScopeGateScope"
```

---

## Task 2: Selector persists traces without `task_id`

**Files:**
- Modify: `src/core/services/retrieval-route-selector-service.ts`
- Create: `test/scenarios/s17-task-less-trace.test.ts`

Goal: allow `selectRetrievalRoute({ persist_trace: true })` without a `task_id`. Scope falls back through `scope_gate.resolved_scope` then `'unknown'`. Task-not-found during persistence is logged in `verification` and treated as null `task_id` rather than thrown.

- [ ] **Step 1: Write failing scenario S17**

Create `test/scenarios/s17-task-less-trace.test.ts`:

```ts
/**
 * Scenario S17 — Task-less trace is persisted with fallback scope.
 *
 * Falsifies Sprint 1.0 goal: `retrieval_traces.id` is the canonical
 * agent-turn identifier. Task is not required.
 */

import { describe, expect, test } from 'bun:test';
import { allocateSqliteBrain } from './helpers.ts';
import { selectRetrievalRoute } from '../../src/core/services/retrieval-route-selector-service.ts';

describe('S17 — task-less trace persistence', () => {
  test('selectRetrievalRoute without task_id persists a trace with scope unknown when no signals', async () => {
    const handle = await allocateSqliteBrain('s17-no-task');

    try {
      const result = await selectRetrievalRoute(handle.engine, {
        intent: 'broad_synthesis',
        query: 'something',
        persist_trace: true,
      });

      expect(result.trace).toBeDefined();
      expect(result.trace!.task_id).toBeNull();
      expect(result.trace!.scope).toBe('unknown');
    } finally {
      await handle.teardown();
    }
  });

  test('selectRetrievalRoute without task_id inherits scope from scope_gate when signals resolve', async () => {
    const handle = await allocateSqliteBrain('s17-signal');

    try {
      const result = await selectRetrievalRoute(handle.engine, {
        intent: 'broad_synthesis',
        query: 'show me the repository architecture docs',  // EN work signals
        persist_trace: true,
      });

      expect(result.trace).toBeDefined();
      expect(result.trace!.task_id).toBeNull();
      expect(result.trace!.scope).toBe('work');
    } finally {
      await handle.teardown();
    }
  });

  test('selectRetrievalRoute with unknown task_id does not throw; persists with task_id null', async () => {
    const handle = await allocateSqliteBrain('s17-bad-task');

    try {
      const result = await selectRetrievalRoute(handle.engine, {
        intent: 'broad_synthesis',
        query: 'test',
        task_id: 'does-not-exist',
        persist_trace: true,
      });

      expect(result.trace).toBeDefined();
      expect(result.trace!.task_id).toBeNull();
      expect(result.trace!.verification.some((v) => v.startsWith('task_id_not_found:'))).toBe(true);
    } finally {
      await handle.teardown();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test test/scenarios/s17-task-less-trace.test.ts
```

Expected: all three tests FAIL. First two fail because `selectRetrievalRoute` with no `task_id` returns `result.trace` as undefined (trace is only persisted when both `persist_trace` and `task_id` are set). Third fails with a thrown error from `persistSelectedRouteTrace` since it throws on task not found.

- [ ] **Step 3: Modify `persistSelectedRouteTrace` to accept optional `taskId`**

Open `src/core/services/retrieval-route-selector-service.ts`. Locate `async function persistSelectedRouteTrace` (around line 290; confirm with `grep -n "persistSelectedRouteTrace" src/core/services/retrieval-route-selector-service.ts`).

Replace the function body. Before:

```ts
async function persistSelectedRouteTrace(
  engine: BrainEngine,
  taskId: string,
  selected: RetrievalRouteSelectorResult,
): Promise<RetrievalTrace> {
  const thread = await engine.getTaskThread(taskId);
  if (!thread) {
    throw new Error(`Task thread not found: ${taskId}`);
  }

  return engine.putRetrievalTrace({
    id: crypto.randomUUID(),
    task_id: taskId,
    scope: thread.scope,
    route: selected.route?.retrieval_route ?? [],
    source_refs: collectSourceRefs(selected.route),
    verification: [
      `intent:${selected.selected_intent}`,
      `selection_reason:${selected.selection_reason}`,
      ...buildScopeGateVerification(selected.scope_gate),
    ],
    outcome: selected.route
      ? `${selected.selected_intent} route selected`
      : `${selected.selected_intent} route unavailable`,
  });
}
```

After:

```ts
async function persistSelectedRouteTrace(
  engine: BrainEngine,
  selected: RetrievalRouteSelectorResult,
  taskId?: string,
): Promise<RetrievalTrace> {
  const thread = taskId ? await engine.getTaskThread(taskId) : null;
  const threadMissing = Boolean(taskId) && thread == null;

  const scope: ScopeGateScope = thread?.scope
    ?? selected.scope_gate?.resolved_scope
    ?? 'unknown';

  return engine.putRetrievalTrace({
    id: crypto.randomUUID(),
    task_id: thread ? taskId! : null,
    scope,
    route: selected.route?.retrieval_route ?? [],
    source_refs: collectSourceRefs(selected.route),
    verification: [
      `intent:${selected.selected_intent}`,
      `selection_reason:${selected.selection_reason}`,
      ...buildScopeGateVerification(selected.scope_gate),
      ...(threadMissing ? [`task_id_not_found:${taskId}`] : []),
    ],
    outcome: selected.route
      ? `${selected.selected_intent} route selected`
      : `${selected.selected_intent} route unavailable`,
  });
}
```

At the top of the file add the `ScopeGateScope` import if it is not already imported. Confirm with:
```bash
grep -n "ScopeGateScope" src/core/services/retrieval-route-selector-service.ts
```
If absent, add it to the existing `from '../types.ts'` import.

- [ ] **Step 4: Update the call site in `selectRetrievalRoute`**

Still in the same file, find the two call sites where `persistSelectedRouteTrace` is invoked (search: `grep -n "persistSelectedRouteTrace" src/core/services/retrieval-route-selector-service.ts`). Update each to match the new signature.

Also find the guard in `selectRetrievalRoute` that gates trace persistence. Before:

```ts
if (!input.persist_trace || !input.task_id) {
  return selected;
}

return {
  ...selected,
  trace: await persistSelectedRouteTrace(engine, input.task_id, selected),
};
```

After (there are two such guards — the deny branch and the main branch — update both):

```ts
if (!input.persist_trace) {
  return selected;
}

return {
  ...selected,
  trace: await persistSelectedRouteTrace(engine, selected, input.task_id),
};
```

The deny branch has the same structure. Apply the same change:

```ts
if (!input.persist_trace) {
  return denied;
}

return {
  ...denied,
  trace: await persistSelectedRouteTrace(engine, denied, input.task_id),
};
```

- [ ] **Step 5: Run S17 to verify it passes**

```bash
bun test test/scenarios/s17-task-less-trace.test.ts
```

Expected: all three tests PASS.

- [ ] **Step 6: Run existing trace tests to confirm no regressions**

```bash
bun test test/retrieval-route-trace-service.test.ts test/retrieval-route-selector-service.test.ts test/scenarios/
```

Expected: all pass. If any test previously expected `persistSelectedRouteTrace` to throw on missing task, update that test — behavior has changed by design.

- [ ] **Step 7: Commit**

```bash
git add src/core/services/retrieval-route-selector-service.ts test/scenarios/s17-task-less-trace.test.ts
git commit -m "feat(selector): persist traces without task_id"
```

---

## Task 3: Migration 21 — `interaction_id` columns on event rows

**Files:**
- Modify: `src/core/migrate.ts`
- Modify: `src/core/sqlite-engine.ts`
- Create: `test/scenarios/interaction-schema.test.ts`

Adds `interaction_id TEXT NULL` to three event tables and partial indexes for fast join from trace id. No FK constraint (loose coupling).

- [ ] **Step 1: Write the cross-engine schema test**

Create `test/scenarios/interaction-schema.test.ts`:

```ts
/**
 * Cross-engine schema test — migration 21 adds interaction_id
 * to three immutable event tables.
 */

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SQLiteEngine } from '../../src/core/sqlite-engine.ts';
import { PGLiteEngine } from '../../src/core/pglite-engine.ts';
import { LATEST_VERSION } from '../../src/core/migrate.ts';

const ENGINE_COLD_START_BUDGET_MS = 30_000;

describe('migration 21 — interaction_id on event rows', () => {
  test('SQLite: interaction_id column exists on three tables', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mbrain-m21-sqlite-'));
    const engine = new SQLiteEngine();
    try {
      await engine.connect({ engine: 'sqlite', database_path: join(dir, 'brain.db') });
      await engine.initSchema();

      const version = await engine.getConfig('version');
      expect(Number(version)).toBeGreaterThanOrEqual(21);
      expect(Number(version)).toBe(LATEST_VERSION);

      const db = (engine as any).database;
      for (const table of [
        'canonical_handoff_entries',
        'memory_candidate_supersession_entries',
        'memory_candidate_contradiction_entries',
      ]) {
        const cols = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
        const names = cols.map((c) => c.name);
        expect(names).toContain('interaction_id');
      }
    } finally {
      await engine.disconnect();
      rmSync(dir, { recursive: true, force: true });
    }
  }, ENGINE_COLD_START_BUDGET_MS);

  test('PGLite: interaction_id column exists on three tables', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mbrain-m21-pglite-'));
    const engine = new PGLiteEngine();
    try {
      await engine.connect({ engine: 'pglite', database_path: join(dir, 'pglite') });
      await engine.initSchema();

      for (const table of [
        'canonical_handoff_entries',
        'memory_candidate_supersession_entries',
        'memory_candidate_contradiction_entries',
      ]) {
        const { rows } = await (engine as any).db.query(
          `SELECT column_name FROM information_schema.columns
           WHERE table_name = $1 AND column_name = 'interaction_id'`,
          [table],
        );
        expect(rows.length).toBe(1);
      }
    } finally {
      await engine.disconnect();
      rmSync(dir, { recursive: true, force: true });
    }
  }, ENGINE_COLD_START_BUDGET_MS);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test test/scenarios/interaction-schema.test.ts
```

Expected: both tests FAIL (column not yet added; also `LATEST_VERSION` currently 20 so the assertion about `>= 21` fails).

- [ ] **Step 3: Add migration 21 to `src/core/migrate.ts`**

Open `src/core/migrate.ts`. Find the `const MIGRATIONS: Migration[] = [ … ]` array. Append after the current last entry (version 20, `canonical_handoff_records`):

```ts
  {
    version: 21,
    name: 'interaction_id_on_event_rows',
    sql: `
      ALTER TABLE canonical_handoff_entries
        ADD COLUMN interaction_id TEXT;
      ALTER TABLE memory_candidate_supersession_entries
        ADD COLUMN interaction_id TEXT;
      ALTER TABLE memory_candidate_contradiction_entries
        ADD COLUMN interaction_id TEXT;
      CREATE INDEX IF NOT EXISTS idx_canonical_handoff_interaction
        ON canonical_handoff_entries(interaction_id)
        WHERE interaction_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_supersession_interaction
        ON memory_candidate_supersession_entries(interaction_id)
        WHERE interaction_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_contradiction_interaction
        ON memory_candidate_contradiction_entries(interaction_id)
        WHERE interaction_id IS NOT NULL;
    `,
  },
```

Confirm `LATEST_VERSION` updates automatically — it is derived from `MIGRATIONS[MIGRATIONS.length - 1].version`.

- [ ] **Step 4: Add SQLite migration case 21**

Open `src/core/sqlite-engine.ts`. Find the switch block inside the migration ladder loop (around line 2700+; locate with `grep -n "case 20:" src/core/sqlite-engine.ts`). After the `case 20` block closes with `break;`, add:

```ts
        case 21:
          this.database.exec(`
            ALTER TABLE canonical_handoff_entries
              ADD COLUMN interaction_id TEXT;
            ALTER TABLE memory_candidate_supersession_entries
              ADD COLUMN interaction_id TEXT;
            ALTER TABLE memory_candidate_contradiction_entries
              ADD COLUMN interaction_id TEXT;
            CREATE INDEX IF NOT EXISTS idx_canonical_handoff_interaction
              ON canonical_handoff_entries(interaction_id);
            CREATE INDEX IF NOT EXISTS idx_supersession_interaction
              ON memory_candidate_supersession_entries(interaction_id);
            CREATE INDEX IF NOT EXISTS idx_contradiction_interaction
              ON memory_candidate_contradiction_entries(interaction_id);
          `);
          break;
```

SQLite partial indexes (`WHERE interaction_id IS NOT NULL`) are supported but not necessary for correctness on SQLite because index entries already allow NULL. Drop the `WHERE` clause for simplicity — the full index is acceptable on SQLite.

- [ ] **Step 5: Run the schema test to verify it passes**

```bash
bun test test/scenarios/interaction-schema.test.ts
```

Expected: both tests PASS.

- [ ] **Step 6: Run the full scenario suite and unit suite**

```bash
bun test
```

Expected: all pass. The new column is nullable so existing engine code that does not yet know about it continues to work.

- [ ] **Step 7: Commit**

```bash
git add src/core/migrate.ts src/core/sqlite-engine.ts test/scenarios/interaction-schema.test.ts
git commit -m "feat(schema): migration 21 — interaction_id on event rows"
```

---

## Task 4: Engine insert/select `interaction_id` on event rows

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/sqlite-engine.ts`
- Modify: `src/core/pglite-engine.ts`
- Modify: `src/core/postgres-engine.ts`

Threads `interaction_id` through the engine I/O for `canonical_handoff_entries`, `memory_candidate_supersession_entries`, `memory_candidate_contradiction_entries`. Inputs accept optional `interaction_id`; SELECT methods return it on the row.

- [ ] **Step 1: Extend types**

Open `src/core/types.ts`. For each of the three entity interfaces below, add `interaction_id: string | null;` as the last field before `created_at`. For each input interface, add `interaction_id?: string | null;` as an optional field.

Entities to edit:
- `CanonicalHandoffEntry`
- `MemoryCandidateSupersessionEntry` (search: `grep -n "MemoryCandidateSupersessionEntry\b" src/core/types.ts`)
- `MemoryCandidateContradictionEntry`

Example for `CanonicalHandoffEntry`:

```ts
export interface CanonicalHandoffEntry {
  id: string;
  scope_id: string;
  candidate_id: string;
  target_object_type: CanonicalHandoffTargetObjectType;
  target_object_id: string;
  source_refs: string[];
  reviewed_at: Date | null;
  review_reason: string | null;
  interaction_id: string | null;       // NEW
  created_at: Date;
  updated_at: Date;
}

export interface CanonicalHandoffEntryInput {
  id: string;
  scope_id: string;
  candidate_id: string;
  target_object_type: CanonicalHandoffTargetObjectType;
  target_object_id: string;
  source_refs: string[];
  reviewed_at?: Date | string | null;
  review_reason?: string | null;
  interaction_id?: string | null;      // NEW — optional
}
```

Apply the same shape (new field last before `created_at` on entity; optional on input) for the other two.

- [ ] **Step 2: Update SQLite engine methods**

Open `src/core/sqlite-engine.ts`. For each of the three `create*` / `supersede*` methods, add `interaction_id` to the INSERT column list, add a `?` placeholder, and bind `input.interaction_id ?? null`. For each SELECT (look for `SELECT id, scope_id, … FROM canonical_handoff_entries` type queries), append `interaction_id` to the column list and ensure the row mapper picks it up.

Specific methods (locate via grep):
- `async createCanonicalHandoffEntry` — INSERT + the corresponding row mapper `rowToCanonicalHandoffEntry`
- `async getCanonicalHandoffEntry` — SELECT
- `async listCanonicalHandoffEntries` — SELECT
- `async supersedeMemoryCandidateEntry` — INSERT into `memory_candidate_supersession_entries` (inside the transaction)
- `async getMemoryCandidateSupersessionEntry` — SELECT
- `async createMemoryCandidateContradictionEntry` — INSERT
- `async getMemoryCandidateContradictionEntry` — SELECT

Row mapper pattern (add `interaction_id`):

```ts
function rowToCanonicalHandoffEntry(row: Record<string, unknown>): CanonicalHandoffEntry {
  return {
    id: String(row.id),
    // ... existing fields ...
    reviewed_at: row.reviewed_at == null ? null : new Date(String(row.reviewed_at)),
    review_reason: row.review_reason == null ? null : String(row.review_reason),
    interaction_id: row.interaction_id == null ? null : String(row.interaction_id),  // NEW
    created_at: new Date(String(row.created_at)),
    updated_at: new Date(String(row.updated_at)),
  };
}
```

INSERT pattern (add `interaction_id` column + placeholder):

```ts
this.database.run(`
  INSERT INTO canonical_handoff_entries (
    id, scope_id, candidate_id, target_object_type, target_object_id,
    source_refs, reviewed_at, review_reason, interaction_id,
    created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, [
  input.id,
  input.scope_id,
  input.candidate_id,
  input.target_object_type,
  input.target_object_id,
  JSON.stringify(input.source_refs),
  toNullableIso(input.reviewed_at),
  input.review_reason ?? null,
  input.interaction_id ?? null,     // NEW
  timestamp,
  timestamp,
]);
```

SELECT pattern (append to column list, row mapper picks it up):

```ts
SELECT id, scope_id, candidate_id, target_object_type, target_object_id,
       source_refs, reviewed_at, review_reason, interaction_id,
       created_at, updated_at
FROM canonical_handoff_entries
WHERE ...
```

Apply the same pattern to `memory_candidate_supersession_entries` and `memory_candidate_contradiction_entries`. The supersession insert is inside a transaction — keep the transaction wrapper, just extend the INSERT.

- [ ] **Step 3: Update PGLite engine methods**

Open `src/core/pglite-engine.ts`. Same three entities. PGLite uses `$N` positional parameters.

INSERT pattern (add `interaction_id` column and the next `$N` placeholder, bump subsequent placeholders):

```ts
const { rows } = await this.db.query(
  `INSERT INTO canonical_handoff_entries (
     id, scope_id, candidate_id, target_object_type, target_object_id,
     source_refs, reviewed_at, review_reason, interaction_id
   ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
   RETURNING id, scope_id, candidate_id, target_object_type, target_object_id,
             source_refs, reviewed_at, review_reason, interaction_id,
             created_at, updated_at`,
  [
    input.id,
    input.scope_id,
    input.candidate_id,
    input.target_object_type,
    input.target_object_id,
    JSON.stringify(input.source_refs),
    input.reviewed_at instanceof Date ? input.reviewed_at.toISOString() : input.reviewed_at ?? null,
    input.review_reason ?? null,
    input.interaction_id ?? null,     // NEW
  ],
);
```

SELECT pattern (append `interaction_id` to the column list):

```ts
const { rows } = await this.db.query(
  `SELECT id, scope_id, candidate_id, target_object_type, target_object_id,
          source_refs, reviewed_at, review_reason, interaction_id,
          created_at, updated_at
   FROM canonical_handoff_entries
   WHERE id = $1`,
  [id],
);
```

Methods to update:
- `async createCanonicalHandoffEntry` — INSERT
- `async getCanonicalHandoffEntry`, `async listCanonicalHandoffEntries` — SELECT
- `async supersedeMemoryCandidateEntry` — INSERT inside the transaction (preserve transaction wrapper)
- `async getMemoryCandidateSupersessionEntry` — SELECT
- `async createMemoryCandidateContradictionEntry` — INSERT
- `async getMemoryCandidateContradictionEntry` — SELECT

If a PGLite row-mapper helper exists, update it to emit `interaction_id: row.interaction_id == null ? null : String(row.interaction_id)` the same way the SQLite helper does.

- [ ] **Step 4: Update Postgres engine methods**

Open `src/core/postgres-engine.ts`. Same three entities. `postgres.js` template literal syntax. Example:

```ts
const rows = await sql`
  INSERT INTO canonical_handoff_entries (
    id, scope_id, candidate_id, target_object_type, target_object_id,
    source_refs, reviewed_at, review_reason, interaction_id
  ) VALUES (
    ${input.id}, ${input.scope_id}, ${input.candidate_id},
    ${input.target_object_type}, ${input.target_object_id},
    ${JSON.stringify(input.source_refs)},
    ${input.reviewed_at instanceof Date ? input.reviewed_at.toISOString() : input.reviewed_at ?? null},
    ${input.review_reason ?? null},
    ${input.interaction_id ?? null}
  )
  RETURNING id, scope_id, candidate_id, target_object_type, target_object_id,
            source_refs, reviewed_at, review_reason, interaction_id,
            created_at, updated_at
`;
```

Update the row mapper if it is Postgres-specific; otherwise rely on the shared helper from Task 4 Step 2.

- [ ] **Step 5: Run the existing handoff / supersession / contradiction tests**

```bash
bun test test/canonical-handoff-engine.test.ts test/canonical-handoff-service.test.ts
bun test test/memory-inbox-service.test.ts
bun test test/memory-inbox-contradiction-service.test.ts
```

Expected: all pass. The new column is optional on input, nullable on read — existing tests that don't supply `interaction_id` continue to work.

- [ ] **Step 6: Commit**

```bash
git add src/core/types.ts src/core/sqlite-engine.ts src/core/pglite-engine.ts src/core/postgres-engine.ts
git commit -m "feat(engine): insert/select interaction_id on event row methods"
```

---

## Task 5: Services accept optional `interaction_id`

**Files:**
- Modify: `src/core/services/canonical-handoff-service.ts`
- Modify: `src/core/services/memory-inbox-supersession-service.ts`
- Modify: `src/core/services/memory-inbox-contradiction-service.ts`

Each service function extends its input type with `interaction_id?: string | null` and passes the value through to the engine call.

- [ ] **Step 1: Extend `recordCanonicalHandoff`**

Open `src/core/services/canonical-handoff-service.ts`. Find `RecordCanonicalHandoffInput`:

Before:
```ts
export interface RecordCanonicalHandoffInput {
  candidate_id: string;
  reviewed_at?: Date | string | null;
  review_reason?: string | null;
}
```

After:
```ts
export interface RecordCanonicalHandoffInput {
  candidate_id: string;
  reviewed_at?: Date | string | null;
  review_reason?: string | null;
  interaction_id?: string | null;
}
```

Find the `engine.createCanonicalHandoffEntry({ ... })` call in the function body and add `interaction_id: input.interaction_id ?? null` to the object passed.

- [ ] **Step 2: Extend `supersedeMemoryCandidateEntry` service wrapper**

Open `src/core/services/memory-inbox-supersession-service.ts`. Find the exported service input interface (search: `grep -n "export interface SupersedeMemoryCandidateEntryInput" src/core/services/memory-inbox-supersession-service.ts`). Add `interaction_id?: string | null`.

Find the `engine.supersedeMemoryCandidateEntry({ ... })` call. The engine input shape is `MemoryCandidateSupersessionInput`. Add `interaction_id: input.interaction_id ?? null` to that call.

- [ ] **Step 3: Extend contradiction service**

Open `src/core/services/memory-inbox-contradiction-service.ts`. Locate the exported create function input (search: `grep -n "export" src/core/services/memory-inbox-contradiction-service.ts` to find input interface). Add `interaction_id?: string | null` to the input type. Pass through to `engine.createMemoryCandidateContradictionEntry({ ... })`.

- [ ] **Step 4: Run service tests**

```bash
bun test test/canonical-handoff-service.test.ts test/memory-inbox-service.test.ts test/memory-inbox-contradiction-service.test.ts
```

Expected: all pass. No existing test provides `interaction_id`, so the new default-null behavior is the exercised path.

- [ ] **Step 5: Commit**

```bash
git add src/core/services/canonical-handoff-service.ts src/core/services/memory-inbox-supersession-service.ts src/core/services/memory-inbox-contradiction-service.ts
git commit -m "feat(services): accept optional interaction_id on write services"
```

---

## Task 6: Scenario tests S18, S19, S20

**Files:**
- Create: `test/scenarios/s18-interaction-id-handoff.test.ts`
- Create: `test/scenarios/s19-interaction-id-supersession.test.ts`
- Create: `test/scenarios/s20-interaction-id-nullable.test.ts`

End-to-end scenarios: the trace-id → write-event correlation works; absent `interaction_id` is a valid state.

- [ ] **Step 1: Write S18 — canonical handoff correlation**

Create `test/scenarios/s18-interaction-id-handoff.test.ts`:

```ts
/**
 * Scenario S18 — Canonical handoff carries interaction_id and is
 * recoverable via the trace id.
 */

import { describe, expect, test } from 'bun:test';
import { allocateSqliteBrain, seedMemoryCandidate } from './helpers.ts';
import { selectRetrievalRoute } from '../../src/core/services/retrieval-route-selector-service.ts';
import { promoteMemoryCandidateEntry } from '../../src/core/services/memory-inbox-promotion-service.ts';
import { recordCanonicalHandoff } from '../../src/core/services/canonical-handoff-service.ts';

describe('S18 — handoff carries interaction_id', () => {
  test('handoff row records interaction_id from the preceding retrieval trace', async () => {
    const handle = await allocateSqliteBrain('s18-happy');

    try {
      const traceResult = await selectRetrievalRoute(handle.engine, {
        intent: 'broad_synthesis',
        query: 'anchor interaction',
        persist_trace: true,
      });
      expect(traceResult.trace).toBeDefined();
      const interactionId = traceResult.trace!.id;

      await seedMemoryCandidate(handle.engine, {
        id: 'cand-s18',
        status: 'staged_for_review',
        source_refs: ['User, direct message, 2026-04-24 KST'],
        target_object_type: 'curated_note',
        target_object_id: 'concepts/s18-target',
      });
      await promoteMemoryCandidateEntry(handle.engine, { id: 'cand-s18' });
      const handoff = await recordCanonicalHandoff(handle.engine, {
        candidate_id: 'cand-s18',
        interaction_id: interactionId,
      });

      expect(handoff.handoff.interaction_id).toBe(interactionId);

      const entries = await handle.engine.listCanonicalHandoffEntries({
        scope_id: 'workspace:default',
      });
      const stored = entries.find((e) => e.candidate_id === 'cand-s18');
      expect(stored).toBeDefined();
      expect(stored!.interaction_id).toBe(interactionId);
    } finally {
      await handle.teardown();
    }
  });
});
```

Run to verify it passes (it uses all the plumbing from Tasks 1–5):

```bash
bun test test/scenarios/s18-interaction-id-handoff.test.ts
```

Expected: PASS.

- [ ] **Step 2: Write S19 — supersession correlation across engines**

Create `test/scenarios/s19-interaction-id-supersession.test.ts`:

```ts
/**
 * Scenario S19 — Supersession entry carries interaction_id on SQLite
 * and PGLite. Postgres is exercised when DATABASE_URL is set.
 */

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SQLiteEngine } from '../../src/core/sqlite-engine.ts';
import { PGLiteEngine } from '../../src/core/pglite-engine.ts';
import { seedMemoryCandidate } from './helpers.ts';
import { promoteMemoryCandidateEntry } from '../../src/core/services/memory-inbox-promotion-service.ts';
import { supersedeMemoryCandidateEntry } from '../../src/core/services/memory-inbox-supersession-service.ts';

const ENGINE_COLD_START_BUDGET_MS = 30_000;

function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function allocateSqlite(label: string) {
  const dir = mkdtempSync(join(tmpdir(), `mbrain-s19-${label}-`));
  const engine = new SQLiteEngine();
  await engine.connect({ engine: 'sqlite', database_path: join(dir, 'brain.db') });
  await engine.initSchema();
  return { engine, teardown: async () => { await engine.disconnect(); rmSync(dir, { recursive: true, force: true }); } };
}

async function allocatePglite(label: string) {
  const dir = mkdtempSync(join(tmpdir(), `mbrain-s19-${label}-`));
  const engine = new PGLiteEngine();
  await engine.connect({ engine: 'pglite', database_path: join(dir, 'pglite') });
  await engine.initSchema();
  return { engine, teardown: async () => { await engine.disconnect(); rmSync(dir, { recursive: true, force: true }); } };
}

function runEngineSuite(label: 'sqlite' | 'pglite', allocate: (l: string) => Promise<any>) {
  describe(`S19 [${label}] — supersession carries interaction_id`, () => {
    test('interaction_id is persisted and readable on the supersession entry', async () => {
      const handle = await allocate(label);
      const interactionId = uniqueId(`interaction-${label}`);
      const oldId = uniqueId(`old-${label}`);
      const newId = uniqueId(`new-${label}`);

      try {
        await seedMemoryCandidate(handle.engine, {
          id: oldId, status: 'staged_for_review',
          target_object_id: `concepts/${label}`,
        });
        await seedMemoryCandidate(handle.engine, {
          id: newId, status: 'staged_for_review',
          target_object_id: `concepts/${label}`,
        });
        await promoteMemoryCandidateEntry(handle.engine, { id: oldId });
        await promoteMemoryCandidateEntry(handle.engine, { id: newId });

        const result = await supersedeMemoryCandidateEntry(handle.engine, {
          superseded_candidate_id: oldId,
          replacement_candidate_id: newId,
          interaction_id: interactionId,
        });

        expect(result.supersession_entry).not.toBeNull();
        expect(result.supersession_entry!.interaction_id).toBe(interactionId);

        const stored = await handle.engine.getMemoryCandidateSupersessionEntry(result.supersession_entry!.id);
        expect(stored?.interaction_id).toBe(interactionId);
      } finally {
        await handle.teardown();
      }
    }, ENGINE_COLD_START_BUDGET_MS);
  });
}

runEngineSuite('sqlite', allocateSqlite);
runEngineSuite('pglite', allocatePglite);
```

Run:

```bash
bun test test/scenarios/s19-interaction-id-supersession.test.ts
```

Expected: both engine variants PASS.

- [ ] **Step 3: Write S20 — absent interaction_id is valid**

Create `test/scenarios/s20-interaction-id-nullable.test.ts`:

```ts
/**
 * Scenario S20 — Absent interaction_id is a valid state on all three
 * event row tables. Guards against future regression that would make
 * the field required.
 */

import { describe, expect, test } from 'bun:test';
import { allocateSqliteBrain, seedMemoryCandidate } from './helpers.ts';
import { promoteMemoryCandidateEntry } from '../../src/core/services/memory-inbox-promotion-service.ts';
import { recordCanonicalHandoff } from '../../src/core/services/canonical-handoff-service.ts';
import { supersedeMemoryCandidateEntry } from '../../src/core/services/memory-inbox-supersession-service.ts';

describe('S20 — absent interaction_id is valid', () => {
  test('canonical handoff without interaction_id has null interaction_id on readback', async () => {
    const handle = await allocateSqliteBrain('s20-handoff');
    try {
      await seedMemoryCandidate(handle.engine, {
        id: 'cand-s20-h',
        status: 'staged_for_review',
        target_object_type: 'curated_note',
        target_object_id: 'concepts/s20-h',
      });
      await promoteMemoryCandidateEntry(handle.engine, { id: 'cand-s20-h' });

      const { handoff } = await recordCanonicalHandoff(handle.engine, {
        candidate_id: 'cand-s20-h',
      });
      expect(handoff.interaction_id).toBeNull();
    } finally {
      await handle.teardown();
    }
  });

  test('supersession without interaction_id has null interaction_id on readback', async () => {
    const handle = await allocateSqliteBrain('s20-super');
    try {
      await seedMemoryCandidate(handle.engine, {
        id: 'cand-s20-old', status: 'staged_for_review',
        target_object_id: 'concepts/s20',
      });
      await seedMemoryCandidate(handle.engine, {
        id: 'cand-s20-new', status: 'staged_for_review',
        target_object_id: 'concepts/s20',
      });
      await promoteMemoryCandidateEntry(handle.engine, { id: 'cand-s20-old' });
      await promoteMemoryCandidateEntry(handle.engine, { id: 'cand-s20-new' });

      const result = await supersedeMemoryCandidateEntry(handle.engine, {
        superseded_candidate_id: 'cand-s20-old',
        replacement_candidate_id: 'cand-s20-new',
      });
      expect(result.supersession_entry?.interaction_id).toBeNull();
    } finally {
      await handle.teardown();
    }
  });
});
```

Run:

```bash
bun test test/scenarios/s20-interaction-id-nullable.test.ts
```

Expected: both PASS.

- [ ] **Step 4: Run the full repo test suite**

```bash
bun test
```

Expected: total pass count is strictly greater than the pre-sprint baseline by ≥ 7 tests (S17 three + S18 one + S19 two + S20 two + interaction-schema two = 10 added; some may overlap if the scenario suite already had tests that now exercise new code paths). Zero failures.

- [ ] **Step 5: Commit**

```bash
git add test/scenarios/s18-interaction-id-handoff.test.ts test/scenarios/s19-interaction-id-supersession.test.ts test/scenarios/s20-interaction-id-nullable.test.ts
git commit -m "test(scenarios): S18 S19 S20 interaction_id correlation tests"
```

---

## Post-tasks: open the PR

- [ ] **Push the branch**

```bash
git push -u origin scenario-test-suite
```

(The current branch already hosts Sprint 1.0 on top of the scenario test suite; if a separate branch is preferred, create it from HEAD before pushing.)

- [ ] **Open the PR**

```bash
gh pr create --repo meghendra6/mbrain --title "feat: sprint 1.0 — agent-turn identity foundation" --body "$(cat <<'EOF'
## Summary
- Introduces agent-turn identity: `retrieval_traces.id` is the canonical interaction identifier.
- Relaxes selector to persist traces without a task_id.
- Adds `interaction_id` column to three immutable event tables (canonical_handoff_entries, memory_candidate_supersession_entries, memory_candidate_contradiction_entries).
- Threads `interaction_id` through write-service inputs.
- Adds scenario tests S17–S20 plus a cross-engine schema test.

## Spec
`docs/superpowers/specs/2026-04-24-mbrain-sprint-1-0-interaction-identity-design.md`

## Non-goals (intentional)
- No changes to `memory_candidate_entries` (mutable state — deferred by policy).
- No audit / CLI / MCP surface (Sprint 1.1).
- No CI typecheck change (Sprint 0 Track A).

## Verification
- `bun test` green, pass count increased by the new scenarios.
- Migration 21 applies on SQLite and PGLite (Postgres with DATABASE_URL).
- Existing unit tests unchanged.

## Test plan
- [ ] S17 scenarios green
- [ ] S18 handoff interaction_id round-trip
- [ ] S19 supersession interaction_id on SQLite + PGLite
- [ ] S20 absent interaction_id is null on readback
- [ ] cross-engine schema test confirms column existence
- [ ] full `bun test` green

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Done criteria (from spec §11)

- [ ] Migration 21 applies cleanly on SQLite, PGLite (cross-engine schema test passes).
- [ ] `selectRetrievalRoute({ persist_trace: true })` succeeds with no `task_id`; resulting trace row has `task_id = NULL`.
- [ ] `recordCanonicalHandoff`, `supersedeMemoryCandidateEntry`, `createMemoryCandidateContradictionEntry` accept and persist `interaction_id`.
- [ ] S17, S18, S19, S20 green.
- [ ] `bun test` overall pass count equals or exceeds the pre-sprint baseline.
- [ ] Zero changes to `memory_candidate_entries` schema.
