#!/usr/bin/env bun

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { performance } from 'perf_hooks';
import { SQLiteEngine } from '../../src/core/sqlite-engine.ts';
import { rankMemoryCandidateEntries } from '../../src/core/services/memory-candidate-scoring-service.ts';

type Phase6CandidateScoringWorkloadResult =
  | {
      name: 'memory_candidate_scoring';
      status: 'measured';
      unit: 'ms';
      p50_ms: number;
      p95_ms: number;
    }
  | {
      name: 'memory_candidate_scoring_correctness';
      status: 'measured';
      unit: 'percent';
      success_rate: number;
    };

interface Phase6CandidateScoringAcceptanceCheck {
  name:
    | 'memory_candidate_scoring_p95_ms'
    | 'memory_candidate_scoring_correctness_success_rate';
  status: 'pass' | 'fail';
  actual: number;
  threshold: {
    operator: '<=' | '===';
    value: number;
    unit: 'ms' | 'percent';
  };
}

const THRESHOLDS = {
  memory_candidate_scoring_p95_ms_max: 100,
  memory_candidate_scoring_correctness_success_rate: 100,
} as const;

const SAMPLE_COUNT = 10;
const DEFAULT_SCOPE_ID = 'workspace:default';
const args = new Set(process.argv.slice(2));

if (args.has('--help')) {
  console.log('Usage: bun run scripts/bench/phase6-candidate-scoring.ts [--json]');
  process.exit(0);
}

const jsonOutput = args.has('--json');
const tempDir = mkdtempSync(join(tmpdir(), 'mbrain-phase6-candidate-scoring-'));
const databasePath = join(tempDir, 'phase6-candidate-scoring.db');
const engine = new SQLiteEngine();

try {
  await engine.connect({ engine: 'sqlite', database_path: databasePath });
  await engine.initSchema();

  const workloads: Phase6CandidateScoringWorkloadResult[] = [
    await runCorrectnessWorkload(engine),
    await runLatencyWorkload(engine),
  ];

  const payload = {
    generated_at: new Date().toISOString(),
    engine: 'sqlite',
    phase: 'phase6',
    workloads,
    acceptance: evaluateAcceptance(workloads),
  };

  console.log(JSON.stringify(payload, null, 2));
} finally {
  await engine.disconnect();
  rmSync(tempDir, { recursive: true, force: true });
}

async function runCorrectnessWorkload(
  engine: SQLiteEngine,
): Promise<Extract<Phase6CandidateScoringWorkloadResult, { name: 'memory_candidate_scoring_correctness' }>> {
  let checks = 0;
  let passes = 0;

  await seedCandidate(engine, 'candidate-c', {
    source_refs: [],
    extraction_kind: 'extracted',
    confidence_score: 1,
    importance_score: 1,
    recurrence_score: 1,
  });
  await seedCandidate(engine, 'candidate-b', {
    source_refs: [
      'User, direct message, 2026-04-23 11:00 AM KST',
      'User, direct message, 2026-04-23 11:00 AM KST',
    ],
    confidence_score: 0.9,
    importance_score: 0.7,
    recurrence_score: 0.2,
  });
  await seedCandidate(engine, 'candidate-a', {
    source_refs: [
      'User, direct message, 2026-04-23 11:00 AM KST',
      'Meeting notes "Scoring Sync", 2026-04-23 11:05 AM KST',
    ],
    confidence_score: 0.6,
    importance_score: 0.8,
    recurrence_score: 0.5,
  });

  const ranked = rankMemoryCandidateEntries(await engine.listMemoryCandidateEntries({
    scope_id: DEFAULT_SCOPE_ID,
    limit: 20,
    offset: 0,
  }));

  checks += 1;
  if (ranked.map((entry) => entry.candidate.id).join(',') === 'candidate-a,candidate-b,candidate-c') {
    passes += 1;
  }

  checks += 1;
  if (ranked[1]?.source_quality_score === 0.6 && ranked[1]?.effective_confidence_score === 0.6) {
    passes += 1;
  }

  return {
    name: 'memory_candidate_scoring_correctness',
    status: 'measured',
    unit: 'percent',
    success_rate: formatPercent((passes / checks) * 100),
  };
}

async function runLatencyWorkload(
  engine: SQLiteEngine,
): Promise<Extract<Phase6CandidateScoringWorkloadResult, { name: 'memory_candidate_scoring' }>> {
  const durations: number[] = [];

  for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) {
    await seedCandidate(engine, `latency-${sample}-a`, {
      source_refs: ['User, direct message, 2026-04-23 11:00 AM KST'],
      confidence_score: 0.7,
      importance_score: 0.7,
      recurrence_score: 0.4,
    });
    await seedCandidate(engine, `latency-${sample}-b`, {
      source_refs: [
        'User, direct message, 2026-04-23 11:00 AM KST',
        'Meeting notes "Scoring Sync", 2026-04-23 11:05 AM KST',
      ],
      confidence_score: 0.8,
      importance_score: 0.8,
      recurrence_score: 0.5,
    });

    const candidates = await engine.listMemoryCandidateEntries({
      scope_id: DEFAULT_SCOPE_ID,
      limit: 100,
      offset: 0,
    });

    const start = performance.now();
    rankMemoryCandidateEntries(candidates);
    durations.push(performance.now() - start);
  }

  return {
    name: 'memory_candidate_scoring',
    status: 'measured',
    unit: 'ms',
    p50_ms: formatMeasuredMs(percentile(durations, 0.5)),
    p95_ms: formatMeasuredMs(percentile(durations, 0.95)),
  };
}

async function seedCandidate(
  engine: SQLiteEngine,
  id: string,
  overrides: Partial<{
    source_refs: string[];
    extraction_kind: 'manual' | 'extracted' | 'inferred' | 'ambiguous';
    confidence_score: number;
    importance_score: number;
    recurrence_score: number;
  }> = {},
) {
  await engine.createMemoryCandidateEntry({
    id,
    scope_id: DEFAULT_SCOPE_ID,
    candidate_type: 'fact',
    proposed_content: `Scoring benchmark candidate ${id}.`,
    source_refs: overrides.source_refs ?? ['User, direct message, 2026-04-23 11:00 AM KST'],
    generated_by: 'manual',
    extraction_kind: overrides.extraction_kind ?? 'manual',
    confidence_score: overrides.confidence_score ?? 0.7,
    importance_score: overrides.importance_score ?? 0.7,
    recurrence_score: overrides.recurrence_score ?? 0.3,
    sensitivity: 'work',
    status: 'candidate',
    target_object_type: 'curated_note',
    target_object_id: 'concepts/memory-candidate-scoring',
    reviewed_at: null,
    review_reason: null,
  });
}

function evaluateAcceptance(workloads: Phase6CandidateScoringWorkloadResult[]) {
  const latency = workloads.find((workload) => workload.name === 'memory_candidate_scoring');
  const correctness = workloads.find((workload) => workload.name === 'memory_candidate_scoring_correctness');
  if (!latency || !correctness) {
    throw new Error('Missing memory candidate scoring benchmark workloads');
  }

  const checks: Phase6CandidateScoringAcceptanceCheck[] = [
    {
      name: 'memory_candidate_scoring_p95_ms',
      status: latency.p95_ms <= THRESHOLDS.memory_candidate_scoring_p95_ms_max ? 'pass' : 'fail',
      actual: latency.p95_ms,
      threshold: {
        operator: '<=',
        value: THRESHOLDS.memory_candidate_scoring_p95_ms_max,
        unit: 'ms',
      },
    },
    {
      name: 'memory_candidate_scoring_correctness_success_rate',
      status: correctness.success_rate === THRESHOLDS.memory_candidate_scoring_correctness_success_rate ? 'pass' : 'fail',
      actual: correctness.success_rate,
      threshold: {
        operator: '===',
        value: THRESHOLDS.memory_candidate_scoring_correctness_success_rate,
        unit: 'percent',
      },
    },
  ];

  const allPass = checks.every((check) => check.status === 'pass');
  return {
    readiness_status: allPass ? 'pass' : 'fail',
    phase6_status: allPass ? 'pass' : 'fail',
    summary: allPass
      ? 'Phase 6 candidate scoring benchmark passed for deterministic inbox review ranking.'
      : 'Phase 6 candidate scoring benchmark failed because one or more checks missed the threshold.',
    checks,
  };
}

function percentile(values: number[], percentileValue: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * percentileValue) - 1));
  return sorted[index] ?? 0;
}

function formatMeasuredMs(value: number): number {
  return Number(value.toFixed(3));
}

function formatPercent(value: number): number {
  return Number(value.toFixed(2));
}
