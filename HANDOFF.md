# Session Handoff — Sprint 1.0 Execution (Partial: Tasks 1–4)

**From:** 2026-04-24 working session (Tasks 1–4 executed)
**To:** next session (resume at Task 5)
**Working directory:** `/Users/meghendra/Work/mbrain`
**Branch:** `scenario-test-suite`
**Tip commit:** `9caa5a7 feat(engine): insert/select interaction_id on event row methods`

---

## 1. What's already done — do not redo

### Scenario test suite (PR #37, merged)
14 scenarios + helpers + `test:scenarios` npm script. Includes engine-level I4 fix (promotion refuses empty `source_refs` on all three engines).

### Sprint 1.0 design artifacts (on this branch, committed)
- `docs/superpowers/specs/2026-04-24-mbrain-sprint-0-tsc-baseline-design.md`
- `docs/superpowers/specs/2026-04-24-mbrain-sprint-1-0-interaction-identity-design.md` — source spec for this sprint
- `docs/superpowers/specs/2026-04-24-mbrain-sprint-1-1-loop-observability-design.md`
- `docs/superpowers/plans/2026-04-24-mbrain-sprint-1-0-interaction-identity-plan.md` — the 6-task plan
- Legacy `2026-04-24-mbrain-sprint-1-loop-observability-design.md` is marked SUPERSEDED; ignore its body.
- `docs/mbrain-architecture-guide.html` explains mbrain end-to-end with 8 SVG diagrams.

### Sprint 1.0 tasks executed in this session (Tasks 1–4)

| # | Commit | Subject | Verified by |
|---|---|---|---|
| 1 | `3d485f3` | `feat(types): widen RetrievalTrace.scope to ScopeGateScope` | tsc delta 0; 15/15 trace unit tests green |
| 2 | `add4c2e` | `feat(selector): persist traces without task_id` | S17 red→green (3/3); selector/trace suites 15/15; `shouldEvaluateScopeGate` narrowly widened for task-less persist path |
| 3 | `cf372dc` | `feat(schema): migration 21 — interaction_id on event rows` | interaction-schema test 2/2 (SQLite + PGLite); `LATEST_VERSION` → 21; migrations 1–20 untouched |
| 4 | `9caa5a7` | `feat(engine): insert/select interaction_id on event row methods` | all 3 engines + `utils.ts` row mappers threaded; targeted suites 42/42; zero regressions |

Each commit passed two-stage review (spec compliance + code quality). Key deviations from the plan's literal SQL (all accepted during review):

- Migration 21 (PG/PGLite) uses `ADD COLUMN IF NOT EXISTS` because `test/memory-inbox-schema.test.ts` replays migrations from v15 against an already-migrated schema. Plain `ADD COLUMN` would fail that replay.
- SQLite case 21 uses a `PRAGMA table_info`-guarded ALTER mirroring case 6 (same codebase precedent), dropping the partial `WHERE interaction_id IS NOT NULL` clause because SQLite indexes allow NULL.
- `test/memory-inbox-schema.test.ts` had 4 hardcoded `'20'` assertions replaced with `String(LATEST_VERSION)` — mechanical version-bump fix, no logic change.
- Task 2 narrowly widened `shouldEvaluateScopeGate` to evaluate scope_gate when `persist_trace === true && task_id === undefined`; otherwise S17's "work signals → scope 'work'" case cannot reach the fallback. Task-bearing paths unchanged.
- Task 4 updated shared row mappers in `src/core/utils.ts` (used by PGLite + Postgres) in addition to the inline copies in `sqlite-engine.ts` — pre-existing duplication, updated both to stay in sync.

### Full-suite test state at Task 4 head

`bun test`: **1113 pass / 1 fail / 135 skip / 6 todo**. The single failure is the known pre-existing flake `memory-inbox-engine.test.ts > blank-only` (passes in isolation; also flakes on pre-sprint `3d485f3`). Not caused by Sprint 1.0.

---

## 2. What's next — resume at Task 5

Remaining plan tasks:

### Task 5 — Services accept optional `interaction_id` (pending)

Files:
- `src/core/services/canonical-handoff-service.ts`
- `src/core/services/memory-inbox-supersession-service.ts`
- `src/core/services/memory-inbox-contradiction-service.ts`

Extend each input interface with `interaction_id?: string | null`; thread through to the engine call. Run the three named service test files. Commit: `feat(services): accept optional interaction_id on write services`.

Full task body in the plan, section "Task 5: Services accept optional `interaction_id`".

### Task 6 — Scenario tests S18, S19, S20 (pending)

Create:
- `test/scenarios/s18-interaction-id-handoff.test.ts` (handoff roundtrip)
- `test/scenarios/s19-interaction-id-supersession.test.ts` (cross-engine SQLite + PGLite)
- `test/scenarios/s20-interaction-id-nullable.test.ts` (null is valid)

Run full `bun test`; expected pass delta ≥ +5 from Task 4 head. Commit: `test(scenarios): S18 S19 S20 interaction_id correlation tests`.

### Post-tasks — push + PR

Already done for the partial checkpoint — scenario-test-suite pushed, new PR opened (link noted in §5). For the final sprint close, amend/extend that PR description to cover Tasks 5 + 6 once landed.

### Expected final state after Tasks 5 + 6

- 2 new commits on `scenario-test-suite` (total Sprint 1.0 = 6 commits).
- `bun test` green with at least 10 new tests vs pre-sprint (S17 ×3, S18 ×1, S19 ×2, S20 ×2, interaction-schema ×2).
- PR description updated.

### Do-not-touch boundaries (policy, not preference — unchanged)

- `memory_candidate_entries` schema — spec §3 excludes it (mutable state).
- `retrieval_traces` schema extensions (`derived_consulted`, `write_outcome`, etc.) — Sprint 1.1.
- CI `tsc --noEmit` — Sprint 0.
- `operations.ts` / CLI / MCP surface — Sprint 1.1 adds the audit op.

---

## 3. Context that saves re-derivation time (unchanged)

### Repo conventions you must preserve

- Contract-first: CLI and MCP both generated from `src/core/operations.ts`. Do not add user-visible operations in Sprint 1.0.
- Forward-only migrations: `src/core/migrate.ts` and `src/core/sqlite-engine.ts` case ladder. Never modify a landed migration; always append. Migration 21 now exists.
- Scenario test pattern: each `test/scenarios/sNN-*.test.ts` starts with a JSDoc block quoting the invariant it falsifies.
- Per-test timeout for cold-start engines: `const ENGINE_COLD_START_BUDGET_MS = 30_000;` + pass as third arg to `test(..., async () => {...}, ENGINE_COLD_START_BUDGET_MS)`. Already applied in `test/scenarios/interaction-schema.test.ts`.

### Known pre-existing issues not yours to fix

- `bunx tsc --noEmit` has pre-existing errors (Sprint 0 owns cleanup). Do not bundle tsc fixes into Sprint 1.0.
- PGLite full-suite flake pattern — use per-test timeout override where needed.
- `memory-inbox-engine.test.ts > blank-only` is a full-suite-only flake; passes in isolation.

### Files likely to change in Task 5 + 6

```
src/core/services/canonical-handoff-service.ts          [Task 5]
src/core/services/memory-inbox-supersession-service.ts  [Task 5]
src/core/services/memory-inbox-contradiction-service.ts [Task 5]
test/scenarios/s18-interaction-id-handoff.test.ts       [Task 6 · NEW]
test/scenarios/s19-interaction-id-supersession.test.ts  [Task 6 · NEW]
test/scenarios/s20-interaction-id-nullable.test.ts      [Task 6 · NEW]
```

If you find yourself editing outside this list, stop and re-read the plan.

---

## 4. Verification commands

```bash
# Confirm starting state for the next session
git status                          # expect clean working tree
git rev-parse --abbrev-ref HEAD     # expect scenario-test-suite
git --no-pager log --oneline -5     # expect tip at 9caa5a7 with Tasks 1–4 above it

# Per-task verification (plan specifies exact commands per step)
bun test test/scenarios/sNN-*.test.ts
bun test                            # full suite before each commit

# Final verification for Sprint 1.0 close
bun run test:scenarios              # all scenarios green
bun test                            # repo-wide green
```

If `bun test` reports more failures than at Task 4 head (1 pre-existing flake), stop and investigate — do not commit.

---

## 5. Open PRs at this handoff

| # | Title | State | Branch |
|---|---|---|---|
| 37 | test: scenario-based test suite grounded in redesign contract | merged | `scenario-test-suite` |
| (new) | feat: sprint 1.0 — agent-turn identity foundation (partial: tasks 1–4) | open | `scenario-test-suite` |

The new PR is the checkpoint for Sprint 1.0 execution through Task 4. It will be extended (amended description or subsequent commits) when Tasks 5 + 6 land.

---

## 6. If things go wrong

- **Migration regression on a rerun path**: the PG migration uses `ADD COLUMN IF NOT EXISTS`; if a new test exercises a different replay pattern, honor that idempotency.
- **`persistSelectedRouteTrace` tests break**: Task 2 intentionally changed the "throw on missing task" behavior. If a pre-existing test asserted the old throw-on-missing, update that single test and note the reason.
- **Cross-engine parity fails for supersession**: the trigger logic (Postgres/PGLite plpgsql vs SQLite hand-coded) was cross-verified in PR #36. If it regresses, start with `test/memory-inbox-schema.test.ts` which exercises all three engines.
- **Row-mapper drift between `utils.ts` and `sqlite-engine.ts`**: both must stay in sync because sqlite has inline copies. Any future event-row field should update BOTH locations.

---

## 7. Stop-hook note (unchanged)

The project's Stop hook enforces an mbrain-write reflex. For Sprint 1.0 execution sessions, the answer is normally **MBRAIN-PASS** — implementation artifacts are captured in the PR and docs, not as world-knowledge entries. If something new and reusable surfaced, record it. Otherwise respond `MBRAIN-PASS: <reason>` and continue.

---

## 8. Bootstrapping prompt for the next session

Copy the block below into the new session as the first message.

> I'm resuming Sprint 1.0 execution for mbrain. Tasks 1–4 landed on `scenario-test-suite` (tip `9caa5a7`). Read `HANDOFF.md` at the repo root first, then read the plan at `docs/superpowers/plans/2026-04-24-mbrain-sprint-1-0-interaction-identity-plan.md`. The spec is `docs/superpowers/specs/2026-04-24-mbrain-sprint-1-0-interaction-identity-design.md`.
>
> Remaining work: Task 5 (services accept optional `interaction_id` — 3 service files) and Task 6 (scenario tests S18 / S19 / S20). Execute them in order using `superpowers:subagent-driven-development` (fresh subagent per task, two-stage review — spec compliance then code quality). If that sub-skill is unavailable, fall back to `superpowers:executing-plans` with checkpoints.
>
> After Task 6, either amend the existing checkpoint PR's description or push follow-up commits to update it. The PR is already open on `scenario-test-suite`.
>
> Constraints (full detail in HANDOFF.md §2):
>
> - Do NOT add `interaction_id` to `memory_candidate_entries` (mutable state — policy).
> - Do NOT extend `retrieval_traces` with `derived_consulted` / `write_outcome` / etc. — Sprint 1.1.
> - Do NOT add `bunx tsc --noEmit` to CI — Sprint 0.
> - Do NOT add CLI or MCP operations — Sprint 1.1.
>
> Before Task 5, verify starting state:
>
> ```bash
> git status                          # expect clean
> git rev-parse --abbrev-ref HEAD     # expect scenario-test-suite
> git --no-pager log --oneline -5     # expect tip at 9caa5a7
> ```
>
> If any mismatch, stop and flag it.
