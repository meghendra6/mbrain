# MBrain Stop Hook — Design Spec

**Date:** 2026-04-17
**Status:** Approved, awaiting implementation plan
**Scope:** User-global Claude Code configuration (`~/.claude/`)
**Target:** Make Claude Code reliably update mbrain with session knowledge

---

## Problem

The user installed mbrain and the `MBRAIN_AGENT_RULES.md` are injected into every session via `~/.claude/CLAUDE.md`. The rules describe a Brain-Agent Loop that requires reading mbrain before answering and writing new facts back. In practice the agent does not follow through — a concrete example is a brain page for a currently active project that contains only frontmatter (no body) despite the user having actively worked on that topic across multiple sessions.

**Diagnosis:**
- `~/.claude/hooks/hooks.json` contains no mbrain-related hook.
- Rules in CLAUDE.md are prose instructions with no enforcement mechanism.
- The agent silently skips the WRITE half of the Brain-Agent Loop.

## Goal

Ensure that at the end of every relevant Claude Code session, the agent either
(a) writes the session's new knowledge back to mbrain, or
(b) explicitly justifies skipping (`MBRAIN-PASS: <reason>`).

## Non-goals

- Writing to mbrain mid-session or after every turn (too noisy).
- Running a background daemon / cron job (rejected — unnecessary complexity).
- Automating entity extraction in the hook itself (the agent already has the session context and is the right place to decide).
- Fixing existing empty or stale brain pages (separate task — data-debt cleanup, not enforcement design).

---

## Architecture

```
[Session end signal]
        │
        ▼
[Stop hook: stop-mbrain-check.sh]
        │
  ┌─────┴─────┐
  │ Re-entry  │  flag exists → exit 0
  │   guard   │
  └─────┬─────┘
        │
  ┌─────┴─────┐
  │ Relevance │  not relevant → exit 0
  │   gate    │
  └─────┬─────┘
        │ relevant
        ▼
  touch flag file
        │
        ▼
  stdout JSON: { "decision": "block", "reason": "<brain-write prompt>" }
        │
        ▼
[Agent runs one more turn]
  ├─ Re-examine session for entities (per MBRAIN_AGENT_RULES §3)
  ├─ mbrain search / get existing pages
  ├─ put_page with compiled truth + timeline + back-links
  ├─ mbrain sync_brain (no_pull: true, no_embed: true)
  └─ or emit "MBRAIN-PASS: <reason>" if nothing to write
        │
        ▼
[Stop hook fires again]
        │
        ▼
  Re-entry guard sees flag → exit 0
        │
        ▼
     [Session ends]
```

**Key invariants:**
- The hook itself makes no LLM calls — it is fast and deterministic.
- The agent performs all brain writes (it has session context and mbrain MCP tools).
- The re-entry flag prevents infinite Stop-hook loops.
- `MBRAIN-PASS:` prefix is a documented protocol the hook may later inspect.

## Components

| Path | Type | Responsibility |
|---|---|---|
| `~/.claude/scripts/hooks/stop-mbrain-check.sh` | new | Stop-hook entrypoint; re-entry guard; orchestrates relevance gate and block decision |
| `~/.claude/scripts/hooks/lib/mbrain-relevance.sh` | new | Decides whether the current CWD / session warrants a brain write check |
| `~/.claude/scripts/hooks/state/mbrain-session-<id>.flag` | runtime artifact | Per-session marker that the hook already fired once |
| `~/.claude/hooks/hooks.json` | modified | Registers the new Stop hook alongside existing hooks |
| `~/.claude/logs/mbrain-stop-hook.log` | runtime artifact | Append-only log of hook decisions for observability |

**Explicitly NOT built (YAGNI):**
- No separate daemon, systemd unit, or cron job.
- No dedicated slash command for manual trigger (can add later if needed).
- No session transcript cache (the agent already has access to the transcript).
- No LLM client library in the hook (hook does no LLM calls).

### Relevance gate logic (initial heuristic)

1. If `$CLAUDE_PROJECT_DIR` or `$PWD` is listed in `~/.claude/mbrain-skip-dirs` → not relevant.
2. If environment variable `MBRAIN_STOP_HOOK=0` → not relevant (kill switch).
3. If `mbrain` CLI is not installed or not on PATH → not relevant (fail-closed in this one case to avoid surprising errors).
4. If `mbrain search --path-hint "$PWD"` (or a grep fallback over `brain/`) returns any hit within the last 30 days → relevant.
5. If CWD is registered in agent memory as a tracked project → relevant.
6. If none of the above decide → **fail-open as relevant**. Agent has the final say via `MBRAIN-PASS`.

Heuristic starts loose. Two-week operating log will drive tightening.

## Data flow

Timing budget for the full cycle (target):

| Step | Time |
|---|---|
| Re-entry flag check | < 5 ms |
| Relevance gate | < 100 ms |
| Stdout JSON emit | < 5 ms |
| Agent's extra turn (LLM + mbrain tool calls) | 2 – 10 s (LLM-bound) |
| `put_page` + `sync_brain --no-embed --no-pull` | < 500 ms (local file + lightweight index) |
| Second Stop-hook fire (flag present) | < 5 ms |

Total perceived delay: one LLM turn beyond normal session end. mbrain operations themselves are not the bottleneck.

Embeddings are refreshed out of band via `mbrain embed --stale` (existing mechanism), not during the hook.

## Error handling

The hook MUST NOT break a session. All failure modes funnel to `exit 0` unless the failure itself is a loud bug the user should see.

| # | Failure | Behavior |
|---|---|---|
| 1 | Hook script syntax / runtime error | stderr warning, `exit 0` |
| 2 | Relevance judgement fails (DB down, etc.) | **fail-open** → block. Agent decides. |
| 3 | Flag file can't be created | stderr warning, `exit 0` (do not block without a safety net) |
| 4 | Agent emits neither `MBRAIN-PASS` nor a write | Flag exists → second Stop passes through. Logged for later review. |
| 5 | `put_page` fails inside agent | Agent surfaces the error to the user. Not the hook's concern. |
| 6 | `sync_brain` fails | Agent warns; session still ends. `mbrain doctor` recovers later. |
| 7 | Stale flag files accumulate | Files are tiny and per-session. No cleanup in v1. Optional `find -mtime +30 -delete` cron can be added later. |
| 8 | Hook too slow (> ~500 ms for gate) | Internal timeout → `exit 0`. |
| 9 | User wants to disable hook | `MBRAIN_STOP_HOOK=0` env var → immediate `exit 0`. |

### Logging

Append one line per invocation to `~/.claude/logs/mbrain-stop-hook.log`:

```
<ISO8601> <session-id> <decision: block|pass|skip|error> <reason>
```

No rotation required — rough sizing: one line per session, a few hundred sessions/year, ≪ 1 MB/year.

## Testing

### Unit tests (bats)

`test/hooks/stop-mbrain-check.bats`:
- Re-entry flag present → `exit 0`, no stdout.
- Relevance gate: CWD in skip list → `exit 0`.
- Relevance gate: `MBRAIN_STOP_HOOK=0` → `exit 0`.
- Relevance gate: `mbrain` missing on PATH → `exit 0` (documented exception).
- Relevance gate: recent brain hit for CWD → emits `decision: "block"` JSON.
- Block path: flag file created.
- Stderr warnings do not alter exit code.

`test/hooks/mbrain-relevance.bats`:
- `mbrain search --path-hint` output parsed correctly.
- Skip-dir wildcard matching.
- Fallback grep path when `--path-hint` is unsupported.

### Integration test

`scripts/test-mbrain-hook.sh`:
1. Create tmp dir, set `CLAUDE_SESSION_ID=test-<rand>`.
2. Run hook with stubbed `mbrain` binary.
3. Assert stdout / stderr / exit code / flag file for each scenario.
4. Run twice in a row → confirm re-entry guard.

### End-to-end (manual)

- Substantive work session on a tracked project entity → observe agent write to the corresponding brain page at end.
- Read-only Q&A session ("what does `ls` do?") → observe `MBRAIN-PASS: read-only question`.
- `/tmp` scratch session → relevance gate skips, hook exits silently.

### Success criteria

- Within two weeks of running:
  - ≥ 1 timeline entry added to the relevant brain page(s) per substantive work session on a tracked project entity.
  - Pass/block ratio between roughly 30–70% block (signal that the gate is neither too loose nor too tight).
  - Zero user-facing session failures attributable to the hook.

## Out of scope (for this spec)

- Entity-detection prompt quality improvements in `MBRAIN_AGENT_RULES.md` — separate effort.
- Retroactive bootstrap of empty / stale brain pages — data-debt cleanup, separate task.
- Per-project hook scoping — user-global is intentional; `~/.claude/mbrain-skip-dirs` handles opt-outs.
- Automatic embedding regeneration during hook — handled by existing batch job.

## Open questions

None blocking. Tuning questions (gate aggressiveness, skip-dir defaults) will be answered empirically from the two-week log.
