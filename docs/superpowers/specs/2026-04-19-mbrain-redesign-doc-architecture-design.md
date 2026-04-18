# MBrain Redesign Documentation Architecture Design

**Date:** 2026-04-19
**Status:** Approved design for documentation structure before implementation planning
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

The redesign should begin with the following six documents under a dedicated redesign subtree:

1. `docs/architecture/redesign/00-principles-and-invariants.md`
2. `docs/architecture/redesign/01-target-architecture.md`
3. `docs/architecture/redesign/02-query-and-write-protocols.md`
4. `docs/architecture/redesign/03-migration-roadmap.md`
5. `docs/architecture/redesign/04-workstream-operational-memory.md`
6. `docs/architecture/redesign/05-workstream-context-map-and-governance.md`

These six documents are sufficient to move from broad redesign discussion to implementation planning without collapsing architecture, protocol, and rollout into one file.

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

### 5.3 `02-query-and-write-protocols.md`

This document defines agent operating rules.

**It must define:**

- query routing by intent
- task resume protocol
- broad synthesis protocol
- precision lookup protocol
- code-claim verification protocol
- write route and candidate lifecycle
- retrieval trace requirements
- fallback rules and anti-patterns

**It must not define:**

- subsystem storage models in depth
- architectural layer debates
- phase scheduling

### 5.4 `03-migration-roadmap.md`

This document defines how the current repository gets to the target architecture.

**It must define:**

- migration strategy
- phase boundaries
- deliverables by phase
- compatibility and rollback constraints
- risk register
- acceptance gates

**It must not define:**

- new target-state architecture concepts beyond what `01` already defines
- redundant subsystem detail already covered in `04` or `05`

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

### 5.6 `05-workstream-context-map-and-governance.md`

This document defines the Graphify-inspired derived layer and its governance.

**It must define:**

- Note Manifest
- structural extraction inputs
- Context Map
- Context Atlas
- map query/path/explain behavior
- Memory Inbox
- confidence taxonomy
- promote/reject/supersede governance rules

**It must not define:**

- operational memory lifecycle internals
- canonical fact graph as an MVP replacement for curated markdown
- full-system repetition of `01`

---

## 6. Required Tone and Writing Style

The redesign documents should not all read the same way.

### `00-principles-and-invariants.md`

Use a short, decisive ADR-style tone.

### `01-target-architecture.md`

Use an architecture reference tone. It should explain the destination state clearly enough that later documents can reuse its terms without redefining them.

### `02-query-and-write-protocols.md`

Use an operator handbook tone. This document is procedural and should read like an explicit behavior contract for agents and operators.

### `03-migration-roadmap.md`

Use an execution RFC tone. This document should be oriented around sequencing, constraints, and acceptance, not architectural storytelling.

### `04-workstream-operational-memory.md`

Use a subsystem design-spec tone. This is a deep dive, not a broad overview.

### `05-workstream-context-map-and-governance.md`

Use a subsystem design-spec tone. It should read as the authoritative design for derived map layers and their governance.

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

### `02-query-and-write-protocols.md`

- Query Route by Intent
- Task Resume Protocol
- Broad Synthesis Protocol
- Precision Lookup Protocol
- Code Claim Verification Protocol
- Write Route and Candidate Lifecycle
- Retrieval Trace Requirements
- Fallback Rules
- Anti-Patterns

### `03-migration-roadmap.md`

- Current State Summary
- Migration Strategy
- Phase Breakdown
- Deliverables by Phase
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

### `05-workstream-context-map-and-governance.md`

- Scope
- Deterministic Extraction Inputs
- Note Manifest Model
- Context Map Model
- Context Atlas Model
- Map Query Behaviors
- Inbox and Promotion Pipeline
- Confidence Taxonomy
- Governance Rules
- Tests and Evaluation

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

**`02-query-and-write-protocols.md`**

- references `00` for rules
- references `01` for object and layer names
- must not create new core object categories casually

**`03-migration-roadmap.md`**

- references `00` for constraints
- references `01` for target-state destination
- references `02` for protocol outcomes that each phase must eventually support

**`04-workstream-operational-memory.md`**

- references `01` for layer placement
- references `02` for task-resume and verification behavior
- references `03` for phase mapping
- must not redefine graph/governance vocabulary owned by `05`

**`05-workstream-context-map-and-governance.md`**

- references `01` for layer placement
- references `02` for map-first and write-governance protocol behavior
- references `03` for phase mapping
- must not redefine operational-memory internals owned by `04`

### 8.3 Duplication prevention rules

- `00` contains principles only
- `01` contains target architecture only
- `02` contains operating protocols only
- `03` contains migration sequencing only
- `04` and `05` contain subsystem specifics only

If a paragraph fits more naturally into another document's ownership boundary, it belongs there instead.

---

## 9. Recommended Authoring Order

The documents should be written in this order:

1. `00-principles-and-invariants.md`
2. `01-target-architecture.md`
3. `02-query-and-write-protocols.md`
4. `03-migration-roadmap.md`
5. `04-workstream-operational-memory.md`
6. `05-workstream-context-map-and-governance.md`

This order minimizes backtracking:

- first lock invariants
- then lock the target architecture
- then lock behavior protocols
- then derive the migration sequence
- then deepen the major workstreams

---

## 10. What This Spec Intentionally Does Not Decide

This spec does not yet decide:

- the exact schema for new tables
- exact CLI/MCP operation names
- whether `05` later needs to split into separate `context-map` and `governance` deep-dive docs
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

---

## 12. Next Step

After this spec is reviewed, the next action is to draft the six redesign documents in the approved order, then create a dedicated implementation plan from those documents.
