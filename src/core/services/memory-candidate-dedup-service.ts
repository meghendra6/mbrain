import type { MemoryCandidateEntry, MemoryCandidateScoredEntry } from '../types.ts';
import { rankMemoryCandidateEntries } from './memory-candidate-scoring-service.ts';

export interface MemoryCandidateReviewBacklogGroup {
  representative_candidate: MemoryCandidateEntry;
  grouped_candidate_ids: string[];
  duplicate_count: number;
  total_recurrence_score: number;
  review_priority_score: number;
}

export function buildMemoryCandidateReviewBacklog(
  candidates: readonly MemoryCandidateEntry[],
): MemoryCandidateReviewBacklogGroup[] {
  const ranked = rankMemoryCandidateEntries(candidates);
  const groups = new Map<string, { representative: MemoryCandidateScoredEntry; items: MemoryCandidateScoredEntry[] }>();

  for (const scored of ranked) {
    const key = buildDedupKey(scored.candidate);
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(scored);
    } else {
      groups.set(key, {
        representative: scored,
        items: [scored],
      });
    }
  }

  return [...groups.values()]
    .map(({ representative, items }) => ({
      representative_candidate: representative.candidate,
      grouped_candidate_ids: items.map((item) => item.candidate.id),
      duplicate_count: items.length,
      total_recurrence_score: roundScore(items.reduce((sum, item) => sum + item.candidate.recurrence_score, 0)),
      review_priority_score: representative.review_priority_score,
    }))
    .sort((left, right) => {
      if (right.review_priority_score !== left.review_priority_score) {
        return right.review_priority_score - left.review_priority_score;
      }
      if (right.duplicate_count !== left.duplicate_count) {
        return right.duplicate_count - left.duplicate_count;
      }
      const updatedAtDelta = right.representative_candidate.updated_at.getTime() - left.representative_candidate.updated_at.getTime();
      if (updatedAtDelta !== 0) {
        return updatedAtDelta;
      }
      return left.representative_candidate.id.localeCompare(right.representative_candidate.id);
    });
}

function buildDedupKey(candidate: MemoryCandidateEntry): string {
  return JSON.stringify([
    candidate.scope_id,
    candidate.candidate_type,
    candidate.target_object_type,
    candidate.target_object_id,
    normalizeContent(candidate.proposed_content),
  ]);
}

function normalizeContent(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function roundScore(value: number): number {
  return Number(value.toFixed(6));
}
