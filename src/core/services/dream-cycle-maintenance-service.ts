import type { BrainEngine } from '../engine.ts';
import type {
  MemoryCandidateEntry,
  MemoryCandidateEntryInput,
  MemoryCandidateSensitivity,
  MemoryCandidateTargetObjectType,
  MemoryCandidateType,
} from '../types.ts';
import { assessHistoricalValidity } from './historical-validity-service.ts';
import { buildMemoryCandidateReviewBacklog } from './memory-candidate-dedup-service.ts';
import { MemoryInboxServiceError } from './memory-inbox-service.ts';

type DreamCycleSuggestionType = 'recap' | 'stale_claim_challenge' | 'duplicate_merge';
type DreamCycleSuggestionStatus = 'created' | 'dry_run';

export interface RunDreamCycleMaintenanceInput {
  scope_id: string;
  now?: Date | string | null;
  limit?: number;
  write_candidates?: boolean;
}

export interface DreamCycleMaintenanceSuggestion {
  suggestion_type: DreamCycleSuggestionType;
  candidate_id: string | null;
  source_candidate_ids: string[];
  target_object_type: MemoryCandidateTargetObjectType | null;
  target_object_id: string | null;
  status: DreamCycleSuggestionStatus;
  summary_lines: string[];
}

export interface DreamCycleMaintenanceResult {
  scope_id: string;
  generated_at: string;
  write_candidates: boolean;
  suggestions: DreamCycleMaintenanceSuggestion[];
  summary_lines: string[];
}

interface DraftSuggestion {
  suggestion_type: DreamCycleSuggestionType;
  source_candidate_ids: string[];
  target_object_type: MemoryCandidateTargetObjectType | null;
  target_object_id: string | null;
  candidate_type: MemoryCandidateType;
  proposed_content: string;
  source_refs: string[];
  extraction_kind: 'inferred' | 'ambiguous';
  confidence_score: number;
  importance_score: number;
  recurrence_score: number;
  sensitivity: MemoryCandidateSensitivity;
  summary_lines: string[];
}

const DEFAULT_DREAM_CYCLE_LIMIT = 20;
const MAX_DREAM_CYCLE_LIMIT = 100;
const MAX_DREAM_CYCLE_INPUT_CANDIDATES = 100;
const ISO_DATETIME_PREFIX = /^\d{4}-\d{2}-\d{2}T/;

export async function runDreamCycleMaintenance(
  engine: BrainEngine,
  input: RunDreamCycleMaintenanceInput,
): Promise<DreamCycleMaintenanceResult> {
  const scopeId = normalizeScopeId(input.scope_id);
  const now = normalizeNow(input.now);
  const limit = normalizeLimit(input.limit);
  const writeCandidates = input.write_candidates ?? true;
  if (limit <= 0) {
    return {
      scope_id: scopeId,
      generated_at: now.toISOString(),
      write_candidates: writeCandidates,
      suggestions: [],
      summary_lines: [
        `Dream-cycle maintenance inspected 0 candidates in ${scopeId}.`,
        'Emitted 0 bounded suggestions.',
        `Write candidates: ${writeCandidates ? 'yes' : 'no'}.`,
      ],
    };
  }
  const candidates = (await listMaintenanceCandidateWindow(engine, scopeId))
    .filter((candidate) => candidate.generated_by !== 'dream_cycle');
  const drafts = await buildDraftSuggestions(engine, {
    candidates,
    limit,
    now,
    scope_id: scopeId,
  });
  const suggestions: DreamCycleMaintenanceSuggestion[] = [];

  if (writeCandidates && drafts.length > 0) {
    await engine.transaction(async (tx) => {
      for (const draft of drafts) {
        const candidateId = (await tx.createMemoryCandidateEntry(toCandidateInput(scopeId, draft, now))).id;

        suggestions.push(toSuggestion(draft, candidateId, 'created'));
      }
    });
  } else {
    for (const draft of drafts) {
      suggestions.push(toSuggestion(draft, null, 'dry_run'));
    }
  }

  return {
    scope_id: scopeId,
    generated_at: now.toISOString(),
    write_candidates: writeCandidates,
    suggestions,
    summary_lines: [
      `Dream-cycle maintenance inspected ${candidates.length} candidates in ${scopeId}.`,
      `Emitted ${suggestions.length} bounded suggestions.`,
      `Write candidates: ${writeCandidates ? 'yes' : 'no'}.`,
    ],
  };
}

function toSuggestion(
  draft: DraftSuggestion,
  candidateId: string | null,
  status: DreamCycleSuggestionStatus,
): DreamCycleMaintenanceSuggestion {
  return {
    suggestion_type: draft.suggestion_type,
    candidate_id: candidateId,
    source_candidate_ids: draft.source_candidate_ids,
    target_object_type: draft.target_object_type,
    target_object_id: draft.target_object_id,
    status,
    summary_lines: draft.summary_lines,
  };
}

async function buildDraftSuggestions(
  engine: BrainEngine,
  input: {
    scope_id: string;
    candidates: MemoryCandidateEntry[];
    now: Date;
    limit: number;
  },
): Promise<DraftSuggestion[]> {
  const drafts: DraftSuggestion[] = [];
  if (input.limit <= 0 || input.candidates.length === 0) {
    return drafts;
  }

  drafts.push(buildRecapSuggestion(input.scope_id, input.candidates));
  if (drafts.length >= input.limit) {
    return drafts;
  }

  for (const candidate of sortCandidates(input.candidates.filter((entry) => entry.status === 'promoted'))) {
    const assessment = await assessHistoricalValidity(engine, {
      candidate_id: candidate.id,
      now: input.now,
    });
    if (assessment.decision === 'allow') {
      continue;
    }
    drafts.push(buildStaleClaimChallenge(candidate, assessment.handoff_id));
    if (drafts.length >= input.limit) {
      return drafts;
    }
  }

  const backlog = buildMemoryCandidateReviewBacklog(input.candidates);
  for (const group of backlog) {
    if (group.duplicate_count <= 1) {
      continue;
    }
    drafts.push(buildDuplicateMergeSuggestion(group.representative_candidate, group.grouped_candidate_ids));
    if (drafts.length >= input.limit) {
      return drafts;
    }
  }

  return drafts;
}

function buildRecapSuggestion(scopeId: string, candidates: MemoryCandidateEntry[]): DraftSuggestion {
  const statusCounts = new Map<string, number>();
  for (const candidate of candidates) {
    statusCounts.set(candidate.status, (statusCounts.get(candidate.status) ?? 0) + 1);
  }
  const statusSummary = [...statusCounts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([status, count]) => `${status}:${count}`)
    .join(', ');

  return {
    suggestion_type: 'recap',
    source_candidate_ids: sortCandidateIds(candidates.map((candidate) => candidate.id)),
    target_object_type: null,
    target_object_id: null,
    candidate_type: 'rationale',
    proposed_content: `Dream-cycle recap for ${scopeId}: ${statusSummary}.`,
    source_refs: sortCandidateIds(candidates.map((candidate) => `memory_candidate:${candidate.id}`)),
    extraction_kind: 'inferred',
    confidence_score: 0.7,
    importance_score: 0.5,
    recurrence_score: 0,
    sensitivity: 'work',
    summary_lines: [
      `Recap candidate count: ${candidates.length}.`,
      `Status counts: ${statusSummary}.`,
    ],
  };
}

function buildStaleClaimChallenge(candidate: MemoryCandidateEntry, handoffId: string | null): DraftSuggestion {
  const sourceRefs = [`memory_candidate:${candidate.id}`];
  if (handoffId) {
    sourceRefs.push(`canonical_handoff:${handoffId}`);
  }

  return {
    suggestion_type: 'stale_claim_challenge',
    source_candidate_ids: [candidate.id],
    target_object_type: candidate.target_object_type,
    target_object_id: candidate.target_object_id,
    candidate_type: 'open_question',
    proposed_content: `Dream-cycle stale-claim challenge for candidate ${candidate.id}: verify whether the handed-off claim is still current.`,
    source_refs: sourceRefs,
    extraction_kind: 'ambiguous',
    confidence_score: 0.65,
    importance_score: Math.max(0.5, candidate.importance_score),
    recurrence_score: candidate.recurrence_score,
    sensitivity: candidate.sensitivity,
    summary_lines: [
      `Candidate ${candidate.id} did not pass historical-validity maintenance.`,
      `Target: ${candidate.target_object_type ?? 'none'}/${candidate.target_object_id ?? 'none'}.`,
    ],
  };
}

function buildDuplicateMergeSuggestion(
  representative: MemoryCandidateEntry,
  groupedCandidateIds: string[],
): DraftSuggestion {
  const sortedIds = sortCandidateIds(groupedCandidateIds);

  return {
    suggestion_type: 'duplicate_merge',
    source_candidate_ids: sortedIds,
    target_object_type: representative.target_object_type,
    target_object_id: representative.target_object_id,
    candidate_type: 'rationale',
    proposed_content: `Dream-cycle duplicate-merge suggestion for ${sortedIds.length} memory candidates targeting ${representative.target_object_id ?? 'none'}.`,
    source_refs: sortedIds.map((id) => `memory_candidate:${id}`),
    extraction_kind: 'inferred',
    confidence_score: 0.75,
    importance_score: representative.importance_score,
    recurrence_score: representative.recurrence_score,
    sensitivity: representative.sensitivity,
    summary_lines: [
      `Duplicate candidate group size: ${sortedIds.length}.`,
      `Representative candidate: ${representative.id}.`,
    ],
  };
}

function toCandidateInput(
  scopeId: string,
  draft: DraftSuggestion,
  now: Date,
): MemoryCandidateEntryInput {
  return {
    id: crypto.randomUUID(),
    scope_id: scopeId,
    candidate_type: draft.candidate_type,
    proposed_content: draft.proposed_content,
    source_refs: draft.source_refs,
    generated_by: 'dream_cycle',
    extraction_kind: draft.extraction_kind,
    confidence_score: draft.confidence_score,
    importance_score: draft.importance_score,
    recurrence_score: draft.recurrence_score,
    sensitivity: draft.sensitivity,
    status: 'candidate',
    target_object_type: draft.target_object_type,
    target_object_id: draft.target_object_id,
    reviewed_at: now,
    review_reason: 'Generated by dream-cycle maintenance.',
  };
}

async function listMaintenanceCandidateWindow(engine: BrainEngine, scopeId: string): Promise<MemoryCandidateEntry[]> {
  return engine.listMemoryCandidateEntries({
    scope_id: scopeId,
    limit: MAX_DREAM_CYCLE_INPUT_CANDIDATES,
    offset: 0,
  });
}

function normalizeScopeId(value: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new MemoryInboxServiceError('invalid_status_transition', 'scope_id must be a non-empty string.');
  }
  return value;
}

function normalizeLimit(value: number | undefined): number {
  if (value == null) {
    return DEFAULT_DREAM_CYCLE_LIMIT;
  }
  if (!Number.isFinite(value) || value < 0) {
    throw new MemoryInboxServiceError('invalid_status_transition', 'limit must be a non-negative number.');
  }
  return Math.min(Math.floor(value), MAX_DREAM_CYCLE_LIMIT);
}

function normalizeNow(value: Date | string | null | undefined): Date {
  if (value == null) {
    return new Date();
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new MemoryInboxServiceError('invalid_status_transition', 'now must be a valid Date when provided.');
    }
    return value;
  }
  if (typeof value !== 'string' || !ISO_DATETIME_PREFIX.test(value)) {
    throw new MemoryInboxServiceError('invalid_status_transition', 'now must be a valid ISO datetime string.');
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new MemoryInboxServiceError('invalid_status_transition', 'now must be a valid ISO datetime string.');
  }
  return parsed;
}

function sortCandidates(candidates: MemoryCandidateEntry[]): MemoryCandidateEntry[] {
  return [...candidates].sort((left, right) => {
    const updatedDelta = right.updated_at.getTime() - left.updated_at.getTime();
    if (updatedDelta !== 0) {
      return updatedDelta;
    }
    return left.id.localeCompare(right.id);
  });
}

function sortCandidateIds(ids: string[]): string[] {
  return [...ids].sort((left, right) => left.localeCompare(right));
}
