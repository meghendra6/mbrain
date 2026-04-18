# MBrain Stop Hook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install a Stop hook in `~/.claude/` that forces the Claude Code agent to write back session-derived knowledge to mbrain at the end of each relevant session, or explicitly justify skipping.

**Architecture:** Single bash Stop hook entrypoint (`stop-mbrain-check.sh`) with a small sourced library (`lib/mbrain-relevance.sh`) for the relevance gate. No LLM calls in the hook; all brain writes are performed by the agent itself during a block-induced extra turn. Re-entry is guarded by Claude Code's native `stop_hook_active` stdin field (cleaner than the flag-file approach noted in the spec — still deterministic, no leftover state). Tests are plain bash assertion scripts (bats not installed; avoids a new dependency).

**Tech Stack:** bash 5, jq 1.6, existing `mbrain` CLI, Claude Code hooks protocol.

**Spec:** `~/.claude/docs/superpowers/specs/2026-04-17-mbrain-stop-hook-design.md`

**Design refinement vs. spec:** The spec described a flag-file-based re-entry guard. Claude Code's Stop-hook stdin JSON includes a `stop_hook_active` boolean that exists exactly for this purpose — no filesystem state needed. We use that. Skip-dir and kill-switch logic from the spec are unchanged. We omit the "recent brain search hit" and "agent-memory lookup" relevance rules in v1 (both were speculative; the 3 simple rules + fail-open default satisfy the spec's goal). Tests use bash assertion scripts instead of bats since bats is not installed.

---

## File structure

```
~/.claude/
├── scripts/hooks/
│   ├── stop-mbrain-check.sh              # NEW: hook entrypoint
│   ├── lib/
│   │   └── mbrain-relevance.sh           # NEW: relevance gate lib
│   └── test/
│       ├── _assert.sh                    # NEW: tiny test helper
│       ├── test_mbrain_relevance.sh      # NEW: unit tests for lib
│       ├── test_stop_mbrain_check.sh     # NEW: unit tests for hook
│       └── e2e_smoke.sh                  # NEW: end-to-end smoke test
├── hooks/hooks.json                      # MODIFY: register Stop hook
├── mbrain-skip-dirs                      # NEW: optional opt-out list
└── logs/
    └── mbrain-stop-hook.log              # runtime artifact (auto-created)
```

Each file has a single responsibility: `lib/mbrain-relevance.sh` decides relevance (no I/O beyond reading the skip-dir file), `stop-mbrain-check.sh` orchestrates hook protocol (stdin → decision JSON + logging), `test/*.sh` validate behavior with no external dependencies beyond bash + jq.

---

### Task 1: Scaffolding and test helper

**Files:**
- Create: `~/.claude/scripts/hooks/lib/` (directory)
- Create: `~/.claude/scripts/hooks/test/` (directory)
- Create: `~/.claude/scripts/hooks/test/_assert.sh`
- Create: `~/.claude/scripts/hooks/test/smoke_test.sh`

- [ ] **Step 1: Create directories**

```bash
mkdir -p ~/.claude/scripts/hooks/lib ~/.claude/scripts/hooks/test ~/.claude/logs
```

- [ ] **Step 2: Write the assertion helper**

Create `~/.claude/scripts/hooks/test/_assert.sh`:

```bash
#!/bin/bash
# Minimal test helper. No dependencies. Source this in test scripts.

TESTS_PASSED=0
TESTS_FAILED=0

assert_eq() {
  local got="$1"
  local exp="$2"
  local msg="${3:-assert_eq}"
  if [ "$got" = "$exp" ]; then
    TESTS_PASSED=$((TESTS_PASSED + 1))
    printf 'PASS %s\n' "$msg"
  else
    TESTS_FAILED=$((TESTS_FAILED + 1))
    printf 'FAIL %s\n  got:      %q\n  expected: %q\n' "$msg" "$got" "$exp" >&2
  fi
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  local msg="${3:-assert_contains}"
  case "$haystack" in
    *"$needle"*)
      TESTS_PASSED=$((TESTS_PASSED + 1))
      printf 'PASS %s\n' "$msg"
      ;;
    *)
      TESTS_FAILED=$((TESTS_FAILED + 1))
      printf 'FAIL %s\n  haystack: %q\n  needle:   %q\n' "$msg" "$haystack" "$needle" >&2
      ;;
  esac
}

assert_summary() {
  printf '\n---\nPassed: %d  Failed: %d\n' "$TESTS_PASSED" "$TESTS_FAILED"
  [ "$TESTS_FAILED" -eq 0 ]
}
```

- [ ] **Step 3: Write a smoke test that proves the helper works**

Create `~/.claude/scripts/hooks/test/smoke_test.sh`:

```bash
#!/bin/bash
set -u
source "$(dirname "$0")/_assert.sh"

assert_eq "hello" "hello" "trivial equality"
assert_contains "the quick brown fox" "quick" "trivial contains"

assert_summary
```

- [ ] **Step 4: Run smoke test to verify infrastructure works**

```bash
chmod +x ~/.claude/scripts/hooks/test/smoke_test.sh
bash ~/.claude/scripts/hooks/test/smoke_test.sh
echo "EXIT=$?"
```

Expected:
```
PASS trivial equality
PASS trivial contains

---
Passed: 2  Failed: 0
EXIT=0
```

- [ ] **Step 5: Commit**

```bash
cd ~/.claude
git add scripts/hooks/test/_assert.sh scripts/hooks/test/smoke_test.sh
git commit -m "chore(hooks): add test helper for mbrain stop hook"
```

---

### Task 2: Relevance lib — kill switch (`MBRAIN_STOP_HOOK=0`)

**Files:**
- Create: `~/.claude/scripts/hooks/lib/mbrain-relevance.sh`
- Create: `~/.claude/scripts/hooks/test/test_mbrain_relevance.sh`

- [ ] **Step 1: Write the failing test**

Create `~/.claude/scripts/hooks/test/test_mbrain_relevance.sh`:

```bash
#!/bin/bash
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/_assert.sh"
source "$HERE/../lib/mbrain-relevance.sh"

# --- kill switch --------------------------------------------------------
test_kill_switch_explicit_zero() {
  ( MBRAIN_STOP_HOOK=0 PWD="/tmp/whatever" mbrain_is_relevant )
  assert_eq "$?" 1 "MBRAIN_STOP_HOOK=0 -> not relevant (rc=1)"
}

test_kill_switch_explicit_zero

assert_summary
```

- [ ] **Step 2: Run to confirm it fails**

```bash
chmod +x ~/.claude/scripts/hooks/test/test_mbrain_relevance.sh
bash ~/.claude/scripts/hooks/test/test_mbrain_relevance.sh
```

Expected: either `source` error (file does not exist) or FAIL line.

- [ ] **Step 3: Write minimal implementation**

Create `~/.claude/scripts/hooks/lib/mbrain-relevance.sh`:

```bash
# mbrain-relevance.sh
#
# Exposes: mbrain_is_relevant
#   rc=0 -> relevant (the Stop hook should block and prompt the agent)
#   rc=1 -> not relevant (the Stop hook should pass through without blocking)
#
# Inputs: $PWD, env vars, optional ~/.claude/mbrain-skip-dirs
# No stdout output on the happy path; stderr only for loud errors.

mbrain_is_relevant() {
  # Rule 1: explicit kill switch.
  if [ "${MBRAIN_STOP_HOOK:-1}" = "0" ]; then
    return 1
  fi

  # Fail-open default (rules 2 and 3 added in later tasks).
  return 0
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
bash ~/.claude/scripts/hooks/test/test_mbrain_relevance.sh
```

Expected:
```
PASS MBRAIN_STOP_HOOK=0 -> not relevant (rc=1)

---
Passed: 1  Failed: 0
```

- [ ] **Step 5: Commit**

```bash
cd ~/.claude
git add scripts/hooks/lib/mbrain-relevance.sh scripts/hooks/test/test_mbrain_relevance.sh
git commit -m "feat(hooks): add mbrain relevance gate with kill switch"
```

---

### Task 3: Relevance lib — skip-dirs file

**Files:**
- Modify: `~/.claude/scripts/hooks/lib/mbrain-relevance.sh`
- Modify: `~/.claude/scripts/hooks/test/test_mbrain_relevance.sh`
- Create: `~/.claude/mbrain-skip-dirs` (empty sentinel file shipped with example comments)

- [ ] **Step 1: Add failing tests for skip-dir behavior**

Append to `~/.claude/scripts/hooks/test/test_mbrain_relevance.sh` (before `assert_summary`):

```bash
# --- skip dirs ----------------------------------------------------------
test_skip_dirs_exact_match() {
  local tmpdir
  tmpdir="$(mktemp -d)"
  local skipfile="$tmpdir/skip"
  printf '%s\n' "$tmpdir" > "$skipfile"

  ( PWD="$tmpdir" MBRAIN_SKIP_DIRS_FILE="$skipfile" mbrain_is_relevant )
  assert_eq "$?" 1 "skip-dirs exact match -> not relevant"

  rm -rf "$tmpdir"
}

test_skip_dirs_commented_line_ignored() {
  local tmpdir
  tmpdir="$(mktemp -d)"
  local skipfile="$tmpdir/skip"
  printf '# %s\n' "$tmpdir" > "$skipfile"   # leading # means comment

  ( PWD="$tmpdir" MBRAIN_SKIP_DIRS_FILE="$skipfile" mbrain_is_relevant )
  assert_eq "$?" 0 "commented skip line -> relevant (fail-open)"

  rm -rf "$tmpdir"
}

test_skip_dirs_empty_file() {
  local tmpdir
  tmpdir="$(mktemp -d)"
  local skipfile="$tmpdir/skip"
  : > "$skipfile"

  ( PWD="$tmpdir" MBRAIN_SKIP_DIRS_FILE="$skipfile" mbrain_is_relevant )
  assert_eq "$?" 0 "empty skip file -> relevant (fail-open)"

  rm -rf "$tmpdir"
}

test_skip_dirs_missing_file() {
  ( PWD="/tmp" MBRAIN_SKIP_DIRS_FILE="/nonexistent/skip" mbrain_is_relevant )
  assert_eq "$?" 0 "missing skip file -> relevant (fail-open)"
}

test_skip_dirs_exact_match
test_skip_dirs_commented_line_ignored
test_skip_dirs_empty_file
test_skip_dirs_missing_file
```

- [ ] **Step 2: Run to confirm the new tests fail**

```bash
bash ~/.claude/scripts/hooks/test/test_mbrain_relevance.sh
```

Expected: kill-switch test still passes; new skip-dir tests either pass accidentally (the function returns 0 by default) or fail on the "exact match -> not relevant" test specifically.

- [ ] **Step 3: Implement skip-dirs logic**

Replace `~/.claude/scripts/hooks/lib/mbrain-relevance.sh` with:

```bash
# mbrain-relevance.sh
#
# Exposes: mbrain_is_relevant
#   rc=0 -> relevant
#   rc=1 -> not relevant
#
# Inputs: $PWD, env vars, optional skip-dirs file
#   MBRAIN_STOP_HOOK       : "0" = kill switch
#   MBRAIN_SKIP_DIRS_FILE  : path to skip-dirs file (default: ~/.claude/mbrain-skip-dirs)
#
# Skip-dirs file format: one absolute path per line. Blank lines and lines
# starting with '#' are ignored. Exact match only (no wildcards in v1).

_mbrain_skip_dir_match() {
  local cwd="$1"
  local file="$2"
  [ -f "$file" ] || return 1

  # Read line-by-line, skip blanks/comments, exact-match $cwd.
  while IFS= read -r line || [ -n "$line" ]; do
    # Trim leading whitespace only (preserve path contents).
    line="${line#"${line%%[![:space:]]*}"}"
    case "$line" in
      ''|'#'*) continue ;;
    esac
    if [ "$line" = "$cwd" ]; then
      return 0
    fi
  done < "$file"

  return 1
}

mbrain_is_relevant() {
  # Rule 1: explicit kill switch.
  if [ "${MBRAIN_STOP_HOOK:-1}" = "0" ]; then
    return 1
  fi

  # Rule 2: CWD in skip-dirs file.
  local skipfile="${MBRAIN_SKIP_DIRS_FILE:-$HOME/.claude/mbrain-skip-dirs}"
  if _mbrain_skip_dir_match "${PWD:-$(pwd)}" "$skipfile"; then
    return 1
  fi

  # Fail-open default (rule 3 added in later task).
  return 0
}
```

- [ ] **Step 4: Create the shipped skip-dirs template**

Create `~/.claude/mbrain-skip-dirs`:

```
# mbrain Stop-hook skip list (v1: exact absolute paths, one per line)
#
# Add directories where you don't want the Stop hook to ask the agent to
# write to mbrain — e.g., scratch / throwaway work.
#
# Example:
# /tmp/throwaway-experiment
# /home/me/scratch
```

- [ ] **Step 5: Run all tests and verify pass**

```bash
bash ~/.claude/scripts/hooks/test/test_mbrain_relevance.sh
```

Expected:
```
PASS MBRAIN_STOP_HOOK=0 -> not relevant (rc=1)
PASS skip-dirs exact match -> not relevant
PASS commented skip line -> relevant (fail-open)
PASS empty skip file -> relevant (fail-open)
PASS missing skip file -> relevant (fail-open)

---
Passed: 5  Failed: 0
```

- [ ] **Step 6: Commit**

```bash
cd ~/.claude
git add scripts/hooks/lib/mbrain-relevance.sh scripts/hooks/test/test_mbrain_relevance.sh mbrain-skip-dirs
git commit -m "feat(hooks): add skip-dirs rule to mbrain relevance gate"
```

---

### Task 4: Relevance lib — missing `mbrain` CLI (fail-closed exception)

**Files:**
- Modify: `~/.claude/scripts/hooks/lib/mbrain-relevance.sh`
- Modify: `~/.claude/scripts/hooks/test/test_mbrain_relevance.sh`

- [ ] **Step 1: Write the failing tests**

Append to `~/.claude/scripts/hooks/test/test_mbrain_relevance.sh` (before `assert_summary`):

```bash
# --- mbrain CLI availability ------------------------------------------
test_mbrain_cli_missing() {
  # Strip PATH so `command -v mbrain` fails.
  ( PATH="/nonexistent" PWD="/tmp" mbrain_is_relevant )
  assert_eq "$?" 1 "mbrain CLI not on PATH -> not relevant (documented exception)"
}

test_mbrain_cli_missing
```

- [ ] **Step 2: Run to confirm it fails**

```bash
bash ~/.claude/scripts/hooks/test/test_mbrain_relevance.sh
```

Expected: the new test FAILs (current impl returns 0).

- [ ] **Step 3: Implement the check**

In `~/.claude/scripts/hooks/lib/mbrain-relevance.sh`, extend `mbrain_is_relevant` so the full function reads:

```bash
mbrain_is_relevant() {
  # Rule 1: explicit kill switch.
  if [ "${MBRAIN_STOP_HOOK:-1}" = "0" ]; then
    return 1
  fi

  # Rule 2: CWD in skip-dirs file.
  local skipfile="${MBRAIN_SKIP_DIRS_FILE:-$HOME/.claude/mbrain-skip-dirs}"
  if _mbrain_skip_dir_match "${PWD:-$(pwd)}" "$skipfile"; then
    return 1
  fi

  # Rule 3: mbrain CLI missing -> documented exception, fail-closed.
  # We don't ask the agent to write to a brain the user hasn't installed.
  if ! command -v mbrain >/dev/null 2>&1; then
    return 1
  fi

  # Fail-open default.
  return 0
}
```

- [ ] **Step 4: Run all tests**

```bash
bash ~/.claude/scripts/hooks/test/test_mbrain_relevance.sh
```

Expected: 6 PASS, 0 FAIL.

- [ ] **Step 5: Commit**

```bash
cd ~/.claude
git add scripts/hooks/lib/mbrain-relevance.sh scripts/hooks/test/test_mbrain_relevance.sh
git commit -m "feat(hooks): skip mbrain prompt when CLI is missing"
```

---

### Task 5: Relevance lib — fail-open default test pin

**Files:**
- Modify: `~/.claude/scripts/hooks/test/test_mbrain_relevance.sh`

(This task has no production code change — it pins the default behavior with an explicit regression test so future edits don't accidentally flip the default to fail-closed.)

- [ ] **Step 1: Add the fail-open test**

Append to `~/.claude/scripts/hooks/test/test_mbrain_relevance.sh` (before `assert_summary`):

```bash
# --- default fail-open -------------------------------------------------
test_default_fail_open() {
  local tmpdir
  tmpdir="$(mktemp -d)"
  ( PWD="$tmpdir" \
    MBRAIN_SKIP_DIRS_FILE="/nonexistent" \
    PATH="$PATH" \
    mbrain_is_relevant )
  assert_eq "$?" 0 "no disqualifying signal -> relevant (fail-open default)"
  rm -rf "$tmpdir"
}

test_default_fail_open
```

- [ ] **Step 2: Run**

```bash
bash ~/.claude/scripts/hooks/test/test_mbrain_relevance.sh
```

Expected: 7 PASS, 0 FAIL. (No impl change needed; current impl already satisfies this.)

- [ ] **Step 3: Commit**

```bash
cd ~/.claude
git add scripts/hooks/test/test_mbrain_relevance.sh
git commit -m "test(hooks): pin fail-open default for mbrain relevance gate"
```

---

### Task 6: Hook entrypoint — `stop_hook_active` re-entry guard

**Files:**
- Create: `~/.claude/scripts/hooks/stop-mbrain-check.sh`
- Create: `~/.claude/scripts/hooks/test/test_stop_mbrain_check.sh`

**Protocol reference:** Claude Code Stop hooks receive a JSON payload on stdin with at minimum `session_id`, `transcript_path`, and `stop_hook_active` fields. When `stop_hook_active` is `true`, the hook must NOT emit another block (Claude Code is already in a block-driven continuation and would loop). The hook should pass stdin through to stdout so downstream hooks in the chain see the same input.

- [ ] **Step 1: Write the failing test**

Create `~/.claude/scripts/hooks/test/test_stop_mbrain_check.sh`:

```bash
#!/bin/bash
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/_assert.sh"

HOOK="$HERE/../stop-mbrain-check.sh"

run_hook() {
  # $1 = stdin JSON, remaining args = env var assignments "KEY=VAL"
  local payload="$1"; shift
  local -a envs=()
  for kv in "$@"; do envs+=("$kv"); done
  env -i HOME="$HOME" PATH="$PATH" "${envs[@]}" bash "$HOOK" <<<"$payload"
}

# --- re-entry guard ---------------------------------------------------
test_reentry_passes_through() {
  local out
  out="$(run_hook '{"session_id":"s1","stop_hook_active":true}')"
  local rc=$?
  assert_eq "$rc" 0 "stop_hook_active=true -> rc 0"
  assert_contains "$out" '"session_id":"s1"' "stop_hook_active=true -> stdin piped through"
  # And no block decision in output.
  case "$out" in
    *'"decision":"block"'*)
      TESTS_FAILED=$((TESTS_FAILED + 1))
      echo "FAIL stop_hook_active=true unexpectedly emitted block" >&2
      ;;
    *)
      TESTS_PASSED=$((TESTS_PASSED + 1))
      echo "PASS stop_hook_active=true did not emit block"
      ;;
  esac
}

test_reentry_passes_through

assert_summary
```

- [ ] **Step 2: Run to confirm it fails**

```bash
chmod +x ~/.claude/scripts/hooks/test/test_stop_mbrain_check.sh
bash ~/.claude/scripts/hooks/test/test_stop_mbrain_check.sh
```

Expected: the hook file does not exist → source/exec error.

- [ ] **Step 3: Write minimal implementation**

Create `~/.claude/scripts/hooks/stop-mbrain-check.sh`:

```bash
#!/bin/bash
# stop-mbrain-check.sh
#
# Claude Code Stop hook. Reads the Stop-hook JSON from stdin and decides
# whether to (a) pass through silently or (b) emit a `decision: block` to
# force the agent to check mbrain for session knowledge that should be
# written back.
#
# Contract:
#   - Never exit non-zero on normal paths (don't break sessions).
#   - Pass stdin through to stdout on non-block paths so downstream hooks
#     in the Stop chain see the same payload.
#   - On block path, emit ONE JSON object to stdout.
#
# See: ~/.claude/docs/superpowers/specs/2026-04-17-mbrain-stop-hook-design.md

set -u  # not -e: we explicitly manage non-zero propagation.

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/mbrain-relevance.sh
source "$HOOK_DIR/lib/mbrain-relevance.sh"

# Read stdin once.
RAW_INPUT="$(cat)"

# Re-entry guard: if Claude Code is already in a stop-hook-driven
# continuation, we must not emit another block or we loop forever.
if command -v jq >/dev/null 2>&1; then
  STOP_ACTIVE="$(printf '%s' "$RAW_INPUT" | jq -r 'try .stop_hook_active // false' 2>/dev/null || printf 'false')"
else
  # jq missing -> fail safe: assume already active to avoid loops.
  STOP_ACTIVE="true"
fi

if [ "$STOP_ACTIVE" = "true" ]; then
  printf '%s' "$RAW_INPUT"
  exit 0
fi

# Placeholder: later tasks add relevance gate + block emission + logging.
printf '%s' "$RAW_INPUT"
exit 0
```

- [ ] **Step 4: Run to verify it passes**

```bash
chmod +x ~/.claude/scripts/hooks/stop-mbrain-check.sh
bash ~/.claude/scripts/hooks/test/test_stop_mbrain_check.sh
```

Expected:
```
PASS stop_hook_active=true -> rc 0
PASS stop_hook_active=true -> stdin piped through
PASS stop_hook_active=true did not emit block

---
Passed: 3  Failed: 0
```

- [ ] **Step 5: Commit**

```bash
cd ~/.claude
git add scripts/hooks/stop-mbrain-check.sh scripts/hooks/test/test_stop_mbrain_check.sh
git commit -m "feat(hooks): add mbrain stop-hook skeleton with re-entry guard"
```

---

### Task 7: Hook entrypoint — relevance gate + block emission

**Files:**
- Modify: `~/.claude/scripts/hooks/stop-mbrain-check.sh`
- Modify: `~/.claude/scripts/hooks/test/test_stop_mbrain_check.sh`

- [ ] **Step 1: Add failing tests for gate + block**

Append to `~/.claude/scripts/hooks/test/test_stop_mbrain_check.sh` (before `assert_summary`):

```bash
# --- not relevant -> pass through --------------------------------------
test_not_relevant_passes_through() {
  local out
  out="$(run_hook '{"session_id":"s2","stop_hook_active":false}' "MBRAIN_STOP_HOOK=0")"
  local rc=$?
  assert_eq "$rc" 0 "kill-switch set -> rc 0"
  assert_contains "$out" '"session_id":"s2"' "kill-switch set -> stdin piped through"
  case "$out" in
    *'"decision":"block"'*)
      TESTS_FAILED=$((TESTS_FAILED + 1))
      echo "FAIL kill-switch set unexpectedly emitted block" >&2
      ;;
    *)
      TESTS_PASSED=$((TESTS_PASSED + 1))
      echo "PASS kill-switch set did not emit block"
      ;;
  esac
}

# --- relevant -> emit block --------------------------------------------
test_relevant_emits_block() {
  local out
  # Use real mbrain on PATH, no skip-dir match, no kill switch.
  out="$(run_hook '{"session_id":"s3","stop_hook_active":false}')"
  local rc=$?
  assert_eq "$rc" 0 "relevant -> rc 0"
  assert_contains "$out" '"decision":"block"' "relevant -> block decision in stdout"
  assert_contains "$out" "MBRAIN_AGENT_RULES" "block reason references MBRAIN_AGENT_RULES"
  assert_contains "$out" "MBRAIN-PASS" "block reason documents the PASS escape hatch"
}

test_not_relevant_passes_through
test_relevant_emits_block
```

- [ ] **Step 2: Run to confirm the new tests fail**

```bash
bash ~/.claude/scripts/hooks/test/test_stop_mbrain_check.sh
```

Expected: re-entry tests still pass; new tests FAIL (hook always pass-through today).

- [ ] **Step 3: Implement relevance gate + block emission**

Replace `~/.claude/scripts/hooks/stop-mbrain-check.sh` with:

```bash
#!/bin/bash
# stop-mbrain-check.sh
#
# Claude Code Stop hook. See task 6 header for contract.
# Spec: ~/.claude/docs/superpowers/specs/2026-04-17-mbrain-stop-hook-design.md

set -u

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/mbrain-relevance.sh
source "$HOOK_DIR/lib/mbrain-relevance.sh"

RAW_INPUT="$(cat)"

# --- re-entry guard ---------------------------------------------------
if command -v jq >/dev/null 2>&1; then
  STOP_ACTIVE="$(printf '%s' "$RAW_INPUT" | jq -r 'try .stop_hook_active // false' 2>/dev/null || printf 'false')"
else
  STOP_ACTIVE="true"
fi

if [ "$STOP_ACTIVE" = "true" ]; then
  printf '%s' "$RAW_INPUT"
  exit 0
fi

# --- relevance gate ---------------------------------------------------
if ! mbrain_is_relevant; then
  printf '%s' "$RAW_INPUT"
  exit 0
fi

# --- block emission ---------------------------------------------------
# This reason is the prompt the agent sees when Claude Code converts our
# block decision into a continuation turn. Keep it tight, actionable,
# and rule-referenced.
REASON='mbrain write check: before ending this session, review the conversation for entities (people, companies, concepts, technical systems) worth recording — per MBRAIN_AGENT_RULES.md §3. For each notable entity: mbrain search <slug> to find or create the page, append compiled truth + timeline entry with source attribution, add back-links (iron law), then mbrain sync_brain with no_pull=true and no_embed=true. If nothing in this session warrants a brain write (read-only question, trivial chore, already-written knowledge), respond with exactly: MBRAIN-PASS: <short reason>. Do not ask the user for permission — decide and act.'

# jq assembles a safe JSON object with the reason string escaped properly.
printf '%s' "$RAW_INPUT" | jq -c \
  --arg reason "$REASON" \
  '{decision: "block", reason: $reason}'

exit 0
```

- [ ] **Step 4: Run all hook tests**

```bash
bash ~/.claude/scripts/hooks/test/test_stop_mbrain_check.sh
```

Expected:
```
PASS stop_hook_active=true -> rc 0
PASS stop_hook_active=true -> stdin piped through
PASS stop_hook_active=true did not emit block
PASS kill-switch set -> rc 0
PASS kill-switch set -> stdin piped through
PASS kill-switch set did not emit block
PASS relevant -> rc 0
PASS relevant -> block decision in stdout
PASS block reason references MBRAIN_AGENT_RULES
PASS block reason documents the PASS escape hatch

---
Passed: 10  Failed: 0
```

- [ ] **Step 5: Commit**

```bash
cd ~/.claude
git add scripts/hooks/stop-mbrain-check.sh scripts/hooks/test/test_stop_mbrain_check.sh
git commit -m "feat(hooks): gate mbrain stop-hook on relevance and emit block decision"
```

---

### Task 8: Hook entrypoint — logging

**Files:**
- Modify: `~/.claude/scripts/hooks/stop-mbrain-check.sh`
- Modify: `~/.claude/scripts/hooks/test/test_stop_mbrain_check.sh`

- [ ] **Step 1: Add failing test for log line**

Append to `~/.claude/scripts/hooks/test/test_stop_mbrain_check.sh` (before `assert_summary`):

```bash
# --- logging ----------------------------------------------------------
test_logs_block_decision() {
  local logdir logfile
  logdir="$(mktemp -d)"
  logfile="$logdir/hook.log"

  local out
  out="$(env -i HOME="$HOME" PATH="$PATH" MBRAIN_STOP_HOOK_LOG="$logfile" \
         bash "$HOOK" <<<'{"session_id":"s-log-1","stop_hook_active":false}')"

  assert_contains "$(cat "$logfile")" "s-log-1" "log contains session id"
  assert_contains "$(cat "$logfile")" "block" "log contains block decision"

  rm -rf "$logdir"
}

test_logs_skip_decision() {
  local logdir logfile
  logdir="$(mktemp -d)"
  logfile="$logdir/hook.log"

  env -i HOME="$HOME" PATH="$PATH" MBRAIN_STOP_HOOK=0 MBRAIN_STOP_HOOK_LOG="$logfile" \
    bash "$HOOK" <<<'{"session_id":"s-log-2","stop_hook_active":false}' >/dev/null

  assert_contains "$(cat "$logfile")" "s-log-2" "log contains session id (skip path)"
  assert_contains "$(cat "$logfile")" "skip" "log contains skip decision"

  rm -rf "$logdir"
}

test_logs_block_decision
test_logs_skip_decision
```

- [ ] **Step 2: Run to confirm failure**

```bash
bash ~/.claude/scripts/hooks/test/test_stop_mbrain_check.sh
```

Expected: existing 10 pass, 4 new assertions FAIL (no log file written).

- [ ] **Step 3: Implement logging**

Replace `~/.claude/scripts/hooks/stop-mbrain-check.sh` with:

```bash
#!/bin/bash
# stop-mbrain-check.sh — see task 6 header.

set -u

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/mbrain-relevance.sh
source "$HOOK_DIR/lib/mbrain-relevance.sh"

LOG_FILE="${MBRAIN_STOP_HOOK_LOG:-$HOME/.claude/logs/mbrain-stop-hook.log}"

log_line() {
  local decision="$1"
  local session_id="$2"
  local reason="${3:-}"
  local ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || true
  printf '%s %s %s %s\n' "$ts" "$session_id" "$decision" "$reason" >> "$LOG_FILE" 2>/dev/null || true
}

extract_session_id() {
  local raw="$1"
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$raw" | jq -r 'try .session_id // "unknown"' 2>/dev/null || printf 'unknown'
  else
    printf 'unknown'
  fi
}

RAW_INPUT="$(cat)"
SESSION_ID="$(extract_session_id "$RAW_INPUT")"

# --- re-entry guard ---------------------------------------------------
if command -v jq >/dev/null 2>&1; then
  STOP_ACTIVE="$(printf '%s' "$RAW_INPUT" | jq -r 'try .stop_hook_active // false' 2>/dev/null || printf 'false')"
else
  STOP_ACTIVE="true"
fi

if [ "$STOP_ACTIVE" = "true" ]; then
  log_line "reentry" "$SESSION_ID" "stop_hook_active=true"
  printf '%s' "$RAW_INPUT"
  exit 0
fi

# --- relevance gate ---------------------------------------------------
if ! mbrain_is_relevant; then
  log_line "skip" "$SESSION_ID" "relevance-gate"
  printf '%s' "$RAW_INPUT"
  exit 0
fi

# --- block emission ---------------------------------------------------
REASON='mbrain write check: before ending this session, review the conversation for entities (people, companies, concepts, technical systems) worth recording — per MBRAIN_AGENT_RULES.md §3. For each notable entity: mbrain search <slug> to find or create the page, append compiled truth + timeline entry with source attribution, add back-links (iron law), then mbrain sync_brain with no_pull=true and no_embed=true. If nothing in this session warrants a brain write (read-only question, trivial chore, already-written knowledge), respond with exactly: MBRAIN-PASS: <short reason>. Do not ask the user for permission — decide and act.'

log_line "block" "$SESSION_ID" "gate-passed"

printf '%s' "$RAW_INPUT" | jq -c \
  --arg reason "$REASON" \
  '{decision: "block", reason: $reason}'

exit 0
```

- [ ] **Step 4: Run all tests**

```bash
bash ~/.claude/scripts/hooks/test/test_stop_mbrain_check.sh
bash ~/.claude/scripts/hooks/test/test_mbrain_relevance.sh
```

Expected: 14 PASS in hook tests, 7 PASS in relevance tests, 0 FAIL total.

- [ ] **Step 5: Commit**

```bash
cd ~/.claude
git add scripts/hooks/stop-mbrain-check.sh scripts/hooks/test/test_stop_mbrain_check.sh
git commit -m "feat(hooks): log mbrain stop-hook decisions to ~/.claude/logs"
```

---

### Task 9: Register the hook in `hooks.json`

**Files:**
- Modify: `~/.claude/hooks/hooks.json`

The existing `Stop` array has six entries (format-typecheck, check-console-log, session-end, evaluate-session, cost-tracker, desktop-notify). We append a seventh. Claude Code runs Stop hooks in order and pipes stdin through each one (see how existing entries all end with `process.stdout.write(raw)`). Our hook preserves that contract: it passes stdin through on skip/re-entry paths, and on block paths it emits the block JSON which is the intended terminal output.

**Ordering:** we want to run AFTER the existing `stop:session-end` and `stop:evaluate-session` hooks so their async session persistence starts first. Placing our entry LAST in the Stop array is fine — Claude Code fires them in order but async hooks don't block sync ones.

- [ ] **Step 1: Back up the current hooks.json**

```bash
cp ~/.claude/hooks/hooks.json ~/.claude/hooks/hooks.json.bak.$(date +%Y%m%d)
```

- [ ] **Step 2: Add the new entry via jq**

```bash
jq '.hooks.Stop += [{
  "matcher": "*",
  "hooks": [{
    "type": "command",
    "command": "bash \"$HOME/.claude/scripts/hooks/stop-mbrain-check.sh\"",
    "timeout": 5
  }],
  "description": "Ask agent to write session knowledge back to mbrain (blocks once, provides MBRAIN-PASS escape hatch).",
  "id": "stop:mbrain-check"
}]' ~/.claude/hooks/hooks.json > ~/.claude/hooks/hooks.json.tmp \
  && mv ~/.claude/hooks/hooks.json.tmp ~/.claude/hooks/hooks.json
```

- [ ] **Step 3: Verify JSON is still valid and entry was added**

```bash
jq '.hooks.Stop | length' ~/.claude/hooks/hooks.json
jq '.hooks.Stop[-1].id' ~/.claude/hooks/hooks.json
```

Expected:
```
7
"stop:mbrain-check"
```

- [ ] **Step 4: Smoke test the registered hook via stdin**

```bash
# Simulate a real Stop-hook payload:
printf '{"session_id":"smoke-1","stop_hook_active":false,"transcript_path":"/tmp/fake.jsonl"}' \
  | bash ~/.claude/scripts/hooks/stop-mbrain-check.sh
```

Expected: one JSON line on stdout containing `"decision":"block"` and the reason string.

```bash
# Kill switch bypass:
MBRAIN_STOP_HOOK=0 printf '{"session_id":"smoke-2","stop_hook_active":false}' \
  | bash ~/.claude/scripts/hooks/stop-mbrain-check.sh
```

Expected: stdin echoed to stdout unchanged, no block.

- [ ] **Step 5: Commit**

```bash
cd ~/.claude
git add hooks/hooks.json
git commit -m "feat(hooks): register stop:mbrain-check in Stop chain"
```

---

### Task 10: End-to-end smoke-test script

**Files:**
- Create: `~/.claude/scripts/hooks/test/e2e_smoke.sh`

- [ ] **Step 1: Write the E2E smoke script**

Create `~/.claude/scripts/hooks/test/e2e_smoke.sh`:

```bash
#!/bin/bash
# Exercises the registered mbrain Stop hook end-to-end by simulating the
# exact stdin payload Claude Code sends. Does NOT require Claude Code
# itself to be running — we invoke the hook directly.

set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/_assert.sh"

HOOK="$HOME/.claude/scripts/hooks/stop-mbrain-check.sh"

# Scenario 1: normal end-of-session -> block expected
scenario_block() {
  local payload='{"session_id":"e2e-block","stop_hook_active":false,"transcript_path":"/tmp/x"}'
  local out
  out="$(printf '%s' "$payload" | bash "$HOOK")"
  assert_contains "$out" '"decision":"block"' "E2E: normal session emits block"
  assert_contains "$out" "MBRAIN-PASS" "E2E: block reason mentions PASS escape"
}

# Scenario 2: re-entry (Claude Code already in continuation) -> pass-through
scenario_reentry() {
  local payload='{"session_id":"e2e-reentry","stop_hook_active":true}'
  local out
  out="$(printf '%s' "$payload" | bash "$HOOK")"
  assert_contains "$out" '"session_id":"e2e-reentry"' "E2E: re-entry pipes stdin"
  case "$out" in
    *'"decision":"block"'*)
      TESTS_FAILED=$((TESTS_FAILED + 1))
      echo "FAIL E2E: re-entry unexpectedly emitted block" >&2
      ;;
    *)
      TESTS_PASSED=$((TESTS_PASSED + 1))
      echo "PASS E2E: re-entry did not emit block"
      ;;
  esac
}

# Scenario 3: kill switch -> pass-through
scenario_kill_switch() {
  local payload='{"session_id":"e2e-kill","stop_hook_active":false}'
  local out
  out="$(MBRAIN_STOP_HOOK=0 printf '%s' "$payload" | MBRAIN_STOP_HOOK=0 bash "$HOOK")"
  assert_contains "$out" '"session_id":"e2e-kill"' "E2E: kill switch pipes stdin"
  case "$out" in
    *'"decision":"block"'*)
      TESTS_FAILED=$((TESTS_FAILED + 1))
      echo "FAIL E2E: kill switch unexpectedly emitted block" >&2
      ;;
    *)
      TESTS_PASSED=$((TESTS_PASSED + 1))
      echo "PASS E2E: kill switch did not emit block"
      ;;
  esac
}

# Scenario 4: skip-dir opt-out -> pass-through
scenario_skip_dir() {
  local tmpdir skipfile
  tmpdir="$(mktemp -d)"
  skipfile="$tmpdir/skip"
  printf '%s\n' "$tmpdir" > "$skipfile"

  local payload='{"session_id":"e2e-skipdir","stop_hook_active":false}'
  local out
  out="$(cd "$tmpdir" && MBRAIN_SKIP_DIRS_FILE="$skipfile" printf '%s' "$payload" \
         | MBRAIN_SKIP_DIRS_FILE="$skipfile" bash "$HOOK")"

  case "$out" in
    *'"decision":"block"'*)
      TESTS_FAILED=$((TESTS_FAILED + 1))
      echo "FAIL E2E: skip-dir unexpectedly emitted block" >&2
      ;;
    *)
      TESTS_PASSED=$((TESTS_PASSED + 1))
      echo "PASS E2E: skip-dir did not emit block"
      ;;
  esac

  rm -rf "$tmpdir"
}

# Scenario 5: log line produced on block
scenario_log_written() {
  local logdir logfile
  logdir="$(mktemp -d)"
  logfile="$logdir/hook.log"

  MBRAIN_STOP_HOOK_LOG="$logfile" printf '%s' '{"session_id":"e2e-log","stop_hook_active":false}' \
    | MBRAIN_STOP_HOOK_LOG="$logfile" bash "$HOOK" >/dev/null

  assert_contains "$(cat "$logfile" 2>/dev/null)" "e2e-log" "E2E: log records session id"
  assert_contains "$(cat "$logfile" 2>/dev/null)" "block"   "E2E: log records block decision"

  rm -rf "$logdir"
}

scenario_block
scenario_reentry
scenario_kill_switch
scenario_skip_dir
scenario_log_written

assert_summary
```

- [ ] **Step 2: Run the E2E smoke**

```bash
chmod +x ~/.claude/scripts/hooks/test/e2e_smoke.sh
bash ~/.claude/scripts/hooks/test/e2e_smoke.sh
```

Expected: all E2E assertions PASS, exit 0.

- [ ] **Step 3: Run the full test bundle as one command (for future use)**

```bash
for t in ~/.claude/scripts/hooks/test/test_*.sh ~/.claude/scripts/hooks/test/e2e_*.sh; do
  echo "=== $t ==="
  bash "$t" || { echo "SUITE FAIL: $t"; exit 1; }
done
```

Expected: every test file prints its PASS lines and exits 0.

- [ ] **Step 4: Commit**

```bash
cd ~/.claude
git add scripts/hooks/test/e2e_smoke.sh
git commit -m "test(hooks): add mbrain stop-hook e2e smoke script"
```

---

### Task 11: Real-session manual verification

**Files:** none (manual verification only).

This task is a checklist — do not skip it even though there is no code. The spec's success criteria can only be confirmed with a live Claude Code session.

- [ ] **Step 1: Substantive-work session**

In a fresh Claude Code session, pick a real task that touches a tracked project entity (any domain — whatever you're actively working on). Let the session run normally. When you end it, observe:

- The Stop hook fires, agent does one extra turn.
- The agent either (a) writes to the relevant brain page(s) and runs `mbrain sync_brain`, OR (b) emits `MBRAIN-PASS: <reason>`.
- `~/.claude/logs/mbrain-stop-hook.log` gains a new line with decision `block`.

```bash
tail -5 ~/.claude/logs/mbrain-stop-hook.log
```

- [ ] **Step 2: Read-only session**

Start a fresh session, ask a trivial question ("what does `ls -la` do?"), end it. Observe:

- Agent's extra turn outputs `MBRAIN-PASS: read-only question` (or similar).
- Log line shows decision `block` but no new brain pages created.

```bash
mbrain get-stats | head -10   # sanity: page count unchanged
```

- [ ] **Step 3: Opt-out via skip-dirs**

```bash
pwd   # note this path
echo "$(pwd)" >> ~/.claude/mbrain-skip-dirs
```

Start a session in that directory, end it immediately. Observe:

- Hook logs `skip` decision, no block.
- Agent ends normally without a mbrain-write extra turn.

Then remove the opt-out:

```bash
# edit ~/.claude/mbrain-skip-dirs to remove the added line
```

- [ ] **Step 4: Kill switch**

```bash
MBRAIN_STOP_HOOK=0 claude   # whatever the normal start command is
```

End the session. Observe: hook logs `skip` with reason `relevance-gate`, no block.

- [ ] **Step 5: Two-week observation window**

Leave the hook running for ~2 weeks. Then review:

```bash
awk '{print $3}' ~/.claude/logs/mbrain-stop-hook.log | sort | uniq -c
```

Expected distribution: roughly 30–70% `block`, the rest `skip` / `reentry`. If everything is `block` the gate is too loose; if everything is `skip` it's too tight. Tune `~/.claude/mbrain-skip-dirs` accordingly. (Tightening the gate is out of scope for this plan — it's follow-up work.)

- [ ] **Step 6: Document completion**

No code commit for this task. If any of steps 1–4 reveal bugs, open a follow-up task. If all four succeed, the hook is live.

---

## Self-review

Ran the checklist against the spec:

1. **Spec coverage:**
   - Architecture (spec §Architecture): Task 6 + 7 build the exact flow.
   - Components (spec §Components): Tasks 1, 2, 6, 7, 8, 9 create every file listed. (Flag-file component intentionally replaced by `stop_hook_active` — design refinement documented in plan header.)
   - Relevance gate rules 1/2/3/6 (spec §Relevance gate logic): Tasks 2, 3, 4, 5. Rules 4 and 5 (search-hit, agent-memory) explicitly deferred with rationale.
   - Data flow timings (spec §Data flow): block JSON shape, jq-based assembly, log append, all in tasks 7 and 8.
   - Error handling (spec §Error handling): `set -u` (not `-e`), `exit 0` everywhere, stderr-only warnings, mkdir || true, jq-missing fallback — all present in task 8 impl.
   - Logging format (spec §Logging): ISO8601 + session_id + decision + reason — matches exactly.
   - Testing (spec §Testing): Tasks 2–5 cover unit tests for relevance; tasks 6–8 cover hook; task 10 is the integration smoke script; task 11 is manual E2E.
   - Success criteria (spec §Testing §Success criteria): task 11 directly verifies each.

2. **Placeholder scan:** no TBD / TODO / "implement later" / "similar to task N" language. Every code step contains the actual code to write. Every command has expected output.

3. **Type / identifier consistency:**
   - Function name `mbrain_is_relevant` is defined in Task 2 and referenced unchanged in Tasks 3, 4, 5, 7, 8.
   - Env var names (`MBRAIN_STOP_HOOK`, `MBRAIN_SKIP_DIRS_FILE`, `MBRAIN_STOP_HOOK_LOG`) are introduced once and used consistently.
   - Hook id `stop:mbrain-check` matches between Task 9 registration and the description.
   - `RAW_INPUT`, `STOP_ACTIVE`, `SESSION_ID`, `LOG_FILE`, `REASON` shell variables are internally consistent across the final impl in Task 8.
   - Helper function `log_line` in Task 8 is only defined once (in the replaced file) — no duplicate definition with Task 7.

No gaps found. Plan is ready for execution.
