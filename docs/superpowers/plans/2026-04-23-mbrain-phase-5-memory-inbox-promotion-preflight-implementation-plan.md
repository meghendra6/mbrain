# Phase 5 Memory Inbox Promotion Preflight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic promotion preflight gate for staged memory candidates without opening `promoted` writes.

**Architecture:** Keep this slice read-only. Add a bounded promotion-preflight decision service, expose it through one shared operation, and extend Phase 5 acceptance with a single new benchmark slice.

**Tech Stack:** TypeScript, Bun, shared operations contract, existing Phase 5 memory inbox services, Phase 5 benchmark and acceptance wiring.

---

## Review-Driven Constraints

- [ ] Keep this PR stacked directly on current `master`.
- [ ] Do not add a new DB migration for this slice.
- [ ] Do not widen `MemoryCandidateStatus` beyond the already published set.
- [ ] Do not write `promoted` outcomes or mutate target-domain records.
- [ ] Keep the service deterministic and driven only by candidate fields already present in Phase 5.

## File Map

- Modify: `src/core/types.ts`
- Modify: `src/core/services/memory-inbox-service.ts`
- Modify: `src/core/operations-memory-inbox.ts`
- Modify: `test/memory-inbox-service.test.ts`
- Modify: `test/memory-inbox-operations.test.ts`
- Create: `scripts/bench/phase5-memory-inbox-promotion-preflight.ts`
- Create: `test/phase5-memory-inbox-promotion-preflight.test.ts`
- Modify: `scripts/bench/phase5-acceptance-pack.ts`
- Modify: `test/phase5-acceptance-pack.test.ts`
- Modify: `package.json`
- Modify: `docs/MBRAIN_VERIFY.md`

## Task 1: Add Promotion Preflight Decision Types

- [ ] Add decision and result types for `allow | deny | defer`.
- [ ] Keep the reason-code list explicit and bounded.
- [ ] Reuse existing `memory_candidate_not_found` behavior for missing ids.

## Task 2: Implement The Deterministic Service

- [ ] Add failing service tests for:
  - allow on a staged work-visible candidate with provenance and a valid target
  - deny on scope/sensitivity mismatch
  - defer on `unknown` sensitivity
  - defer on `procedure` revalidation requirement
  - deny on missing provenance
  - deny on missing target binding
- [ ] Implement the minimal service logic to satisfy those tests.

## Task 3: Publish One Shared Operation

- [ ] Add a failing operation test for `preflight_promote_memory_candidate`.
- [ ] Register the operation with CLI hints.
- [ ] Keep the handler read-only and thin over the service.

## Task 4: Extend Phase 5 Acceptance

- [ ] Add a failing benchmark contract test for
  `phase5-memory-inbox-promotion-preflight`.
- [ ] Implement the benchmark script with correctness and latency workloads.
- [ ] Extend `phase5-acceptance-pack` to include the new published slice.
- [ ] Add `bench:phase5-memory-inbox-promotion-preflight` to `package.json`.
- [ ] Update `docs/MBRAIN_VERIFY.md`.
- [ ] Verify `test:phase5`, the new benchmark, and the acceptance pack go green.
