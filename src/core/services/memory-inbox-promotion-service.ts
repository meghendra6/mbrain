import type { BrainEngine } from '../engine.ts';
import type { MemoryCandidateEntry } from '../types.ts';
import {
  MemoryInboxServiceError,
  normalizeMemoryInboxReviewedAt,
  preflightPromoteMemoryCandidate,
} from './memory-inbox-service.ts';

export interface PromoteMemoryCandidateEntryInput {
  id: string;
  reviewed_at?: Date | string | null;
  review_reason?: string | null;
}

export async function promoteMemoryCandidateEntry(
  engine: BrainEngine,
  input: PromoteMemoryCandidateEntryInput,
): Promise<MemoryCandidateEntry> {
  const reviewedAt = normalizeMemoryInboxReviewedAt(input.reviewed_at, new Date());
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
      `Cannot promote memory candidate from ${entry.status}; only staged_for_review candidates may be promoted.`,
    );
  }

  const preflight = await preflightPromoteMemoryCandidate(engine, { id: input.id });
  if (preflight.decision !== 'allow') {
    throw new MemoryInboxServiceError(
      'promotion_preflight_failed',
      `Cannot promote memory candidate ${input.id}: ${preflight.reasons.join(', ')}.`,
    );
  }

  const promoted = await engine.promoteMemoryCandidateEntry(entry.id, {
    expected_current_status: 'staged_for_review',
    reviewed_at: reviewedAt,
    review_reason: input.review_reason ?? null,
  });
  if (!promoted) {
    throw new MemoryInboxServiceError(
      'invalid_status_transition',
      `Cannot promote memory candidate ${input.id}; current state changed before promotion completed.`,
    );
  }
  return promoted;
}
