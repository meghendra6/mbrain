# Phase 5 Memory Inbox Promotion Preflight Design

## Goal

Add a deterministic read-side promotion gate for `Memory Candidate` records
without opening `promoted` writes, target-domain handoff, or contradiction
resolution.

## Scope

- add one `promotion preflight` decision service for a single candidate
- support `allow | deny | defer` outcomes with explicit reason codes
- keep the published candidate lifecycle unchanged:
  `captured -> candidate -> staged_for_review -> rejected`
- expose the preflight through one shared operation
- publish one additional Phase 5 benchmark slice and acceptance wiring

## Non-Goals

- writing `status='promoted'`
- mutating curated notes, procedures, profile memory, or personal episodes
- contradiction linking
- duplicate merge or supersession logic
- reviewer queueing or batch review UX

## Design Choice

Three approaches were considered:

1. Add full `promoted` status and target-domain writes now.
2. Add a read-only `promotion preflight` gate first.
3. Add `superseded` before promotion readiness.

The chosen design is **2**.

Reasons:

- it is the smallest slice that exercises the promotion rules from the redesign
  docs without widening canonical write surfaces
- it keeps Phase 5 reviewable and reversible
- it gives the later promotion PR a deterministic contract to build on

## Decision Model

The preflight returns:

- `decision`: `allow | deny | defer`
- `reasons`: stable machine-readable reason codes
- `summary_lines`: compact human-readable explanation

The first published reason set is:

- `candidate_not_staged_for_review`
- `candidate_missing_provenance`
- `candidate_missing_target_object`
- `candidate_scope_conflict`
- `candidate_unknown_sensitivity`
- `candidate_requires_revalidation`
- `candidate_ready_for_promotion`

## Rules

The preflight should evaluate:

1. candidate exists
2. candidate is currently `staged_for_review`
3. candidate has at least one `source_ref`
4. candidate has both `target_object_type` and `target_object_id`
5. `unknown` sensitivity defers rather than allows
6. `personal` or `secret` candidates deny when the target is work-visible
7. `work` candidates deny when the target is personal-only
8. `procedure` candidates defer for explicit revalidation before promotion

For this slice, target-domain classes are:

- work-visible: `curated_note`, `procedure`
- personal-only: `profile_memory`, `personal_episode`
- neutral fallback: `other`

`other` never auto-allows in this slice. It should defer because the target
policy is not explicit enough yet.

## Operation Surface

This slice should expose one new operation:

- `preflight-promote-memory-candidate`

Expected params:

- `id`

Operation rules:

- read-only
- thin adapter over the service
- missing ids should still map to the stable `memory_candidate_not_found` error

## Acceptance

This slice is complete when:

- service tests prove `allow`, `deny`, and `defer` outcomes for representative
  candidates
- operation tests prove `preflight-promote-memory-candidate` is registered and
  returns the decision payload
- benchmark reports one new slice:
  `memory_inbox_promotion_preflight`
- `phase5-acceptance` passes with:
  - `memory_inbox_foundations`
  - `memory_inbox_rejection`
  - `memory_inbox_promotion_preflight`
