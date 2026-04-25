import type { BrainEngine } from '../engine.ts';
import type {
  MemoryCandidateEntry,
  MemoryCandidateSupersessionEntry,
} from '../types.ts';
import {
  MemoryInboxServiceError,
  normalizeMemoryInboxReviewedAt,
  recordMemoryCandidateStatusEvent,
} from './memory-inbox-service.ts';

export interface SupersedeMemoryCandidateEntryInput {
  superseded_candidate_id: string;
  replacement_candidate_id: string;
  reviewed_at?: Date | string | null;
  review_reason?: string | null;
  interaction_id?: string | null;
}

export interface SupersedeMemoryCandidateEntryResult {
  superseded_candidate: MemoryCandidateEntry;
  replacement_candidate: MemoryCandidateEntry;
  supersession_entry: MemoryCandidateSupersessionEntry;
}

export async function supersedeMemoryCandidateEntry(
  engine: BrainEngine,
  input: SupersedeMemoryCandidateEntryInput,
): Promise<SupersedeMemoryCandidateEntryResult> {
  const reviewedAt = normalizeMemoryInboxReviewedAt(input.reviewed_at, new Date());
  return engine.transaction(async (txBase) => {
    const tx = txBase as BrainEngine;
    if (input.superseded_candidate_id === input.replacement_candidate_id) {
      throw new MemoryInboxServiceError(
        'invalid_status_transition',
        `Cannot supersede memory candidate ${input.superseded_candidate_id} with itself.`,
      );
    }

    const supersededCandidate = await tx.getMemoryCandidateEntry(input.superseded_candidate_id);
    if (!supersededCandidate) {
      throw new MemoryInboxServiceError(
        'memory_candidate_not_found',
        `Memory candidate not found: ${input.superseded_candidate_id}`,
      );
    }

    const replacementCandidate = await tx.getMemoryCandidateEntry(input.replacement_candidate_id);
    if (!replacementCandidate) {
      throw new MemoryInboxServiceError(
        'memory_candidate_not_found',
        `Memory candidate not found: ${input.replacement_candidate_id}`,
      );
    }

    if (supersededCandidate.scope_id !== replacementCandidate.scope_id) {
      throw new MemoryInboxServiceError(
        'invalid_status_transition',
        `Cannot supersede memory candidate across scopes: ${supersededCandidate.scope_id} vs ${replacementCandidate.scope_id}.`,
      );
    }

    if (supersededCandidate.status !== 'staged_for_review' && supersededCandidate.status !== 'promoted') {
      throw new MemoryInboxServiceError(
        'invalid_status_transition',
        `Cannot supersede memory candidate from ${supersededCandidate.status}; only staged_for_review or promoted candidates may be superseded.`,
      );
    }

    if (replacementCandidate.status !== 'promoted') {
      throw new MemoryInboxServiceError(
        'invalid_status_transition',
        `Cannot supersede memory candidate with replacement status ${replacementCandidate.status}; replacement must already be promoted.`,
      );
    }

    const supersessionEntry = await tx.supersedeMemoryCandidateEntry({
      id: crypto.randomUUID(),
      scope_id: supersededCandidate.scope_id,
      superseded_candidate_id: supersededCandidate.id,
      replacement_candidate_id: replacementCandidate.id,
      expected_current_status: supersededCandidate.status,
      reviewed_at: reviewedAt,
      review_reason: input.review_reason ?? null,
      interaction_id: input.interaction_id ?? null,
    });

    if (!supersessionEntry) {
      throw new MemoryInboxServiceError(
        'invalid_status_transition',
        `Cannot supersede memory candidate ${supersededCandidate.id}; current state changed before supersession completed.`,
      );
    }

    const updatedCandidate = await tx.getMemoryCandidateEntry(supersededCandidate.id);
    if (!updatedCandidate) {
      throw new Error(`Memory candidate not found after supersession: ${supersededCandidate.id}`);
    }

    await recordMemoryCandidateStatusEvent(tx, {
      candidate: updatedCandidate,
      from_status: supersededCandidate.status,
      event_kind: 'superseded',
      interaction_id: input.interaction_id ?? null,
    });

    return {
      superseded_candidate: updatedCandidate,
      replacement_candidate: replacementCandidate,
      supersession_entry: supersessionEntry,
    };
  });
}
