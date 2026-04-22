import type {
  MemoryCandidateEntry,
  MemoryCandidateScoredEntry,
} from '../types.ts';

const EXTRACTION_KIND_WEIGHTS: Record<MemoryCandidateEntry['extraction_kind'], number> = {
  manual: 1,
  extracted: 0.95,
  inferred: 0.8,
  ambiguous: 0.55,
};

export function scoreMemoryCandidateEntry(candidate: MemoryCandidateEntry): MemoryCandidateScoredEntry {
  const sourceQualityScore = computeSourceQualityScore(candidate.source_refs);
  const effectiveConfidenceScore = Math.min(clampScore(candidate.confidence_score), sourceQualityScore);
  const reviewPriorityScore = roundScore(
    (effectiveConfidenceScore * 0.4)
      + (clampScore(candidate.importance_score) * 0.35)
      + (clampScore(candidate.recurrence_score) * 0.15)
      + (EXTRACTION_KIND_WEIGHTS[candidate.extraction_kind] * 0.1),
  );

  return {
    candidate,
    source_quality_score: sourceQualityScore,
    effective_confidence_score: roundScore(effectiveConfidenceScore),
    review_priority_score: reviewPriorityScore,
  };
}

export function rankMemoryCandidateEntries(
  candidates: readonly MemoryCandidateEntry[],
): MemoryCandidateScoredEntry[] {
  return candidates
    .map(scoreMemoryCandidateEntry)
    .sort((left, right) => {
      if (right.review_priority_score !== left.review_priority_score) {
        return right.review_priority_score - left.review_priority_score;
      }
      const updatedAtDelta = right.candidate.updated_at.getTime() - left.candidate.updated_at.getTime();
      if (updatedAtDelta !== 0) {
        return updatedAtDelta;
      }
      return left.candidate.id.localeCompare(right.candidate.id);
    });
}

function computeSourceQualityScore(sourceRefs: readonly string[]): number {
  const normalized = new Set(
    sourceRefs
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  );

  if (normalized.size >= 2) {
    return 1;
  }
  if (normalized.size === 1) {
    return 0.6;
  }
  return 0;
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function roundScore(value: number): number {
  return Number(value.toFixed(6));
}
