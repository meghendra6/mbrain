# MBrain Redesign Principles and Invariants

## Purpose

This document is the redesign constitution for `mbrain`.

It establishes the rules that later redesign documents must obey. It does not define migration sequencing, subsystem procedures, or implementation tasks.

## Non-Negotiable Invariants

1. Human-editable Markdown remains a canonical artifact for curated knowledge and reusable procedures.
2. Retrieval order is determined by query intent and scope, not by a fixed storage tier such as long-term, short-term, or cache.
3. Derived structures may improve navigation and retrieval, but they do not become canonical truth without an explicit promotion step.
4. Ongoing work state must have a durable canonical home so that the system can resume work without repeating analysis or failed attempts.
5. Provenance is mandatory for promoted knowledge claims. A claim without source context is not canonical memory.
6. Work memory and personal memory remain isolated by default. Cross-scope retrieval or write behavior requires an explicit scope decision.
7. Local-first and offline-capable operation are architectural constraints, not optional deployment modes.
8. Backend parity is a hard constraint at the contract level. SQLite, Postgres, and local execution paths may differ internally, but they must preserve the same semantic behavior at the system boundary.
9. Incremental evolution of the current Bun/TypeScript codebase is the governing delivery model. The redesign is not permission for a rewrite-first strategy.

## Canonical Sources

The redesign recognizes only a small number of canonical source classes:

| Source Class | Canonical Role | Why It Is Canonical |
|---|---|---|
| Curated Markdown notes | Canonical knowledge synthesis | They are human-readable, reviewable, and directly editable. |
| Markdown procedures | Canonical reusable operating knowledge | They preserve stable instructions that users and agents can inspect and revise. |
| Operational work records | Canonical active-work state | They preserve what is in progress, what was tried, what was decided, and what should resume next. |
| Profile and personal records | Canonical personal memory within scope | They preserve durable non-work facts that must not leak across scope boundaries. |
| Source evidence and raw artifacts | Canonical provenance substrate | They preserve what the system observed, where it came from, and what later synthesis is allowed to cite. |
| Governance records | Canonical review state for candidate claims | They preserve the Memory Inbox, candidate records, and promotion, rejection, or supersession outcomes. |

Canonical sources may be rendered, indexed, summarized, mapped, embedded, or cached. Those derivatives do not replace the canonical source.

## Derived vs Canonical Rules

1. A derived artifact may be deleted and regenerated without loss of truth.
2. A canonical artifact may not be silently rewritten by a derived process.
3. Note manifests, context maps, context atlases, embeddings, search indexes, orientation reports, and retrieval caches are derived artifacts.
4. Retrieval traces are canonical operational records rather than derived caches.
5. Inferred links, suggested claims, and surprising connections remain Memory Inbox candidates until they pass the canonical write path and governance checks.
6. A derived artifact may narrow search space, explain a path, or rank sources. It may not independently authorize a truth claim.
7. Promotion changes canonical state. Regeneration changes only derived state.

## Scope and Privacy Boundaries

1. Work memory, personal memory, and imported source artifacts are separate memory domains.
2. Personal memory is never injected into work retrieval by default.
3. Work context is never written into personal memory by default.
4. External source artifacts may inform synthesis, but they do not override user-authored or curated canonical records without explicit evidence handling.
5. Retrieval must respect the active scope before ranking relevance.
6. Export, sync, or sharing behavior must preserve these scope boundaries instead of flattening them.

## Compatibility Constraints

1. The redesign must preserve Markdown as a first-class interface for human inspection, diffing, and repair.
2. The redesign must preserve local/offline operation as a first-class path.
3. The redesign must preserve contract-first behavior across CLI and MCP surfaces even if the internal implementation becomes more layered.
4. The redesign must preserve backend semantic parity rather than specializing the product around a single storage engine.
5. The redesign must fit an incremental migration path from the existing repository rather than requiring a discontinuous platform reset.

## Rejected Alternatives

- Treating a graph database or graph overlay as the single canonical memory store.
- Treating long-term, short-term, cache, and note as the primary retrieval order.
- Auto-promoting inferred facts, links, or summaries directly into canonical memory.
- Mixing work memory and personal memory into one undifferentiated recall space.
- Replacing the current repository with a rewrite-first architecture before the redesign is proven in the existing product.

## Glossary

| Term | Meaning |
|---|---|
| Canonical artifact | A source of truth that may be edited, reviewed, versioned, and cited directly. |
| Derived artifact | A regenerable product created from canonical sources to improve search, navigation, explanation, or performance. |
| Task Thread | The canonical record for a unit of ongoing work across sessions, including its active state, related attempts, decisions, and next-resume context. |
| Working Set | The canonical focused projection of the files, symbols, notes, decisions, and next actions most relevant to continuing an active Task Thread; interface surfaces may render it as a resume card, but that is not a separate top-level object. |
| Memory Inbox | The canonical governance container that holds inferred, ambiguous, or not-yet-promoted memory candidates for review, promotion, rejection, or supersession. |
| Retrieval Trace | The canonical operational record of which sources, derived aids, and verification steps informed a retrieval result. |
| Promotion | The act of moving a proposed claim or relationship into canonical state after review and evidence checks. |
| Provenance | The source context attached to a claim, including where it came from and why it can be trusted. |
| Scope gate | The boundary check that determines which memory domain may participate in retrieval or write behavior for a request. |
| Operational work record | Canonical state for in-progress work continuity rather than broad world knowledge. |
| Context map | A derived structural overlay that helps the system navigate notes, code, tasks, and sources. |
| Context atlas | A higher-level derived orientation view composed from one or more context maps. |
