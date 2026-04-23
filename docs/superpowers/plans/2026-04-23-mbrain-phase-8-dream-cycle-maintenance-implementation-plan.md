# MBrain Phase 8 Dream-Cycle Maintenance Implementation Plan

## Task 1: Add Red Tests

- add `test/dream-cycle-maintenance-service.test.ts`
- add `test/dream-cycle-maintenance-operations.test.ts`
- add `test/phase8-dream-cycle.test.ts`
- prove:
  - the service creates only `generated_by: dream_cycle` memory candidates
  - dry-run emits suggestion shape but creates no candidates
  - duplicate groups produce `duplicate_merge`
  - stale historical-validity outcomes produce `stale_claim_challenge`
  - `limit` bounds total emitted suggestions in write and dry-run modes, with `recap` consuming one slot
  - the raw maintenance read window is capped to `100` scope-local candidates
  - prior `generated_by: dream_cycle` candidates are ignored as maintenance input
  - a two-scope fixture proves the service does not read or emit suggestions from another scope
  - invalid `now` values fail before stale calculations
  - the shared operation is exposed and validates params
- run the focused tests first and confirm failure is caused by the missing slice

## Task 2: Implement The Maintenance Service

- add `src/core/services/dream-cycle-maintenance-service.ts`
- reuse:
  - `buildMemoryCandidateReviewBacklog`
  - `assessHistoricalValidity`
  - existing `createMemoryCandidateEntry`
- add no new tables
- keep total emitted suggestions bounded by `limit`, not just created candidates
- make `recap` consume one suggestion slot
- cap the raw candidate read window at `100` rows per run
- filter prior `generated_by: dream_cycle` rows out of maintenance inputs
- keep all reads scoped to one `scope_id`
- validate optional time inputs as both service-level `Date` objects and operation-level ISO strings

## Task 3: Publish The Shared Operation

- add `run_dream_cycle_maintenance` to `operations-memory-inbox.ts`
- use the existing default inbox scope when `scope_id` is omitted
- support operation-level dry-run by passing `write_candidates: false`
- validate optional ISO `now` at the operation boundary while retaining service-level `Date` validation

## Task 4: Benchmark And Verification

- add `scripts/bench/phase8-dream-cycle.ts`
- add `bench:phase8-dream-cycle` to `package.json`
- extend `test:phase8`
- update `docs/MBRAIN_VERIFY.md`

## Task 5: Review

- run focused tests and benchmark
- run spec review subagent, fix valid findings
- run code-quality review subagent, fix valid findings
