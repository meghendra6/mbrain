# MBrain Redesign Memory Operations Control Plane

This document defines the Phase 9 control layer for durable memory operations in `mbrain`. It is inspired by managed-agent memory control ideas, but it adapts them to the existing local-first architecture, canonical Markdown contract, scope gates, Memory Inbox, and operational-memory records already defined in `00-principles-and-invariants.md` through `08-evaluation-and-acceptance.md`.

## Why This Layer Exists

Earlier redesign phases define what memory exists, how retrieval is routed, how candidates are reviewed, and how work and personal scope stay isolated. Phase 9 adds the missing control plane around memory mutation itself.

The control plane answers five operational questions:

1. Who or what tried to change durable memory?
2. Under which realm, session, scope, source refs, and allowed operations did it act?
3. What canonical object or review candidate was targeted, and what content hash was expected?
4. Was the result applied, dry-run, conflicted, denied, failed, redacted, or left for review?
5. Are recent memory operations safe, useful, and auditable enough to trust?

This layer does not replace canonical Markdown, task memory, context maps, the Memory Inbox, or profile memory. It wraps those systems with explicit execution context, audit records, reviewable patch boundaries, redaction workflow, and health reporting.

## Scope

This workstream owns:

- `Memory Mutation Ledger` as the append-only event record for durable memory mutation attempts
- `Memory Realm` as the isolation domain for work, personal, and explicitly mixed memory usage
- `Memory Session` as the per-interaction or per-agent memory-access context and audit boundary
- `Reviewable Patch Candidate` as a structured proposed edit against canonical memory that extends the Memory Inbox
- `Redaction Plan` as the auditable forgetting and redaction workflow
- `Memory Operations Health` as the reporting surface for safety, usefulness, backlog, and anomaly signals

It does not own:

- canonical Markdown note content from `00-principles-and-invariants.md`
- retrieval route selection from `02-memory-loop-and-protocols.md`
- Task Thread, Working Set, Event, Episode, Attempt, Decision, or Procedure lifecycles from `04-workstream-operational-memory.md`
- derived map generation, map freshness, or atlas behavior from `05-workstream-context-map.md`
- Memory Inbox governance state machines except where patch candidates extend them, as defined in `06-workstream-governance-and-inbox.md`
- Profile Memory, Personal Episodes, or base scope-gate policy from `07-workstream-profile-memory-and-scope.md`
- global evaluation thresholds from `08-evaluation-and-acceptance.md`

The control plane is therefore not a new memory store. It is the contract that makes memory operations explicit, bounded, reviewable, and measurable.

## Core Objects

| Object | Role | Canonical Status | Primary Owner Boundary |
|---|---|---|---|
| Memory Mutation Ledger | Append-only audit event for every attempted durable memory mutation, including provenance, actor, operation, target, expected and current content hashes, result, conflict info, dry-run flag, timestamps, and redaction visibility. | Canonical DB-backed audit record. | Phase 9 control plane. |
| Memory Realm | Explicit isolation domain such as `work`, `personal`, or `mixed`, with default scope policy, allowed target kinds, export and sync visibility, and access boundaries. | Canonical policy record. | Phase 9 control plane, aligned with `07`. |
| Memory Session | Per-interaction or per-agent context binding a caller to one realm, one actor, allowed scopes, allowed operations, source refs, optional expiry, and audit metadata. | Canonical DB-backed execution context. | Phase 9 control plane. |
| Reviewable Patch Candidate | Structured proposed edit against canonical memory, including target, base content hash, expected patch body, risk, sensitivity, provenance, and review status. | Canonical governance candidate, extending the Memory Inbox. | `06` owns review lifecycle; Phase 9 owns patch-operation shape and ledger linkage. |
| Redaction Plan | Auditable workflow for tombstoning or redacting canonical memory, linked artifacts, candidates, and ledger visibility without silent deletion. | Canonical DB-backed governance and audit record. | Phase 9 control plane, with target-domain handoff. |
| Memory Operations Health Report | Point-in-time report over ledger, sessions, realms, candidates, and redaction plans. | Derived report over canonical records. | Phase 9 control plane. |

### Memory Mutation Ledger

The ledger records mutation attempts, not only successful writes. A durable memory operation must produce a ledger event when it attempts to create, update, promote, reject, supersede, redact, tombstone, export, sync, or otherwise alter canonical memory or review state.

Each ledger event should capture at least:

| Field | Purpose |
|---|---|
| `id` | Stable event identity. |
| `sessionId` and `realmId` | Bind the event to memory-access context and isolation domain. |
| `actor` | Identify the human, agent, import process, CLI, MCP caller, or background job. |
| `operation` | Stable operation name such as `create_candidate`, `apply_patch`, `promote_candidate`, or `execute_redaction`. |
| `targetKind` and `targetId` | Name the canonical or governance object being changed. |
| `sourceRefs` | Preserve provenance handles that justified the attempted mutation. |
| `expectedContentHash` | Capture the base hash the caller believed it was changing. |
| `currentContentHash` | Capture the observed hash at execution time, if available. |
| `result` | One of `dry_run`, `applied`, `conflict`, `denied`, `failed`, or `redacted`. |
| `conflictInfo` | Explain hash mismatch, scope mismatch, contradiction, stale source, or policy failure. |
| `dryRun` | Mark whether the operation was simulated rather than applied. |
| `createdAt`, `decidedAt`, `appliedAt` | Preserve timing across proposal, review, and application. |
| `redactionVisibility` | Explain whether event details are visible, partially redacted, or tombstoned. |

The ledger is append-only. Corrections are new events that reference prior events. Redaction may hide sensitive payload fields, but it must not erase the fact that an event existed.

### Memory Realms

A realm is the explicit isolation domain for memory operations. The default realms are:

| Realm | Default Scope Policy | Allowed Target Kinds | Export and Sync Visibility |
|---|---|---|---|
| `work` | Work memory only unless mixed access is explicitly requested. | Task memory, curated work Markdown, work Source Records, work candidates, work procedures, work maps. | Eligible for work export and sync according to repo policy; excludes personal records by default. |
| `personal` | Personal memory only unless mixed access is explicitly requested. | Profile Memory, Personal Episodes, personal candidates, personal source artifacts, personal maps. | Private by default; selected export only when explicitly allowed by `07`. |
| `mixed` | Explicit bridge between work and personal domains for a named purpose. | Minimum necessary work and personal targets named by policy or session. | No broad export by default; sync/export must preserve per-target visibility. |

Realm rules:

1. Every memory session belongs to exactly one realm.
2. Realm policy constrains allowed scopes, target kinds, operations, export behavior, and sync visibility.
3. Mixed realm access is never inferred from convenience. It requires an explicit reason and minimal target set.
4. Realm policy cannot weaken the scope and privacy invariants in `00-principles-and-invariants.md` or `07-workstream-profile-memory-and-scope.md`.

### Memory Sessions

A memory session is not user authentication. It is the memory-access context and audit boundary for one interaction, one agent run, one CLI command, one import, or one background job.

Each session should capture:

- `id`
- `realmId`
- `actor`
- `callerKind`
- `allowedScopes`
- `allowedOperations`
- `allowedTargetKinds`
- `sourceRefs`
- `createdAt`
- optional `expiresAt`
- `status` such as `active`, `expired`, `closed`, or `revoked`

Session rules:

1. Durable memory mutations require an active session.
2. A session may narrow realm permissions, but it may not expand beyond realm policy.
3. Expired, closed, or revoked sessions must not apply new durable mutations.
4. Session identity must appear in ledger events and health reports.
5. Sessions support local CLI and MCP callers equally; they do not imply cloud accounts or remote identity.

### Reviewable Patch Candidates

Patch candidates are structured proposed edits against canonical memory. They extend the Memory Inbox from `06-workstream-governance-and-inbox.md`; they do not bypass it.

Each patch candidate should capture:

- target kind and target id
- base content hash
- expected patch body
- patch format or operation type
- source refs and provenance summary
- actor and originating session
- risk class
- sensitivity class
- expected resulting content hash, when computable
- review status such as `captured`, `staged_for_review`, `approved`, `rejected`, `superseded`, `applied`, or `conflicted`
- linked mutation ledger event ids

Patch candidates are required when the system proposes a durable edit that is not a direct authoritative write under `02-memory-loop-and-protocols.md`. Direct task-continuity writes may still be recorded in the ledger without entering the inbox, but inferred, ambiguous, cross-scope, high-risk, or review-requiring changes must become candidates.

### Redaction Plans

A redaction plan is the controlled path for forgetting, hiding, or tombstoning sensitive memory without silently deleting history.

Each plan should capture:

- target records and linked artifacts
- reason and source refs
- requested actor and reviewing actor
- realm and session context
- redaction mode such as `field_redaction`, `payload_redaction`, `tombstone`, or `visibility_restriction`
- affected candidates and ledger events
- dry-run impact summary
- review status
- execution result
- rollback or restoration notes where policy allows them

Redaction rules:

1. Redaction is an operation, not an untracked delete.
2. Canonical records may be tombstoned or have sensitive fields redacted, but provenance of the redaction decision must remain auditable.
3. Ledger event visibility may be reduced, but the existence of the event remains visible unless a stricter local policy explicitly tombstones even the event shell.
4. Redaction plans must include linked artifacts so derived maps, candidates, exports, and sync surfaces do not keep stale sensitive copies.

### Memory Operations Health

The health surface reports whether recent memory operations were safe and useful. It is a derived report over canonical sessions, realms, ledger events, candidates, and redaction plans.

Minimum report categories:

- mutation counts by realm, actor, operation, target kind, and result
- conflict, denial, failure, dry-run, applied, and redacted rates
- stale candidate backlog and age distribution
- patch candidates waiting for review or stuck after approval
- realm anomalies such as unexpected target kind or cross-realm attempt
- session anomalies such as expired-session mutation attempts or overbroad permissions
- redaction backlog and failed redaction execution
- source-ref completeness for mutation events
- hash mismatch frequency by target kind

Health reporting is not acceptance by itself. It supplies evidence for the evaluation contract in `08-evaluation-and-acceptance.md`.

## Lifecycle

The default mutation lifecycle is:

```text
create_memory_session
  -> dry_run_memory_mutation | create_memory_patch_candidate | direct_allowed_mutation
  -> record_memory_mutation_event
  -> review_memory_patch_candidate, when review is required
  -> apply, reject, supersede, deny, conflict, fail, or redact
  -> record_memory_mutation_event
  -> get_memory_operations_health
```

Rules:

1. A caller starts with a memory session bound to one realm and one actor.
2. The session checks allowed scopes, allowed operations, allowed target kinds, expiry, and source refs before mutation.
3. A dry run may calculate target resolution, hash comparison, scope policy, sensitivity, and redaction impact without changing canonical state.
4. A direct authoritative write may apply only when existing workstream contracts allow it.
5. A reviewable or risky write becomes a patch candidate in the Memory Inbox.
6. Application rechecks the base content hash before modifying canonical state.
7. Conflicts, denials, failures, redactions, and successful applications are all ledger events.
8. Health reports aggregate the recent event stream and backlog state without becoming canonical truth.

## Boundaries With Existing Workstreams

| Existing Document | Boundary |
|---|---|
| `00-principles-and-invariants.md` | Phase 9 preserves Markdown, provenance, local-first operation, backend parity, and scope isolation. It does not redefine canonical source classes. |
| `02-memory-loop-and-protocols.md` | Phase 9 records and constrains durable writes after route and scope decisions. It does not replace retrieval routing, verification rules, or the candidate lifecycle. |
| `04-workstream-operational-memory.md` | Task Thread, Working Set, Event, Episode, Attempt, Decision, and Procedure remain owned by operational memory. Their mutations are audited through the ledger when durable state changes. |
| `05-workstream-context-map.md` | Context maps remain derived. Phase 9 can audit map-triggered candidates and redaction propagation, but it does not make maps canonical. |
| `06-workstream-governance-and-inbox.md` | Reviewable Patch Candidates extend Memory Inbox records. Promotion, rejection, supersession, contradiction, and review state remain governed by `06`. |
| `07-workstream-profile-memory-and-scope.md` | Realms and sessions enforce, record, and report scope boundaries. They do not relax personal/work isolation. |
| `08-evaluation-and-acceptance.md` | Memory Operations Health contributes acceptance evidence for safety and provenance. It does not replace baseline thresholds or phase acceptance rules. |

## Safety Invariants

1. Every durable memory mutation attempt must produce a Memory Mutation Ledger event.
2. Every applied mutation must have an active Memory Session and one Memory Realm.
3. A session may not apply operations outside its realm policy, allowed scopes, allowed target kinds, or expiry window.
4. Mixed realm writes require an explicit reason and named target set.
5. Expected content hashes must be checked before applying patch candidates or redaction plans to canonical content.
6. Hash mismatch is a conflict, not an implicit overwrite.
7. Reviewable Patch Candidates extend the Memory Inbox and must not bypass review when the existing governance contract requires review.
8. Redaction must be auditable. Sensitive payloads may be hidden, but the redaction action must not disappear silently.
9. Derived artifacts may be redacted, rebuilt, or marked stale after a redaction plan, but they do not become canonical sources.
10. Health reports are diagnostic projections, not a second authority for memory truth.

## MCP / CLI Surface

The public surface should use stable operation names across MCP and CLI even if exact command syntax differs.

| Operation | Purpose | Mutation Behavior |
|---|---|---|
| `create_memory_session` | Start a memory-access context for one actor in one realm. | Creates session record. |
| `get_memory_session` | Fetch session policy, status, expiry, and allowed operations. | Read-only. |
| `list_memory_sessions` | List sessions by realm, actor, status, or time window. | Read-only. |
| `close_memory_session` | Close a session so no further mutations can apply under it. | Creates session status change and ledger event if policy requires. |
| `dry_run_memory_mutation` | Validate target, scope, operation, hashes, and policy without applying the mutation. | Creates dry-run ledger event. |
| `record_memory_mutation_event` | Append an explicit ledger event for an attempted or completed mutation. | Creates ledger event. |
| `list_memory_mutation_events` | Query ledger events by session, realm, actor, operation, target, result, or time window. | Read-only. |
| `create_memory_patch_candidate` | Create a structured proposed edit against canonical memory. | Creates candidate and ledger event. |
| `dry_run_memory_patch_candidate` | Compute hash, policy, sensitivity, and expected patch impact without staging or applying. | Creates dry-run ledger event. |
| `review_memory_patch_candidate` | Approve, reject, supersede, or request changes for a patch candidate. | Updates candidate review state and records ledger event. |
| `apply_memory_patch_candidate` | Apply an approved patch after hash and policy checks. | Mutates target canonical state and records ledger event. |
| `create_redaction_plan` | Create an auditable redaction or tombstone proposal. | Creates redaction plan and ledger event. |
| `dry_run_redaction_plan` | Report affected targets, candidates, ledger visibility, maps, exports, and sync surfaces. | Creates dry-run ledger event. |
| `execute_redaction_plan` | Apply an approved redaction plan. | Mutates target visibility or payload fields and records ledger event. |
| `get_memory_operations_health` | Report recent mutation safety, usefulness, backlog, realm/session anomalies, and redaction status. | Read-only derived report. |

Representative CLI projections:

```bash
mbrain memory session create --realm work --actor codex --allow apply_patch,create_candidate
mbrain memory mutation dry-run --session <session-id> --target note:<slug> --operation apply_patch
mbrain memory ledger list --realm work --result conflict --since 24h
mbrain memory patch create --session <session-id> --target note:<slug> --base-hash <hash>
mbrain memory patch review <candidate-id> --approve
mbrain memory redaction create --session <session-id> --target profile:<id> --mode payload_redaction
mbrain memory health --realm work --since 7d
```

Representative MCP tool names:

```text
create_memory_session
get_memory_session
list_memory_sessions
close_memory_session
dry_run_memory_mutation
record_memory_mutation_event
list_memory_mutation_events
create_memory_patch_candidate
dry_run_memory_patch_candidate
review_memory_patch_candidate
apply_memory_patch_candidate
create_redaction_plan
dry_run_redaction_plan
execute_redaction_plan
get_memory_operations_health
```

## Evaluation and Acceptance

Phase 9 acceptance extends the measurement contract in `08-evaluation-and-acceptance.md`.

Required test areas:

- ledger append-only behavior for applied, dry-run, conflict, denied, failed, and redacted events
- session enforcement for realm, actor, allowed scopes, allowed operations, allowed target kinds, and expiry
- realm isolation tests for work, personal, and mixed operations
- patch-candidate hash conflict tests
- inbox integration tests confirming reviewable patch candidates do not bypass `06`
- redaction-plan tests confirming canonical targets, candidates, derived artifacts, exports, sync visibility, and ledger visibility are handled explicitly
- MCP and CLI parity tests for operation semantics
- health-report tests for counts, rates, backlog, anomaly, and source-ref completeness fields

Required evaluation measures:

- ledger coverage rate for durable memory mutation attempts
- denied, conflict, failed, applied, dry-run, and redacted mutation rates
- session-policy violation rate
- realm-leak incident count
- stale patch-candidate backlog
- redaction backlog age and failure rate
- mutation source-ref completeness
- health-report freshness and query latency under local execution

Acceptance rules:

1. Durable memory mutation attempts must have ledger coverage at `100%` on the acceptance workload.
2. Realm-leak incidents and session-policy bypass incidents must remain `0`.
3. Patch application must reject stale base hashes rather than overwriting silently.
4. Redaction must leave an auditable trail while removing or hiding sensitive payloads according to plan.
5. CLI and MCP surfaces must preserve the same operation semantics.
6. The local/offline path must remain usable without network dependence for core control-plane operations.

## Phase 9 Implementation Slices

1. Define storage contracts for Memory Realms, Memory Sessions, and the Memory Mutation Ledger.
2. Add session creation, lookup, listing, closure, and expiry enforcement.
3. Add mutation-event recording and ledger query operations.
4. Add dry-run mutation validation for target resolution, scope policy, operation policy, source refs, and content hashes.
5. Extend Memory Inbox records with Reviewable Patch Candidate fields and review transitions.
6. Add patch application with expected-hash conflict detection and ledger recording.
7. Add Redaction Plan creation, dry-run impact reporting, approval, execution, and derived-artifact invalidation hooks.
8. Add Memory Operations Health reporting over ledger events, sessions, realms, candidates, and redaction plans.
9. Add MCP and CLI projections for the stable operations in this document.
10. Add evaluation workloads and acceptance checks tied back to `08-evaluation-and-acceptance.md`.

The implementation order should keep the ledger and sessions first. Patch candidates, redaction, and health reporting are safer once every durable mutation attempt already has a consistent audit boundary.
