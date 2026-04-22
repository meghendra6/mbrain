# MBrain Phase 6 Candidate Dedup Design

## Goal

Finish Phase 6 by reducing repeated inbox noise into a bounded review backlog without mutating stored candidates.

## In Scope

- deterministic duplicate grouping for inbox candidates
- recurrence-aware backlog summaries built from existing candidate rows
- a read-only shared operation that exposes deduped review groups
- Phase 6 acceptance-pack closure

## Out Of Scope

- merging or deleting stored candidates
- automatic promotion or rejection
- canonical writes
- fuzzy semantic clustering beyond simple deterministic normalization

## Minimal Model

Group candidates by a deterministic dedup key built from:

- `scope_id`
- `candidate_type`
- `target_object_type`
- `target_object_id`
- normalized `proposed_content`

Each backlog group should expose:

- the representative highest-priority candidate
- grouped candidate ids
- duplicate count
- summed recurrence score
- highest review priority score in the group

## Grouping Rules

1. Normalize `proposed_content` by trimming, lowercasing, and collapsing internal whitespace.
2. Keep grouping deterministic and exact; do not introduce fuzzy embeddings or heuristics.
3. Choose the representative candidate by existing Phase 6 ranking order.
4. Backlog ordering follows:
   - highest representative review priority
   - then larger duplicate count
   - then newer representative `updated_at`
   - then representative `id`
5. Apply `limit` and `offset` after grouping and backlog ordering, never before grouping.

## Guardrails

- dedup is read-only
- dedup must not hide provenance; group output must expose grouped candidate ids
- dedup must not merge across scopes or targets
- ambiguous or stale-derived candidates may group only when their normalized key exactly matches

## Proof

This slice is complete when:

- service tests prove deterministic grouping and representative selection
- operation tests prove the shared deduped backlog surface
- tests prove dedup reads do not mutate underlying candidate rows
- the Phase 6 acceptance pack includes the dedup slice
- Phase 6 can close with scoring, map-derived capture, and dedup all passing together
