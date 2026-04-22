# Phase 5 Memory Inbox Rejection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first explicit terminal governance outcome to the Phase 5 memory inbox by supporting deterministic rejection of staged candidates.

**Architecture:** Keep the Phase 5 foundation boundary intact. Widen the canonical status model only enough to include `rejected`, add one dedicated rejection service and operation, and extend Phase 5 acceptance with a single additional benchmark slice.

**Tech Stack:** TypeScript, Bun, shared operations contract, SQLite/PGLite/Postgres engine implementations, Phase 5 benchmark and acceptance wiring.

---

## Review-Driven Constraints

- [ ] Keep this PR stacked on `phase5-memory-inbox-foundations`, not on PR `#32`.
- [ ] Keep scope bounded to `rejected` only. Do not mix in `promoted`, `superseded`, contradiction handling, or target-domain writes.
- [ ] Do not re-widen `create_memory_candidate_entry` to future-only statuses.
- [ ] Do not overload `advance_memory_candidate_status` with terminal outcomes. Publish a dedicated rejection surface instead.
- [ ] Preserve the Phase 5 hardening added in PR `#33`: DB `CHECK` constraints, enum-safe operation coercion, dedicated inbox default scope constant, and capped list reads.

## File Map

- Modify: `src/core/types.ts`
- Modify: `src/core/migrate.ts`
- Modify: `src/core/sqlite-engine.ts`
- Modify: `src/core/services/memory-inbox-service.ts`
- Modify: `src/core/operations-memory-inbox.ts`
- Modify: `test/memory-inbox-schema.test.ts`
- Modify: `test/memory-inbox-engine.test.ts`
- Modify: `test/memory-inbox-service.test.ts`
- Modify: `test/memory-inbox-operations.test.ts`
- Create: `scripts/bench/phase5-memory-inbox-rejection.ts`
- Create: `test/phase5-memory-inbox-rejection.test.ts`
- Modify: `scripts/bench/phase5-acceptance-pack.ts`
- Modify: `test/phase5-acceptance-pack.test.ts`
- Modify: `package.json`
- Modify: `docs/MBRAIN_VERIFY.md`

## Task 1: Widen The Canonical Status Contract

- [ ] Add failing schema tests proving `rejected` becomes DB-valid while `promoted` stays invalid.
- [ ] Add migration `16` that rebuilds `memory_candidate_entries` with `status IN ('captured', 'candidate', 'staged_for_review', 'rejected')`.
- [ ] Mirror the same invariant in the SQLite `initSchema()` bootstrap path.
- [ ] Narrow list/create surfaces so only list filters see `rejected`; create remains foundation-bounded.
- [ ] Verify schema tests go green.

## Task 2: Add Deterministic Rejection Service

- [ ] Add failing service tests for `staged_for_review -> rejected`.
- [ ] Add failing service tests proving `candidate -> rejected` and `captured -> rejected` are rejected.
- [ ] Implement a dedicated rejection function in `memory-inbox-service.ts`.
- [ ] Preserve `review_reason` and explicit `reviewed_at: null`.
- [ ] Verify service tests go green.

## Task 3: Publish Dedicated Rejection Operations

- [ ] Add failing operation tests for `reject_memory_candidate_entry`.
- [ ] Register the new operation in `operations-memory-inbox.ts` with dry-run behavior and CLI hints.
- [ ] Keep `advance_memory_candidate_status` unchanged for the non-terminal path.
- [ ] Let `list_memory_candidate_entries` filter by `rejected`.
- [ ] Verify operation tests go green.

## Task 4: Extend Phase 5 Acceptance

- [ ] Add failing benchmark tests for `phase5-memory-inbox-rejection`.
- [ ] Implement `scripts/bench/phase5-memory-inbox-rejection.ts`.
- [ ] Extend `phase5-acceptance-pack` to include both published Phase 5 slices.
- [ ] Add `bench:phase5-memory-inbox-rejection` to `package.json`.
- [ ] Update `docs/MBRAIN_VERIFY.md`.
- [ ] Verify the rejection benchmark, the acceptance pack, and full `test:phase5` go green.
