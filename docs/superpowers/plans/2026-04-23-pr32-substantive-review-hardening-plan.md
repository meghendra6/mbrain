# PR #32 Substantive Review Hardening Plan

**Goal:** Land the valid production-facing fixes from the April 22 substantive PR review without expanding scope into new Phase 4 or Phase 5 features.

**Branching:** Keep this work on a dedicated stacked branch/PR above `phase2-note-manifest`. Do not add new feature slices here.

## Fix Now

1. `retrieval-route-selector-service`
- Add explicit runtime handling for unsupported `intent` values.
- Prevent `undefined` route selections from turning into downstream `TypeError`s.

2. `personal profile/episode route services`
- Add service-layer scope-gate enforcement so direct service callers cannot silently bypass the selector guard.
- Thread explicit personal scope through mixed-bridge and selector callers.

3. `personal-export-visibility-service`
- Replace hardcoded personal scope literals with shared defaults or explicit inputs.
- Remove the silent `1000`-row truncation by paginating through all profile-memory and episode entries.
- Return real personal-episode metadata instead of an always-empty array.

4. `scope-gate-service`
- Add Korean work/personal signal coverage so automatic routing is not English-only.

5. `mixed-scope-bridge-service`
- Remove the `as any` cast at the scope-gate boundary once the types line up.

## Defer

1. `note-section-service`
- Revisit section-content hash semantics and heading-order invariants in a separate slice.

2. `personal lookup scaling`
- Replace the hardcoded `limit: 10` path with explicit pagination and/or tighter filters in a separate slice.

3. `schema hardening`
- Add DB-level `CHECK` constraints and stronger uniqueness guarantees in a later migration-focused PR.

## Verification

- `bun test test/retrieval-route-selector-service.test.ts test/personal-profile-lookup-route-service.test.ts test/personal-episode-lookup-route-service.test.ts test/personal-export-visibility-service.test.ts test/scope-gate-service.test.ts`
- `bun run test:phase3`
- `bun run test:phase4`
- `bun run bench:phase4-acceptance --json`
