# MBrain Sprint 5 Candidate Status Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add append-only memory-candidate status events so candidate lifecycle transitions can be audited by interaction id without adding mutable provenance to `memory_candidate_entries`.

**Architecture:** One focused PR in six commits. The raw engine candidate methods stay available for fixtures and low-level parity; product lifecycle paths record status events through services and public operations. Audit gains a precise `candidate_status_events` section while the old `approximate` fields remain backward-compatible counters.

**Tech Stack:** TypeScript, Bun test, SQLite (`bun:sqlite`), PGLite (`@electric-sql/pglite`), Postgres (`postgres.js`), existing forward-only migrations in `src/core/migrate.ts`, and the SQLite migration ladder in `src/core/sqlite-engine.ts`.

**Source spec:** `docs/superpowers/specs/2026-04-25-mbrain-sprint-5-candidate-status-events-design.md`

---

## File Structure

| File | Role |
|---|---|
| `src/core/types.ts` | Add candidate status-event types and audit report section type. |
| `src/core/engine.ts` | Add status-event engine methods to the `BrainEngine` contract. |
| `src/core/migrate.ts` | Add migration 25 for Postgres/PGLite table, indexes, and deterministic backfill. |
| `src/core/sqlite-engine.ts` | Add SQLite migration case 25 and SQLite status-event engine methods. |
| `src/core/pglite-engine.ts` | Add PGLite status-event engine methods. |
| `src/core/postgres-engine.ts` | Add Postgres status-event engine methods. |
| `src/core/utils.ts` | Add shared row mapper for PGLite/Postgres status-event rows. |
| `src/core/services/memory-inbox-service.ts` | Add creation helper and record created/advanced/rejected events. |
| `src/core/services/memory-inbox-promotion-service.ts` | Record promoted events. |
| `src/core/services/memory-inbox-supersession-service.ts` | Record superseded events. |
| `src/core/services/memory-inbox-contradiction-service.ts` | Forward interaction ids through rejected and superseded contradiction outcomes. |
| `src/core/services/map-derived-candidate-service.ts` | Use the creation helper for product-created candidates. |
| `src/core/services/dream-cycle-maintenance-service.ts` | Use the creation helper for product-created candidates. |
| `src/core/services/brain-loop-audit-service.ts` | Count status events precisely and preserve compatibility counters. |
| `src/core/operations-memory-inbox.ts` | Add read operation and thread `interaction_id` through lifecycle operations. |
| `test/memory-inbox-schema.test.ts` | Assert migration/table/index/backfill behavior. |
| `test/memory-inbox-engine.test.ts` | Assert engine create/list/filter status events across engines. |
| `test/memory-inbox-service.test.ts` | Assert service-level lifecycle events. |
| `test/memory-inbox-contradiction-service.test.ts` | Assert contradiction paths share interaction ids. |
| `test/memory-inbox-operations.test.ts` | Assert operation params, forwarding, and status-event listing. |
| `test/brain-loop-audit-service.test.ts` | Assert precise candidate-event report and compatibility counters. |
| `test/brain-loop-audit-engine.test.ts` | Assert audit parity across SQLite/PGLite/Postgres when configured. |
| `test/scenarios/s21-candidate-status-events-audit.test.ts` | New scenario for interaction-linked lifecycle audit. |
| `test/scenarios/README.md` | Add S21 to the scenario contract table. |
| `docs/MBRAIN_VERIFY.md` | Add Sprint 5 verification line. |

Do not add `interaction_id` to `memory_candidate_entries`. Do not add create/update/delete operations for status events.

---

## Task 1: Migration 25 creates and backfills status events

**Files:**
- Modify: `src/core/migrate.ts`
- Modify: `src/core/sqlite-engine.ts`
- Test: `test/memory-inbox-schema.test.ts`

- [ ] **Step 1: Write failing schema tests**

Add a schema assertion helper in `test/memory-inbox-schema.test.ts`:

```ts
async function expectStatusEventBackfill(engine: PGLiteEngine | PostgresEngine, prefix: string) {
  const { rows } = await (engine as any).db.query(
    `SELECT id, candidate_id, scope_id, from_status, to_status, event_kind, interaction_id
     FROM memory_candidate_status_events
     WHERE candidate_id LIKE $1
     ORDER BY candidate_id ASC`,
    [`${prefix}-%`],
  );

  expect(rows.map((row: any) => ({
    id: row.id,
    candidate_id: row.candidate_id,
    from_status: row.from_status,
    to_status: row.to_status,
    event_kind: row.event_kind,
    interaction_id: row.interaction_id,
  }))).toEqual([
    {
      id: `candidate-status-created:${prefix}-promotable`,
      candidate_id: `${prefix}-promotable`,
      from_status: null,
      to_status: 'captured',
      event_kind: 'created',
      interaction_id: null,
    },
    {
      id: `candidate-status-created:${prefix}-rejectable`,
      candidate_id: `${prefix}-rejectable`,
      from_status: null,
      to_status: 'captured',
      event_kind: 'created',
      interaction_id: null,
    },
    {
      id: `candidate-status-created:${prefix}-replacement`,
      candidate_id: `${prefix}-replacement`,
      from_status: null,
      to_status: 'captured',
      event_kind: 'created',
      interaction_id: null,
    },
    {
      id: `candidate-status-created:${prefix}-supersedable`,
      candidate_id: `${prefix}-supersedable`,
      from_status: null,
      to_status: 'captured',
      event_kind: 'created',
      interaction_id: null,
    },
  ]);
}
```

Add a SQLite companion:

```ts
function expectSqliteStatusEventBackfill(engine: SQLiteEngine, prefix: string) {
  const db = (engine as any).database;
  const rows = db.query(`
    SELECT id, candidate_id, scope_id, from_status, to_status, event_kind, interaction_id
    FROM memory_candidate_status_events
    WHERE candidate_id LIKE ?
    ORDER BY candidate_id ASC
  `).all(`${prefix}-%`) as any[];

  expect(rows.map((row) => ({
    id: row.id,
    candidate_id: row.candidate_id,
    from_status: row.from_status,
    to_status: row.to_status,
    event_kind: row.event_kind,
    interaction_id: row.interaction_id,
  }))).toEqual([
    {
      id: `candidate-status-created:${prefix}-promotable`,
      candidate_id: `${prefix}-promotable`,
      from_status: null,
      to_status: 'staged_for_review',
      event_kind: 'created',
      interaction_id: null,
    },
    {
      id: `candidate-status-created:${prefix}-rejectable`,
      candidate_id: `${prefix}-rejectable`,
      from_status: null,
      to_status: 'staged_for_review',
      event_kind: 'created',
      interaction_id: null,
    },
    {
      id: `candidate-status-created:${prefix}-replacement`,
      candidate_id: `${prefix}-replacement`,
      from_status: null,
      to_status: 'staged_for_review',
      event_kind: 'created',
      interaction_id: null,
    },
    {
      id: `candidate-status-created:${prefix}-supersedable`,
      candidate_id: `${prefix}-supersedable`,
      from_status: null,
      to_status: 'staged_for_review',
      event_kind: 'created',
      interaction_id: null,
    },
  ]);
}
```

Extend the existing SQLite/PGLite/Postgres schema tests to assert:

```ts
expect(tableNames).toContain('memory_candidate_status_events');
expect(indexNames).toContain('idx_memory_candidate_status_events_candidate_created');
expect(indexNames).toContain('idx_memory_candidate_status_events_interaction');
expect(indexNames).toContain('idx_memory_candidate_status_events_scope_created');
expect(indexNames).toContain('idx_memory_candidate_status_events_kind_created');
expect(foreignKeyRows).toEqual([]);
```

In each existing v15 migration replay test, call the matching backfill helper after `runMigrations(engine)` or `engine.initSchema()`.

- [ ] **Step 2: Run schema tests and confirm failure**

```bash
bun test test/memory-inbox-schema.test.ts
```

Expected: FAIL because `memory_candidate_status_events` does not exist and `LATEST_VERSION` is still 24.

- [ ] **Step 3: Add migration 25 to shared migration list**

In `src/core/migrate.ts`, append this object after migration 24:

```ts
{
  version: 25,
  name: 'memory_candidate_status_events',
  sql: `
    CREATE TABLE IF NOT EXISTS memory_candidate_status_events (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT NOT NULL CHECK (
        to_status IN ('captured', 'candidate', 'staged_for_review', 'promoted', 'rejected', 'superseded')
      ),
      event_kind TEXT NOT NULL CHECK (
        event_kind IN ('created', 'advanced', 'promoted', 'rejected', 'superseded')
      ),
      interaction_id TEXT,
      reviewed_at TIMESTAMPTZ,
      review_reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_memory_candidate_status_events_candidate_created
      ON memory_candidate_status_events(candidate_id, created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_memory_candidate_status_events_interaction
      ON memory_candidate_status_events(interaction_id)
      WHERE interaction_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_memory_candidate_status_events_scope_created
      ON memory_candidate_status_events(scope_id, created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_memory_candidate_status_events_kind_created
      ON memory_candidate_status_events(event_kind, created_at DESC, id DESC);
    INSERT INTO memory_candidate_status_events (
      id, candidate_id, scope_id, from_status, to_status, event_kind,
      interaction_id, reviewed_at, review_reason, created_at
    )
    SELECT
      'candidate-status-created:' || id,
      id,
      scope_id,
      NULL,
      status,
      'created',
      NULL,
      NULL,
      NULL,
      created_at
    FROM memory_candidate_entries
    ON CONFLICT (id) DO NOTHING;
  `,
},
```

- [ ] **Step 4: Add SQLite migration case 25**

In `src/core/sqlite-engine.ts`, add `case 25` in `runSqliteMigrations`:

```ts
case 25:
  this.ensureMemoryCandidateStatusEventSchema();
  break;
```

Add this private helper near `ensureBrainLoopAuditIndexes`:

```ts
private ensureMemoryCandidateStatusEventSchema(): void {
  this.database.exec(`
    CREATE TABLE IF NOT EXISTS memory_candidate_status_events (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT NOT NULL CHECK (
        to_status IN ('captured', 'candidate', 'staged_for_review', 'promoted', 'rejected', 'superseded')
      ),
      event_kind TEXT NOT NULL CHECK (
        event_kind IN ('created', 'advanced', 'promoted', 'rejected', 'superseded')
      ),
      interaction_id TEXT,
      reviewed_at TEXT,
      review_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_memory_candidate_status_events_candidate_created
      ON memory_candidate_status_events(candidate_id, created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_memory_candidate_status_events_interaction
      ON memory_candidate_status_events(interaction_id);
    CREATE INDEX IF NOT EXISTS idx_memory_candidate_status_events_scope_created
      ON memory_candidate_status_events(scope_id, created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_memory_candidate_status_events_kind_created
      ON memory_candidate_status_events(event_kind, created_at DESC, id DESC);
    INSERT OR IGNORE INTO memory_candidate_status_events (
      id, candidate_id, scope_id, from_status, to_status, event_kind,
      interaction_id, reviewed_at, review_reason, created_at
    )
    SELECT
      'candidate-status-created:' || id,
      id,
      scope_id,
      NULL,
      status,
      'created',
      NULL,
      NULL,
      NULL,
      created_at
    FROM memory_candidate_entries;
  `);
}
```

- [ ] **Step 5: Verify schema tests pass**

```bash
bun test test/memory-inbox-schema.test.ts
```

Expected: PASS. Postgres v15 migration test remains skipped when `DATABASE_URL` is unset.

- [ ] **Step 6: Commit**

```bash
git add src/core/migrate.ts src/core/sqlite-engine.ts test/memory-inbox-schema.test.ts
git diff --cached --check
git commit -m "feat(schema): add candidate status events migration"
```

---

## Task 2: Engine API creates and lists status events

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/engine.ts`
- Modify: `src/core/utils.ts`
- Modify: `src/core/sqlite-engine.ts`
- Modify: `src/core/pglite-engine.ts`
- Modify: `src/core/postgres-engine.ts`
- Test: `test/memory-inbox-engine.test.ts`

- [ ] **Step 1: Write failing engine tests**

In `test/memory-inbox-engine.test.ts`, add this helper:

```ts
async function expectCandidateStatusEventApi(engine: BrainEngine, label: string) {
  const candidateId = `candidate-status-event-api:${label}`;
  await seedMemoryCandidate(engine, candidateId, 'workspace:default');

  const created = await engine.createMemoryCandidateStatusEvent({
    id: `candidate-status-event:${label}:created`,
    candidate_id: candidateId,
    scope_id: 'workspace:default',
    from_status: null,
    to_status: 'captured',
    event_kind: 'created',
    interaction_id: `trace-${label}`,
    reviewed_at: null,
    review_reason: 'Engine API fixture.',
    created_at: new Date('2026-04-25T00:00:00.000Z'),
  });

  expect(created.id).toBe(`candidate-status-event:${label}:created`);
  expect(created.candidate_id).toBe(candidateId);
  expect(created.from_status).toBeNull();
  expect(created.to_status).toBe('captured');
  expect(created.event_kind).toBe('created');
  expect(created.interaction_id).toBe(`trace-${label}`);
  expect(created.reviewed_at).toBeNull();

  const byCandidate = await engine.listMemoryCandidateStatusEvents({
    candidate_id: candidateId,
    limit: 10,
  });
  expect(byCandidate.map((event) => event.id)).toContain(`candidate-status-event:${label}:created`);

  const byScope = await engine.listMemoryCandidateStatusEvents({
    scope_id: 'workspace:default',
    event_kind: 'created',
    to_status: 'captured',
    interaction_id: `trace-${label}`,
    created_since: new Date('2026-04-24T23:59:00.000Z'),
    created_until: new Date('2026-04-25T00:01:00.000Z'),
    limit: 10,
    offset: 0,
  });
  expect(byScope.map((event) => event.id)).toContain(`candidate-status-event:${label}:created`);

  const byInteraction = await engine.listMemoryCandidateStatusEventsByInteractionIds([`trace-${label}`]);
  expect(byInteraction.map((event) => event.id)).toEqual([`candidate-status-event:${label}:created`]);
}
```

Call it inside the existing SQLite/PGLite loop:

```ts
test(`${createHarness.name} creates and lists memory candidate status events`, async () => {
  const harness = await createHarness();
  try {
    await expectCandidateStatusEventApi(harness.engine, harness.label);
  } finally {
    await harness.cleanup();
  }
}, timeoutMs);
```

Add the same call in the guarded Postgres section if that file already has one.

- [ ] **Step 2: Run engine tests and confirm failure**

```bash
bun test test/memory-inbox-engine.test.ts
```

Expected: FAIL because `BrainEngine` has no status-event methods.

- [ ] **Step 3: Add status-event types**

In `src/core/types.ts`, add near the candidate types:

```ts
export type MemoryCandidateStatusEventKind =
  | 'created'
  | 'advanced'
  | 'promoted'
  | 'rejected'
  | 'superseded';

export interface MemoryCandidateStatusEvent {
  id: string;
  candidate_id: string;
  scope_id: string;
  from_status: MemoryCandidateStatus | null;
  to_status: MemoryCandidateStatus;
  event_kind: MemoryCandidateStatusEventKind;
  interaction_id: string | null;
  reviewed_at: Date | null;
  review_reason: string | null;
  created_at: Date;
}

export interface MemoryCandidateStatusEventInput {
  id: string;
  candidate_id: string;
  scope_id: string;
  from_status?: MemoryCandidateStatus | null;
  to_status: MemoryCandidateStatus;
  event_kind: MemoryCandidateStatusEventKind;
  interaction_id?: string | null;
  reviewed_at?: Date | string | null;
  review_reason?: string | null;
  created_at?: Date | string | null;
}

export interface MemoryCandidateStatusEventFilters {
  candidate_id?: string;
  scope_id?: string;
  event_kind?: MemoryCandidateStatusEventKind;
  to_status?: MemoryCandidateStatus;
  interaction_id?: string;
  created_since?: Date;
  created_until?: Date;
  limit?: number;
  offset?: number;
}
```

- [ ] **Step 4: Add engine contract methods**

In `src/core/engine.ts`, import the new types and add:

```ts
createMemoryCandidateStatusEvent(input: MemoryCandidateStatusEventInput): Promise<MemoryCandidateStatusEvent>;
listMemoryCandidateStatusEvents(filters?: MemoryCandidateStatusEventFilters): Promise<MemoryCandidateStatusEvent[]>;
listMemoryCandidateStatusEventsByInteractionIds(interactionIds: string[]): Promise<MemoryCandidateStatusEvent[]>;
```

- [ ] **Step 5: Add shared row mapper**

In `src/core/utils.ts`, add:

```ts
export function rowToMemoryCandidateStatusEvent(
  row: Record<string, unknown>,
): MemoryCandidateStatusEvent {
  return {
    id: row.id as string,
    candidate_id: row.candidate_id as string,
    scope_id: row.scope_id as string,
    from_status: (row.from_status as MemoryCandidateStatusEvent['from_status']) ?? null,
    to_status: row.to_status as MemoryCandidateStatusEvent['to_status'],
    event_kind: row.event_kind as MemoryCandidateStatusEvent['event_kind'],
    interaction_id: row.interaction_id == null ? null : String(row.interaction_id),
    reviewed_at: row.reviewed_at ? new Date(row.reviewed_at as string) : null,
    review_reason: (row.review_reason as string | null) ?? null,
    created_at: new Date(row.created_at as string),
  };
}
```

Import `MemoryCandidateStatusEvent` if needed.

- [ ] **Step 6: Implement SQLite methods**

In `src/core/sqlite-engine.ts`, import the new types and shared mapper. Add methods near the candidate methods:

```ts
async createMemoryCandidateStatusEvent(input: MemoryCandidateStatusEventInput): Promise<MemoryCandidateStatusEvent> {
  const createdAt = input.created_at ?? new Date();
  this.database.query(`
    INSERT INTO memory_candidate_status_events (
      id, candidate_id, scope_id, from_status, to_status, event_kind,
      interaction_id, reviewed_at, review_reason, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.id,
    input.candidate_id,
    input.scope_id,
    input.from_status ?? null,
    input.to_status,
    input.event_kind,
    input.interaction_id ?? null,
    input.reviewed_at ?? null,
    input.review_reason ?? null,
    createdAt,
  );

  const row = this.database.query(`
    SELECT id, candidate_id, scope_id, from_status, to_status, event_kind,
           interaction_id, reviewed_at, review_reason, created_at
    FROM memory_candidate_status_events
    WHERE id = ?
  `).get(input.id) as Record<string, unknown> | null;
  if (!row) throw new Error(`Memory candidate status event not found after create: ${input.id}`);
  return rowToMemoryCandidateStatusEvent(row);
}
```

Then implement `listMemoryCandidateStatusEvents` with the same dynamic filter pattern as `listMemoryCandidateEntries`, ordering:

```sql
ORDER BY created_at DESC, id DESC
```

Implement `listMemoryCandidateStatusEventsByInteractionIds` with the existing 500-row chunking pattern and final sort by `created_at DESC`, then `id DESC`.

- [ ] **Step 7: Implement PGLite and Postgres methods**

In both `src/core/pglite-engine.ts` and `src/core/postgres-engine.ts`, add the same method set. Use `$n` dynamic SQL in PGLite and `sql.unsafe` with params in Postgres, matching existing candidate list methods. Each `SELECT` must include:

```sql
SELECT id, candidate_id, scope_id, from_status, to_status, event_kind,
       interaction_id, reviewed_at, review_reason, created_at
FROM memory_candidate_status_events
```

Order all list responses by:

```sql
ORDER BY created_at DESC, id DESC
```

- [ ] **Step 8: Verify engine tests pass**

```bash
bun test test/memory-inbox-engine.test.ts
```

Expected: PASS for SQLite and PGLite; Postgres is covered when `DATABASE_URL` is set.

- [ ] **Step 9: Commit**

```bash
git add src/core/types.ts src/core/engine.ts src/core/utils.ts src/core/sqlite-engine.ts src/core/pglite-engine.ts src/core/postgres-engine.ts test/memory-inbox-engine.test.ts
git diff --cached --check
git commit -m "feat(engine): add candidate status event API"
```

---

## Task 3: Services record lifecycle status events

**Files:**
- Modify: `src/core/services/memory-inbox-service.ts`
- Modify: `src/core/services/memory-inbox-promotion-service.ts`
- Modify: `src/core/services/memory-inbox-supersession-service.ts`
- Modify: `src/core/services/memory-inbox-contradiction-service.ts`
- Modify: `src/core/services/map-derived-candidate-service.ts`
- Modify: `src/core/services/dream-cycle-maintenance-service.ts`
- Test: `test/memory-inbox-service.test.ts`
- Test: `test/memory-inbox-contradiction-service.test.ts`
- Test: `test/map-derived-candidate-service.test.ts`
- Test: `test/dream-cycle-maintenance-service.test.ts`

- [ ] **Step 1: Write failing service tests**

In `test/memory-inbox-service.test.ts`, add:

```ts
test('memory inbox service records created and transition events with interaction ids', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mbrain-memory-inbox-status-events-'));
  const databasePath = join(dir, 'brain.db');
  const engine = new SQLiteEngine();

  try {
    await engine.connect({ engine: 'sqlite', database_path: databasePath });
    await engine.initSchema();

    await createMemoryCandidateEntryWithStatusEvent(engine, {
      id: 'candidate-status-events-service',
      scope_id: 'workspace:default',
      candidate_type: 'fact',
      proposed_content: 'Service should record candidate status events.',
      source_refs: ['User, direct message, 2026-04-25 9:00 AM KST'],
      generated_by: 'manual',
      extraction_kind: 'manual',
      confidence_score: 0.9,
      importance_score: 0.7,
      recurrence_score: 0.1,
      sensitivity: 'work',
      status: 'captured',
      target_object_type: 'curated_note',
      target_object_id: 'concepts/status-events',
      interaction_id: 'trace-service-status-events',
    });
    await advanceMemoryCandidateStatus(engine, {
      id: 'candidate-status-events-service',
      next_status: 'candidate',
      interaction_id: 'trace-service-status-events',
    });
    await advanceMemoryCandidateStatus(engine, {
      id: 'candidate-status-events-service',
      next_status: 'staged_for_review',
      interaction_id: 'trace-service-status-events',
      review_reason: 'Ready for review.',
    });
    await rejectMemoryCandidateEntry(engine, {
      id: 'candidate-status-events-service',
      interaction_id: 'trace-service-status-events',
      review_reason: 'Rejected for service status-event test.',
    });

    const events = await engine.listMemoryCandidateStatusEvents({
      candidate_id: 'candidate-status-events-service',
      limit: 10,
    });
    expect(events.map((event) => event.event_kind).sort()).toEqual([
      'advanced',
      'advanced',
      'created',
      'rejected',
    ]);
    expect(events.every((event) => event.interaction_id === 'trace-service-status-events')).toBe(true);
  } finally {
    await engine.disconnect();
    rmSync(dir, { recursive: true, force: true });
  }
});
```

Also add targeted tests for promotion and supersession:

```ts
expect((await engine.listMemoryCandidateStatusEvents({
  candidate_id: 'promoted-service-candidate',
  event_kind: 'promoted',
  limit: 10,
}))).toHaveLength(1);

expect((await engine.listMemoryCandidateStatusEvents({
  candidate_id: 'superseded-service-candidate',
  event_kind: 'superseded',
  limit: 10,
}))).toHaveLength(1);
```

In `test/memory-inbox-contradiction-service.test.ts`, add one rejected-outcome assertion that the rejection status event has the same `interaction_id` as the contradiction row.

- [ ] **Step 2: Run service tests and confirm failure**

```bash
bun test test/memory-inbox-service.test.ts test/memory-inbox-contradiction-service.test.ts test/map-derived-candidate-service.test.ts test/dream-cycle-maintenance-service.test.ts
```

Expected: FAIL because services do not create status-event rows and `createMemoryCandidateEntryWithStatusEvent` is not exported.

- [ ] **Step 3: Add creation helper and event helper**

In `src/core/services/memory-inbox-service.ts`, import `MemoryCandidateEntryInput` and add:

```ts
export async function createMemoryCandidateEntryWithStatusEvent(
  engine: BrainEngine,
  input: MemoryCandidateEntryInput & { interaction_id?: string | null },
): Promise<MemoryCandidateEntry> {
  return engine.transaction(async (txBase) => {
    const tx = txBase as BrainEngine;
    const created = await tx.createMemoryCandidateEntry(input);
    await tx.createMemoryCandidateStatusEvent({
      id: crypto.randomUUID(),
      candidate_id: created.id,
      scope_id: created.scope_id,
      from_status: null,
      to_status: created.status,
      event_kind: 'created',
      interaction_id: input.interaction_id ?? null,
      reviewed_at: created.reviewed_at,
      review_reason: created.review_reason,
      created_at: created.created_at,
    });
    return created;
  });
}
```

Add a private helper for status updates:

```ts
async function recordCandidateStatusEvent(
  engine: BrainEngine,
  input: {
    candidate: MemoryCandidateEntry;
    from_status: MemoryCandidateStatus | null;
    event_kind: 'advanced' | 'rejected' | 'promoted' | 'superseded';
    interaction_id?: string | null;
  },
) {
  await engine.createMemoryCandidateStatusEvent({
    id: crypto.randomUUID(),
    candidate_id: input.candidate.id,
    scope_id: input.candidate.scope_id,
    from_status: input.from_status,
    to_status: input.candidate.status,
    event_kind: input.event_kind,
    interaction_id: input.interaction_id ?? null,
    reviewed_at: input.candidate.reviewed_at,
    review_reason: input.candidate.review_reason,
  });
}
```

- [ ] **Step 4: Thread interaction ids through service inputs**

Update inputs in service files:

```ts
export interface AdvanceMemoryCandidateStatusInput {
  id: string;
  next_status: MemoryCandidateAdvanceTargetStatus;
  reviewed_at?: Date | string | null;
  review_reason?: string | null;
  interaction_id?: string | null;
}

export interface RejectMemoryCandidateEntryInput {
  id: string;
  reviewed_at?: Date | string | null;
  review_reason: string;
  interaction_id?: string | null;
}

export interface PromoteMemoryCandidateEntryInput {
  id: string;
  reviewed_at?: Date | string | null;
  review_reason?: string | null;
  interaction_id?: string | null;
}
```

- [ ] **Step 5: Wrap service transitions in transactions**

In `advanceMemoryCandidateStatus`, wrap the current get/validate/update flow:

```ts
return engine.transaction(async (txBase) => {
  const tx = txBase as BrainEngine;
  const entry = await tx.getMemoryCandidateEntry(input.id);
  // keep existing validation
  const advanced = await tx.updateMemoryCandidateEntryStatus(entry.id, patch);
  // keep existing null guard
  await recordCandidateStatusEvent(tx, {
    candidate: advanced,
    from_status: entry.status,
    event_kind: 'advanced',
    interaction_id: input.interaction_id ?? null,
  });
  return advanced;
});
```

Apply the same pattern to reject, promote, and supersede. Supersession records the event after fetching the updated superseded candidate.

- [ ] **Step 6: Forward interaction ids in contradiction paths**

In `src/core/services/memory-inbox-contradiction-service.ts`, update rejected and superseded branches:

```ts
const rejectedCandidate = await rejectMemoryCandidateEntry(tx, {
  id: candidate.id,
  reviewed_at: reviewedAt,
  review_reason: reviewReason ?? 'Rejected during contradiction review.',
  interaction_id: input.interaction_id ?? null,
});
```

The superseded branch already passes interaction id into `supersedeMemoryCandidateEntry`; keep that and assert the new status event in tests.

- [ ] **Step 7: Use the creation helper in product creation paths**

In `src/core/services/map-derived-candidate-service.ts`, replace `engine.createMemoryCandidateEntry(...)` with `createMemoryCandidateEntryWithStatusEvent(engine, ...)`.

In `src/core/services/dream-cycle-maintenance-service.ts`, replace `tx.createMemoryCandidateEntry(toCandidateInput(...))` with:

```ts
createMemoryCandidateEntryWithStatusEvent(tx, toCandidateInput(scopeId, draft, now))
```

No interaction id is passed for these background/product paths; their created events are unlinked by design.

- [ ] **Step 8: Verify service tests pass**

```bash
bun test test/memory-inbox-service.test.ts test/memory-inbox-contradiction-service.test.ts test/map-derived-candidate-service.test.ts test/dream-cycle-maintenance-service.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/core/services/memory-inbox-service.ts src/core/services/memory-inbox-promotion-service.ts src/core/services/memory-inbox-supersession-service.ts src/core/services/memory-inbox-contradiction-service.ts src/core/services/map-derived-candidate-service.ts src/core/services/dream-cycle-maintenance-service.ts test/memory-inbox-service.test.ts test/memory-inbox-contradiction-service.test.ts test/map-derived-candidate-service.test.ts test/dream-cycle-maintenance-service.test.ts
git diff --cached --check
git commit -m "feat(services): record candidate status events"
```

---

## Task 4: Operations expose interaction ids and list status events

**Files:**
- Modify: `src/core/operations-memory-inbox.ts`
- Test: `test/memory-inbox-operations.test.ts`

- [ ] **Step 1: Write failing operation tests**

In `test/memory-inbox-operations.test.ts`, update the operation-name assertion to include `list_memory_candidate_status_events` immediately after `list_memory_candidate_entries`.

Add CLI-hint assertions:

```ts
const listStatusEvents = operations.find((operation) => operation.name === 'list_memory_candidate_status_events');
expect(listStatusEvents?.cliHints?.name).toBe('list-memory-candidate-status-events');
expect(listStatusEvents?.params.interaction_id?.type).toBe('string');
expect(create?.params.interaction_id?.type).toBe('string');
expect(advance?.params.interaction_id?.type).toBe('string');
expect(reject?.params.interaction_id?.type).toBe('string');
expect(promote?.params.interaction_id?.type).toBe('string');
expect(supersede?.params.interaction_id?.type).toBe('string');
expect(contradiction?.params.interaction_id?.type).toBe('string');
```

Add an end-to-end operation test:

```ts
const listStatusEvents = operations.find((operation) => operation.name === 'list_memory_candidate_status_events');
if (!listStatusEvents) throw new Error('status event list operation is missing');

await create.handler(ctx, {
  id: 'candidate-op-status-events',
  candidate_type: 'fact',
  proposed_content: 'Operation-created candidate should get a status event.',
  source_ref: 'User, direct message, 2026-04-25 9:30 AM KST',
  interaction_id: 'trace-op-status-events',
});

const events = await listStatusEvents.handler(ctx, {
  candidate_id: 'candidate-op-status-events',
  interaction_id: 'trace-op-status-events',
  limit: 10,
});
expect((events as any[]).map((event) => event.event_kind)).toEqual(['created']);
```

- [ ] **Step 2: Run operation tests and confirm failure**

```bash
bun test test/memory-inbox-operations.test.ts
```

Expected: FAIL because the new operation and params are absent.

- [ ] **Step 3: Add status-event constants and optional string helper**

In `src/core/operations-memory-inbox.ts`, add:

```ts
const MEMORY_CANDIDATE_STATUS_EVENT_KIND_VALUES = ['created', 'advanced', 'promoted', 'rejected', 'superseded'] as const;

function normalizeOptionalNonEmptyString(
  deps: { OperationError: OperationErrorCtor },
  field: string,
  value: unknown,
): string | null {
  if (value == null) return null;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw invalidParams(deps, `${field} must be a non-empty string`);
  }
  return value.trim();
}
```

- [ ] **Step 4: Use creation helper in create operation**

Import `createMemoryCandidateEntryWithStatusEvent` and replace the raw create call:

```ts
return createMemoryCandidateEntryWithStatusEvent(ctx.engine, {
  id,
  scope_id: scopeId,
  // existing fields unchanged
  interaction_id: normalizeOptionalNonEmptyString(deps, 'interaction_id', p.interaction_id),
});
```

Add `interaction_id` to the create params.

- [ ] **Step 5: Forward interaction ids in lifecycle operations**

For advance, reject, promote, supersede, and contradiction operations, add:

```ts
interaction_id: { type: 'string', description: 'Optional retrieval trace id for lifecycle event attribution' },
```

Forward with:

```ts
interaction_id: normalizeOptionalNonEmptyString(deps, 'interaction_id', p.interaction_id),
```

- [ ] **Step 6: Add read-only list operation**

Add this operation near `list_memory_candidate_entries`:

```ts
const list_memory_candidate_status_events: Operation = {
  name: 'list_memory_candidate_status_events',
  description: 'List append-only memory-candidate lifecycle status events.',
  params: {
    candidate_id: { type: 'string', description: 'Optional candidate id filter' },
    scope_id: { type: 'string', description: `Optional candidate storage scope id filter (default omitted)` },
    event_kind: {
      type: 'string',
      description: 'Optional status-event kind filter',
      enum: [...MEMORY_CANDIDATE_STATUS_EVENT_KIND_VALUES],
    },
    to_status: {
      type: 'string',
      description: 'Optional resulting candidate status filter',
      enum: [...MEMORY_CANDIDATE_STATUS_VALUES],
    },
    interaction_id: { type: 'string', description: 'Optional retrieval trace id filter' },
    limit: { type: 'number', description: `Max results (default 20, cap ${MAX_MEMORY_CANDIDATE_LIMIT})` },
    offset: { type: 'number', description: 'Offset for pagination (default 0)' },
  },
  handler: async (ctx, p) => ctx.engine.listMemoryCandidateStatusEvents({
    candidate_id: normalizeOptionalNonEmptyString(deps, 'candidate_id', p.candidate_id) ?? undefined,
    scope_id: normalizeOptionalNonEmptyString(deps, 'scope_id', p.scope_id) ?? undefined,
    event_kind: optionalEnumValue(deps, 'event_kind', p.event_kind, MEMORY_CANDIDATE_STATUS_EVENT_KIND_VALUES),
    to_status: optionalEnumValue(deps, 'to_status', p.to_status, MEMORY_CANDIDATE_STATUS_VALUES),
    interaction_id: normalizeOptionalNonEmptyString(deps, 'interaction_id', p.interaction_id) ?? undefined,
    limit: normalizeLimit(deps, p.limit),
    offset: normalizeOffset(deps, p.offset),
  }),
  cliHints: { name: 'list-memory-candidate-status-events', aliases: { n: 'limit' } },
};
```

Add it to the returned operation list immediately after `list_memory_candidate_entries`.

- [ ] **Step 7: Verify operation tests pass**

```bash
bun test test/memory-inbox-operations.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/core/operations-memory-inbox.ts test/memory-inbox-operations.test.ts
git diff --cached --check
git commit -m "feat(operations): expose candidate status events"
```

---

## Task 5: Audit reports precise candidate status events

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/services/brain-loop-audit-service.ts`
- Test: `test/brain-loop-audit-service.test.ts`
- Test: `test/brain-loop-audit-engine.test.ts`

- [ ] **Step 1: Write failing audit tests**

In `test/brain-loop-audit-service.test.ts`, add:

```ts
test('auditBrainLoop reports precise candidate status-event counts by interaction id', async () => {
  const harness = await createSqliteEngine();
  const traceId = 'trace-candidate-status-events-audit';
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const until = new Date(Date.now() + 60 * 60 * 1000);

  try {
    await harness.engine.putRetrievalTrace({
      id: traceId,
      task_id: null,
      scope: 'work',
      route: [],
      source_refs: [],
      verification: [],
      selected_intent: 'precision_lookup',
      outcome: 'candidate status-event audit trace',
    });

    await harness.engine.createMemoryCandidateStatusEvent({
      id: 'audit-status-event-created',
      candidate_id: 'audit-status-event-candidate',
      scope_id: 'workspace:default',
      from_status: null,
      to_status: 'captured',
      event_kind: 'created',
      interaction_id: traceId,
      created_at: new Date(),
    });
    await harness.engine.createMemoryCandidateStatusEvent({
      id: 'audit-status-event-advanced',
      candidate_id: 'audit-status-event-candidate',
      scope_id: 'workspace:default',
      from_status: 'captured',
      to_status: 'candidate',
      event_kind: 'advanced',
      interaction_id: traceId,
      created_at: new Date(),
    });

    const report = await auditBrainLoop(harness.engine, { since, until, scope: 'work' });

    expect(report.candidate_status_events.created_count).toBe(1);
    expect(report.candidate_status_events.advanced_count).toBe(1);
    expect(report.candidate_status_events.linked_event_count).toBe(2);
    expect(report.candidate_status_events.unlinked_event_count).toBe(0);
    expect(report.candidate_status_events.traces_with_candidate_events).toBe(1);
    expect(report.approximate.candidate_creation_same_window).toBe(0);
  } finally {
    await harness.cleanup();
  }
});
```

Add a compatibility-counter test:

```ts
test('auditBrainLoop keeps approximate counters compatible for raw candidate rows', async () => {
  const harness = await createSqliteEngine();
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const until = new Date(Date.now() + 60 * 60 * 1000);

  try {
    await createCandidate(harness.engine, 'candidate-raw-compatibility', {
      status: 'staged_for_review',
    });
    await harness.engine.updateMemoryCandidateEntryStatus('candidate-raw-compatibility', {
      status: 'rejected',
      reviewed_at: new Date(),
      review_reason: 'Raw compatibility count.',
    });

    const report = await auditBrainLoop(harness.engine, { since, until });

    expect(report.approximate.candidate_creation_same_window).toBe(1);
    expect(report.approximate.candidate_rejection_same_window).toBe(1);
    expect(report.candidate_status_events.created_count).toBe(0);
  } finally {
    await harness.cleanup();
  }
});
```

In `test/brain-loop-audit-engine.test.ts`, extend the existing parity test to assert `candidate_status_events` exists and has zero counts when only legacy linked-write rows are seeded.

- [ ] **Step 2: Run audit tests and confirm failure**

```bash
bun test test/brain-loop-audit-service.test.ts test/brain-loop-audit-engine.test.ts
```

Expected: FAIL because `AuditBrainLoopReport` has no `candidate_status_events` section.

- [ ] **Step 3: Add audit report type**

In `src/core/types.ts`, add:

```ts
export interface AuditCandidateStatusEventCounts {
  created_count: number;
  advanced_count: number;
  promoted_count: number;
  rejected_count: number;
  superseded_count: number;
  linked_event_count: number;
  unlinked_event_count: number;
  traces_with_candidate_events: number;
}
```

Add to `AuditBrainLoopReport`:

```ts
candidate_status_events: AuditCandidateStatusEventCounts;
```

- [ ] **Step 4: Count candidate status events in audit service**

In `src/core/services/brain-loop-audit-service.ts`, add:

```ts
async function countCandidateStatusEvents(
  engine: BrainEngine,
  traceIds: string[],
  since: Date,
  until: Date,
  filters: { task_id?: string; scope?: ScopeGateScope },
): Promise<AuditCandidateStatusEventCounts> {
  const events = filters.task_id !== undefined || filters.scope !== undefined
    ? await listCandidateStatusEventsByTraceIds(engine, traceIds)
    : await listAllCandidateStatusEventsInWindow(engine, since, until);

  const inWindow = events.filter((event) => event.created_at >= since && event.created_at <= until);
  const linkedTraceIds = new Set<string>();
  for (const event of inWindow) {
    if (event.interaction_id) linkedTraceIds.add(event.interaction_id);
  }

  return {
    created_count: inWindow.filter((event) => event.event_kind === 'created').length,
    advanced_count: inWindow.filter((event) => event.event_kind === 'advanced').length,
    promoted_count: inWindow.filter((event) => event.event_kind === 'promoted').length,
    rejected_count: inWindow.filter((event) => event.event_kind === 'rejected').length,
    superseded_count: inWindow.filter((event) => event.event_kind === 'superseded').length,
    linked_event_count: inWindow.filter((event) => event.interaction_id != null).length,
    unlinked_event_count: inWindow.filter((event) => event.interaction_id == null).length,
    traces_with_candidate_events: linkedTraceIds.size,
  };
}
```

Use existing `chunkArray` for `listCandidateStatusEventsByTraceIds`.

- [ ] **Step 5: Preserve compatibility counters**

Change `approximateUnlinkedCandidateEvents` to accept `statusEvents` or call a helper that excludes matching event candidate ids. For unfiltered audits:

```ts
const createdEventCandidateIds = new Set(
  statusEvents
    .filter((event) => event.event_kind === 'created')
    .map((event) => event.candidate_id),
);
const rejectedEventCandidateIds = new Set(
  statusEvents
    .filter((event) => event.event_kind === 'rejected')
    .map((event) => event.candidate_id),
);
```

Count raw fallback candidates with existing `listMemoryCandidateEntries`, then subtract candidates whose id is in the matching event set:

```ts
const candidateCreationCount = await countMemoryCandidateEntriesExcluding(engine, {
  created_since: since,
  created_until: until,
}, createdEventCandidateIds);
```

Return:

```ts
{
  candidate_creation_same_window: candidateStatusEvents.created_count + candidateCreationCount,
  candidate_rejection_same_window: candidateStatusEvents.rejected_count + candidateRejectionCount,
  note: 'compatibility counters; candidate_status_events are precise for service-recorded lifecycle transitions',
}
```

Keep filtered audits suppressed as they are today.

- [ ] **Step 6: Wire report construction**

In `auditBrainLoop`, compute:

```ts
const candidateStatusEvents = await countCandidateStatusEvents(engine, traceIds, since, until, {
  task_id: input.task_id,
  scope: input.scope,
});
const approximate = await approximateUnlinkedCandidateEvents(engine, since, until, {
  task_id: input.task_id,
  scope: input.scope,
}, candidateStatusEvents);
```

Return:

```ts
candidate_status_events: candidateStatusEvents,
```

- [ ] **Step 7: Verify audit tests pass**

```bash
bun test test/brain-loop-audit-service.test.ts test/brain-loop-audit-engine.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/core/types.ts src/core/services/brain-loop-audit-service.ts test/brain-loop-audit-service.test.ts test/brain-loop-audit-engine.test.ts
git diff --cached --check
git commit -m "feat(audit): report candidate status events"
```

---

## Task 6: Add S21 scenario and verification docs

**Files:**
- Create: `test/scenarios/s21-candidate-status-events-audit.test.ts`
- Modify: `test/scenarios/README.md`
- Modify: `docs/MBRAIN_VERIFY.md`

- [ ] **Step 1: Write S21 scenario**

Create `test/scenarios/s21-candidate-status-events-audit.test.ts`:

```ts
/**
 * Scenario S21 — candidate status events join lifecycle writes to interaction ids.
 *
 * Falsifies L6/G1: an interaction-linked candidate lifecycle must be auditable
 * through retrieval_traces.id without mutating memory_candidate_entries.
 */

import { describe, expect, test } from 'bun:test';
import { allocateSqliteBrain } from './helpers.ts';
import { auditBrainLoop } from '../../src/core/services/brain-loop-audit-service.ts';
import {
  advanceMemoryCandidateStatus,
  createMemoryCandidateEntryWithStatusEvent,
  rejectMemoryCandidateEntry,
} from '../../src/core/services/memory-inbox-service.ts';

describe('S21 — candidate status events audit', () => {
  test('interaction-linked candidate lifecycle is counted through status events', async () => {
    const handle = await allocateSqliteBrain('s21-candidate-status-events');
    const traceId = 'trace-s21-candidate-status-events';
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const until = new Date(Date.now() + 60 * 60 * 1000);

    try {
      await handle.engine.createTaskThread({
        id: 'task-s21-candidate-status-events',
        scope: 'work',
        title: 'S21 candidate status events',
        status: 'active',
      });
      await handle.engine.putRetrievalTrace({
        id: traceId,
        task_id: 'task-s21-candidate-status-events',
        scope: 'work',
        route: ['memory_inbox'],
        source_refs: ['scenario:s21'],
        verification: ['intent:precision_lookup'],
        selected_intent: 'precision_lookup',
        scope_gate_policy: 'allow',
        outcome: 'scenario status-event lifecycle',
      });

      await createMemoryCandidateEntryWithStatusEvent(handle.engine, {
        id: 'candidate-s21-status-events',
        scope_id: 'workspace:default',
        candidate_type: 'fact',
        proposed_content: 'S21 candidate status events are auditable.',
        source_refs: ['Scenario S21'],
        generated_by: 'manual',
        extraction_kind: 'manual',
        confidence_score: 0.9,
        importance_score: 0.8,
        recurrence_score: 0,
        sensitivity: 'work',
        status: 'captured',
        target_object_type: 'curated_note',
        target_object_id: 'concepts/s21',
        interaction_id: traceId,
      });
      await advanceMemoryCandidateStatus(handle.engine, {
        id: 'candidate-s21-status-events',
        next_status: 'candidate',
        interaction_id: traceId,
      });
      await advanceMemoryCandidateStatus(handle.engine, {
        id: 'candidate-s21-status-events',
        next_status: 'staged_for_review',
        interaction_id: traceId,
      });
      await rejectMemoryCandidateEntry(handle.engine, {
        id: 'candidate-s21-status-events',
        review_reason: 'Scenario closes with rejection.',
        interaction_id: traceId,
      });

      const report = await auditBrainLoop(handle.engine, {
        since,
        until,
        task_id: 'task-s21-candidate-status-events',
      });

      expect(report.candidate_status_events.created_count).toBe(1);
      expect(report.candidate_status_events.advanced_count).toBe(2);
      expect(report.candidate_status_events.rejected_count).toBe(1);
      expect(report.candidate_status_events.linked_event_count).toBe(4);
      expect(report.candidate_status_events.traces_with_candidate_events).toBe(1);
      expect(report.approximate.candidate_creation_same_window).toBe(0);
      expect(report.approximate.candidate_rejection_same_window).toBe(0);
    } finally {
      await handle.teardown();
    }
  });
});
```

- [ ] **Step 2: Run S21 and confirm pass**

```bash
bun test test/scenarios/s21-candidate-status-events-audit.test.ts
```

Expected: PASS.

- [ ] **Step 3: Update scenario README**

Add a row to `test/scenarios/README.md`:

```md
| S21 | `s21-candidate-status-events-audit.test.ts` | L6, G1 | green |
```

Use the same status wording as the existing rows.

- [ ] **Step 4: Update verification docs**

In `docs/MBRAIN_VERIFY.md`, add Sprint 5 to the relevant scenario/audit verification section:

```md
- Sprint 5 candidate status events: `bun test test/scenarios/s21-candidate-status-events-audit.test.ts`
```

- [ ] **Step 5: Run scenario suite**

```bash
bun run test:scenarios
```

Expected: `62 pass`, `2 skip`, `0 fail` or higher if additional tests were added.

- [ ] **Step 6: Commit**

```bash
git add test/scenarios/s21-candidate-status-events-audit.test.ts test/scenarios/README.md docs/MBRAIN_VERIFY.md
git diff --cached --check
git commit -m "test(scenarios): add candidate status event audit scenario"
```

---

## Final Verification

After all tasks:

- [ ] **Step 1: Run red-flag scan**

```bash
rg -n "TB[D]|TO[D]O|implement late[r]|fill i[n]|placeholde[r]" docs/superpowers/specs docs/superpowers/plans test/scenarios src/core
```

Expected: no matches introduced by Sprint 5.

- [ ] **Step 2: Run typecheck**

```bash
bunx tsc --noEmit --pretty false
```

Expected: exit 0 with no output.

- [ ] **Step 3: Run focused tests**

```bash
bun test test/memory-inbox-schema.test.ts test/memory-inbox-engine.test.ts test/memory-inbox-service.test.ts test/memory-inbox-contradiction-service.test.ts test/memory-inbox-operations.test.ts test/brain-loop-audit-service.test.ts test/brain-loop-audit-engine.test.ts
```

Expected: PASS. Postgres tests skip when `DATABASE_URL` is unset.

- [ ] **Step 4: Run scenario suite**

```bash
bun run test:scenarios
```

Expected: PASS with S21 included.

- [ ] **Step 5: Run full suite**

```bash
env HOME="$(mktemp -d /tmp/mbrain-sprint5-test-home.XXXXXX)" bun test --timeout 60000
```

Expected: PASS.

- [ ] **Step 6: Run build**

```bash
bun run build
```

Expected: exit 0.

- [ ] **Step 7: Run whitespace check**

```bash
git diff --check
```

Expected: exit 0.

---

## Self-Review

- Spec coverage: migration/backfill, engine API, service-level recording, operations, audit, S21, and docs are covered by tasks.
- Red-flag scan target: run the command in Final Verification Step 1 after this plan is created.
- Scope control: no dashboard, scheduler, retention policy, active-only compliance, AST-aware verification, or `interaction_id` column on `memory_candidate_entries`.
