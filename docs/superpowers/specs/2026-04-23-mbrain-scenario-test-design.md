# mbrain Scenario-Based Test Design (Design-Contract Edition)

**Author:** scott.lee@rebellions.ai (via code-review synthesis across PR #31–#36)
**Date:** 2026-04-23
**Status:** Design proposal

---

## 1. Purpose and framing

This test spec is written **from the redesign contract down**, not from the current code up.

Every scenario in §4 is grounded in an invariant quoted verbatim from `docs/architecture/redesign/00`–`08`. If a scenario's test fails against the current code, the **code is wrong, not the test**. Fixing the code is the correct response.

The existing unit-test suite (four layers per phase slice) validates that the components behave consistently with themselves. It does not validate that the composed system honors the contract the redesign declared. That is the gap this spec closes.

Reading order for this document:
- §2 — the 14 invariants the test suite enforces, each with its redesign-doc source.
- §3 — scenario catalog indexed to those invariants.
- §4 — full scenario specs with Given / When / Then.
- §5 — **known failing scenarios**: where current code violates the contract and must change.
- §6 — test architecture.
- §7–§9 — rollout, coverage map, open questions.

---

## 2. Invariants extracted from the redesign

Each invariant is given a stable ID. Scenario tests cite these IDs.

### 2.1 Structural invariants (from `00-principles-and-invariants.md`)

**I1** — *Retrieval order is determined by query intent and scope, not by a fixed storage tier such as long-term, short-term, or cache.*

**I2** — *Derived structures may improve navigation and retrieval, but they do not become canonical truth without an explicit promotion step.*

**I3** — *Ongoing work state must have a durable canonical home so that the system can resume work without repeating analysis or failed attempts.*

**I4** — *Provenance is mandatory for promoted knowledge claims. A claim without source context is not canonical memory.*

**I5** — *Work memory and personal memory remain isolated by default. Cross-scope retrieval or write behavior requires an explicit scope decision.*

**I6** — *Local-first and offline-capable operation are architectural constraints, not optional deployment modes.*

**I7** — *Backend parity is a hard constraint at the contract level. SQLite, Postgres, and local execution paths may differ internally, but they must preserve the same semantic behavior at the system boundary.*

### 2.2 Loop invariants (from `02-memory-loop-and-protocols.md`)

**L1 (mixed intent decomposition)** — *If a request mixes intents, the route should be decomposed instead of flattened.* A mixed-intent request must not be silently collapsed to a single intent.

**L2 (canonical-first synthesis)** — *Prefer curated Markdown over inferred map edges when the two disagree in emphasis or confidence.*

**L3 (explicit degradation)** — *If the exact artifact cannot be found, the answer should degrade explicitly rather than pretending a remembered summary is equivalent.* Precision lookup must return `no_match` cleanly, not a fabricated result.

**L4 (code claim verification)** — *Reconfirm file paths, symbols, tests, and branch-sensitive claims before repeating them. If verification fails, drop the claim's authority for the current answer while preserving the historical operational record.*

**L5 (explicit reject / supersede)** — *Reject or supersede candidates explicitly rather than deleting their governance history silently.*

**L6 (retrieval trace fidelity)** — *Each trace must capture the active scope and intent route, which canonical artifacts were read, which derived artifacts were consulted, where verification occurred, and whether the interaction produced operational writes, candidates, promotions, rejections, or no durable write.*

**L7 (resume-before-raw)** — *Read the active Working Set before scanning raw files.* Task resume must surface working-set state as its primary payload.

### 2.3 Governance invariants (from `06-workstream-governance-and-inbox.md`)

**G1** — *Governance state is canonical for review history, not canonical for truth claims.* Promoted ≠ curated; canonical handoff is the boundary.

**G2** — *Candidate provenance must remain attached even when the candidate is eventually rejected.*

### 2.4 Evaluation invariants (from `08-evaluation-and-acceptance.md`)

**E1** — *Baselines must be captured before a phase claims improvement over current behavior.* A phase with no baseline cannot show `phase_status='pass'`.

---

## 3. Scenario catalog

Twelve scenarios. Each scenario names the invariants it falsifies on violation.

| # | Scenario | Falsifies | Must run on engines |
|---|---|---|---|
| S1 | Fresh install → import → search | I6, I7, I4 (structural provenance on manifest) | sqlite + pglite + postgres |
| S2 | Task resume after restart surfaces working set first | I3, L7 | all |
| S3 | Route selection is intent-driven, not tier-driven | I1 | sqlite + pglite |
| S4 | Personal route denies work scope at service layer | I5 | all |
| S5 | Mixed-scope bridge produces decomposed route | I5, **L1** | sqlite + pglite |
| S6 | Candidate lifecycle → promotion requires provenance | **I4**, G1, L6 | all |
| S7 | Supersession trigger is identical across engines | **I7**, L5 | all (with PG variants) |
| S8 | Rejection preserves provenance forever | G2, L5 | all |
| S9 | Broad synthesis prefers curated over map edges | **L2** | sqlite + pglite |
| S10 | Precision lookup degrades explicitly on miss | **L3** | sqlite + pglite |
| S11 | Code claim verification gates staleness | **L4** | sqlite + pglite |
| S12 | Acceptance pack refuses pass without baseline | **E1** | sqlite |
| S13 | Personal export honors scope + sensitivity + supersession | I5, G2 | all |
| S14 | Retrieval trace captures full loop-6 record | **L6** | sqlite + pglite |

**Bolded invariants** are contract claims the current implementation does not yet fully satisfy. Their scenarios are expected to fail on `master` today — see §5.

---

## 4. Scenario specifications

Each scenario: **Given → When → Then**, with the invariant(s) it enforces.

### S1 — Fresh install to first query

Falsifies: **I6** (local-first), **I7** (backend parity), **I4** (provenance substrate exists).

**Given** a clean working directory.
**When** `mbrain init --local`, write a 5-page markdown brain, `mbrain import .`, `mbrain search <term>`.
**Then** migration table at `LATEST_VERSION`; 5 pages, 5 manifests with non-empty `heading_index`, sections with stable `section_id`; backlinks bidirectional; keyword search returns expected page. Repeat on PGLite and Postgres with identical assertions.

### S2 — Task resume surfaces Working Set first (**L7**)

**Given** a task thread `task-X` with `working_set` populated, 2 attempts, 3 decisions, 1 retrieval trace.
**When** `selectRetrievalRoute({ intent: 'task_resume', task_id: 'task-X' })`.
**Then**
- `selection_reason === 'direct_task_match'`.
- `route.working_set.next_steps` is non-empty **and is the first field populated in the returned resume card** (positional assertion, not just presence).
- Attempts and decisions are ordered newest-first.
- `scope_gate.resolved_scope === 'work'`, `decision_reason === 'task_scope'`.

### S3 — Intent-driven routing, not tier-driven (**I1**)

**Given** a brain with curated notes, a context map, profile memory, and a personal episode — all in the same scope.
**When** six requests, each explicitly tagged with one of the six intents, hit `selectRetrievalRoute` with identical other inputs.
**Then** the six requests produce six distinct `route_kind` values. No request falls back to a default "recent notes" route. No request reaches raw pages before the intent-chosen entry point.

Additionally: a synthetic request with `intent: '__unknown__'` must throw (not silently route to a default).

### S4 — Personal route denies work scope at service layer (**I5**)

**Given** a profile memory entry exists.
**When** `getPersonalProfileLookupRoute(engine, { subject: '…', requested_scope: 'work' })` is called **directly at the service layer**.
**Then** `selection_reason === 'unsupported_scope_intent'`, `route === null`, and the profile memory store is **never queried** (assert with a query spy on the engine).

This directly validates PR #34's claim; the test must keep passing on every future PR.

### S5 — Mixed-scope bridge route is decomposed, not flattened (**L1**, **I5**)

**Given** a context map for `work:default` and a profile memory entry for `alex`.
**When** a single request carries both `query: 'what did alex say about X'` and `subject: 'alex'` with `intent: 'mixed_scope_bridge', requested_scope: 'mixed'`.
**Then**
- `route.route_kind === 'mixed_scope_bridge'`.
- `route.work_route.route_kind === 'broad_synthesis'` (non-null).
- `route.personal_route.route_kind === 'personal_profile_lookup'` (non-null).
- `route.retrieval_route === ['mixed_scope_gate', 'work_broad_synthesis', 'personal_profile_lookup', 'bounded_cross_scope_bridge']`.

**The test fails if** the system flattens to a single intent, drops one side of the bridge, or omits the `mixed_scope_gate` / `bounded_cross_scope_bridge` markers from the route trail.

### S6 — Candidate lifecycle → promotion requires provenance (**I4**, G1, L6)

**Given** a curated note `concepts/graph-retrieval`.
**When** the full lifecycle: create (with `source_refs`) → advance → advance → preflight → promote.
**Then**
- Every skipped or backward transition raises `invalid_status_transition`.
- Preflight deny reasons are surfaced explicitly (e.g., `candidate_missing_provenance` when `source_refs=[]`).
- Promotion succeeds only when `source_refs` is non-empty and target binding resolves.
- `canonical_handoff_entries` row exists after promotion with `source_refs` byte-for-byte equal to candidate input (after trim).
- Double-promote is a no-op and returns `null` (CAS).
- **Additional failing-path test**: attempt to promote a candidate whose `source_refs=[]`. Promotion must be denied. Asserting the candidate's `status` afterwards must still be `'staged_for_review'`.

### S7 — Supersession trigger identical across engines (**I7**, L5)

**Given** two staged candidates, intent to supersede one by another.
**When** on each engine (SQLite, PGLite, Postgres), the caller attempts both orderings:
- Update `status='superseded'` **without** supersession link first.
- Insert supersession link, then update status.

**Then** on every engine, the first order raises `"superseded candidate requires a supersession link record"` (exact message or regex). The second order succeeds. `superseded_candidate_id <> replacement_candidate_id` CHECK rejects self-supersession on every engine.

### S8 — Rejection preserves provenance (**G2**, L5)

**Given** a candidate with `source_refs=['Meeting X, …']` that reaches `staged_for_review`.
**When** `reject_memory_candidate_entry(id, { review_reason: '…' })`.
**Then**
- `status='rejected'`, `reviewed_at` stamped, `review_reason` persisted.
- `source_refs` is **still equal** to the original `['Meeting X, …']`, not empty, not null.
- The candidate remains queryable by id forever.
- If another candidate with the same `target_object_id` is later submitted, the historical rejection is findable via query.

### S9 — Broad synthesis prefers curated over map edges (**L2**)

**Given** two records:
- a curated note `concepts/X` whose body says "A is B"
- a context map edge inferring "A is C" with high score

**When** a broad-synthesis request on topic "A".
**Then** the returned `route.entrypoints` lists the curated note **before** any map-derived suggestion for the same entity. If the curated note and the map disagree, the route must surface the curated claim, and any map-derived contradiction must appear either as a Memory Candidate suggestion or as an explicit `contradicts` annotation — not as co-equal synthesis material.

This is a **positional** assertion: `route.entrypoints[0].source === 'curated_note'`. See §5 for why this is expected to fail today.

### S10 — Precision lookup degrades explicitly (**L3**)

**Given** no page at `concepts/nonexistent`, and a **similar-titled** page at `concepts/nonexistent-but-close`.
**When** `getPrecisionLookupRoute({ slug: 'concepts/nonexistent' })` and separately `{ path: 'concepts/nonexistent.md' }` and `{ source_ref: 'Meeting X, direct, 2026-04-01' }` against a brain that has none of these.
**Then** every call returns:
- `selection_reason === 'no_match'`
- `candidate_count === 0`
- `route === null`
- No fallback to the similar-titled page, no summary, no pointer to a "closest match."

### S11 — Code claim verification gates staleness (**L4**)

**Given** a retrieval trace captured on branch A that asserted "file `src/X.ts` exists" and "symbol `fooBar` is defined in it."
**When** a new resume-like request reuses that trace on branch B where the file has been renamed and the symbol removed.
**Then**
- The returned answer **explicitly marks the code claim as unverified** (e.g., `code_claim_status: 'stale'`).
- The historical trace itself is **not deleted** — historical operational memory is preserved (falsifies the protocol's "keep the historical record intact").
- The answer does not repeat the stale claim as a present-tense fact.

This scenario requires a `reverify_code_claims` step in the retrieval pipeline. It does not exist today — see §5.

### S12 — Acceptance pack refuses pass without baseline (**E1**)

**Given** no Phase 1 baseline artifact.
**When** `bun run bench:phase8-longitudinal-evaluation --json`.
**Then** `acceptance.phase8_status === 'pending_baseline'` (not `pass`). Exit code 0, but the "pass" label is reserved.

**Given** a **regressed** baseline artifact (p95 worse than envelope).
**When** same command with `--phase1-baseline=path`.
**Then** `acceptance.phase8_status === 'fail'`, exit code nonzero. A phase claiming improvement cannot pass while the baseline diff shows regression.

### S13 — Personal export honors scope, sensitivity, supersession (**I5**, **G2**)

**Given** `personal:travel` with 1,000 exportable entries, 1 superseded, 1 `sensitivity='secret'`, 1 `export_status='blocked'`, plus 1 personal episode.
**When** `previewPersonalExport({ requested_scope: 'personal', scope_id: 'personal:travel' })`.
**Then**
- Returned profile entries count = exactly 1,000 (no truncation, no leakage).
- Superseded, secret, and blocked entries are **absent**.
- `personal_episode_entries` contains the episode.
- With `requested_scope=undefined` and signals that do not resolve to personal, result is `policy='defer'`, arrays empty.

### S14 — Retrieval trace captures full loop-6 record (**L6**)

**Given** a request that reads one curated note, consults one context map, performs one code verification, and does no durable writes.
**When** `selectRetrievalRoute` with `persist_trace=true, task_id='t1'`.
**Then** the persisted `retrieval_traces` row contains, at minimum, each of:
- `scope`: the active scope
- `route`: the intent and the sequence of canonical reads
- `source_refs`: the canonical artifacts read
- **`derived_consulted`**: the derived artifacts used for orientation
- **`verification`**: which verification step ran and its outcome
- `outcome`: one of `operational_write | candidate_created | promoted | rejected | no_durable_write`

Fields shown in **bold** are required by the contract but not persisted today — see §5.

---

## 5. Known failing scenarios (code must change, not tests)

These scenarios are expected to **fail against `master` at HEAD today**. Each is a contract claim the current code does not yet satisfy. The test is correct; the code is the debt.

| Scenario | Invariant | Why current code fails | Fix direction |
|---|---|---|---|
| **S5** — mixed intent decomposition | L1 | `selectRetrievalRoute` takes one `intent`. Given a mixed request, callers must pre-classify. There is no `decomposeRequest` that splits a mixed ask into multiple sub-routes. | Add a request-classifier that emits a list of intents, then run each sub-route and compose results. Today's `mixed_scope_bridge` is a point solution, not a general mechanism. |
| **S9** — curated > map | L2 | `broad-synthesis-route-service` returns map-derived candidates alongside (or without) curated notes. There is no conflict-resolution layer that compares the two and prefers curated. `route.entrypoints` ordering is not contract-defined. | Introduce a ranking step that (a) separates canonical vs derived sources in the return shape, (b) when they disagree on the same entity, surfaces the disagreement as an explicit annotation or as a new Memory Candidate suggestion. |
| **S11** — code claim verification | L4 | The entire Code Claim Verification Protocol from §2 of `02-memory-loop-and-protocols.md` is unimplemented. No code path reconfirms file paths, symbols, branch state. `retrieval_traces.verification` exists in the schema but is not populated by any caller. | Add a `reverify_code_claims({ trace_id })` operation that re-checks file/symbol/branch assertions in the trace against the current worktree and produces a `stale | current | unverifiable` marker. Wire it into the resume path. |
| **S14** — loop-6 trace fidelity | L6 | `retrieval_traces.route` stores the selection; `source_refs` is present but often empty; `derived_consulted` and `verification` are not first-class columns or JSON fields. The selector writes traces with a subset of the required fields. | Promote `derived_consulted` and `verification` to canonical trace fields (migration + engine methods). Every surface that consults a context map or performs a check must append to the trace. |
| **S10** — precision degradation | L3 (partial) | Current `getPrecisionLookupRoute` does return `no_match`, so the service is mostly correct. **However**, upstream callers — CLI help text, MCP descriptions, and any code that falls back to "closest title match" — may fuzzy-match. A scenario test that exercises the full CLI surface may catch such fallbacks. | Audit all callers of precision-lookup-adjacent operations; remove any "did-you-mean" fallback that short-circuits explicit degradation. |
| **S12** — baseline-gated pass | E1 | `phase8-acceptance-pack` already distinguishes `pending_baseline` vs `pass` (tests exist). The **regression case** (`fail` when baseline regresses) is implicit but not explicitly tested end-to-end. | Add a fixture with a degraded baseline and assert `phase8_status === 'fail'`. Low-effort. |
| **S6** (provenance sub-case) | I4 | `preflightPromoteMemoryCandidate` denies for `candidate_missing_provenance`, but that is the only enforcement layer. No DB CHECK; no engine-side refusal. A hand-crafted call to `engine.promoteMemoryCandidateEntry` with empty `source_refs` would succeed today. | Either (a) add a CHECK: `jsonb_array_length(source_refs) > 0` on the canonical_handoff_entries table, or (b) make `promoteMemoryCandidateEntry` refuse when the source candidate's `source_refs` is empty, regardless of preflight result. |

The remaining scenarios (S1, S2, S3, S4, S7, S8, S13) should pass on current code. If they don't, the failing scenario exposes a regression, not a design gap.

---

## 6. Test architecture

### 6.1 Location

```
test/
├── e2e/                  # existing mechanical / skills / mcp / sync / upgrade E2E
├── scenarios/            # NEW — contract-level cross-phase tests
│   ├── fixtures/
│   │   ├── mini-brain/
│   │   ├── tasks/
│   │   └── baselines/
│   ├── helpers.ts        # engine matrix + query spy + seed utilities
│   ├── s01-fresh-install.test.ts
│   ├── s02-task-resume-working-set-first.test.ts
│   ├── s03-intent-driven-routing.test.ts
│   ├── s04-personal-scope-deny.test.ts
│   ├── s05-mixed-intent-decomposition.test.ts      # FAIL on master
│   ├── s06-promotion-requires-provenance.test.ts
│   ├── s07-supersession-cross-engine.test.ts
│   ├── s08-rejection-preserves-provenance.test.ts
│   ├── s09-curated-over-map.test.ts                # FAIL on master
│   ├── s10-precision-explicit-degradation.test.ts
│   ├── s11-code-claim-verification.test.ts         # FAIL on master
│   ├── s12-baseline-gated-acceptance.test.ts
│   ├── s13-personal-export-boundary.test.ts
│   └── s14-retrieval-trace-fidelity.test.ts        # FAIL on master
└── ...
```

### 6.2 Helpers

```ts
// test/scenarios/helpers.ts
export function describeAcrossEngines(
  name: string,
  fn: (ctx: { engine: BrainEngine; spy: QuerySpy }) => void,
  opts?: { engines?: Array<'sqlite' | 'pglite' | 'postgres'> },
) { /* loop over engines, wire spies, handle DATABASE_URL */ }

export interface QuerySpy {
  queries: Array<{ sql: string; table: string; params: unknown[] }>;
  reset(): void;
  wasTableRead(table: string): boolean;
}
```

`QuerySpy` is how S4 asserts "profile memory store was never queried" without relying on behavioral proxies. It wraps the engine's underlying SQL interface.

### 6.3 Runner

- New tier: **Tier 1.5 (Scenario)**. `bun run test:scenarios` → `bun test test/scenarios`.
- CI:
  - On SQLite: always.
  - On PGLite: always.
  - On Postgres: gated on `DATABASE_URL`. Follow the existing E2E test-DB lifecycle documented in `CLAUDE.md`.
- Scenarios that are **expected to fail on `master` today** (from §5) are marked with `test.failing` or kept in a quarantine file until the code lands to satisfy them. This makes "design drift" visible: every green → red flip means a regression, and every red → green flip means a design claim has finally been implemented.

### 6.4 Anti-patterns the suite avoids

- No `spawnSync('bun', ['run', …])` inside tests. Import exported helpers. (This is the lesson from PR #36's CI failure.)
- No test depends on wall-clock ordering. Seeds set timestamps explicitly.
- No test shares DB state across `test(...)` blocks; each re-seeds.
- No test asserts equality on `generated_at` / `updated_at` — assert shape and monotonicity, not values.

---

## 7. Coverage map — existing vs proposed

| Capability | Unit coverage exists | Scenario coverage (proposed) |
|---|---|---|
| Migration apply / replay | `test/migrate.test.ts` | S1, S7 |
| Import pipeline | `test/import-file*.test.ts` | S1 |
| Note manifest + sections | `test/note-manifest*`, `test/note-section*` | S1 |
| Task thread CRUD | `test/task-memory-*` | S2 |
| Retrieval route selector | `test/retrieval-route-selector-*` | S3, S4, S5, S14 |
| Scope gate | `test/scope-gate-service.test.ts` | S4, S5, S13 |
| Personal routes | `test/personal-*-service.test.ts` | S4, S5 |
| Mixed bridge | `test/mixed-scope-bridge-*` | S5 |
| Memory candidate FSM | `test/memory-inbox-service.test.ts` | S6, S8 |
| Canonical handoff | `test/canonical-handoff-*` | S6 |
| Supersession trigger | `test/memory-inbox-schema.test.ts` | S7 |
| Contradiction | `test/memory-inbox-contradiction-*` | (covered inside S7/S9) |
| Personal export | `test/personal-export-visibility-service.test.ts` | S13 |
| Longitudinal eval | `test/phase8-longitudinal-evaluation.test.ts` | S12 |
| Broad synthesis ranking | — | **S9 (new coverage)** |
| Code claim verification | — | **S11 (new coverage; needs impl)** |
| Trace fidelity | — | **S14 (new coverage; needs schema extension)** |

---

## 8. Priority and rollout

Order is chosen so each PR produces a scenario that either (a) pins an existing correct behavior or (b) flips a currently-failing scenario from red to green after the corresponding code change.

| Order | Scenario | Rationale |
|---|---|---|
| 1 | S4, S13 | Privacy-critical; pin current correct behavior so future regressions are caught. |
| 2 | S6, S8 | The loop's central guarantee (provenance + rejection history). Also pin current behavior. |
| 3 | S7 | Cross-engine invariant. Cheap to add on top of S6. |
| 4 | S1, S2, S3 | Foundation scenarios. Pin current behavior. |
| 5 | **S12** | Add the regressed-baseline case — small code change, closes E1. |
| 6 | **S6 provenance sub-case** | Add DB CHECK or engine guard for empty source_refs. Small change, closes I4 at the DB level. |
| 7 | **S9 (curated > map)** | New ranking logic. Larger change, but small in isolation. |
| 8 | **S14 (trace fidelity)** | Schema migration + caller updates. Medium change. |
| 9 | **S5 (mixed-intent decomposition)** | Architectural — new request classifier + composer. Larger change. |
| 10 | **S11 (code claim verification)** | Largest — requires a verification subsystem the code does not yet have. This may take its own multi-slice sprint and should not block other scenarios. |

At this cadence, the suite grows from zero to eight green scenarios in the first two weeks; the remaining six surface design debt and drive the next round of implementation.

---

## 9. Open questions

1. **Where does S11's code verification live?** A new workstream under `src/core/services/code-claim-verification/`, or inlined into `retrieval-route-selector-service`? The redesign doc treats it as a cross-cutting concern, which argues for a dedicated service.
2. **Should S9's ranking step expose its decisions in the trace?** Probably yes (see S14) — the decision "preferred curated note over map edge" is exactly the kind of explainability L6 is asking for.
3. **Is the regressed-baseline fixture in S12 per-phase or shared?** Recommend a single shared regression-envelope helper that each phase's acceptance pack consults, so only one fixture grammar has to evolve.
4. **How do we handle S7's trigger behavior when PGLite's pglite version is bumped?** The test pins error-message text. Suggestion: pin to a regex that also accepts PGLite's future-variant messages as long as the intent is preserved.
5. **Who owns `test.failing` flip back to `test`?** Whoever lands the fix. A PR that silently re-enables a quarantined scenario by adding features is exactly the signal we want.
