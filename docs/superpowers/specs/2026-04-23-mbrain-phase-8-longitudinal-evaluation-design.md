# MBrain Phase 8 Longitudinal Evaluation Design

## Goal

Add one read-only longitudinal evaluation pack that reruns the published Phase 1 through Phase 7 benchmark entrypoints and reports whether the redesign still matches the recorded baseline families.

## In Scope

- one benchmark runner:
  - `phase1` operational-memory benchmark
  - `phase2` acceptance pack
  - `phase3` acceptance pack
  - `phase4` acceptance pack
  - `phase5` acceptance pack
  - `phase6` acceptance pack
  - `phase7` acceptance pack
- one compact summary payload for:
  - workload coverage
  - comparability to the recorded baseline family
  - regressions
  - overall `phase8_status`
- optional external Phase 1 baseline forwarding
- benchmark and verification wiring for the slice

## Out Of Scope

- generating or refreshing baseline artifacts automatically
- mutating any canonical, inbox, or derived records
- dream-cycle maintenance behavior
- new per-phase benchmark thresholds
- hidden fallback logic beyond explicit `pending_baseline`

## Baseline Model

The longitudinal pack uses two baseline modes:

1. `phase1`
   - forwards an optional external baseline artifact to the existing Phase 1 runner
   - without that artifact, `phase1` remains comparable only at the readiness level and reports `pending_baseline`

2. `phase2` through `phase7`
   - treat each published acceptance pack as the recorded baseline contract for that phase
   - the contract includes:
     - the expected benchmark names
     - `acceptance.readiness_status = pass`
     - the phase-specific acceptance status = `pass`

## Minimal Output

The runner emits:

- `generated_at`
- `engine`
- `phase`
- `phase_summaries`
  - `phase`
  - `baseline_family`
  - `comparable_status`
  - `readiness_status`
  - `phase_status`
  - `benchmark_names`
  - `regression_reasons`
- `acceptance`
  - `readiness_status`
  - `phase8_status`
  - `summary`

## Comparable Status

`comparable_status` is one of:

- `pass`
- `fail`
- `pending_baseline`

## Regression Rules

1. If a published benchmark runner exits non-zero, the corresponding phase is a regression.
2. If a phase returns a benchmark-name collection that is not an exact match for its recorded manifest, the phase is a regression. Order is ignored, but missing names, extra names, and duplicate names are all regressions.
3. If a phase returns `acceptance.readiness_status != pass`, the phase is a regression.
4. If a phase-specific acceptance status is not `pass`, the phase is a regression.
5. `phase1` may report `pending_baseline` only when no external baseline artifact was supplied.
6. The longitudinal slice remains read-only and must not synthesize replacement baselines.

## Phase Status Rules

- `readiness_status = pass` only when no phase summary reports `fail`
- `phase8_status = pass` only when every phase summary is comparable and passing
- `phase8_status = pending_baseline` only when:
  - no phase summary failed, and
  - the only non-pass comparable result is `phase1 = pending_baseline`
- `phase8_status = fail` for any regression

## Proof

This slice is complete when:

- the benchmark test proves the longitudinal summary shape
- the test proves `phase1` becomes `pending_baseline` without an external artifact
- the test proves `phase1` becomes comparable when a valid baseline artifact is provided
- the test proves Phase 2 through Phase 7 benchmark manifests are present in the summary
- the test proves an intentional regression path returns `phase8_status = fail` and exits non-zero
- the benchmark script exits successfully for `pass` and `pending_baseline`, but exits non-zero for regressions
