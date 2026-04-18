# MBrain Redesign Migration Roadmap and Execution Envelope

This document defines how the current `mbrain` repository should move toward the redesign target described in `01-target-architecture.md` while staying inside the protocol and compatibility boundaries established by `00-principles-and-invariants.md` and `02-memory-loop-and-protocols.md`. It owns rollout sequencing, execution constraints, rollback boundaries, and mapping to the current inefficiency workstreams. It does not redefine target-state objects or deep subsystem behavior.

## Current State Summary

`mbrain` is already a real TypeScript/Bun product with a meaningful engine boundary, partially centralized operations, multiple backend implementations, and actual local/offline usage paths.

The redesign therefore starts from these facts rather than abstracting them away:

- `src/core/engine.ts` is a useful contract boundary that should be exploited more consistently rather than replaced.
- SQLite, Postgres, and local execution modes already exist and already shape user expectations.
- CLI and MCP surfaces already expose a meaningful product contract, even though command ownership is not yet cleanly split.
- Markdown import, sync, and human-edited knowledge artifacts are already part of how the system works in practice.

The migration problem is not "how to build a new memory system from scratch." The migration problem is how to improve the current repository so repeated-work prevention, derived orientation, governance, and scoped memory can arrive without regressing the existing product.

## Migration Strategy

The migration strategy is incremental and contract-preserving.

1. Preserve the current product boundary wherever possible and change internals before changing user-facing contracts.
2. Introduce new canonical or derived capabilities in additive phases rather than through a single architectural cutover.
3. Keep Markdown import, sync, and human inspection valid throughout the rollout.
4. Use phase-specific feature exposure, capability checks, and explicit acceptance gates to prevent backend skew from leaking into the public surface.
5. Treat rollback, parity, and local/offline fitness as design inputs for each phase rather than as release cleanup after implementation.

The practical consequence is that each phase must deliver value on top of the current codebase while leaving the system in a state that the next phase can build on safely. No phase should require the repository to stop being a local-first Bun/TypeScript product in order to make progress.

## Execution Envelope

The roadmap is only valid inside the following execution envelope.

| Constraint | Required Behavior |
|---|---|
| Local/offline execution | Every phase must preserve a usable local/offline path. New capabilities may use different implementations by backend, but the roadmap may not defer local/offline support to a later "catch-up" release. |
| SQLite/Postgres parity | New architectural capabilities must preserve semantic parity across SQLite and Postgres at the contract boundary. Temporary implementation gaps are acceptable only if they remain behind non-default or non-contract surfaces and have an explicit closure path. |
| Existing CLI/MCP contract | Existing CLI and MCP behavior should remain stable unless a phase explicitly versions or documents the change. Internal refactors do not justify silent contract drift. |
| Markdown continuity | Markdown notes and procedures remain valid canonical artifacts throughout migration. No phase may require converting human-curated knowledge into a DB-only representation. |
| Derived artifact status | Note manifests, context maps, atlases, reports, indexes, and similar artifacts remain regenerable derived state. Migration phases may add or refresh them, but may not let them silently replace canonical truth. |
| Additive rollout | Schema additions, service modules, and operation layering should be introduced additively where possible so that rollback can disable new paths without corrupting existing data. |
| Workstream grounding | Each phase must map to a concrete inefficiency already identified in the current repository, not to an abstract vNext aspiration detached from current bottlenecks. |

Within this envelope, SQLite is not a "lite" preview tier and Postgres is not the only real target. The redesign succeeds only if both remain first-class product backends at the semantic boundary, even when one backend carries more optimized internals than the other.

## Phase Breakdown

| Phase | Focus | Why It Comes Here |
|---|---|---|
| Phase 0 | Policy and compatibility | Establishes the envelope, parity rules, and rollback boundaries before new memory objects or read paths are introduced. |
| Phase 1 | Operational memory | Addresses repeated-work prevention first by adding durable task continuity to the current system. |
| Phase 2 | Note manifest and structural context map | Captures the earliest Graphify-derived win through deterministic extraction without changing canonical truth rules. |
| Phase 3 | Context atlas and map query tools | Makes the structural layer operational for navigation after the underlying maps exist. |
| Phase 4 | Procedure registry and rationale capture | Converts repeated work patterns into reusable operating knowledge once active work continuity exists. |
| Phase 5 | Governance and Memory Inbox | Inserts the promotion boundary before more ambitious derived analysis can influence durable memory. |
| Phase 6 | Semantic map analysis under governance | Introduces higher-noise semantic signals only after governance controls exist. |
| Phase 7 | Fact/edge graph with temporal validity | Adds slower, more durable relationship storage after operational memory, structural orientation, and governance are already in place. |
| Phase 8 | Evaluation harness and dream cycle | Turns the redesign into a measurable system after the major write and retrieval paths exist. |

## Deliverables by Phase

| Phase | Deliverables |
|---|---|
| Phase 0 | Scope and policy schema additions, compatibility rules, and SQLite/Postgres parity tests for the migration baseline. |
| Phase 1 | `task_threads`, `working_sets`, `memory_events`, `episodes`, `attempts`, and `decisions` support plus task start, resume, decision, and attempt-capture surfaces with continuity tests. |
| Phase 2 | Note manifest extraction, structural context map build, basic map reports, and tests against Markdown note corpora. |
| Phase 3 | Map query, path, explain, and neighbor operations; Context Atlas registration; staleness and stats reporting; and interface exposure for agent use. |
| Phase 4 | Procedure registry support, procedure creation and search flows, rationale capture, and Markdown-backed canonical procedure files. |
| Phase 5 | Memory Candidate and Memory Inbox handling, review and promotion flows, scope and sensitivity gates, and governance dashboards or reports. |
| Phase 6 | Semantic map build mode, controlled inferred-edge handling, bridge or surprise analysis, suggested-question output, and dream-cycle map review inputs. |
| Phase 7 | Fact and relationship storage with temporal validity, evidence chain support, contradiction handling, and candidate-based compiled-truth update flows. |
| Phase 8 | Evaluation commands, repeated-work prevention tests, resume and synthesis evaluations, privacy and scope leakage checks, and dream-cycle reporting. |

Deliverables should remain scoped to what the current repository can absorb phase by phase. If a deliverable requires a deeper subsystem contract, that contract belongs in the later workstream document for that subsystem rather than here.

## Mapping to Existing Inefficiency Workstreams

The roadmap is justified by the inefficiency analysis only if each phase reduces a real current cost.

| Existing Inefficiency Workstream | Relevant Phases | Migration Implication |
|---|---|---|
| Engine implementation duplication across SQLite, Postgres, and PGLite | Phase 0 through Phase 8 | Every phase should prefer shared services and capability flags over backend-specific product logic. New memory capabilities should enter through stable contracts rather than fan out into three divergent implementations. |
| Split between contract-first operations and CLI-only flows | Phase 0 through Phase 5 | New roadmap capabilities should land behind reusable operations or service layers first, with thin CLI and MCP adapters. The redesign should reduce accidental command-surface divergence instead of adding more of it. |
| Mixed Postgres connection ownership | Phase 0, Phase 1, Phase 5, Phase 7 | Phases that add canonical write paths or governance state must not deepen reliance on mixed singleton and instance access. They should move the system toward clearer ownership and transaction boundaries. |
| Full-scan local vector search in SQLite | Phase 2, Phase 3, Phase 6, Phase 8 | Structural maps and atlas features should improve orientation without assuming expensive semantic retrieval. Semantic map work must remain performance-aware for local backends and be measured explicitly before broad exposure. |
| Local import throughput limits caused by engine capability gaps | Phase 0, Phase 2, Phase 3, Phase 8 | Manifest extraction, map builds, and future dream-cycle workloads must be designed so the local path does not become a second-class throughput story. Capability modeling should remain explicit. |
| Code-to-doc drift after the local-first transition | Phase 0 and every later phase | Each phase must keep docs aligned with actual contract and runtime behavior. The redesign documents are part of the migration surface, not separate from it. |
| Missing benchmark baselines | Phase 0 and Phase 8, with phase-local checks in between | The roadmap should not claim retrieval or workflow wins without benchmarks or acceptance evidence. Local search, import throughput, resume quality, and leakage prevention all need measurable baselines. |

This mapping is why the roadmap stays improvement-first. The phases are not just architecture milestones; they are a sequence for attacking today’s structural duplication, contract drift, local bottlenecks, and missing evidence discipline.

## Compatibility and Rollback

Compatibility and rollback rules apply to every phase.

| Area | Compatibility Rule | Rollback Rule |
|---|---|---|
| Markdown knowledge and procedures | Existing Markdown artifacts remain readable, writable, and syncable throughout migration. | If a new phase misbehaves, disable the new derivation or write path and continue using the existing Markdown artifacts as canonical state. |
| Operational records | New operational objects should be additive to existing behavior and should not invalidate legacy task workflows immediately. | Roll back by disabling new resume or capture flows while preserving written historical records. |
| Derived artifacts | Context maps, atlases, reports, embeddings, and indexes remain derived and regenerable. | Roll back by ignoring or rebuilding the derived artifact; do not mutate canonical memory to compensate. |
| CLI and MCP surfaces | Existing commands and tools stay stable unless explicitly versioned or documented as changed. | Roll back by routing adapters back to the prior implementation path without breaking contract names where possible. |
| Backend parity | Public behavior should remain semantically aligned across SQLite and Postgres. | Roll back feature exposure on the skewed path rather than accepting silent parity breakage in the public contract. |
| Data migrations | Prefer additive schema changes and backfills over destructive rewrites. | Roll back by disabling reads or writes that depend on the new schema while leaving pre-existing data usable. |

Rollback is therefore phase-scoped rather than repo-wide. A failed derived feature should be removable without invalidating canonical memory, and a failed new canonical workflow should be disableable without requiring a repository reset.

## Test and Acceptance Gates

No phase is complete without fresh verification across the execution envelope.

| Gate | Required Evidence |
|---|---|
| Local/offline gate | The phase works in a local/offline configuration without requiring network-backed fallback for its core contract. |
| SQLite/Postgres parity gate | The phase preserves the same semantic result across SQLite and Postgres for its public contract, or else the temporary gap is explicitly hidden and documented. |
| Contract gate | CLI and MCP behavior remains stable or the versioned/documented change is verified intentionally. |
| Markdown continuity gate | Markdown import, sync, and canonical inspection still behave correctly after the phase lands. |
| Derived-versus-canonical gate | Derived outputs remain regenerable and do not silently modify canonical truth. |
| Benchmark or workload gate | Phases that affect local search, import, map builds, or background analysis include measurement or baseline comparison rather than anecdotal claims. |
| Rollback gate | The team can identify the feature flag, adapter boundary, or schema dependency needed to disable the phase safely if needed. |

Minimum acceptance emphasis by phase:

- Phase 0 must prove compatibility rules and parity baselines before later phases depend on them.
- Phase 1 must prove task continuity and repeated-work prevention on current local workflows.
- Phases 2 and 3 must prove that structural orientation helps retrieval without introducing contract drift or local performance regression.
- Phases 5 through 7 must prove that governance, semantic analysis, and fact storage cannot bypass provenance, scope, or contradiction checks.
- Phase 8 must prove that the redesign can be evaluated as a system rather than by anecdote.

## Risk Register

| Risk | Why It Matters | Mitigation Direction |
|---|---|---|
| Backend skew | SQLite and Postgres may drift as new features land. | Enforce parity tests at each public contract boundary and keep backend-specific logic behind shared service contracts. |
| Local/offline regression | New map, governance, or evaluation work could quietly assume heavier runtime infrastructure than the current local path can support. | Keep local/offline as a release gate for every phase and measure local workloads explicitly. |
| Contract drift between operations, CLI, MCP, and docs | The redesign could add new behavior faster than the public contract is cleaned up. | Route new work through service or operation boundaries first and update docs as part of the same phase. |
| Candidate pollution | Derived or inferred signals may flood governance state and reduce trust. | Introduce scoring, triage, and promotion checks before semantic analysis becomes a primary workflow. |
| Scope leakage | Work and personal memory boundaries may blur as retrieval grows more capable. | Keep scope checks in the acceptance gates and require explicit scope decisions before cross-domain retrieval or writes. |
| Temporal drift in code-sensitive memory | Historical decisions may be mistaken for current workspace truth. | Keep verification requirements tied to code-sensitive claims and separate historical operational memory from current evidence. |
| Migration sprawl | Later phases may start redefining target-state architecture or subsystem internals inside rollout docs. | Keep this roadmap focused on sequencing and constraints; defer subsystem mechanics to the later workstream documents. |

## Sequence Rationale

Phase 0 comes first because the redesign needs an execution envelope before it needs new objects. If compatibility, local/offline constraints, rollback boundaries, and SQLite/Postgres parity are not explicit at the start, every later phase risks solving the architecture problem by making the current product less reliable.

Phase 1 comes next because repeated-work prevention is the first user goal and the strongest justification for redesign work that touches the live codebase. Durable task continuity also creates a safer base for later procedure capture, retrieval traces, and governance-aware writes.

Phase 2 follows because deterministic structural extraction is the earliest Graphify-derived gain that fits the current repository. It improves navigation and synthesis without forcing a canonical graph story too early.

Phase 3 is sequenced after Phase 2 because atlas and query tools are only valuable once structural maps exist and staleness can be observed. It turns the structural layer into an actual agent aid rather than an offline artifact.

Phase 4 waits until after operational continuity and structural orientation because procedures and rationales are most useful when they can be grounded in real task history instead of premature abstraction.

Phase 5 must precede Phase 6 and Phase 7 because higher-noise derived analysis and slower-moving fact storage both need a governance boundary. Without Memory Inbox and promotion controls, semantic suggestions and relationship candidates would bypass the trust model.

Phase 6 comes before Phase 7 because semantic map analysis is still derived, discardable, and easier to constrain. It is a lower-risk way to learn from richer structure before introducing a more durable fact and edge substrate with temporal validity.

Phase 7 is intentionally late because temporal fact storage is valuable only after the system already knows how to preserve provenance, contain contradictions, and distinguish current evidence from historical memory.

Phase 8 closes the roadmap because evaluation and dream-cycle maintenance should validate the full loop rather than guess at isolated wins. Benchmarking, leakage checks, retrieval evaluation, and repeated-work tests are the evidence layer that tells the team whether the migration actually improved the existing product.
