# Handoff: Sprint 5 Candidate Status Events

## Current State

- Repository: `/Users/meghendra/Work/mbrain`
- Active worktree: `/Users/meghendra/Work/mbrain/.worktrees/sprint-5-candidate-status-events`
- Branch: `sprint-5-candidate-status-events`
- Base: `origin/master` at `f02e4d8` (`Merge pull request #52 from meghendra6/sprint-final-acceptance-closure`)
- Open PRs after PR #52 merge: none were present when checked.

## Completed Before This Handoff

PR #52 was completed and merged before Sprint 5 began.

- PR: `https://github.com/meghendra6/mbrain/pull/52`
- Merge commit: `f02e4d8f16e99d3e2cb826dc7b6b5aafcf3ecbe3`
- Remote branch `sprint-final-acceptance-closure` was deleted.
- PR #52 local verification before merge:
  - placeholder scan: no matches, exit 0
  - `bunx tsc --noEmit --pretty false`: exit 0
  - `bun run test:scenarios`: `61 pass`, `2 skip`, `0 fail`
  - `env HOME="$(mktemp -d /tmp/mbrain-final-acceptance-test-home.XXXXXX)" bun test --timeout 60000`: `1219 pass`, `145 skip`, `0 fail`
  - `bun run build`: exit 0
  - fresh local SQLite `audit-brain-loop --json`: valid zero-activity `AuditBrainLoopReport`
  - `git diff --check`: exit 0
- PR #52 GitHub checks:
  - `test`: pass
  - `postgres-jsonb`: pass
  - `gitleaks`: pass
  - `Tier 1 (Mechanical)`: pass
  - `Tier 2 (LLM Skills)`: skipped by workflow condition
- Merge-before-review rule was satisfied:
  - final subagent critical review found no blockers and recommended merge.

## Sprint 5 Direction

Next recommended product-extension PR is **Candidate Status Events**.

Reasoning:

- The completed redesign intentionally left candidate creation/rejection in
  `audit_brain_loop` as approximate.
- Current audit counts candidate creation from `memory_candidate_entries.created_at`
  and rejection from `reviewed_at`.
- Because candidate lifecycle transitions can happen across multiple agent
  interactions, adding a single `interaction_id` column to
  `memory_candidate_entries` would be incorrect.
- An append-only `memory_candidate_status_events` table is the correct
  foundation before dashboards, cron audit runners, retention/pruning, or
  active-only compliance.

## Files Changed So Far

Only one new design spec exists and is currently untracked:

- `docs/superpowers/specs/2026-04-25-mbrain-sprint-5-candidate-status-events-design.md`

No implementation code has been changed yet.

Current `git status --short --branch` in the Sprint 5 worktree:

```text
## sprint-5-candidate-status-events...origin/master
?? docs/superpowers/specs/2026-04-25-mbrain-sprint-5-candidate-status-events-design.md
```

## Baseline Verification Already Run In Sprint 5 Worktree

Run from:

```bash
cd /Users/meghendra/Work/mbrain/.worktrees/sprint-5-candidate-status-events
```

Commands and results:

```bash
bunx tsc --noEmit --pretty false
```

Result: exit 0, no output.

```bash
bun run test:scenarios
```

Result:

```text
61 pass
2 skip
0 fail
210 expect() calls
Ran 63 tests across 21 files.
```

## Design Spec Summary

Spec path:

```text
docs/superpowers/specs/2026-04-25-mbrain-sprint-5-candidate-status-events-design.md
```

Core design:

- Add migration 25 with append-only `memory_candidate_status_events`.
- Record each lifecycle transition as its own event row:
  - `created`
  - `advanced`
  - `promoted`
  - `rejected`
  - `superseded`
- Include:
  - `candidate_id`
  - `scope_id`
  - `from_status`
  - `to_status`
  - `event_kind`
  - optional `interaction_id`
  - `reviewed_at`
  - `review_reason`
  - `created_at`
- Do not add `interaction_id` to `memory_candidate_entries`.
- Keep `interaction_id` as loose string identity, not FK to `retrieval_traces`.
- Backfill only a single `created` event for existing candidate rows; do not
  invent historical advance/promote/reject/supersede events.
- Record events in service-level lifecycle flows, not raw engine status update
  calls.
- Update `audit_brain_loop` to include precise
  `candidate_status_events` counts while preserving old `approximate` report
  shape for backward compatibility.

Explicit non-goals:

- No dashboard.
- No scheduled audit/cron runner.
- No pruning, TTL, retention, or archival policy.
- No active-only task compliance.
- No AST-aware code verification.
- No full historical reconstruction from old mutable candidate rows.

## Important Review State

A subagent critical design review was started:

- Agent id: `019dc328-f91d-7023-b1c4-dc1bf273bb01`
- Nickname: `McClintock`
- Task: review the new Sprint 5 design spec.
- Status: the user interrupted the turn before it completed.
- The agent was then closed; notification showed `shutdown`.
- Result: **no completed review findings are available**.

The next session should re-run a fresh critical subagent review before turning
the design into an implementation plan.

## Next Steps For New Session

1. Resume in the Sprint 5 worktree:

```bash
cd /Users/meghendra/Work/mbrain/.worktrees/sprint-5-candidate-status-events
```

2. Re-read the design spec:

```bash
sed -n '1,320p' docs/superpowers/specs/2026-04-25-mbrain-sprint-5-candidate-status-events-design.md
```

3. Run quick local checks:

```bash
rg -n "TBD|TODO|implement later|fill in|placeholder" docs/superpowers/specs/2026-04-25-mbrain-sprint-5-candidate-status-events-design.md
git diff --check
git status --short --branch
```

4. Spawn a fresh subagent to critically review the design spec.

Review prompt recommendation:

```text
Review docs/superpowers/specs/2026-04-25-mbrain-sprint-5-candidate-status-events-design.md.
Do not edit files. Critically assess whether the design is technically sound
for the existing mbrain codebase. Focus on migration safety, engine parity,
service-level event recording vs raw engine triggers, audit/filter semantics,
backward-compatible report shape, and scope control. Return severity-ordered
findings with file/line references. If no blockers, state that explicitly.
```

5. Evaluate review findings:

- Treat review as hypotheses, not commands.
- Fix valid design issues in the spec.
- If changes are made, rerun placeholder scan and `git diff --check`.

6. Commit the approved design spec before implementation planning:

```bash
git add docs/superpowers/specs/2026-04-25-mbrain-sprint-5-candidate-status-events-design.md HANDOFF.md
git diff --cached --check
git commit -m "docs: design candidate status event log"
```

7. Use `superpowers:writing-plans` to create:

```text
docs/superpowers/plans/2026-04-25-mbrain-sprint-5-candidate-status-events-plan.md
```

8. Only after the plan exists, begin implementation with TDD:

- migration/schema tests first
- engine event API tests
- service transition event tests
- audit precise-count tests
- scenario S21
- operation/CLI read-only list tests

## Likely Implementation Files

Expected code areas:

- `src/core/types.ts`
- `src/core/engine.ts`
- `src/core/migrate.ts`
- `src/core/sqlite-engine.ts`
- `src/core/pglite-engine.ts`
- `src/core/postgres-engine.ts`
- `src/core/services/memory-inbox-service.ts`
- `src/core/services/memory-inbox-promotion-service.ts`
- `src/core/services/memory-inbox-supersession-service.ts`
- `src/core/services/memory-inbox-contradiction-service.ts`
- `src/core/services/brain-loop-audit-service.ts`
- operation registry/domain files for memory inbox operations
- `test/memory-inbox-schema.test.ts`
- `test/memory-inbox-service.test.ts`
- `test/memory-inbox-operations.test.ts`
- `test/brain-loop-audit-service.test.ts`
- new `test/scenarios/s21-candidate-status-events-audit.test.ts`
- `test/scenarios/README.md`
- `docs/MBRAIN_VERIFY.md`

## Merge Rule Reminder

Before merging any PR:

- Run a critical subagent review.
- Verify each review finding against the codebase.
- Fix all valid findings.
- Run local verification.
- Wait for GitHub checks.
- Run one final pre-merge subagent review if any code changed after the last
  review.
- Merge only after checks and review are clean.
