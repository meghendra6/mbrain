# MBrain Sprint 5 Candidate Status Events Design

## Goal

Make memory-candidate lifecycle transitions precisely auditable by adding an
append-only `memory_candidate_status_events` log. This removes the current
same-window approximation for candidate creation and rejection in
`audit_brain_loop` and gives later dashboard, cron, and compliance work a
durable event stream.

## Context

The current redesign completion boundary intentionally deferred this table.
`memory_candidate_entries` stores mutable candidate state, while handoff,
supersession, and contradiction rows already carry `interaction_id`. Because a
candidate can be captured in one interaction, advanced in another, promoted in
a third, and rejected or superseded later, a single `interaction_id` column on
`memory_candidate_entries` would be incorrect.

Current audit behavior is therefore approximate:

- candidate creation is counted by `memory_candidate_entries.created_at`
- candidate rejection is counted by `memory_candidate_entries.reviewed_at`
- filtered audits suppress candidate counts because there is no interaction
  link to join

Sprint 5 fixes the data model, not the presentation layer. It does not add a
dashboard, scheduler, retention policy, active-only compliance, or AST-aware
code verification.

## Options Considered

### Option A: Add `interaction_id` to `memory_candidate_entries`

Rejected. A candidate has many lifecycle transitions. A single mutable
`interaction_id` would either point to the first transition, the latest
transition, or require overwriting history. All three choices lose information.

### Option B: Infer lifecycle events from current candidate state

Rejected. This is the current approximate approach. It can count created and
rejected candidates in a time window, but it cannot say which interaction caused
which transition and cannot support task- or scope-filtered audit precisely.

### Option C: Append-only status-event table

Selected. Each lifecycle transition gets its own immutable row. Rows can attach
to a retrieval trace by `interaction_id` when the caller has one, while older or
manual transitions can remain unlinked. Audit can answer exact questions by
joining `retrieval_traces.id` to `memory_candidate_status_events.interaction_id`
without mutating candidate truth.

## Data Model

Add migration 25:

```sql
CREATE TABLE IF NOT EXISTS memory_candidate_status_events (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL CHECK (
    to_status IN (
      'captured',
      'candidate',
      'staged_for_review',
      'promoted',
      'rejected',
      'superseded'
    )
  ),
  event_kind TEXT NOT NULL CHECK (
    event_kind IN (
      'created',
      'advanced',
      'promoted',
      'rejected',
      'superseded'
    )
  ),
  interaction_id TEXT,
  reviewed_at TEXT,
  review_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

Indexes:

- `idx_memory_candidate_status_events_candidate_created` on
  `(candidate_id, created_at DESC, id DESC)`
- `idx_memory_candidate_status_events_interaction` on `(interaction_id)` where
  `interaction_id IS NOT NULL`
- `idx_memory_candidate_status_events_scope_created` on
  `(scope_id, created_at DESC, id DESC)`
- `idx_memory_candidate_status_events_kind_created` on
  `(event_kind, created_at DESC, id DESC)`

Backfill policy:

- Existing rows receive one `created` event with `from_status = NULL`,
  `to_status = current status`, `interaction_id = NULL`, and
  `created_at = memory_candidate_entries.created_at`.
- Backfilled event ids are deterministic:
  `candidate-status-created:{candidate_id}`.
- Backfill uses conflict-safe inserts (`ON CONFLICT DO NOTHING` for
  Postgres/PGLite; `INSERT OR IGNORE` for SQLite) so migration replay cannot
  duplicate rows.
- The backfill does not invent historical advance, promote, reject, or
  supersede transitions because that would create false precision.

Foreign-key policy:

- Do not add an FK to `memory_candidate_entries(id)`. Status events are
  append-only evidence and must not block existing low-level candidate deletion
  paths or disappear if a test/cleanup path deletes a candidate.
- Service-level writers validate that the candidate exists before recording an
  event. The event stores `candidate_id` and `scope_id` as denormalized
  lifecycle evidence.
- Do not add an FK to `retrieval_traces(id)`. `interaction_id` remains a loose
  cross-table identity string, matching Sprint 1.0 governance event rows.

Migration implementation:

- Add migration 25 to `src/core/migrate.ts` for Postgres/PGLite.
- Add SQLite migration case 25 in `src/core/sqlite-engine.ts`; SQLite does not
  execute the shared SQL migration list.
- Schema and replay tests must prove fresh init and v15-to-latest replay create
  the same event table, indexes, and deterministic backfill rows.

## Engine Contract

Add types:

- `MemoryCandidateStatusEventKind`
- `MemoryCandidateStatusEvent`
- `MemoryCandidateStatusEventInput`
- `MemoryCandidateStatusEventFilters`

Add engine methods:

```ts
createMemoryCandidateStatusEvent(input: MemoryCandidateStatusEventInput): Promise<MemoryCandidateStatusEvent>;
listMemoryCandidateStatusEvents(filters?: MemoryCandidateStatusEventFilters): Promise<MemoryCandidateStatusEvent[]>;
listMemoryCandidateStatusEventsByInteractionIds(interactionIds: string[]): Promise<MemoryCandidateStatusEvent[]>;
```

Filters support:

- `candidate_id`
- `scope_id`
- `event_kind`
- `to_status`
- `interaction_id`
- `created_since`
- `created_until`
- `limit`
- `offset`

The event APIs are append-only. There is no update or delete method in Sprint 5.

## Service Flow

Event recording belongs in service-level lifecycle functions, not in raw engine
state-update methods. Reason: services know the semantic transition and the
optional interaction provenance; raw engine methods are still used by older
tests, migrations, and low-level parity checks.

Inputs become additive:

- New service helper `createMemoryCandidateEntryWithStatusEvent` accepts
  `MemoryCandidateEntryInput & { interaction_id?: string | null }`
- `create_memory_candidate_entry` operation accepts `interaction_id?: string`
- Public lifecycle operations `advance_memory_candidate_status`,
  `reject_memory_candidate_entry`, `promote_memory_candidate_entry`,
  `supersede_memory_candidate_entry`, and
  `resolve_memory_candidate_contradiction` accept and forward
  `interaction_id?: string`
- `advanceMemoryCandidateStatus` accepts `interaction_id?: string`
- `rejectMemoryCandidateEntry` accepts `interaction_id?: string`
- `promoteMemoryCandidateEntry` accepts `interaction_id?: string`
- `supersedeMemoryCandidateEntry` already accepts `interaction_id?: string`
- `resolveMemoryCandidateContradiction` already accepts `interaction_id?: string`

Creation coverage:

- The public `create_memory_candidate_entry` operation calls
  `createMemoryCandidateEntryWithStatusEvent`, not the raw engine create method.
- All public lifecycle operations forward `interaction_id` into the service call
  so MCP/CLI product paths can produce trace-linked status events.
- `captureMapDerivedCandidates` and `runDreamCycleMaintenance` also use the
  helper so product-created candidates receive unlinked `created` events.
- Raw `engine.createMemoryCandidateEntry` remains available for low-level tests,
  migration fixtures, and parity checks, but raw creates are not audited
  lifecycle transitions unless paired with an explicit status event.

Recording rules:

- Candidate creation writes `created` with `from_status = NULL` and
  `to_status = initial status`.
- `captured -> candidate` writes `advanced`.
- `candidate -> staged_for_review` writes `advanced`.
- `staged_for_review -> promoted` writes `promoted`.
- `staged_for_review -> rejected` writes `rejected`.
- `staged_for_review|promoted -> superseded` writes `superseded`.
- Contradiction rejected flow forwards its `interaction_id` into
  `rejectMemoryCandidateEntry` so the rejection event and contradiction row share
  the same trace identity.

Transaction rules:

- A status event is written in the same service transaction as the candidate
  state change when the service already has a transaction boundary.
- For simple one-row transitions, the service wraps the engine update and event
  insert in `engine.transaction`.
- If the candidate state update fails or races, no event is written.
- If event insert fails, the candidate state change rolls back.

Direct raw engine updates remain possible but are not considered audited
lifecycle transitions unless a service records an event. This preserves the
existing engine test surface while making product paths precise.

## Audit Behavior

`audit_brain_loop` gains a precise candidate-event section:

```ts
candidate_status_events: {
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

Audit rules:

- Unfiltered audits count all status-event rows in the window.
- Filtered audits by `task_id` join retrieval traces in the window to
  status-event `interaction_id`.
- Filtered audits by `scope` use `retrieval_traces.scope`
  (`work|personal|mixed|unknown`) and count only status events linked to those
  filtered trace ids. They do not compare audit `scope` to candidate `scope_id`,
  because `scope_id` is a storage identity such as `workspace:default`, not a
  `ScopeGateScope` value.
- The read operation can still filter events by `scope_id`; that is separate
  from `audit_brain_loop`'s trace-scope filter.
- `approximate.note` changes to state that status-event counts are precise for
  service-recorded lifecycle transitions, while legacy/backfilled rows without
  interaction remain unlinked.

The old `candidate_creation_same_window` and `candidate_rejection_same_window`
fields stay for backward-compatible report shape in Sprint 5, but their values
remain compatibility counters:

- unfiltered audits count matching status events, plus mutable candidate-state
  fallback rows that lack the matching status event, to preserve legacy/raw
  engine behavior without double-counting service-recorded transitions.
- filtered audits continue to suppress these two compatibility counters because
  unlinked legacy/raw candidate rows cannot be attributed to a task or trace
  scope.

## Operations And CLI

Add one read operation:

- `list_memory_candidate_status_events`
- CLI hint: `list-memory-candidate-status-events`
- Params: `candidate_id`, `scope_id`, `event_kind`, `to_status`,
  `interaction_id`, `limit`, `offset`

Do not add create/update CLI operations for events. Events are lifecycle
evidence, not user-authored records.

## Tests

Required tests:

- Migration/schema test: SQLite and PGLite create the table and indexes; Postgres
  covered when `DATABASE_URL` is present.
- Engine test: events can be created and listed by candidate, scope, kind, and
  interaction id.
- Service tests: create, advance, promote, reject, supersede, and contradiction
  flows write correct events only when the transition succeeds.
- Audit tests: `auditBrainLoop` reports precise status-event counts and no
  longer relies on same-window candidate-state inference for service-recorded
  events.
- Scenario test S21: an interaction-linked candidate lifecycle can be audited by
  joining trace id to status events.

## Rollback

Forward-only. If Sprint 5 code must be reverted, leave
`memory_candidate_status_events` in place and stop writing or reading it. The
table is append-only and does not change canonical candidate state.

## Non-Goals

- No dashboard or scheduled audit runner.
- No pruning, TTL, retention, or archival policy.
- No active-only task compliance.
- No AST-aware code verification.
- No attempt to reconstruct full historical transitions from old mutable rows.

## Self-Review

- Red-flag scan: clean at write time.
- Scope check: one focused foundation PR; dashboard, cron, pruning, and
  compliance policy are excluded.
- Ambiguity check: service paths record events; raw engine status updates do not
  become audited transitions unless explicitly paired with an event.
- Revertability: additive migration and additive engine/service APIs only.
