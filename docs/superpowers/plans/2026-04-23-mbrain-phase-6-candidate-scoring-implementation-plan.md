# MBrain Phase 6 Candidate Scoring Implementation Plan

## Task 1: Add Red Tests

- add service tests for source quality, effective confidence capping, review priority ordering, deterministic tie-breaking, and duplicate provenance normalization
- add operation tests for scoped ranked reads and bounded limits
- add a read-only regression test proving the scoring path does not mutate stored candidates
- add benchmark shape test
- add the scoring benchmark to the Phase 6 acceptance pack expectation
- run the focused scoring tests first and confirm failure is caused by the missing slice

## Task 2: Add The Minimal Read-Only Types

- add scored-candidate output types
- keep the model transient and read-only
- do not add schema or engine writes

## Task 3: Implement The Scoring Service

- add `memory-candidate-scoring-service.ts`
- compute source-quality, effective-confidence, and review-priority deterministically
- sort ties by `updated_at` and `id`

## Task 4: Publish The Shared Operation

- add a read-only `rank_memory_candidate_entries` surface
- reuse existing inbox list filters and bounded limits
- return scored entries without mutating stored candidates

## Task 5: Acceptance Wiring

- add `scripts/bench/phase6-candidate-scoring.ts`
- add `scripts/bench/phase6-acceptance-pack.ts`
- update `package.json` and `docs/MBRAIN_VERIFY.md`

## Task 6: Verification And Review

- run focused scoring tests
- run `bun run bench:phase6-candidate-scoring --json`
- run `bun run bench:phase6-acceptance --json`
- run the Phase 6 test suite once the slice is green
- run spec review subagent, fix valid findings
- run quality review subagent, fix valid findings
