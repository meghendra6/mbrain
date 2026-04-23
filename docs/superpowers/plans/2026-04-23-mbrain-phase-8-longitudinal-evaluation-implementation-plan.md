# MBrain Phase 8 Longitudinal Evaluation Implementation Plan

## Task 1: Add Red Tests

- add `test/phase8-longitudinal-evaluation.test.ts`
- cover:
  - `--help` usage
  - `--json` summary shape without a Phase 1 baseline artifact
  - `--json --phase1-baseline <path>` makes Phase 1 comparable
  - one intentional regression case that forces `phase8_status = fail` and a non-zero exit
- assert that:
  - `phase1` reports `pending_baseline` without a baseline file
  - `phase2` through `phase7` are present with benchmark manifests
  - overall `phase8_status` is `pending_baseline` without a Phase 1 baseline and `pass` with a valid one
  - a broken phase manifest or broken acceptance status produces `phase8_status = fail`
- run the focused test first and confirm failure is caused by the missing slice

## Task 2: Implement The Minimal Summarizer

- add `scripts/bench/phase8-longitudinal-evaluation.ts`
- keep the implementation read-only
- forward an optional `--phase1-baseline` flag to the existing Phase 1 runner
- encode the recorded benchmark manifests for Phase 2 through Phase 7 in one local constant
- compare benchmark-name collections with exact set equality, ignoring order only

## Task 3: Publish The Slice

- add `bench:phase8-longitudinal` to `package.json`
- add this slice to `docs/MBRAIN_VERIFY.md`
- keep the contract bounded to summary reporting only

## Task 4: Verification And Review

- run `bun test test/phase8-longitudinal-evaluation.test.ts`
- run `bun run bench:phase8-longitudinal --json`
- run `bun run bench:phase8-longitudinal --json --phase1-baseline <tempfile>`
- run spec review subagent, fix valid findings
- run quality review subagent, fix valid findings

## Task 5: Carry Forward

- append the Phase 8 retrospective only after Slice 8.3, but note any execution-rule changes discovered in 8.1 during the working log and carry them into 8.2
