# MBrain Phase 6 Candidate Dedup Implementation Plan

## Task 1: Add Red Tests

- add service tests for deterministic grouping, recurrence aggregation, representative selection, and group-first pagination semantics
- add operation tests for deduped backlog reads and read-only regression coverage
- add benchmark shape test
- extend the Phase 6 acceptance-pack expectation with the dedup benchmark
- run the focused dedup tests first and confirm failure is caused by the missing slice

## Task 2: Implement The Minimal Dedup Service

- add `memory-candidate-dedup-service.ts`
- reuse the Phase 6 scoring service for representative ordering
- keep output read-only

## Task 3: Publish The Shared Backlog Operation

- add `list_memory_candidate_review_backlog`
- support the existing inbox filters and apply bounded limits only after deduped backlog ordering
- return group summaries instead of mutating candidate state

## Task 4: Acceptance Wiring

- add `scripts/bench/phase6-candidate-dedup.ts`
- extend `scripts/bench/phase6-acceptance-pack.ts`
- update `package.json` and `docs/MBRAIN_VERIFY.md`

## Task 5: Verification And Review

- run focused dedup tests
- run `bun run bench:phase6-candidate-dedup --json`
- run `bun run bench:phase6-acceptance --json`
- run spec review subagent, fix valid findings
- run quality review subagent, fix valid findings
