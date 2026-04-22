# MBrain Phases 5 To 8 Completion Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the remaining redesign roadmap by completing Phases 5 through 8 in one PR, with bounded slices, subagent review after every slice, and a phase retrospective recorded before moving to the next phase.

**Architecture:** Keep the existing contract-first migration strategy intact. Finish Phase 5 by closing the governance state machine and contradiction boundary, use that governance boundary to safely add higher-noise derived analysis in Phase 6, add canonical consolidation and historical-validity controls in Phase 7, and then close the roadmap with a system-level evaluation and dream-cycle maintenance loop in Phase 8. Every slice must land through focused services and shared operations first, extend acceptance packs as part of the slice, and append a retrospective entry before the next phase begins.

**Tech Stack:** TypeScript, Bun, shared operations contract, SQLite/PGLite/Postgres engine implementations, benchmark/acceptance scripts, GitHub PR workflow, subagent implementation and review loops.

---

## Execution Rules

- [ ] Keep all remaining work on one branch and one PR. Do not open additional stacked PRs for Phase 5 through Phase 8.
- [ ] Keep edits scoped to the active slice. Do not opportunistically refactor unrelated files.
- [ ] For every slice: write/extend failing tests first, verify red, implement the minimum code, verify green, run the relevant benchmark, then run a spec review subagent and a code-quality review subagent.
- [ ] For every phase: update `docs/superpowers/specs/2026-04-23-mbrain-phases-5-to-8-retrospective-log.md` with a short retrospective before starting the next phase.
- [ ] Extend the relevant acceptance pack in the same slice that adds new behavior. Do not defer benchmark wiring.
- [ ] Prefer dedicated service and operation modules over growing `src/core/operations.ts` further.
- [ ] Preserve local/offline semantics and Phase 0 parity discipline. Postgres-specific gaps may skip in local verification only when guarded by existing `DATABASE_URL` checks.

## Current Starting Point

- [ ] Treat `master` as containing complete Phase 0 through Phase 4 plus Phase 5 foundations and rejection.
- [ ] Treat the current uncommitted promotion-preflight RED tests and docs as the first in-progress Phase 5 slice.
- [ ] Preserve the published redesign documents as authoritative scope:
  - `docs/architecture/redesign/03-migration-roadmap-and-execution-envelope.md`
  - `docs/architecture/redesign/06-workstream-governance-and-inbox.md`
  - `docs/architecture/redesign/07-workstream-profile-memory-and-scope.md`
  - `docs/architecture/redesign/08-evaluation-and-acceptance.md`

## File Map

**Likely create or extend during Phases 5 through 8**

- Modify: `src/core/types.ts`
- Modify: `src/core/engine.ts`
- Modify: `src/core/sqlite-engine.ts`
- Modify: `src/core/pglite-engine.ts`
- Modify: `src/core/postgres-engine.ts`
- Modify: `src/core/migrate.ts`
- Modify: `src/core/operations.ts`
- Modify: `src/core/operations-memory-inbox.ts`
- Create or modify focused services under `src/core/services/`
  - `memory-inbox-service.ts`
  - `memory-inbox-*.ts` slice-specific services
  - `derived-*.ts` or `candidate-*.ts` Phase 6 services
  - `canonical-*.ts` or `promotion-*.ts` Phase 7 services
  - `evaluation-*.ts` or `dream-cycle-*.ts` Phase 8 services
- Modify and create tests under `test/`
- Modify and create benchmarks under `scripts/bench/`
- Modify: `package.json`
- Modify: `docs/MBRAIN_VERIFY.md`
- Modify throughout execution: `docs/superpowers/specs/2026-04-23-mbrain-phases-5-to-8-retrospective-log.md`

## Phase 5: Governance Completion

### Scope

- [ ] Complete bounded governance outcomes and gates for the Memory Inbox.
- [ ] Publish promotion preflight, promotion outcome, supersession outcome, contradiction handling, and Phase 5 acceptance closure.
- [ ] Keep this phase focused on governance state and target-domain handoff rules. Do not add higher-noise derived candidate generation yet.

### Slice 5.1: Promotion Preflight

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/services/memory-inbox-service.ts`
- Modify: `src/core/operations-memory-inbox.ts`
- Modify: `test/memory-inbox-service.test.ts`
- Modify: `test/memory-inbox-operations.test.ts`
- Create: `scripts/bench/phase5-memory-inbox-promotion-preflight.ts`
- Create: `test/phase5-memory-inbox-promotion-preflight.test.ts`
- Modify: `scripts/bench/phase5-acceptance-pack.ts`
- Modify: `test/phase5-acceptance-pack.test.ts`
- Modify: `package.json`
- Modify: `docs/MBRAIN_VERIFY.md`

- [ ] Write failing tests for `allow | deny | defer` preflight decisions, run them, and confirm failure is due to the missing feature.
- [ ] Implement the minimal read-only preflight service and shared operation.
- [ ] Add the dedicated benchmark slice and acceptance-pack wiring.
- [ ] Run focused tests, `bun run bench:phase5-memory-inbox-promotion-preflight --json`, and `bun run bench:phase5-acceptance --json`.
- [ ] Run subagent spec review, fix valid findings, run subagent code-quality review, fix valid findings.

### Slice 5.2: Promotion Outcome

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/engine.ts`
- Modify: `src/core/sqlite-engine.ts`
- Modify: `src/core/pglite-engine.ts`
- Modify: `src/core/postgres-engine.ts`
- Modify: `src/core/migrate.ts`
- Create or modify: `src/core/services/memory-inbox-promotion-service.ts`
- Modify: `src/core/operations-memory-inbox.ts`
- Modify: `test/memory-inbox-schema.test.ts`
- Modify: `test/memory-inbox-engine.test.ts`
- Create or modify: `test/memory-inbox-promotion-service.test.ts`
- Create or modify: `test/memory-inbox-promotion-operations.test.ts`
- Create: `scripts/bench/phase5-memory-inbox-promotion.ts`
- Create: `test/phase5-memory-inbox-promotion.test.ts`
- Modify: `scripts/bench/phase5-acceptance-pack.ts`
- Modify: `test/phase5-acceptance-pack.test.ts`
- Modify: `package.json`
- Modify: `docs/MBRAIN_VERIFY.md`

- [ ] Add failing tests for `staged_for_review -> promoted` plus durable promotion record output and target binding persistence.
- [ ] Add only the new schema and status widening needed for canonical promotion outcomes.
- [ ] Implement the smallest promotion service that requires a passing preflight result and emits durable governance output.
- [ ] Keep target-domain writes bounded: link to destination ids without widening into large target-domain rewrite logic.
- [ ] Add benchmark and acceptance wiring, then run the focused suite and Phase 5 pack.
- [ ] Run subagent spec review and code-quality review, fixing only valid issues.

### Slice 5.3: Supersession Outcome

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/engine.ts`
- Modify: `src/core/sqlite-engine.ts`
- Modify: `src/core/pglite-engine.ts`
- Modify: `src/core/postgres-engine.ts`
- Modify: `src/core/migrate.ts`
- Create or modify: `src/core/services/memory-inbox-supersession-service.ts`
- Modify: `src/core/operations-memory-inbox.ts`
- Modify or create: `test/memory-inbox-supersession-service.test.ts`
- Modify or create: `test/memory-inbox-supersession-operations.test.ts`
- Create: `scripts/bench/phase5-memory-inbox-supersession.ts`
- Create: `test/phase5-memory-inbox-supersession.test.ts`
- Modify: `scripts/bench/phase5-acceptance-pack.ts`
- Modify: `test/phase5-acceptance-pack.test.ts`
- Modify: `package.json`
- Modify: `docs/MBRAIN_VERIFY.md`

- [ ] Write failing tests for explicit supersession records and old/new candidate linking.
- [ ] Implement the smallest schema/service change that keeps historical governance records visible.
- [ ] Extend acceptance and verification in the same slice.
- [ ] Run subagent spec review and code-quality review, fixing valid findings.

### Slice 5.4: Contradiction Handling

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/engine.ts`
- Modify: `src/core/sqlite-engine.ts`
- Modify: `src/core/pglite-engine.ts`
- Modify: `src/core/postgres-engine.ts`
- Modify: `src/core/migrate.ts`
- Create or modify: `src/core/services/memory-inbox-contradiction-service.ts`
- Modify: `src/core/operations-memory-inbox.ts`
- Modify or create: `test/memory-inbox-contradiction-service.test.ts`
- Modify or create: `test/memory-inbox-contradiction-operations.test.ts`
- Create: `scripts/bench/phase5-memory-inbox-contradiction.ts`
- Create: `test/phase5-memory-inbox-contradiction.test.ts`
- Modify: `scripts/bench/phase5-acceptance-pack.ts`
- Modify: `test/phase5-acceptance-pack.test.ts`
- Modify: `package.json`
- Modify: `docs/MBRAIN_VERIFY.md`

- [ ] Add failing tests for contradiction detection and explicit outcomes: reject, unresolved, superseded.
- [ ] Implement only the deterministic contradiction data and service paths needed by the tests.
- [ ] Add benchmark coverage for contradiction safety and Phase 5 acceptance.
- [ ] Run subagent spec review and code-quality review, fixing valid findings.

### Slice 5.5: Phase 5 Closure

**Files:**
- Modify: `scripts/bench/phase5-acceptance-pack.ts`
- Modify: `test/phase5-acceptance-pack.test.ts`
- Modify: `package.json`
- Modify: `docs/MBRAIN_VERIFY.md`
- Modify: `docs/superpowers/specs/2026-04-23-mbrain-phases-5-to-8-retrospective-log.md`

- [ ] Run the full Phase 5 suite and acceptance pack.
- [ ] Record a Phase 5 retrospective with:
  - wins
  - misses
  - valid review findings that changed the implementation
  - one execution rule carried forward into Phase 6

## Phase 6: Higher-Noise Derived Analysis Under Governance

### Scope

- [ ] Add richer derived candidate generation only after Phase 5 governance is complete.
- [ ] Keep all Phase 6 outputs bounded to inbox candidates or review signals. No direct canonical writes.

### Slice 6.1: Derived Candidate Scoring And Ranking

**Files:**
- Modify: `src/core/types.ts`
- Create or modify: `src/core/services/memory-candidate-scoring-service.ts`
- Modify: `src/core/operations-memory-inbox.ts`
- Create or modify: `test/memory-candidate-scoring-service.test.ts`
- Create or modify: `test/memory-candidate-scoring-operations.test.ts`
- Create: `scripts/bench/phase6-candidate-scoring.ts`
- Create: `test/phase6-candidate-scoring.test.ts`
- Modify: `package.json`
- Modify: `docs/MBRAIN_VERIFY.md`

- [ ] Write failing tests for deterministic candidate ranking from confidence, importance, recurrence, extraction kind, and source quality.
- [ ] Implement the minimal scoring service and operation surface.
- [ ] Add benchmark and acceptance hooks for scoring determinism.
- [ ] Run subagent spec review and code-quality review, fixing valid findings.

### Slice 6.2: Map-Derived Candidate Capture

**Files:**
- Create or modify: `src/core/services/map-derived-candidate-service.ts`
- Modify: `src/core/operations-memory-inbox.ts`
- Create or modify: `test/map-derived-candidate-service.test.ts`
- Create or modify: `test/map-derived-candidate-operations.test.ts`
- Create: `scripts/bench/phase6-map-derived-candidates.ts`
- Create: `test/phase6-map-derived-candidates.test.ts`
- Modify: `package.json`
- Modify: `docs/MBRAIN_VERIFY.md`

- [ ] Write failing tests proving map-derived candidates enter inbox state rather than bypassing governance.
- [ ] Implement the smallest bridge from existing map/report artifacts into `memory_candidate_entries`.
- [ ] Add benchmark and acceptance wiring.
- [ ] Run subagent spec review and code-quality review, fixing valid findings.

### Slice 6.3: Duplicate And Recurrence Handling

**Files:**
- Create or modify: `src/core/services/memory-candidate-dedup-service.ts`
- Modify: `src/core/operations-memory-inbox.ts`
- Create or modify: `test/memory-candidate-dedup-service.test.ts`
- Create or modify: `test/memory-candidate-dedup-operations.test.ts`
- Create: `scripts/bench/phase6-candidate-dedup.ts`
- Create: `test/phase6-candidate-dedup.test.ts`
- Modify: `scripts/bench/phase6-acceptance-pack.ts`
- Create: `test/phase6-acceptance-pack.test.ts`
- Modify: `package.json`
- Modify: `docs/MBRAIN_VERIFY.md`

- [ ] Write failing tests for recurrence-aware duplicate suppression and bounded review backlog behavior.
- [ ] Implement the minimal dedup/recurrence service used by inbox list/read surfaces.
- [ ] Publish the Phase 6 acceptance pack.
- [ ] Run subagent spec review and code-quality review, fixing valid findings.

### Slice 6.4: Phase 6 Closure

**Files:**
- Modify: `docs/superpowers/specs/2026-04-23-mbrain-phases-5-to-8-retrospective-log.md`

- [ ] Run the full Phase 6 suite and acceptance pack.
- [ ] Record a Phase 6 retrospective and carry one concrete improvement rule into Phase 7.

## Phase 7: Canonical Knowledge Consolidation

### Scope

- [ ] Move from governed candidates into slower-moving canonical knowledge only through explicit handoff records.
- [ ] Add historical-validity safeguards so old truth does not outrun current evidence.

### Slice 7.1: Canonical Handoff Records

**Files:**
- Modify: `src/core/types.ts`
- Create or modify: `src/core/services/canonical-handoff-service.ts`
- Modify: `src/core/operations-memory-inbox.ts`
- Create or modify: `test/canonical-handoff-service.test.ts`
- Create or modify: `test/canonical-handoff-operations.test.ts`
- Create: `scripts/bench/phase7-canonical-handoff.ts`
- Create: `test/phase7-canonical-handoff.test.ts`
- Modify: `package.json`
- Modify: `docs/MBRAIN_VERIFY.md`

- [ ] Write failing tests for promotion records that hand off into curated notes, procedures, profile memory, or personal episodes without losing provenance.
- [ ] Implement the smallest canonical handoff service and read surface.
- [ ] Add benchmark and acceptance wiring.
- [ ] Run subagent spec review and code-quality review, fixing valid findings.

### Slice 7.2: Historical Validity And Staleness Controls

**Files:**
- Create or modify: `src/core/services/historical-validity-service.ts`
- Modify: `src/core/operations-memory-inbox.ts`
- Create or modify: `test/historical-validity-service.test.ts`
- Create or modify: `test/historical-validity-operations.test.ts`
- Create: `scripts/bench/phase7-historical-validity.ts`
- Create: `test/phase7-historical-validity.test.ts`
- Modify: `package.json`
- Modify: `docs/MBRAIN_VERIFY.md`

- [ ] Write failing tests for current-evidence checks, stale-claim flags, and safe fallback to supersession or unresolved conflict.
- [ ] Implement the minimum validity controls to pass those tests.
- [ ] Run subagent spec review and code-quality review, fixing valid findings.

### Slice 7.3: Phase 7 Closure

**Files:**
- Create: `scripts/bench/phase7-acceptance-pack.ts`
- Create: `test/phase7-acceptance-pack.test.ts`
- Modify: `package.json`
- Modify: `docs/MBRAIN_VERIFY.md`
- Modify: `docs/superpowers/specs/2026-04-23-mbrain-phases-5-to-8-retrospective-log.md`

- [ ] Publish the Phase 7 acceptance pack and run it.
- [ ] Record a Phase 7 retrospective and carry one concrete improvement rule into Phase 8.

## Phase 8: System Evaluation And Dream Cycle

### Scope

- [ ] Close the roadmap with integrated evaluation, longitudinal baseline comparison, and bounded maintenance automation.
- [ ] Keep dream-cycle outputs governed. They may generate candidates or maintenance recommendations, but they may not silently mutate canonical truth.

### Slice 8.1: Longitudinal Evaluation Pack

**Files:**
- Create or modify: `scripts/bench/phase8-longitudinal-evaluation.ts`
- Create or modify: `test/phase8-longitudinal-evaluation.test.ts`
- Modify: `package.json`
- Modify: `docs/MBRAIN_VERIFY.md`

- [ ] Write failing tests for a single evaluation pack that compares key Phase 1 through Phase 7 benchmarks against the recorded baselines.
- [ ] Implement the smallest summarizer that can consume existing benchmark outputs and report regressions.
- [ ] Run subagent spec review and code-quality review, fixing valid findings.

### Slice 8.2: Dream-Cycle Candidate Maintenance

**Files:**
- Create or modify: `src/core/services/dream-cycle-maintenance-service.ts`
- Modify: `src/core/operations-memory-inbox.ts`
- Create or modify: `test/dream-cycle-maintenance-service.test.ts`
- Create or modify: `test/dream-cycle-maintenance-operations.test.ts`
- Create: `scripts/bench/phase8-dream-cycle.ts`
- Create: `test/phase8-dream-cycle.test.ts`
- Modify: `package.json`
- Modify: `docs/MBRAIN_VERIFY.md`

- [ ] Write failing tests for a bounded maintenance loop that emits recap, stale-claim challenge, or duplicate-merge suggestions into governance state only.
- [ ] Implement the minimal dream-cycle service and operation.
- [ ] Add benchmark coverage and keep outputs read-only or candidate-only.
- [ ] Run subagent spec review and code-quality review, fixing valid findings.

### Slice 8.3: Final Roadmap Closure

**Files:**
- Create: `scripts/bench/phase8-acceptance-pack.ts`
- Create: `test/phase8-acceptance-pack.test.ts`
- Modify: `package.json`
- Modify: `docs/MBRAIN_VERIFY.md`
- Modify: `docs/superpowers/specs/2026-04-23-mbrain-phases-5-to-8-retrospective-log.md`

- [ ] Publish the Phase 8 acceptance pack.
- [ ] Run all phase acceptance packs needed to show end-to-end roadmap closure.
- [ ] Record the Phase 8 retrospective with final lessons, remaining risks, and any intentionally deferred work.

## Final Integration

**Files:**
- Modify: PR description and verification notes when the branch is ready

- [ ] Run focused suites for the active slice after each merge point.
- [ ] After Phase 8, run:
  - `bun run test:phase5`
  - `bun run test:phase6` once it exists
  - `bun run test:phase7` once it exists
  - `bun run test:phase8` once it exists
  - all published acceptance packs
- [ ] Run a final whole-branch critical review subagent after all phases are complete.
- [ ] Open one PR with the roadmap completion scope and include:
  - completed slices
  - acceptance evidence
  - retrospectives and resulting execution-rule changes
  - explicit remaining risks, including any Postgres skips caused by missing `DATABASE_URL`
