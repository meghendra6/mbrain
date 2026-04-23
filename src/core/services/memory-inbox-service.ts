import type { BrainEngine } from '../engine.ts';
import type {
  MemoryCandidateEntry,
  MemoryCandidatePromotionPreflightInput,
  MemoryCandidatePromotionPreflightReason,
  MemoryCandidatePromotionPreflightResult,
  MemoryCandidateStatus,
  MemoryCandidateTargetObjectType,
} from '../types.ts';

type AdvanceableMemoryCandidateStatus = 'captured' | 'candidate' | 'staged_for_review';
type MemoryCandidateAdvanceTargetStatus = 'candidate' | 'staged_for_review';

const ALLOWED_TRANSITIONS: Record<
  AdvanceableMemoryCandidateStatus,
  MemoryCandidateAdvanceTargetStatus | null
> = {
  captured: 'candidate',
  candidate: 'staged_for_review',
  staged_for_review: null,
};
const ISO_DATETIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(?:Z|([+-])(\d{2}):(\d{2}))$/;

export class MemoryInboxServiceError extends Error {
  constructor(
    public code: 'memory_candidate_not_found' | 'invalid_status_transition' | 'promotion_preflight_failed',
    message: string,
  ) {
    super(message);
    this.name = 'MemoryInboxServiceError';
  }
}

export interface AdvanceMemoryCandidateStatusInput {
  id: string;
  next_status: MemoryCandidateAdvanceTargetStatus;
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

  const reasons: MemoryCandidatePromotionPreflightReason[] = denyReasons.length > 0
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

  const allowedNext = getAllowedAdvanceTargetStatus(entry.status);
  if (allowedNext !== input.next_status) {
    throw new MemoryInboxServiceError(
      'invalid_status_transition',
      `Cannot advance memory candidate from ${entry.status} to ${input.next_status}.`,
    );
  }

  const advanced = await engine.updateMemoryCandidateEntryStatus(entry.id, {
    status: input.next_status,
    reviewed_at: normalizeMemoryInboxReviewedAt(
      input.reviewed_at,
      input.next_status === 'staged_for_review' ? new Date() : null,
    ),
    review_reason: input.review_reason ?? null,
  });
  if (!advanced) {
    throw new MemoryInboxServiceError(
      'invalid_status_transition',
      `Cannot advance memory candidate ${entry.id}; current state changed before advance completed.`,
    );
  }
  return advanced;
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

  const rejected = await engine.updateMemoryCandidateEntryStatus(entry.id, {
    status: 'rejected',
    reviewed_at: normalizeMemoryInboxReviewedAt(input.reviewed_at, new Date()),
    review_reason: input.review_reason,
  });
  if (!rejected) {
    throw new MemoryInboxServiceError(
      'invalid_status_transition',
      `Cannot reject memory candidate ${entry.id}; current state changed before rejection completed.`,
    );
  }
  return rejected;
}

export function normalizeMemoryInboxReviewedAt(
  value: Date | string | null | undefined,
  fallback: Date | string | null,
): Date | string | null;
export function normalizeMemoryInboxReviewedAt(
  value: Date | string | null | undefined,
  fallback: undefined,
): Date | string | null | undefined;
export function normalizeMemoryInboxReviewedAt(
  value: Date | string | null | undefined,
  fallback: Date | string | null | undefined,
): Date | string | null | undefined {
  const resolved = value === undefined ? fallback : value;
  if (resolved === undefined || resolved === null) {
    return resolved;
  }
  if (resolved instanceof Date) {
    if (Number.isNaN(resolved.getTime())) {
      throw new MemoryInboxServiceError(
        'invalid_status_transition',
        'reviewed_at must be a valid Date when provided.',
      );
    }
    return resolved;
  }
  if (!isValidIsoDatetime(resolved)) {
    throw new MemoryInboxServiceError(
      'invalid_status_transition',
      'reviewed_at must be a valid ISO datetime string when provided.',
    );
  }
  return resolved;
}

function isValidIsoDatetime(value: string): boolean {
  const match = ISO_DATETIME_PATTERN.exec(value);
  if (!match) {
    return false;
  }

  const [, yearRaw, monthRaw, dayRaw, hourRaw, minuteRaw, secondRaw, _millisRaw, offsetSign, offsetHourRaw, offsetMinuteRaw] = match;
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  const second = Number(secondRaw);

  if (month < 1 || month > 12) {
    return false;
  }
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > maxDay) {
    return false;
  }
  if (hour > 23 || minute > 59 || second > 59) {
    return false;
  }
  if (offsetSign) {
    const offsetHour = Number(offsetHourRaw);
    const offsetMinute = Number(offsetMinuteRaw);
    if (offsetHour > 23 || offsetMinute > 59) {
      return false;
    }
  }
  return true;
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

function getAllowedAdvanceTargetStatus(
  status: MemoryCandidateStatus,
): MemoryCandidateAdvanceTargetStatus | null {
  switch (status) {
    case 'captured':
    case 'candidate':
    case 'staged_for_review':
      return ALLOWED_TRANSITIONS[status];
    case 'rejected':
    case 'promoted':
      return null;
  }
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
