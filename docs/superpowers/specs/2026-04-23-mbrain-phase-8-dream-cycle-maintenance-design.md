# MBrain Phase 8 Dream-Cycle Maintenance Design

## Goal

Add a bounded dream-cycle maintenance loop that can surface maintenance recommendations into the Memory Inbox without silently mutating canonical truth.

## In Scope

- one service that reads existing memory candidates in a single scope
- one bounded maintenance window per run
- one shared operation for running the maintenance loop
- candidate-only outputs with `generated_by: dream_cycle`
- three recommendation types:
  - `recap`
  - `stale_claim_challenge`
  - `duplicate_merge`
- optional dry-run behavior through the existing operation context
- benchmark and Phase 8 verification wiring

## Out Of Scope

- direct canonical note, profile, procedure, or episode writes
- automatic promotion, rejection, supersession, or contradiction resolution
- new persistence tables
- fuzzy semantic matching
- background scheduling
- cross-scope maintenance

## Minimal Model

The service emits:

- `scope_id`
- `generated_at`
- `write_candidates`
- `suggestions`
- `summary_lines`

Each suggestion has:

- `suggestion_type`
- `candidate_id`
- `source_candidate_ids`
- `target_object_type`
- `target_object_id`
- `status`
- `summary_lines`

`candidate_id` is `null` in dry-run mode and a stored memory-candidate id when writing is enabled.

## Suggestion Rules

1. `recap`
   - generated when the scope has at least one candidate
   - summarizes status counts for the scope
   - creates a `rationale` candidate with `generated_by: dream_cycle`

2. `duplicate_merge`
   - generated from the existing dedup backlog when a group has more than one candidate
   - source refs point to the grouped candidate ids
   - creates a `rationale` candidate

3. `stale_claim_challenge`
   - generated for promoted candidates whose historical-validity assessment does not return `allow`
   - source refs point to the challenged candidate id and handoff id when available
   - creates an `open_question` candidate

## Safety Rules

1. The loop is scope-local. It must not read across scopes.
2. The loop must not mutate any existing candidate row except by creating new dream-cycle candidate rows.
3. The loop must not write canonical target domains.
4. Optional `now` inputs must validate both ISO strings and `Date` objects before stale checks.
5. Dry-run mode must return the same suggestion shape without creating candidates.
6. The number of emitted suggestions is bounded by `limit` in both write and dry-run modes.
7. `recap` consumes one suggestion slot when emitted.
8. The maintenance input is bounded to the first `100` raw candidates in the requested scope for each run.
9. Prior `generated_by: dream_cycle` candidates are ignored as maintenance input.

## Proof

This slice is complete when:

- service tests prove candidate-only write behavior
- service tests prove dry-run creates no memory candidates
- service tests prove `limit` bounds emitted suggestions, including `recap`
- service tests prove the raw maintenance read window is capped
- service tests seed two scopes and prove the loop only reads and emits suggestions for the requested scope
- service tests prove invalid `Date` objects and invalid ISO strings are rejected
- operation tests prove shared operation validation and dry-run behavior
- benchmark reports the dream-cycle slice
- Phase 8 verification includes the slice
