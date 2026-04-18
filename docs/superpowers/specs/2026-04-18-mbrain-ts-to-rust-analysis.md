# MBrain TypeScript to Rust Rewrite Analysis

**Date:** 2026-04-18
**Status:** Analysis memo, intended to feed a follow-up design plan
**Scope:** Current `mbrain` repository architecture, implementation maturity, and the case for or against a TypeScript -> Rust rewrite

---

## Executive Summary

The current recommendation is **not** to do a full TypeScript -> Rust rewrite yet.

The codebase is already materially useful and reasonably mature:

- the core storage boundary is explicit through `src/core/engine.ts`
- `postgres`, `sqlite`, and `pglite` are all already implemented
- CLI, MCP, and tool JSON are partially unified through `src/core/operations.ts`
- local/offline mode is no longer an idea; it is implemented and tested
- the test suite is large enough that the repository should be treated as a real product, not a disposable prototype

The strongest argument for change is **not** "TypeScript is too slow." The stronger arguments are:

1. too much duplication across storage-engine implementations
2. partial split-brain between the operation layer and CLI-only commands
3. a real local/offline performance hotspot in SQLite vector search
4. some code-to-doc drift after the local-first / `nomic-embed-text` transition

That means the highest-leverage move is:

1. redesign the internal architecture in TypeScript first
2. fix the actual local bottlenecks
3. re-measure
4. only then decide whether a Rust component is justified

If Rust is introduced, it should most likely start as a **narrow performance-oriented local core** rather than a full application rewrite.

---

## Review Goal

The question was whether MBrain should be reimplemented in Rust so it can run more lightly and quickly, and whether the overall structure should be substantially redesigned.

This review focused on three things:

1. how mature the current repository already is
2. whether TypeScript is the primary source of current pain
3. what architectural changes are likely to produce the most value

---

## Evidence Reviewed

### Code structure

- `src/cli.ts`
- `src/core/engine.ts`
- `src/core/engine-factory.ts`
- `src/core/operations.ts`
- `src/core/postgres-engine.ts`
- `src/core/sqlite-engine.ts`
- `src/core/pglite-engine.ts`
- `src/core/import-file.ts`
- `src/core/search/hybrid.ts`
- `src/core/search/vector-local.ts`
- `src/core/config.ts`
- `src/mcp/server.ts`
- `src/commands/import.ts`
- `src/commands/sync.ts`

### Architecture and product docs

- `README.md`
- `docs/guides/repo-architecture.md`
- `docs/architecture/infra-layer.md`
- `docs/local-offline.md`

### Verification commands

- `bun test`
- `HOME=$(mktemp -d) bun test test/import-resume.test.ts`
- `bun run build`

---

## Current Repository Snapshot

The repository currently has:

- `src/`: 65 files, about 13.8k lines
- `test/`: 61 files, about 31.3k lines
- `docs/`: 55 files, about 13.9k lines

Notable large implementation files:

- `src/core/sqlite-engine.ts`: 1303 lines
- `src/core/operations.ts`: 816 lines
- `src/core/postgres-engine.ts`: 770 lines
- `src/core/pglite-engine.ts`: 736 lines
- `src/commands/integrations.ts`: 686 lines
- `src/cli.ts`: 524 lines

This is already beyond the stage where "rewrite it from scratch" is cheap.

---

## What Is Already Strong

## 1. The storage boundary is real

`src/core/engine.ts` defines a meaningful `BrainEngine` interface instead of letting storage concerns leak across the app.

That is an important architectural asset because it means:

- local/offline and managed modes already share a conceptual contract
- search, CRUD, timeline, tags, links, versions, config, and ingest logging are modeled consistently
- future backend changes can happen behind a stable surface

This is the kind of boundary a rewrite should preserve, not discard.

## 2. Local/offline mode is already first-class enough to matter

`README.md` and `docs/local-offline.md` are not describing a vague future direction. The code supports:

- `sqlite` engine
- `pglite` engine
- local embedding provider selection
- heuristic or local query rewriting
- MCP server exposure over stdio

`src/core/config.ts` now defaults local installs to:

- `engine: "sqlite"`
- local embedding provider
- `embedding_model: "nomic-embed-text"`
- heuristic query rewriting

That means the repository has already crossed an important product threshold: it is no longer purely cloud-first.

## 3. The operation contract is a good direction

`src/core/operations.ts` is explicitly positioned as the single source of truth for:

- CLI surface
- MCP tools
- tools JSON

`src/mcp/server.ts` generates MCP tool definitions directly from it.

This is a solid architectural move. It reduces interface drift and makes the external surface more coherent.

## 4. The test base is substantial

`bun test` produced:

- 587 passing tests
- 128 skipped tests
- 5 failing tests

The 5 failures were not logic regressions. They came from sandbox restrictions writing to `~/.mbrain/import-checkpoint.json` in `test/import-resume.test.ts`.

When rerun with a temporary `HOME`, that file passed `6/6`.

This matters because it changes the decision standard. A codebase with this much verification should be incrementally refactored unless there is a very strong reason not to.

## 5. The build still works cleanly

`bun run build` succeeded and produced a compiled Bun binary.

That does not prove optimal runtime behavior, but it does show the current TypeScript/Bun stack is operational and shippable.

---

## Main Structural Problems

## 1. Engine implementation duplication is the biggest maintainability problem

The largest issue is not language choice. It is repeated logic across:

- `src/core/sqlite-engine.ts`
- `src/core/postgres-engine.ts`
- `src/core/pglite-engine.ts`

The repository has a good interface boundary, but much of the behavior still exists in three storage-specific copies.

This creates several costs:

- feature work fans out across multiple files
- migrations and schema evolution become more fragile
- bug fixes must be repeated
- performance work becomes backend-specific too early

If the same architecture is rewritten in Rust, this duplication risk remains. The language does not solve it by itself.

## 2. CLI and operation layer are not fully unified

`src/cli.ts` still keeps a large `CLI_ONLY` set:

- `init`
- `upgrade`
- `check-update`
- `integrations`
- `publish`
- `import`
- `export`
- `files`
- `embed`
- `serve`
- `doctor`
- `setup-agent`
- `migrate`
- and others

This weakens the otherwise good "contract-first" story.

The current result is a mixed model:

- some behavior flows through `operations.ts`
- some major commands bypass it completely

That is a structural smell. It makes it harder to reason about behavior, help text, validation, dry-run semantics, and future automation.

## 3. Postgres connection ownership is partly split

`src/core/postgres-engine.ts` supports both:

- instance-scoped connections
- module-global singleton access through `src/core/db.ts`

This exists for backward compatibility, but it complicates ownership and makes the mental model less clean than it should be.

A cleaner architecture would push toward one connection ownership model.

## 4. Local SQLite vector search is the clearest real performance bottleneck

This is the most important technical finding for the Rust question.

In `src/core/sqlite-engine.ts`, `searchVector()`:

- selects all candidate rows with embeddings
- loads them into memory
- passes them to `src/core/search/vector-local.ts`

Then `searchLocalVectors()` computes cosine similarity in-process over the full candidate set.

That means local semantic retrieval is effectively an `O(N)` scan over stored embeddings.

This is a real problem at larger scale. But the real issue is:

- missing local ANN / vector index support
- not the fact that the cosine loop is written in TypeScript

Rust could make that loop faster. But the larger gain likely comes from replacing the full scan with an indexed search path.

## 5. Parallel import is currently biased toward Postgres

`src/core/engine-factory.ts` reports parallel worker support only for `postgres`.

`src/commands/import.ts` therefore falls back to serialized processing for local engines.

For local/offline users with large corpora, that is a meaningful scaling limitation.

Again, this points more toward architecture and engine capability work than a whole-language rewrite.

## 6. Documentation drift exists

`docs/architecture/infra-layer.md` still describes:

- OpenAI `text-embedding-3-large`
- 1536-dimension embeddings

But the code, schema, tests, and local docs have already moved to:

- `nomic-embed-text`
- 768 dimensions

This is not a runtime problem, but it is a trust and maintenance problem. It suggests the repository is evolving faster than its architecture docs are being updated.

---

## Is MBrain Already "Good Enough"?

The answer is: **good enough to refactor, not good enough to freeze**.

That is an important distinction.

It is already good enough in these ways:

- the product direction is coherent
- the engine boundary is real
- local/offline mode is implemented
- the CLI and MCP story are converging
- test coverage is strong enough to support non-trivial refactoring

It is not yet "good enough" in these ways:

- too much engine duplication
- uneven command architecture
- local vector search will not scale gracefully
- some docs describe an older architecture

So the right mental model is not:

> "This is still half-baked; replace it."

It is closer to:

> "This now deserves serious internal cleanup because it has become important."

---

## Rust Rewrite Assessment

## Short answer

A **full Rust rewrite is not justified yet**.

## Why not

### 1. The main bottlenecks are architectural

The most obvious problems are:

- duplicated storage-engine logic
- mixed dispatch architecture
- local full-scan vector search

Those are not inherently TypeScript problems.

### 2. The rewrite cost would be high

A rewrite would need to recreate:

- three engine behaviors
- migrations
- MCP surface
- CLI behavior
- import/sync behavior
- test coverage
- local/offline capability semantics

That is a large migration surface for a project that is already working.

### 3. The current stack is fast enough for many layers of the app

For a CLI/MCP knowledge tool, the dominant costs are often:

- DB I/O
- filesystem traversal
- git operations
- embedding runtime latency
- networked providers when enabled

Language overhead matters most in the hot path. Right now the clearest hot path is local vector search, and even there the larger problem is algorithmic.

## When Rust would make sense

Rust becomes plausible if, after refactoring, measured bottlenecks still concentrate in one of these areas:

- local embedding storage and retrieval
- ANN / vector indexing
- large-scale incremental sync diffing and import orchestration
- a packaged local daemon/core that must be very memory-efficient and highly concurrent

In that case, a good strategy would be:

- keep the current CLI/MCP/user-facing orchestration in TypeScript
- move only the hot local core into Rust
- expose it as a library, sidecar binary, or FFI boundary

That is much safer than rewriting the whole product.

---

## Recommended Direction

## Phase 1: Architecture cleanup in TypeScript

This should happen before any Rust decision.

### A. Consolidate engine behavior

Pull more shared logic out of the concrete engines and into shared layers, especially around:

- common CRUD semantics
- chunk persistence conventions
- tag reconciliation
- search result shaping
- stats/health computation
- versioning behavior

Goal: reduce the amount of behavior implemented three times.

### B. Finish the contract-first transition

Reduce the `CLI_ONLY` surface and decide clearly which commands belong in:

- operation layer
- application service layer
- pure CLI bootstrap / UX layer

Goal: one command model, not two.

### C. Clean up connection ownership

Move away from mixed singleton and instance connection management for Postgres.

Goal: simpler lifecycle reasoning, fewer hidden code paths.

### D. Separate orchestration from storage

Commands like `import`, `sync`, `embed`, and `doctor` are currently rich enough that they should likely use explicit service modules rather than burying business flow in command files.

Goal: make command files thin and move reusable workflows into service-level modules.

## Phase 2: Fix actual local performance bottlenecks

### A. Replace SQLite full-scan vector search

This is the biggest practical performance task.

Candidate directions:

- SQLite vector extension
- sqlite-vec / sqlite-vss style indexing
- separate local ANN sidecar
- two-stage retrieval with candidate narrowing before vector scoring

Do this before concluding that TypeScript is the limiting factor.

### B. Improve local import throughput

Investigate safe local parallelism for:

- parsing
- chunk building
- embedding backfill orchestration
- batched writes

### C. Add measured benchmarks

The repository needs explicit performance baselines for:

- import throughput
- sync throughput
- local keyword search latency
- local semantic search latency
- memory footprint under large corpora

Without this, a rewrite decision will be emotional rather than technical.

## Phase 3: Re-evaluate Rust with evidence

Only after the previous work should the project ask:

> "What remains slow specifically because of the current runtime and implementation language?"

If the answer is "a narrow local hot path," then Rust becomes attractive.

If the answer is still mostly "data structure and index choices," then the rewrite still is not the right first move.

---

## Suggested Future Rust Scope If Needed

If a Rust move happens later, the best first target is likely **not**:

- CLI parsing
- MCP server wiring
- config loading
- markdown orchestration

The better first target is more likely:

- local vector index + retrieval engine
- local chunk store / fast search core
- import-time high-throughput content processing

In other words: **rewrite the hot core, not the whole brain.**

---

## Recommended Decision

The recommended decision today is:

**Do a substantial architectural redesign, but do not do a full Rust rewrite yet.**

More concretely:

1. keep the current TypeScript/Bun product line
2. refactor internal structure aggressively where duplication and drift exist
3. solve the local search bottleneck properly
4. add benchmarks
5. reconsider Rust afterward as a targeted optimization move

That direction has the best ratio of:

- delivery safety
- retained product momentum
- engineering leverage
- future optionality

---

## Proposed Follow-up Design Plan Inputs

The next design session should probably answer these concretely:

1. What should the final internal layering be between CLI, operations, services, and engines?
2. Which responsibilities can be centralized so engine files stop growing independently?
3. What is the intended long-term local search architecture?
4. Should `sqlite` and `pglite` remain separate engines, or should they share more infrastructure?
5. What benchmark thresholds would justify introducing Rust?
6. If Rust is adopted, what is the narrowest viable boundary for phase 1?

---

## Verification Notes

Commands run during this review:

```bash
bun test
HOME=$(mktemp -d) bun test test/import-resume.test.ts
bun run build
```

Observed outcomes:

- `bun test`: 587 pass / 128 skip / 5 fail
- the 5 failures were sandbox writes to `~/.mbrain/import-checkpoint.json`
- isolated rerun with temporary `HOME`: 6 pass / 0 fail
- `bun run build`: succeeded

---

## Bottom Line

MBrain looks like a project that has graduated from experimentation into real engineering maintenance.

That is exactly the point where:

- internal redesign is valuable
- performance work should become evidence-driven
- full rewrites become dangerous unless the bottleneck is both real and measured

The correct next step is **detailed architectural planning**, not immediate language replacement.
