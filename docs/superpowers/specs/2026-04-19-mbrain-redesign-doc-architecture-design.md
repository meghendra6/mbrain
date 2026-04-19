# MBrain Redesign Documentation Architecture Design

**Date:** 2026-04-19
**Status:** Approved design for documentation structure before implementation planning, revised after review
**Scope:** Define how the mbrain redesign should be decomposed into architecture documents before writing implementation plans or touching runtime code

---

## 1. Summary

The mbrain redesign should not be captured in a single monolithic architecture memo.

The approved direction is a two-layer design:

1. define the **target architecture** clearly enough that the system has a stable destination
2. define the **migration path** separately enough that the current TypeScript/Bun codebase can evolve toward that destination incrementally

This keeps the work aligned with the Graphify-informed architecture direction while respecting the current repository reality:

- markdown remains the human-editable canonical artifact
- derived graphs and maps do not become canonical truth
- local/offline mode remains first-class
- SQLite/Postgres parity remains a hard constraint
- the redesign is an incremental evolution, not a rewrite

This spec defines the document set, the responsibility boundary of each document, the required tone of each document, and the cross-reference rules that keep the set coherent.

---

## 2. Why This Must Be Split

The reference memo at [docs/architecture/mbrain_memory_architecture_graphify_final.md](/Users/meghendra/Work/mbrain/docs/architecture/mbrain_memory_architecture_graphify_final.md:1) is directionally strong, but it mixes several different concerns:

- architectural principles
- target-state system design
- agent operating rules
- migration phases
- subsystem details

If those remain mixed, later implementation work will blur three different questions:

1. what is non-negotiable
2. what the final system should look like
3. what the next safe step in the current repository is

The redesign therefore needs a document system, not a single document.

---

## 3. Approved Design Approach

Three approaches were considered:

### A. Incremental redesign only

Describe the redesign purely in terms of modifications to the current codebase.

**Strengths**

- immediately actionable
- tightly constrained by the real repository
- low risk of speculative design drift

**Weaknesses**

- too easy to inherit current structural limitations
- weak at expressing the final architecture cleanly
- encourages local optimization over global coherence

### B. vNext ideal architecture only

Describe the destination architecture without binding it tightly to the current codebase.

**Strengths**

- cleanest architectural story
- easiest place to reason about layer boundaries
- strongest long-term coherence

**Weaknesses**

- high risk of disconnect from the current repository
- migration cost becomes underspecified
- execution sequencing becomes hand-wavy

### C. Two-layer design: target architecture + migration architecture

Describe the destination architecture and the current-to-target migration path in separate documents.

**Strengths**

- preserves a clean target-state model
- keeps execution grounded in the current repository
- matches the existing Graphify-informed roadmap
- supports phased workstreams without re-arguing fundamentals

**Weaknesses**

- requires stricter documentation discipline
- creates one extra document boundary to maintain

### Recommendation

Adopt **Approach C**.

This is the only option that fits both the approved Graphify direction and the repository's current state. It avoids both extremes:

- it does not reduce the redesign to small local refactors
- it does not escape into a detached ideal-state architecture

---

## 4. Document Set

The redesign should begin with the following nine documents under a dedicated redesign subtree:

1. `docs/architecture/redesign/00-principles-and-invariants.md`
2. `docs/architecture/redesign/01-target-architecture.md`
3. `docs/architecture/redesign/02-memory-loop-and-protocols.md`
4. `docs/architecture/redesign/03-migration-roadmap-and-execution-envelope.md`
5. `docs/architecture/redesign/04-workstream-operational-memory.md`
6. `docs/architecture/redesign/05-workstream-context-map.md`
7. `docs/architecture/redesign/06-workstream-governance-and-inbox.md`
8. `docs/architecture/redesign/07-workstream-profile-memory-and-scope.md`
9. `docs/architecture/redesign/08-evaluation-and-acceptance.md`

This nine-document set is intentionally larger than the original six-document proposal because review surfaced four missing ownership boundaries:

- end-to-end memory loop ownership
- local/offline and backend-parity ownership
- profile/personal memory ownership
- measurement and acceptance ownership

Those concerns are too important to leave implicit.

---

## 5. Responsibility Boundary by Document

### 5.1 `00-principles-and-invariants.md`

This document is the redesign constitution.

**It must define:**

- non-negotiable invariants
- canonical source rules
- derived vs canonical boundaries
- privacy and scope boundaries
- compatibility constraints
- rejected alternatives

**It must not define:**

- migration phases
- detailed data models
- command inventories
- step-by-step implementation tasks

### 5.2 `01-target-architecture.md`

This document defines the target system shape.

**It must define:**

- system layers
- object taxonomy
- layer responsibilities
- canonical source matrix
- high-level data flow
- read/write path overview

**It must not define:**

- phase sequencing
- exact rollout order
- implementation task breakdown

### 5.3 `02-memory-loop-and-protocols.md`

This document defines the end-to-end memory loop and agent operating rules.

**It must define:**

- the full read/write loop across retrieval, verification, candidate creation, and promotion boundaries
- query routing by intent
- task resume protocol
- broad synthesis protocol
- precision lookup protocol
- code-claim verification protocol
- write route and candidate lifecycle
- retrieval trace requirements
- fallback rules and anti-patterns

**It must not define:**

- detailed subsystem storage schemas
- phase scheduling
- backend implementation details owned by `03`

### 5.4 `03-migration-roadmap-and-execution-envelope.md`

This document defines how the current repository gets to the target architecture and under which runtime constraints that migration remains valid.

**It must define:**

- migration strategy
- phase boundaries
- deliverables by phase
- compatibility and rollback constraints
- local/offline execution constraints
- SQLite/Postgres parity constraints
- mapping from phases to the current repository inefficiency workstreams
- risk register
- acceptance gates

**It must not define:**

- new target-state architecture concepts beyond what `01` already defines
- deep subsystem behavior already owned by `04` through `07`

### 5.5 `04-workstream-operational-memory.md`

This document defines the operational-memory subsystem.

**It must define:**

- Task Thread
- Working Set / Resume Card
- Event / Episode
- Attempt / Decision
- Procedure lifecycle
- retrieval behavior for ongoing work
- stale state handling
- operational CLI/MCP surface

**It must not define:**

- the whole system again
- full graph/governance design
- unrelated migration sequencing

### 5.6 `05-workstream-context-map.md`

This document defines the Graphify-inspired derived map layer.

**It must define:**

- Note Manifest
- structural extraction inputs
- Context Map
- Context Atlas
- map query/path/explain behavior
- map report and orientation artifacts
- stale map handling

**It must not define:**

- inbox/promotion lifecycle internals owned by `06`
- operational memory lifecycle internals owned by `04`
- canonical fact graph as an MVP replacement for curated markdown

### 5.7 `06-workstream-governance-and-inbox.md`

This document defines the governance layer between derived signals and durable memory.

**It must define:**

- Memory Inbox
- confidence taxonomy
- candidate scoring
- promote/reject/supersede rules
- scope and sensitivity gates applied during promotion
- contradiction and review boundaries

**It must not define:**

- map-building internals owned by `05`
- operational memory lifecycle internals owned by `04`
- personal/profile memory lifecycle internals owned by `07`

### 5.8 `07-workstream-profile-memory-and-scope.md`

This document defines personal/profile memory and work-personal separation.

**It must define:**

- Profile Memory
- Personal Episode
- scope gate behavior
- workspace vs personal retrieval isolation
- privacy boundary rules at retrieval and write time
- export and visibility rules for personal memory

**It must not define:**

- operational task-memory internals owned by `04`
- map-building internals owned by `05`
- general governance mechanisms already owned by `06`

### 5.9 `08-evaluation-and-acceptance.md`

This document defines how redesign success is measured.

**It must define:**

- benchmark baselines
- repeated-work prevention metrics
- retrieval quality metrics
- governance precision metrics
- local/offline performance checks
- acceptance thresholds for phases and subsystems

**It must not define:**

- target architecture concepts already owned by `01`
- subsystem behavior already owned by `04` through `07`
- rollout sequencing already owned by `03`

---

## 6. Required Tone and Writing Style

The redesign documents should not all read the same way.

### `00-principles-and-invariants.md`

Use a short, decisive ADR-style tone.

### `01-target-architecture.md`

Use an architecture reference tone. It should explain the destination state clearly enough that later documents can reuse its terms without redefining them.

### `02-memory-loop-and-protocols.md`

Use an operator handbook tone. This document is procedural and should read like the authoritative contract for the full end-to-end memory loop.

### `03-migration-roadmap-and-execution-envelope.md`

Use an execution RFC tone. This document should be oriented around sequencing, runtime constraints, and acceptance, not architectural storytelling.

### `04-workstream-operational-memory.md`

Use a subsystem design-spec tone. This is a deep dive, not a broad overview.

### `05-workstream-context-map.md`

Use a subsystem design-spec tone. It should read as the authoritative design for derived map layers and orientation artifacts.

### `06-workstream-governance-and-inbox.md`

Use a subsystem design-spec tone. It should read as the authoritative design for candidate review, promotion, and governance.

### `07-workstream-profile-memory-and-scope.md`

Use a subsystem design-spec tone. It should read as the authoritative design for personal/profile memory boundaries and scope gating.

### `08-evaluation-and-acceptance.md`

Use a verification-spec tone. It should read as the measurement contract that later implementation and rollout documents must satisfy.

---

## 7. Recommended Outline by Document

### `00-principles-and-invariants.md`

- Purpose
- Non-Negotiable Invariants
- Canonical Sources
- Derived vs Canonical Rules
- Scope and Privacy Boundaries
- Compatibility Constraints
- Rejected Alternatives
- Glossary

### `01-target-architecture.md`

- Problem Statement
- Design Goals
- System Layers
- Core Objects
- Canonical Source Matrix
- Data Flow Overview
- Read Path Overview
- Write Path Overview
- Failure and Drift Boundaries
- Open Questions Deferred

### `02-memory-loop-and-protocols.md`

- End-to-End Memory Loop
- Query Route by Intent
- Task Resume Protocol
- Broad Synthesis Protocol
- Precision Lookup Protocol
- Code Claim Verification Protocol
- Write Route and Candidate Lifecycle
- Retrieval Trace Requirements
- Fallback Rules
- Anti-Patterns

### `03-migration-roadmap-and-execution-envelope.md`

- Current State Summary
- Migration Strategy
- Execution Envelope
- Phase Breakdown
- Deliverables by Phase
- Mapping to Existing Inefficiency Workstreams
- Compatibility and Rollback
- Test and Acceptance Gates
- Risk Register
- Sequence Rationale

### `04-workstream-operational-memory.md`

- Scope
- Object Model
- Lifecycle
- Storage and Canonical Artifacts
- Retrieval Behavior
- Resume UX
- Staleness and Verification
- CLI/MCP Surface
- Tests and Evaluation

### `05-workstream-context-map.md`

- Scope
- Deterministic Extraction Inputs
- Note Manifest Model
- Context Map Model
- Context Atlas Model
- Map Query Behaviors
- Map Report and Orientation Artifacts
- Staleness and Refresh Rules
- Tests and Evaluation

### `06-workstream-governance-and-inbox.md`

- Scope
- Candidate Sources
- Memory Inbox Model
- Confidence Taxonomy
- Scoring and Review Flow
- Promote / Reject / Supersede Rules
- Scope and Sensitivity Gates
- Contradiction Handling
- Tests and Evaluation

### `07-workstream-profile-memory-and-scope.md`

- Scope
- Profile Memory Model
- Personal Episode Model
- Scope Gate Rules
- Retrieval Isolation Rules
- Write Isolation Rules
- Export and Visibility Boundaries
- Tests and Evaluation

### `08-evaluation-and-acceptance.md`

- Why Measurement Is First-Class
- Baseline Metrics
- Repeated-Work Prevention Evaluation
- Markdown Knowledge Retrieval Evaluation
- Context Map Utility Evaluation
- Governance Precision Evaluation
- Local/Offline Performance Evaluation
- Phase Acceptance Criteria
- Regression Triggers

---

## 8. Cross-Reference Rules

The documents must form a strict dependency chain instead of restating one another.

### 8.1 Top-level rule

`00-principles-and-invariants.md` is the highest local authority in the redesign set. Later redesign documents may refine within its boundaries, but may not override it.

### 8.2 Document-level reference rules

**`00-principles-and-invariants.md`**

- refers outward to no other redesign document
- establishes terms and constraints used by all later documents

**`01-target-architecture.md`**

- references `00`
- reuses its definitions without restating them in expanded form
- defines the stable target vocabulary for later documents

**`02-memory-loop-and-protocols.md`**

- references `00` for rules
- references `01` for object and layer names
- owns the end-to-end loop across retrieval, verification, candidate creation, and promotion boundaries
- must not create new core object categories casually

**`03-migration-roadmap-and-execution-envelope.md`**

- references `00` for constraints
- references `01` for target-state destination
- references `02` for protocol outcomes that each phase must eventually support
- owns local/offline, parity, and execution-envelope constraints for the redesign

**`04-workstream-operational-memory.md`**

- references `01` for layer placement
- references `02` for task-resume and verification behavior
- references `03` for phase mapping
- must not redefine map vocabulary owned by `05`
- must not redefine governance vocabulary owned by `06`

**`05-workstream-context-map.md`**

- references `01` for layer placement
- references `02` for map-first protocol behavior
- references `03` for phase mapping
- must not redefine governance internals owned by `06`
- must not redefine operational-memory internals owned by `04`

**`06-workstream-governance-and-inbox.md`**

- references `01` for layer placement
- references `02` for write-governance protocol behavior
- references `03` for phase mapping
- must not redefine map-building internals owned by `05`
- must not redefine profile-memory internals owned by `07`

**`07-workstream-profile-memory-and-scope.md`**

- references `00` for privacy and scope boundaries
- references `01` for layer placement
- references `02` for retrieval/write isolation behavior
- references `03` for phase mapping
- must not redefine general governance mechanisms owned by `06`

**`08-evaluation-and-acceptance.md`**

- references `02` for protocol-level success criteria
- references `03` for phase acceptance gates
- references `04` through `07` for subsystem-specific measurements
- owns the shared measurement contract for the redesign

### 8.3 Duplication prevention rules

- `00` contains principles only
- `01` contains target architecture only
- `02` contains the end-to-end memory loop and operating protocols only
- `03` contains migration sequencing and execution-envelope constraints only
- `04` through `07` contain subsystem specifics only
- `08` contains shared measurement and acceptance logic only

If a paragraph fits more naturally into another document's ownership boundary, it belongs there instead.

---

## 9. Recommended Authoring Order

The documents should be written in this order:

1. `00-principles-and-invariants.md`
2. `01-target-architecture.md`
3. `02-memory-loop-and-protocols.md`
4. `03-migration-roadmap-and-execution-envelope.md`
5. `04-workstream-operational-memory.md`
6. `05-workstream-context-map.md`
7. `06-workstream-governance-and-inbox.md`
8. `07-workstream-profile-memory-and-scope.md`
9. `08-evaluation-and-acceptance.md`

This order minimizes backtracking:

- first lock invariants
- then lock the target architecture
- then lock the full memory loop and behavior protocols
- then lock the migration sequence and execution envelope
- then deepen the major workstreams
- then lock the shared measurement contract

---

## 10. What This Spec Intentionally Does Not Decide

This spec does not yet decide:

- the exact schema for new tables
- exact CLI/MCP operation names
- which phase each individual runtime file modification belongs to
- the implementation plan task granularity

Those decisions belong in later redesign documents or in the implementation plan stage.

---

## 11. Success Criteria

This design is successful if:

1. the redesign can proceed without re-arguing document structure
2. every later redesign document has a clear ownership boundary
3. implementation planning can map work to stable architectural documents
4. target-state reasoning and migration reasoning stay separated
5. Graphify-inspired context-map work does not collapse into a rewrite narrative
6. local/offline and backend-parity constraints remain explicit throughout the redesign
7. repeated-work prevention, profile isolation, and governance quality all have named owners
8. redesign success is measurable before implementation claims are made

---

## 12. Next Step

After this spec is reviewed, the next action is to draft the nine redesign documents in the approved order, then create a dedicated implementation plan from those documents.
