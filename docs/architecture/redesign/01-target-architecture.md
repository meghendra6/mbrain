# MBrain Redesign Target Architecture

This document defines the destination architecture for the redesign. It assumes the invariants in `00-principles-and-invariants.md` and uses them without re-arguing them.

## Problem Statement

The current `mbrain` repository already has a meaningful engine boundary, local/offline support, Markdown-based knowledge storage, and contract-first operations. The redesign is needed because the current shape still blends too many concerns:

- active work continuity is weaker than it needs to be for repeated-work prevention
- canonical memory and derived retrieval aids are not separated clearly enough
- structural context extraction is underdeveloped relative to the needs of note and code navigation
- governance boundaries for inferred claims are not strong enough to prevent drift or pollution
- backend differences and command-surface splits create avoidable architectural friction

The target architecture resolves those issues without abandoning Markdown, local-first operation, or the existing Bun/TypeScript product shape.

## Design Goals

1. Preserve Markdown as the human-editable canonical substrate for curated knowledge and procedures.
2. Add a derived structural middle layer that improves navigation without becoming canonical truth.
3. Make active work state durable enough to resume tasks, reuse decisions, and avoid repeated failed work.
4. Separate canonical truth, derived orientation, and governance state so each layer can evolve without corrupting the others.
5. Enforce scope isolation between work memory and personal memory.
6. Preserve local/offline operation and backend semantic parity across supported runtimes.
7. Make read and write paths explainable enough that later protocol documents can specify them without redefining object categories.

## System Layers

| Layer | Responsibility | Canonical Status |
|---|---|---|
| Source Inputs and Evidence | Capture imported notes, files, raw source material, code references, and user-authored inputs into Source Records with provenance and attached raw evidence. | Canonical through Source Records, not for synthesized truth. |
| Canonical Memory | Store curated notes, procedures, operational work records, and profile memory as scoped canonical subdomains. | Canonical. |
| Derived Structure and Orientation | Build manifests, context maps, context atlases, embeddings, indexes, and orientation reports from canonical sources. | Derived. |
| Governance and Promotion | Hold the Memory Inbox, candidate claims, contradiction handling, and promotion or supersession records. | Canonical for governance state, not for truth claims until promoted. |
| Retrieval and Orchestration | Route reads and writes through scope isolation, intent, verification, and source selection rules. | Neither a storage layer nor a source of truth. |
| Interfaces and Runtime Surfaces | Expose the system through CLI, MCP, and local runtime services. | Projection layer only. |

The target system is layered so that canonical truth remains stable even when derived orientation artifacts are refreshed or discarded.

In this target architecture, profile memory is not a separate peer layer. It is a scoped subdomain within Canonical Memory, while scope isolation is enforced by Retrieval and Orchestration together with Governance and Promotion. Evaluation and dream-cycle maintenance are operating regimens applied to these layers, not peer architectural layers.

## Core Objects

The target architecture uses the following stable object vocabulary:

| Object | Role |
|---|---|
| Curated Note | Canonical synthesized knowledge document for a topic, entity, project, or concept. |
| Procedure | Canonical reusable operating knowledge that agents and users can inspect directly. |
| Source Record | Canonical provenance object that describes an observed source and preserves its attached raw evidence or imported content. |
| Task Thread | Canonical record for an ongoing unit of work spanning one or more sessions. |
| Working Set / Resume Card | Canonical focused projection of what should be resumed next for active work. |
| Event / Episode | Canonical record of a work session, interaction, or meaningful state change. |
| Attempt / Decision | Canonical records of what was tried, what failed, and what was chosen. |
| Note Manifest | Derived structural extraction of deterministic note metadata and link structure. |
| Context Map | Derived navigational graph overlay connecting notes, code, tasks, and evidence. |
| Context Atlas | Derived higher-level orientation artifact that composes multiple maps or corpora. |
| Map Report | Derived orientation artifact that explains useful subgraphs, bridges, gaps, and entry points for navigation. |
| Memory Inbox | Canonical governance container for candidate claims awaiting review, promotion, rejection, or supersession. |
| Memory Candidate | Canonical governance object for a proposed claim, link, or synthesis that is not yet truth. |
| Promotion / Supersession Record | Canonical governance outcome showing how candidate state affected canonical memory. |
| Retrieval Trace | Canonical operational trace record explaining which sources, maps, and checks informed a retrieval outcome. |
| Profile Memory | Canonical personal-scope memory for stable preferences, routines, and user-specific facts. |
| Personal Episode | Canonical personal-scope event record analogous to work episodes. |

Later redesign documents may deepen these objects, but they should not replace them with new top-level categories casually.

## Canonical Source Matrix

| Concern | Canonical Source | Derived Views |
|---|---|---|
| Curated knowledge | Curated Note Markdown | Note manifests, embeddings, search indexes, context maps, summaries |
| Reusable operating knowledge | Procedure Markdown | Procedure manifests, embeddings, orientation reports |
| Active work continuity | Task Thread, Working Set / Resume Card, Event / Episode, Attempt / Decision | Resume views, task maps, relevance rankings |
| Provenance and raw inputs | Source Records | Citation views, extraction outputs, ranked evidence sets |
| Candidate governance state | Memory Inbox, Memory Candidates, and Promotion / Supersession records | Triage scores and contradiction reports |
| Personal memory | Profile Memory and Personal Episode records | Scoped recall views, profile summaries |
| Retrieval explainability | Retrieval Trace records | Session explainers and debug summaries |
| Global orientation | None | Context Maps, Context Atlases, graph explainers, gap reports |

This matrix preserves the core rule from `00`: orientation aids may be powerful, but they remain derivative.

## Data Flow Overview

1. Source inputs enter the system as user-authored Markdown, imported artifacts, code references, or raw evidence.
2. Observed inputs are written to Source Records as the explicit provenance destination, with raw evidence preserved inside that canonical object.
3. Canonical writes persist into the appropriate memory domain: curated knowledge, procedures, operational work records, profile records, or governance state.
4. Deterministic extraction builds structural manifests from canonical sources.
5. Derived processes build context maps, atlases, embeddings, indexes, and orientation artifacts from canonical state and manifests.
6. Retrieval and orchestration use canonical state first and consult derived artifacts to narrow, explain, and rank candidate sources.
7. Governance outcomes either promote reviewed claims into canonical memory or keep them isolated as rejected or superseded candidates.

The architecture treats derivation as a downstream consequence of canonical state rather than a peer source of truth.

## Read Path Overview

The target read path follows this shape:

1. Determine the active scope before retrieval begins.
2. Classify the request by intent, such as active task continuation, precise lookup, broad synthesis, or personal recall.
3. Read the strongest canonical sources for that intent first.
4. Use derived manifests, maps, atlases, embeddings, and indexes to narrow search space and explain relevance.
5. Pull supporting evidence or raw sources when canonical material needs verification or citation support.
6. Return an answer grounded in canonical state, with derived artifacts acting as routing and explanation aids rather than independent authorities.

For code- or workspace-sensitive claims, the target architecture assumes live verification against the current workspace before the claim is treated as reliable output.
When explainability or auditability matters, the system persists a Retrieval Trace as a canonical operational record rather than treating it as a cache.

## Write Path Overview

The target write path follows this shape:

1. Classify the incoming signal by scope and memory domain.
2. Write or link the source evidence into Source Records so provenance has one explicit canonical destination.
3. Write directly to canonical memory when the signal is already an authoritative update for that domain.
4. Write to the Memory Inbox and related governance state when the signal is inferred, ambiguous, contradictory, or not yet strong enough to become canonical truth.
5. Persist a Retrieval Trace when the system needs a durable explanation of how retrieval or verification proceeded.
6. Refresh manifests, maps, indexes, and other derived artifacts from the updated canonical state.
7. Preserve promotion or supersession outcomes as explicit records rather than silent mutations.

This write path keeps canonical memory durable while letting the system learn from partial or uncertain signals without polluting truth.

## Failure and Drift Boundaries

The target architecture assumes several forms of drift and constrains their impact:

- Derived artifacts may become stale. Staleness may harm retrieval quality, but it must not corrupt canonical truth.
- Embeddings and indexes may lag behind canonical writes. They are performance aids, not authority.
- Context maps may surface misleading connections. Those connections remain advisory until promoted through governance.
- Workspace-sensitive claims may drift as code moves. Canonical work records may preserve historical decisions, but live claims require current verification.
- Backend implementations may vary internally. Semantic contract drift across supported backends is not acceptable.
- Scope leakage is treated as a boundary failure, not an acceptable ranking mistake.

## Open Questions Deferred

The following questions are intentionally deferred to later redesign documents:

- the exact schemas and storage split for operational memory, governance state, and profile memory
- the precise refresh cadence and invalidation rules for manifests, maps, embeddings, and indexes
- the detailed read and write protocols by request type
- the exact CLI and MCP operation inventory for the redesigned layers
- the migration sequence from the current repository shape to this target architecture
- the benchmark and acceptance thresholds that define redesign success
