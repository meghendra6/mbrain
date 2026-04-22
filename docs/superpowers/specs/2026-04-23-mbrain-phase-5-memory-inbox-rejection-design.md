# Phase 5 Memory Inbox Rejection Design

## Goal

Add the first explicit terminal governance outcome to the Phase 5 inbox by
supporting bounded rejection of staged candidates, without opening promotion,
supersession, contradiction resolution, or target-domain writes.

## Scope

- widen the canonical `memory_candidate_entries.status` contract just enough to
  include `rejected`
- support one deterministic rejection path:
  `staged_for_review -> rejected`
- preserve review metadata and auditability on rejection
- expose rejection through a dedicated shared operation instead of widening the
  generic advance surface
- publish one additional Phase 5 benchmark slice and acceptance wiring for the
  rejection path

## Non-Goals

- promotion into canonical target domains
- supersession
- contradictory-candidate linking
- batch review or reviewer queues
- automatic duplicate collapse

## Design Choice

Three approaches were considered:

1. Widen `advance_memory_candidate_status` to accept `rejected`.
2. Add a dedicated `reject_memory_candidate_entry` surface.
3. Add all terminal outcomes (`rejected`, `promoted`, `superseded`) at once.

The chosen design is **2**.

Reasons:

- it keeps the published API aligned with the bounded implementation
- it avoids reintroducing the misleading “generic FSM metadata” problem that PR
  `#33` just corrected
- it is the smallest reviewable step that still produces a real governance
  outcome

## Status Rules

After this slice, the published inbox lifecycle is:

```text
captured -> candidate -> staged_for_review -> rejected
```

Rules:

- creation still defaults to `captured`
- `advance_memory_candidate_status` remains limited to
  `captured -> candidate -> staged_for_review`
- rejection is only valid from `staged_for_review`
- rejection must preserve `review_reason`
- `reviewed_at` auto-stamps only when omitted; explicit `null` remains valid
- `promoted` and `superseded` stay hidden for later PRs

## Schema and Migration

This slice requires a new migration because Phase 5 foundations already shipped
DB-level `CHECK` constraints.

`migration 16` should rebuild `memory_candidate_entries` with the same shape as
`migration 15`, except:

- `status` allows `rejected`

The migration should use the same rebuild pattern across SQLite, PGLite, and
Postgres:

1. create a replacement table with the widened `status` check
2. copy all rows
3. drop the old table
4. rename the replacement table
5. recreate the existing indexes

The SQLite bootstrap path in `initSchema()` must match the same invariant.

## Service Boundary

This slice adds a dedicated service function, not a generic state-machine
expansion helper.

The service contract should:

- load the candidate by id
- reject missing ids with `memory_candidate_not_found`
- reject candidates not currently in `staged_for_review` with
  `invalid_status_transition`
- write `status='rejected'`
- preserve `review_reason`
- preserve explicit `reviewed_at: null`

## Operation Surface

This slice should expose one new operation:

- `reject-memory-candidate`

Expected params:

- `id`
- `review_reason`
- `reviewed_at` optional

Operation rules:

- dry-run support stays consistent with the rest of the contract-first surface
- list filters may now include `rejected`
- create still does **not** accept `rejected` as an initial status
- CLI/MCP adapters stay thin over the service

## Acceptance

This slice is complete when:

- schema and engine tests prove `rejected` is DB-valid while `promoted` remains
  DB-invalid
- service tests prove only `staged_for_review -> rejected` succeeds
- operation tests prove `reject-memory-candidate` is registered and bounded
- benchmark reports one new slice:
  `memory_inbox_rejection`
- `phase5-acceptance` passes with both:
  - `memory_inbox_foundations`
  - `memory_inbox_rejection`
