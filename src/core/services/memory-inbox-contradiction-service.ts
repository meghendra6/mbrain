import type { BrainEngine } from '../engine.ts';
import type {
  MemoryCandidateContradictionEntry,
  MemoryCandidateContradictionOutcome,
  MemoryCandidateEntry,
  MemoryCandidateSupersessionEntry,
} from '../types.ts';
import {
  MemoryInboxServiceError,
  normalizeMemoryInboxReviewedAt,
  rejectMemoryCandidateEntry,
} from './memory-inbox-service.ts';
import { supersedeMemoryCandidateEntry } from './memory-inbox-supersession-service.ts';

export interface ResolveMemoryCandidateContradictionInput {
  candidate_id: string;
  challenged_candidate_id: string;
  outcome: MemoryCandidateContradictionOutcome;
  reviewed_at?: Date | string | null;
  review_reason?: string | null;
  interaction_id?: string | null;
}

export interface ResolveMemoryCandidateContradictionResult {
  contradiction_entry: MemoryCandidateContradictionEntry;
  candidate: MemoryCandidateEntry;
  challenged_candidate: MemoryCandidateEntry;
  supersession_entry: MemoryCandidateSupersessionEntry | null;
}

export async function resolveMemoryCandidateContradiction(
  engine: BrainEngine,
  input: ResolveMemoryCandidateContradictionInput,
): Promise<ResolveMemoryCandidateContradictionResult> {
  const reviewedAt = normalizeMemoryInboxReviewedAt(input.reviewed_at, new Date());

  return engine.transaction(async (txBase) => {
    const tx = txBase as BrainEngine;

    if (input.candidate_id === input.challenged_candidate_id) {
      throw new MemoryInboxServiceError(
        'invalid_status_transition',
        `Cannot resolve a contradiction against the same memory candidate: ${input.candidate_id}.`,
      );
    }

    const candidate = await tx.getMemoryCandidateEntry(input.candidate_id);
    if (!candidate) {
      throw new MemoryInboxServiceError(
        'memory_candidate_not_found',
        `Memory candidate not found: ${input.candidate_id}`,
      );
    }

    const challengedCandidate = await tx.getMemoryCandidateEntry(input.challenged_candidate_id);
    if (!challengedCandidate) {
      throw new MemoryInboxServiceError(
        'memory_candidate_not_found',
        `Memory candidate not found: ${input.challenged_candidate_id}`,
      );
    }

    if (candidate.scope_id !== challengedCandidate.scope_id) {
      throw new MemoryInboxServiceError(
        'invalid_status_transition',
        `Cannot resolve contradiction across scopes: ${candidate.scope_id} vs ${challengedCandidate.scope_id}.`,
      );
    }

    if (!isReviewableContradictionStatus(candidate.status) || !isReviewableContradictionStatus(challengedCandidate.status)) {
      throw new MemoryInboxServiceError(
        'invalid_status_transition',
        `Contradiction handling requires staged_for_review or promoted candidates; got ${candidate.status} and ${challengedCandidate.status}.`,
      );
    }
    validateOutcomeRoute(input.outcome, candidate, challengedCandidate);

    const reviewReason = input.review_reason ?? null;
    const contradictionId = crypto.randomUUID();

    switch (input.outcome) {
      case 'rejected': {
        const rejectedCandidate = await rejectMemoryCandidateEntry(tx, {
          id: candidate.id,
          reviewed_at: reviewedAt,
          review_reason: reviewReason ?? 'Rejected during contradiction review.',
          interaction_id: input.interaction_id ?? null,
        });
        const contradictionEntry = await tx.createMemoryCandidateContradictionEntry({
          id: contradictionId,
          scope_id: candidate.scope_id,
          candidate_id: rejectedCandidate.id,
          challenged_candidate_id: challengedCandidate.id,
          outcome: 'rejected',
          supersession_entry_id: null,
          reviewed_at: reviewedAt,
          review_reason: reviewReason,
          interaction_id: input.interaction_id ?? null,
        });
        if (!contradictionEntry) {
          throw new MemoryInboxServiceError(
            'invalid_status_transition',
            `Cannot persist contradiction record for ${rejectedCandidate.id} against ${challengedCandidate.id}.`,
          );
        }
        return {
          contradiction_entry: contradictionEntry,
          candidate: rejectedCandidate,
          challenged_candidate: challengedCandidate,
          supersession_entry: null,
        };
      }
      case 'unresolved': {
        const contradictionEntry = await tx.createMemoryCandidateContradictionEntry({
          id: contradictionId,
          scope_id: candidate.scope_id,
          candidate_id: candidate.id,
          challenged_candidate_id: challengedCandidate.id,
          outcome: 'unresolved',
          supersession_entry_id: null,
          reviewed_at: reviewedAt,
          review_reason: reviewReason,
          interaction_id: input.interaction_id ?? null,
        });
        if (!contradictionEntry) {
          throw new MemoryInboxServiceError(
            'invalid_status_transition',
            `Cannot persist contradiction record for ${candidate.id} against ${challengedCandidate.id}.`,
          );
        }
        return {
          contradiction_entry: contradictionEntry,
          candidate,
          challenged_candidate: challengedCandidate,
          supersession_entry: null,
        };
      }
      case 'superseded': {
        const supersession = await supersedeMemoryCandidateEntry(tx, {
          superseded_candidate_id: challengedCandidate.id,
          replacement_candidate_id: candidate.id,
          reviewed_at: reviewedAt,
          review_reason: reviewReason,
          interaction_id: input.interaction_id ?? null,
        });
        const contradictionEntry = await tx.createMemoryCandidateContradictionEntry({
          id: contradictionId,
          scope_id: candidate.scope_id,
          candidate_id: supersession.replacement_candidate.id,
          challenged_candidate_id: supersession.superseded_candidate.id,
          outcome: 'superseded',
          supersession_entry_id: supersession.supersession_entry.id,
          reviewed_at: reviewedAt,
          review_reason: reviewReason,
          interaction_id: input.interaction_id ?? null,
        });
        if (!contradictionEntry) {
          throw new MemoryInboxServiceError(
            'invalid_status_transition',
            `Cannot persist contradiction record for ${supersession.replacement_candidate.id} against ${supersession.superseded_candidate.id}.`,
          );
        }
        return {
          contradiction_entry: contradictionEntry,
          candidate: supersession.replacement_candidate,
          challenged_candidate: supersession.superseded_candidate,
          supersession_entry: supersession.supersession_entry,
        };
      }
    }
  });
}

function isReviewableContradictionStatus(status: MemoryCandidateEntry['status']): boolean {
  return status === 'staged_for_review' || status === 'promoted';
}

function validateOutcomeRoute(
  outcome: MemoryCandidateContradictionOutcome,
  candidate: MemoryCandidateEntry,
  challengedCandidate: MemoryCandidateEntry,
) {
  if (outcome === 'rejected' && candidate.status !== 'staged_for_review') {
    throw new MemoryInboxServiceError(
      'invalid_status_transition',
      `Contradiction rejected outcome requires the candidate to be staged_for_review; got ${candidate.status}.`,
    );
  }
  if (outcome === 'superseded' && candidate.status !== 'promoted') {
    throw new MemoryInboxServiceError(
      'invalid_status_transition',
      `Contradiction superseded outcome requires the replacement candidate to be promoted; got ${candidate.status}.`,
    );
  }
  if (
    outcome === 'superseded'
    && challengedCandidate.status !== 'staged_for_review'
    && challengedCandidate.status !== 'promoted'
  ) {
    throw new MemoryInboxServiceError(
      'invalid_status_transition',
      `Contradiction superseded outcome requires the challenged candidate to be staged_for_review or promoted; got ${challengedCandidate.status}.`,
    );
  }
}
