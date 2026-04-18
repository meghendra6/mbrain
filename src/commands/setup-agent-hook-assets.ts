export const CLAUDE_MBRAIN_SKIP_DIRS = `# mbrain Stop-hook skip list (one absolute path per line)
#
# Add directories where you do not want Claude Code to prompt for
# a mbrain writeback check at session end.
#
# Example:
# /tmp/throwaway-experiment
# /home/me/scratch
`;

export const CLAUDE_MBRAIN_RELEVANCE_LIB = `# mbrain-relevance.sh

_mbrain_normalize_dir() {
  local dir="$1"
  if [ -d "$dir" ]; then
    (
      cd "$dir" 2>/dev/null && pwd -P
    )
    return 0
  fi

  printf '%s\n' "$dir"
}

_mbrain_skip_dir_match() {
  local cwd="$1"
  local file="$2"
  [ -f "$file" ] || return 1
  local normalized_cwd
  normalized_cwd="$(_mbrain_normalize_dir "$cwd")"

  while IFS= read -r line || [ -n "$line" ]; do
    line="\${line#"\${line%%[![:space:]]*}"}"
    case "$line" in
      ''|'#'*) continue ;;
    esac
    if [ "$line" = "$cwd" ]; then
      return 0
    fi
    if [ "$(_mbrain_normalize_dir "$line")" = "$normalized_cwd" ]; then
      return 0
    fi
  done < "$file"

  return 1
}

mbrain_is_relevant() {
  if [ "\${MBRAIN_STOP_HOOK:-1}" = "0" ]; then
    return 1
  fi

  local cwd="$(pwd)"
  local skipfile="\${MBRAIN_SKIP_DIRS_FILE:-$HOME/.claude/mbrain-skip-dirs}"
  if _mbrain_skip_dir_match "$cwd" "$skipfile"; then
    return 1
  fi

  if ! command -v mbrain >/dev/null 2>&1; then
    return 1
  fi

  return 0
}
`;

export const CLAUDE_MBRAIN_STOP_HOOK = `#!/bin/bash
set -u

HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_FILE="\${MBRAIN_STOP_HOOK_LOG:-$HOME/.claude/logs/mbrain-stop-hook.log}"
# shellcheck source=lib/mbrain-relevance.sh
source "$HOOK_DIR/lib/mbrain-relevance.sh"

log_line() {
  local decision="$1"
  local session_id="$2"
  local reason="\${3:-}"
  local ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || true
  printf '%s %s %s %s\n' "$ts" "$session_id" "$decision" "$reason" >> "$LOG_FILE" 2>/dev/null || true
}

extract_session_id() {
  local raw="$1"
  printf '%s' "$raw" | jq -r 'try .session_id // "unknown"' 2>/dev/null || printf 'unknown'
}

RAW_INPUT="$(cat)"
SESSION_ID="$(extract_session_id "$RAW_INPUT")"
STOP_ACTIVE="$(printf '%s' "$RAW_INPUT" | jq -r 'try .stop_hook_active // false' 2>/dev/null || printf 'false')"

if [ "$STOP_ACTIVE" = "true" ]; then
  log_line "reentry" "$SESSION_ID" "stop_hook_active=true"
  printf '%s' "$RAW_INPUT"
  exit 0
fi

if ! mbrain_is_relevant; then
  log_line "skip" "$SESSION_ID" "relevance-gate"
  printf '%s' "$RAW_INPUT"
  exit 0
fi

REASON='mbrain write check: before ending this session, review the conversation for entities (people, companies, concepts, technical systems) worth recording — per MBRAIN_AGENT_RULES.md §3. For each notable entity: mbrain search <slug> to find or create the page, append compiled truth + timeline entry with source attribution, add back-links (iron law), then mbrain sync_brain with no_pull=true and no_embed=true. If nothing in this session warrants a brain write (read-only question, trivial chore, already-written knowledge), respond with exactly: MBRAIN-PASS: <short reason>. Do not ask the user for permission — decide and act.'

log_line "block" "$SESSION_ID" "gate-passed"

printf '%s' "$RAW_INPUT" | jq -c \
  --arg reason "$REASON" \
  '{decision: "block", reason: $reason}'
`;
