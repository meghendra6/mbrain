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

## Phase 0 parity verification

Run:

```bash
bun test test/phase0-contract-parity.test.ts
```

Expected:

- SQLite and PGLite pass unconditionally against the same shared workflow fixture.
- Postgres runs when `DATABASE_URL` is configured.
- Missing Postgres coverage is reported as an explicit skip reason, not as a silent reduction in the supported surface.

## Phase 1 operational-memory verification

Run:

```bash
bun run test:phase1
```

Expected:

- `task-memory-schema`, `task-memory-engine`, `task-memory-service`, and `task-memory-operations` all pass.
- SQLite and PGLite persist task-memory records across reconnects.
- Phase 1 task-resume parity runs through `test/phase0-contract-parity.test.ts`, including the `task resume semantics` coverage.
- Postgres task-memory persistence runs when `DATABASE_URL` is configured.
- If `DATABASE_URL` is missing, the Postgres task-memory persistence and parity checks report explicit skip reasons instead of silently dropping coverage.

## Phase 1 operational-memory benchmark

Run:

```bash
bun run bench:phase1 --json
```

Expected:

- the report includes `task_resume`, `attempt_history`, `decision_history`, and `resume_projection`
- latency workloads report positive `p50_ms` and `p95_ms`
- `resume_projection.success_rate` is `100` on the published fixture workload
- `acceptance.readiness_status` reports `pass` or `fail` from the local guardrails
- `acceptance.phase1_status` stays `pending_baseline` until a comparable repeated-work baseline exists for the primary improvement threshold
- the benchmark stays local and uses the same sqlite execution envelope as the Phase 0 baseline runner

To evaluate the full primary-improvement threshold once you have a comparable prior benchmark:

```bash
bun run bench:phase1 --json --baseline path/to/previous-phase1-benchmark.json
```

Expected:

- `acceptance.phase1_status` becomes `pass` or `fail` instead of `pending_baseline`
- the baseline must use the same engine and include a comparable `task_resume` latency measurement

To publish a reusable environment-specific baseline artifact:

```bash
bun run bench:phase1 --json --write-baseline docs/benchmarks/phase1/YYYY-MM-DD-<env>.json
```

Expected:

- the command still prints the benchmark JSON to stdout
- the same payload is written to the requested file
- the file can later be passed back through `--baseline`

## Phase 2 note-manifest verification

Run:

```bash
bun test test/note-manifest-schema.test.ts test/note-manifest-service.test.ts test/note-manifest-engine.test.ts test/note-manifest-operations.test.ts test/phase2-note-manifest.test.ts
```

Expected:

- note-manifest schema and service coverage pass on the local sqlite/pglite path
- import refresh keeps note-manifest rows in sync with canonical note writes
- `manifest-get`, `manifest-list`, and `manifest-rebuild` stay available through the shared operation surface

## Phase 2 note-manifest benchmark

Run:

```bash
bun run bench:phase2 --json
```

Expected:

- the report includes `manifest_get`, `manifest_list`, `manifest_rebuild`, and `structural_projection`
- latency workloads report positive `p50_ms` and `p95_ms`
- `structural_projection.success_rate` is `100` on the published fixture workload
- `acceptance.readiness_status` reports `pass` or `fail` from the local guardrails
- `acceptance.phase2_status` matches the local guardrail outcome without requiring an external baseline artifact
- the benchmark stays local and uses the same sqlite execution envelope as the earlier phase runners

## Phase 2 note-sections verification

Run:

```bash
bun test test/note-section-schema.test.ts test/note-section-service.test.ts test/note-section-engine.test.ts test/note-section-operations.test.ts test/phase2-note-sections.test.ts
```

Expected:

- note-section schema and extraction coverage pass on the local sqlite/pglite path
- canonical note writes refresh deterministic section rows immediately
- `section-get`, `section-list`, and `section-rebuild` stay available through the shared operation surface

## Phase 2 note-sections benchmark

Run:

```bash
bun run bench:phase2-sections --json
```

Expected:

- the report includes `section_get`, `section_list`, `section_rebuild`, and `section_projection`
- latency workloads report positive `p50_ms` and `p95_ms`
- `section_projection.success_rate` is `100` on the published fixture workload
- `acceptance.readiness_status` reports `pass` or `fail` from the local guardrails
- `acceptance.phase2_status` matches the local guardrail outcome without requiring an external baseline artifact
- the benchmark stays local and uses the same sqlite execution envelope as the earlier phase runners

## Phase 2 structural-paths verification

Run:

```bash
bun test test/note-structural-graph-service.test.ts test/note-structural-graph-operations.test.ts test/phase2-structural-paths.test.ts
```

Expected:

- deterministic structural neighbors and path coverage pass
- the operation surface exposes `section-neighbors` and `section-path`
- the benchmark reports local guardrail status for graph build, neighbors, and path lookup

## Phase 2 structural-paths benchmark

Run:

```bash
bun run bench:phase2-structural-paths --json
```

Expected:

- the report includes `structural_graph_build`, `structural_neighbors`, `structural_path`, and `structural_path_correctness`
- latency workloads report positive `p50_ms` and `p95_ms`
- `structural_path_correctness.success_rate` is `100`
- `acceptance.readiness_status` reports `pass` or `fail` from the local guardrails
- `acceptance.phase2_status` matches the local guardrail outcome without requiring an external baseline artifact

## Phase 2 context-map verification

Run:

```bash
bun test test/context-map-schema.test.ts test/context-map-engine.test.ts test/context-map-service.test.ts test/context-map-operations.test.ts test/phase2-context-map.test.ts
```

Expected:

- context-map schema and persisted builder coverage pass on the local sqlite/pglite path
- engine CRUD persists context-map rows across reopen
- `map-build`, `map-get`, and `map-list` stay available through the shared operation surface
- `map-get` and `map-list` mark persisted maps as `stale` after manifest/section source hashes change
- explicit `map-build` returns stale maps to `ready`
- persisted workspace maps are rebuildable from existing manifest and section rows

## Phase 2 context-map benchmark

Run:

```bash
bun run bench:phase2-context-map --json
```

Expected:

- the report includes `context_map_build`, `context_map_get`, `context_map_list`, and `context_map_correctness`
- latency workloads report positive `p50_ms` and `p95_ms`
- `context_map_correctness.success_rate` is `100`, including stale-read disclosure before explicit rebuild
- `acceptance.readiness_status` reports `pass` or `fail` from the local guardrails
- `acceptance.phase2_status` matches the local guardrail outcome without requiring an external baseline artifact

## Phase 2 context-atlas verification

Run:

```bash
bun test test/context-atlas-schema.test.ts test/context-atlas-engine.test.ts test/context-atlas-service.test.ts test/context-atlas-operations.test.ts test/phase2-context-atlas.test.ts
```

Expected:

- context-atlas schema and engine persistence coverage pass on the local sqlite/pglite path
- `atlas-build`, `atlas-get`, and `atlas-list` stay available through the shared operation surface
- atlas reads mirror underlying context-map freshness
- explicit rebuild returns atlas freshness to `fresh`

## Phase 2 context-atlas benchmark

Run:

```bash
bun run bench:phase2-context-atlas --json
```

Expected:

- the report includes `context_atlas_build`, `context_atlas_get`, `context_atlas_list`, and `context_atlas_correctness`
- latency workloads report positive `p50_ms` and `p95_ms`
- `context_atlas_correctness.success_rate` is `100`, including stale-to-fresh recovery
- `acceptance.readiness_status` reports `pass` or `fail` from the local guardrails
- `acceptance.phase2_status` matches the local guardrail outcome without requiring an external baseline artifact

## Phase 2 context-atlas selection

Run:

```bash
bun test test/context-atlas-service.test.ts test/context-atlas-operations.test.ts test/phase2-context-atlas-select.test.ts
bun test test/cli.test.ts -t "atlas-select --help"
bun run bench:phase2-context-atlas-select --json
```

Expected:

- selection returns deterministic outcomes for fresh, stale, and over-budget cases
- `atlas-select` stays available through the shared operation surface
- benchmark reports `context_atlas_select` and `context_atlas_select_correctness`
- `acceptance.readiness_status` reports `pass` or `fail` from the local guardrails
- `acceptance.phase2_status` matches the local guardrail outcome without introducing an external baseline artifact

## Phase 2 context-atlas overview

Run:

```bash
bun test test/context-atlas-overview-service.test.ts test/context-atlas-overview-operations.test.ts test/phase2-context-atlas-overview.test.ts
bun test test/cli.test.ts -t "atlas-overview --help"
bun run bench:phase2-context-atlas-overview --json
```

Expected:

- overview tests pass
- `atlas-overview` stays available through the shared operation surface
- benchmark reports `context_atlas_overview` and `context_atlas_overview_correctness`
- `acceptance.readiness_status` reports `pass` or `fail` from the local guardrails
- `acceptance.phase2_status` matches the local guardrail outcome without introducing an external baseline artifact

## Phase 2 context-atlas report

Run:

```bash
bun test test/context-atlas-report-service.test.ts test/context-atlas-report-operations.test.ts test/phase2-context-atlas-report.test.ts
bun test test/cli.test.ts -t "atlas-report --help"
bun run bench:phase2-context-atlas-report --json
```

Expected:

- report tests pass
- `atlas-report` stays available through the shared operation surface
- benchmark reports `context_atlas_report` and `context_atlas_report_correctness`
- `acceptance.readiness_status` reports `pass` or `fail` from the local guardrails
- `acceptance.phase2_status` matches the local guardrail outcome without introducing an external baseline artifact

## Phase 2 context-map report

Run:

```bash
bun test test/context-map-report-service.test.ts test/context-map-report-operations.test.ts test/phase2-context-map-report.test.ts
bun test test/cli.test.ts -t "map-report --help"
bun run bench:phase2-context-map-report --json
```

Expected:

- map report tests pass
- `map-report` stays available through the shared operation surface
- benchmark reports `context_map_report` and `context_map_report_correctness`
- `acceptance.readiness_status` reports `pass` or `fail` from the local guardrails
- `acceptance.phase2_status` matches the local guardrail outcome without introducing an external baseline artifact

## Phase 2 workspace-system-card

Run:

```bash
bun test test/workspace-system-card-service.test.ts test/workspace-system-card-operations.test.ts test/phase2-workspace-system-card.test.ts
bun test test/cli.test.ts -t "workspace-system-card --help"
bun run bench:phase2-workspace-system-card --json
```

Expected:

- workspace-system-card tests pass
- `workspace-system-card` stays available through the shared operation surface
- benchmark reports `workspace_system_card` and `workspace_system_card_correctness`
- `acceptance.readiness_status` reports `pass` or `fail` from the local guardrails
- `acceptance.phase2_status` matches the local guardrail outcome without introducing an external baseline artifact

## Phase 2 workspace-project-card

Run:

```bash
bun test test/workspace-project-card-service.test.ts test/workspace-project-card-operations.test.ts test/phase2-workspace-project-card.test.ts
bun test test/cli.test.ts -t "workspace-project-card --help"
bun run bench:phase2-workspace-project-card --json
```

Expected:

- workspace-project-card tests pass
- `workspace-project-card` stays available through the shared operation surface
- benchmark reports `workspace_project_card` and `workspace_project_card_correctness`
- `acceptance.readiness_status` reports `pass` or `fail` from the local guardrails
- `acceptance.phase2_status` matches the local guardrail outcome without introducing an external baseline artifact

## Phase 2 workspace-orientation-bundle

Run:

```bash
bun test test/workspace-orientation-bundle-service.test.ts test/workspace-orientation-bundle-operations.test.ts test/phase2-workspace-orientation-bundle.test.ts
bun test test/cli.test.ts -t "workspace-orientation --help"
bun run bench:phase2-workspace-orientation-bundle --json
```

Expected:

- workspace-orientation-bundle tests pass
- `workspace-orientation` stays available through the shared operation surface
- benchmark reports `workspace_orientation_bundle` and `workspace_orientation_bundle_correctness`
- `acceptance.readiness_status` reports `pass` or `fail` from the local guardrails
- `acceptance.phase2_status` matches the local guardrail outcome without introducing an external baseline artifact

## Phase 2 workspace-corpus-card

Run:

```bash
bun test test/workspace-corpus-card-service.test.ts test/workspace-corpus-card-operations.test.ts test/phase2-workspace-corpus-card.test.ts
bun test test/cli.test.ts -t "workspace-corpus-card --help"
bun run bench:phase2-workspace-corpus-card --json
```

Expected:

- workspace-corpus-card tests pass
- `workspace-corpus-card` stays available through the shared operation surface
- benchmark reports `workspace_corpus_card` and `workspace_corpus_card_correctness`
- `acceptance.readiness_status` reports `pass` or `fail` from the local guardrails
- `acceptance.phase2_status` matches the local guardrail outcome without introducing an external baseline artifact

## Phase 2 atlas-orientation-card

Run:

```bash
bun test test/atlas-orientation-card-service.test.ts test/atlas-orientation-card-operations.test.ts test/phase2-atlas-orientation-card.test.ts
bun test test/cli.test.ts -t "atlas-orientation-card --help"
bun run bench:phase2-atlas-orientation-card --json
```

Expected:

- atlas-orientation-card tests pass
- `atlas-orientation-card` stays available through the shared operation surface
- benchmark reports `atlas_orientation_card` and `atlas_orientation_card_correctness`
- `acceptance.readiness_status` reports `pass` or `fail` from the local guardrails
- `acceptance.phase2_status` matches the local guardrail outcome without introducing an external baseline artifact

## Phase 2 atlas-orientation-bundle

Run:

```bash
bun test test/atlas-orientation-bundle-service.test.ts test/atlas-orientation-bundle-operations.test.ts test/phase2-atlas-orientation-bundle.test.ts
bun test test/cli.test.ts -t "atlas-orientation-bundle --help"
bun run bench:phase2-atlas-orientation-bundle --json
```

Expected:

- atlas-orientation-bundle tests pass
- `atlas-orientation-bundle` stays available through the shared operation surface
- benchmark reports `atlas_orientation_bundle` and `atlas_orientation_bundle_correctness`
- `acceptance.readiness_status` reports `pass` or `fail` from the local guardrails
- `acceptance.phase2_status` matches the local guardrail outcome without introducing an external baseline artifact

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
