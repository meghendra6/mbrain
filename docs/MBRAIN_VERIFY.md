# MBrain Installation Verification Runbook

Run these checks after install to confirm every part of MBrain is working.
Each check includes the command, expected output, and what to do if it fails.

The most important check is #4 (live sync). "Sync ran" is not the same as
"sync worked." A sync that silently skips pages because of a pooler bug is
worse than no sync at all, because you think it's working.

---

## 1. Schema Verification

**Command:**

```bash
mbrain doctor --json
```

**Expected:** The output should match the active profile:
- On Postgres profiles, `connection`, `pgvector`, `rls`, `schema_version`, and `embeddings` should be `ok`.
- On local/offline profiles, `execution_envelope` and `contract_surface` should appear, `pgvector` and `rls` should short-circuit with `warn`, and `check-update` should be reported honestly as unsupported.
- `unsupported_capabilities` should explain any local-path limits such as cloud file storage.

**If it fails:** The doctor output includes specific fix instructions for each
check. See `skills/setup/SKILL.md` Error Recovery table.

## 1a. Execution envelope verification

Run:

```bash
mbrain doctor --json | jq '.checks[] | select(.name == "execution_envelope" or .name == "contract_surface")'
```

Expected:

- the active profile is reported honestly
- unsupported contract surfaces include an explicit reason
- sqlite/local mode does not pretend to support cloud file storage
- pglite local-path mode should follow the same honest contract reporting

---

## 2. Skillpack Loaded

**Check:** Ask the agent: "What is the brain-agent loop?"

**Expected:** The agent references MBRAIN_SKILLPACK.md Section 2 and describes
the read-write cycle: detect entities, read brain, respond with context, write
brain, sync.

**If it fails:** The agent hasn't loaded the skillpack. Run step 6 from the
install paste (read `docs/MBRAIN_SKILLPACK.md`).

---

## 3. Auto-Update Configured

**Command:**

```bash
mbrain check-update --json
```

**Expected:** Returns JSON with `current_version`, `latest_version`,
`update_available` (boolean). On local/offline profiles, the command should
short-circuit with `error: "offline_mode"` and a human-readable `reason`.
The cron `mbrain-update-check` is registered.

**If it fails:** Run step 7 from the install paste. See MBRAIN_SKILLPACK.md
Section 17.

---

## 4. Live Sync Actually Works

This is the most important check. Three parts.

### 4a. Coverage Check

Compare page count in the DB against syncable file count in the repo:

```bash
mbrain stats
```

Then count syncable files:

```bash
find /data/brain -name '*.md' \
  -not -path '*/.*' \
  -not -path '*/.raw/*' \
  -not -path '*/ops/*' \
  -not -name 'README.md' \
  -not -name 'index.md' \
  -not -name 'schema.md' \
  -not -name 'log.md' \
  | wc -l
```

**Expected:** Page count in `mbrain stats` should be close to the file count.
Some difference is normal (files added since last sync), but if page count is
less than half the file count, sync is silently skipping pages.

**If page count is way too low:** The #1 cause is the connection pooler bug.
Check your `DATABASE_URL`:
- If it contains `pooler.supabase.com:6543`, verify it's using **Session mode**,
  not Transaction mode.
- Transaction mode breaks `engine.transaction()` and causes `.begin() is not a
  function` errors.
- Fix: switch to Session mode pooler string, then run `mbrain sync --full`
  to reimport everything.

### 4b. Embed Check

```bash
mbrain stats
```

**Expected:** Embedded chunk count should be close to total chunk count.

**If embedded is much lower than total:**

```bash
mbrain embed --stale
```

If your local embedding runtime is not reachable, or `nomic-embed-text` is not
installed, embeddings can't be generated. Keyword search still works without
embeddings, but hybrid/semantic search won't.

If you are upgrading an existing Postgres brain to the 768-dim nomic schema,
run this once before backfilling:

```bash
mbrain init
mbrain embed --all
```

### 4c. End-to-End Test

This is the real test. Edit a brain page, push, wait, search.

1. Edit a page in the brain repo (e.g., correct a fact on a person's page):

```bash
# Example: fix a line in Gustaf's page
cd /data/brain
# Make a small edit to any .md file
git add -A && git commit -m "test: verify live sync" && git push
```

2. Wait for the next sync cycle (cron interval or `--watch` poll).

3. Search for the corrected text:

```bash
mbrain search "<text from the correction>"
```

**Expected:** The search returns the **corrected** text, not the old version.

**If it returns old text:** Sync failed silently. Check:
- Is the sync cron registered and running?
- Is `mbrain sync --watch` still alive (if using watch mode)?
- Run `mbrain config get sync.last_run` to see when sync last ran.
- Run `mbrain sync --repo /data/brain` manually and check for errors.
- If you see `.begin() is not a function`, fix the pooler (see 4a above).

---

## 5. Embedding Coverage

**Command:**

```bash
mbrain stats
```

**Expected:** Embedded chunk count matches (or is close to) total chunk count.

**If zero or very low:** your local embedding runtime may be unavailable or the
model may be missing. Check:

```bash
ollama list | grep nomic-embed-text
```

If the model is missing, install it. Then:

```bash
ollama pull nomic-embed-text
mbrain embed --stale
```

---

## 6. Brain-First Lookup Protocol

**Check:** Ask the agent about a person or concept that exists in the brain.

**Expected:** The agent uses `mbrain search` or `mbrain query` FIRST, not grep
or external APIs. The response includes brain-sourced context with source
attribution.

**If it fails:** The brain-first lookup protocol isn't injected into the agent's
system context. See `skills/setup/SKILL.md` Phase D.

---

## Quick Verification (all checks in one pass)

```bash
# 1. Schema
mbrain doctor --json

# 2. Sync recency
mbrain config get sync.last_run

# 3. Page count + embed coverage
mbrain stats

# 4. Search works
mbrain search "test query from your brain content"

# 5. Catch any unembedded chunks
mbrain embed --stale

# 6. Auto-update
mbrain check-update --json
```

If all six return successfully, the installation is healthy. For the full
end-to-end sync test (4c), push a real change and verify it appears in search.
