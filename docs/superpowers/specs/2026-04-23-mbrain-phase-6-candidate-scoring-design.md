# MBrain Phase 6 Candidate Scoring Design

## Goal

Start Phase 6 by adding deterministic review scoring for existing Memory Inbox candidates without creating new candidates or mutating canonical stores.

## In Scope

- deterministic scoring for existing `memory_candidate_entries`
- ranking inputs from:
  - confidence score
  - importance score
  - recurrence score
  - extraction kind
  - source quality derived from `source_refs`
- a read-only shared operation that returns scored candidates for review ordering
- benchmark and Phase 6 acceptance wiring for scoring determinism

## Out Of Scope

- creating or importing new candidates
- map-derived candidate capture
- duplicate suppression
- direct promotion, rejection, or canonical writes
- changing stored inbox scores in the database

## Minimal Model

Each scored result should expose:

- the underlying candidate
- `source_quality_score`
- `effective_confidence_score`
- `review_priority_score`

The scoring slice stays read-only. It computes transient review signals from current candidate data.

## Scoring Rules

1. `source_quality_score` is derived from `source_refs` only:
   - normalize by trimming and deduplicating repeated provenance strings first
   - `0` unique refs -> `0`
   - `1` unique ref -> `0.6`
   - `2+` unique refs -> `1`
2. `effective_confidence_score` is capped by source quality:
   - `min(confidence_score, source_quality_score)`
3. extraction kind adjusts review priority, but does not override the source-quality cap:
   - `manual` -> `1.0`
   - `extracted` -> `0.95`
   - `inferred` -> `0.8`
   - `ambiguous` -> `0.55`
4. `review_priority_score` is deterministic:
   - `effective_confidence_score * 0.4`
   - `importance_score * 0.35`
   - `recurrence_score * 0.15`
   - `extraction_kind_weight * 0.1`
5. Ties sort by:
   - higher `updated_at`
   - then lexicographic `id`

## Guardrails

- scoring must not persist new data
- scoring must not create candidates
- scoring must not bypass Phase 5 governance rules
- scoring output is a review signal only and must remain inside the inbox boundary

## Proof

This slice is complete when:

- service tests prove deterministic scoring and tie-breaking
- service or operation tests prove the scoring path is read-only and does not mutate stored candidates
- operation tests prove the shared read surface and bounded filters
- the dedicated scoring benchmark passes
- the Phase 6 acceptance pack includes the scoring slice
