import type { BrainEngine } from '../engine.ts';
import type {
  MemoryCandidateEntry,
  MemoryCandidatePromotionPreflightInput,
  MemoryCandidatePromotionPreflightReason,
  MemoryCandidatePromotionPreflightResult,
  MemoryCandidateStatus,
  MemoryCandidateTargetObjectType,
} from '../types.ts';

const ALLOWED_TRANSITIONS: Record<MemoryCandidateStatus, MemoryCandidateStatus | null> = {
  captured: 'candidate',
  candidate: 'staged_for_review',
  staged_for_review: null,
};

export class MemoryInboxServiceError extends Error {
  constructor(
    public code: 'memory_candidate_not_found' | 'invalid_status_transition',
    message: string,
  ) {
    super(message);
    this.name = 'MemoryInboxServiceError';
  }
}

export interface AdvanceMemoryCandidateStatusInput {
  id: string;
  next_status: MemoryCandidateStatus;
  reviewed_at?: Date | string | null;
  review_reason?: string | null;
}

export interface RejectMemoryCandidateEntryInput {
  id: string;
  reviewed_at?: Date | string | null;
  review_reason: string;
}

export async function preflightPromoteMemoryCandidate(
  engine: BrainEngine,
  input: MemoryCandidatePromotionPreflightInput,
): Promise<MemoryCandidatePromotionPreflightResult> {
  const entry = await engine.getMemoryCandidateEntry(input.id);
  if (!entry) {
    throw new MemoryInboxServiceError(
      'memory_candidate_not_found',
      `Memory candidate not found: ${input.id}`,
    );
  }

  const denyReasons: MemoryCandidatePromotionPreflightReason[] = [];
  const deferReasons: MemoryCandidatePromotionPreflightReason[] = [];

  if (entry.status !== 'staged_for_review') {
    denyReasons.push('candidate_not_staged_for_review');
  }
  if (!hasUsableProvenance(entry)) {
    denyReasons.push('candidate_missing_provenance');
  }
  if (!hasUsableTargetBinding(entry)) {
    denyReasons.push('candidate_missing_target_object');
  }
  if (hasScopeConflict(entry)) {
    denyReasons.push('candidate_scope_conflict');
  }
  if (entry.sensitivity === 'unknown') {
    deferReasons.push('candidate_unknown_sensitivity');
  }
  if (requiresRevalidation(entry)) {
    deferReasons.push('candidate_requires_revalidation');
  }

  const reasons = denyReasons.length > 0
    ? denyReasons
    : (deferReasons.length > 0 ? deferReasons : ['candidate_ready_for_promotion']);
  const decision = denyReasons.length > 0
    ? 'deny'
    : (deferReasons.length > 0 ? 'defer' : 'allow');

  return {
    candidate_id: entry.id,
    decision,
    reasons,
    summary_lines: [
      `Promotion preflight decision: ${decision}.`,
      `Candidate ${entry.id} targets ${entry.target_object_type ?? 'none'}/${entry.target_object_id ?? 'none'}.`,
      `Reasons: ${reasons.map(formatReasonLabel).join(', ')}.`,
    ],
  };
}

export async function advanceMemoryCandidateStatus(
  engine: BrainEngine,
  input: AdvanceMemoryCandidateStatusInput,
): Promise<MemoryCandidateEntry> {
  const entry = await engine.getMemoryCandidateEntry(input.id);
  if (!entry) {
    throw new MemoryInboxServiceError(
      'memory_candidate_not_found',
      `Memory candidate not found: ${input.id}`,
    );
  }

  const allowedNext = ALLOWED_TRANSITIONS[entry.status];
  if (allowedNext !== input.next_status) {
    throw new MemoryInboxServiceError(
      'invalid_status_transition',
      `Cannot advance memory candidate from ${entry.status} to ${input.next_status}.`,
    );
  }

  return engine.updateMemoryCandidateEntryStatus(entry.id, {
    status: input.next_status,
    reviewed_at: input.reviewed_at !== undefined
      ? input.reviewed_at
      : (input.next_status === 'staged_for_review' ? new Date() : null),
    review_reason: input.review_reason ?? null,
  });
}

export async function rejectMemoryCandidateEntry(
  engine: BrainEngine,
  input: RejectMemoryCandidateEntryInput,
): Promise<MemoryCandidateEntry> {
  const entry = await engine.getMemoryCandidateEntry(input.id);
  if (!entry) {
    throw new MemoryInboxServiceError(
      'memory_candidate_not_found',
      `Memory candidate not found: ${input.id}`,
    );
  }

  if (entry.status !== 'staged_for_review') {
    throw new MemoryInboxServiceError(
      'invalid_status_transition',
      `Cannot reject memory candidate from ${entry.status}; only staged_for_review candidates may be rejected.`,
    );
  }

  return engine.updateMemoryCandidateEntryStatus(entry.id, {
    status: 'rejected',
    reviewed_at: input.reviewed_at !== undefined ? input.reviewed_at : new Date(),
    review_reason: input.review_reason,
  });
}

function hasScopeConflict(entry: MemoryCandidateEntry): boolean {
  const targetClass = classifyTargetObjectType(entry.target_object_type);
  if (targetClass === 'work_visible') {
    return entry.sensitivity === 'personal' || entry.sensitivity === 'secret';
  }
  if (targetClass === 'personal_only') {
    return entry.sensitivity === 'work';
  }
  return false;
}

function hasUsableProvenance(entry: MemoryCandidateEntry): boolean {
  return entry.source_refs.some((sourceRef) => sourceRef.trim().length > 0);
}

function hasUsableTargetBinding(entry: MemoryCandidateEntry): boolean {
  return entry.target_object_type != null
    && entry.target_object_id != null
    && entry.target_object_id.trim().length > 0;
}

function requiresRevalidation(entry: MemoryCandidateEntry): boolean {
  return entry.candidate_type === 'procedure'
    || entry.target_object_type === 'other';
}

function classifyTargetObjectType(
  targetObjectType: MemoryCandidateTargetObjectType | null,
): 'work_visible' | 'personal_only' | 'other' {
  if (targetObjectType === 'curated_note' || targetObjectType === 'procedure') {
    return 'work_visible';
  }
  if (targetObjectType === 'profile_memory' || targetObjectType === 'personal_episode') {
    return 'personal_only';
  }
  return 'other';
}

function formatReasonLabel(reason: MemoryCandidatePromotionPreflightReason): string {
  switch (reason) {
    case 'candidate_not_staged_for_review':
      return 'candidate is not staged for review';
    case 'candidate_missing_provenance':
      return 'candidate is missing provenance';
    case 'candidate_missing_target_object':
      return 'candidate is missing a target object';
    case 'candidate_scope_conflict':
      return 'candidate scope conflicts with its target';
    case 'candidate_unknown_sensitivity':
      return 'candidate sensitivity is unknown';
    case 'candidate_requires_revalidation':
      return 'candidate requires revalidation';
    case 'candidate_ready_for_promotion':
      return 'candidate is ready for promotion';
  }
}
