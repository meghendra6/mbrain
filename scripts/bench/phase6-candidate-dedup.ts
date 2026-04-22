#!/usr/bin/env bun

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { performance } from 'perf_hooks';
import { SQLiteEngine } from '../../src/core/sqlite-engine.ts';
import { buildMemoryCandidateReviewBacklog } from '../../src/core/services/memory-candidate-dedup-service.ts';

type Phase6CandidateDedupWorkloadResult =
  | {
      name: 'memory_candidate_dedup';
      status: 'measured';
      unit: 'ms';
      p50_ms: number;
      p95_ms: number;
    }
  | {
      name: 'memory_candidate_dedup_correctness';
      status: 'measured';
      unit: 'percent';
      success_rate: number;
    };

interface Phase6CandidateDedupAcceptanceCheck {
  name:
    | 'memory_candidate_dedup_p95_ms'
    | 'memory_candidate_dedup_correctness_success_rate';
  status: 'pass' | 'fail';
  actual: number;
  threshold: {
    operator: '<=' | '===';
    value: number;
    unit: 'ms' | 'percent';
  };
}

const THRESHOLDS = {
  memory_candidate_dedup_p95_ms_max: 100,
  memory_candidate_dedup_correctness_success_rate: 100,
} as const;

const SAMPLE_COUNT = 10;
const args = new Set(process.argv.slice(2));

if (args.has('--help')) {
  console.log('Usage: bun run scripts/bench/phase6-candidate-dedup.ts [--json]');
  process.exit(0);
}

const tempDir = mkdtempSync(join(tmpdir(), 'mbrain-phase6-candidate-dedup-'));
const databasePath = join(tempDir, 'phase6-candidate-dedup.db');
const engine = new SQLiteEngine();

try {
  await engine.connect({ engine: 'sqlite', database_path: databasePath });
  await engine.initSchema();

  const workloads: Phase6CandidateDedupWorkloadResult[] = [
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
): Promise<Extract<Phase6CandidateDedupWorkloadResult, { name: 'memory_candidate_dedup_correctness' }>> {
  let checks = 0;
  let passes = 0;

  await seedCandidate(engine, 'dup-a', {
    proposed_content: 'Review the context map recommendation.',
    confidence_score: 0.8,
    importance_score: 0.8,
    recurrence_score: 0.4,
    target_object_id: 'concepts/topic-1',
  });
  await seedCandidate(engine, 'dup-b', {
    proposed_content: ' review  the context map recommendation. ',
    confidence_score: 0.6,
    importance_score: 0.7,
    recurrence_score: 0.2,
    target_object_id: 'concepts/topic-1',
  });
  await seedCandidate(engine, 'distinct', {
    proposed_content: 'Review another recommendation.',
    target_object_id: 'concepts/topic-2',
  });

  const backlog = buildMemoryCandidateReviewBacklog(await engine.listMemoryCandidateEntries({
    scope_id: 'workspace:default',
    limit: 100,
    offset: 0,
  }));

  checks += 1;
  if (backlog.length === 2 && backlog[0]?.duplicate_count === 2) {
    passes += 1;
  }
  checks += 1;
  if (backlog[0]?.grouped_candidate_ids.join(',') === 'dup-a,dup-b') {
    passes += 1;
  }

  return {
    name: 'memory_candidate_dedup_correctness',
    status: 'measured',
    unit: 'percent',
    success_rate: formatPercent((passes / checks) * 100),
  };
}

async function runLatencyWorkload(
  engine: SQLiteEngine,
): Promise<Extract<Phase6CandidateDedupWorkloadResult, { name: 'memory_candidate_dedup' }>> {
  const durations: number[] = [];

  for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) {
    await seedCandidate(engine, `latency-${sample}-a`, {
      proposed_content: 'Review the context map recommendation.',
      target_object_id: 'concepts/topic-1',
    });
    await seedCandidate(engine, `latency-${sample}-b`, {
      proposed_content: ' review  the context map recommendation. ',
      target_object_id: 'concepts/topic-1',
    });

    const candidates = await engine.listMemoryCandidateEntries({
      scope_id: 'workspace:default',
      limit: 100,
      offset: 0,
    });

    const start = performance.now();
    buildMemoryCandidateReviewBacklog(candidates);
    durations.push(performance.now() - start);
  }

  return {
    name: 'memory_candidate_dedup',
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
    proposed_content: string;
    confidence_score: number;
    importance_score: number;
    recurrence_score: number;
    target_object_id: string;
  }> = {},
) {
  await engine.createMemoryCandidateEntry({
    id,
    scope_id: 'workspace:default',
    candidate_type: 'note_update',
    proposed_content: overrides.proposed_content ?? 'Review the context map recommendation.',
    source_refs: ['User, direct message, 2026-04-23 12:00 PM KST'],
    generated_by: 'map_analysis',
    extraction_kind: 'inferred',
    confidence_score: overrides.confidence_score ?? 0.7,
    importance_score: overrides.importance_score ?? 0.8,
    recurrence_score: overrides.recurrence_score ?? 0.2,
    sensitivity: 'work',
    status: 'captured',
    target_object_type: 'curated_note',
    target_object_id: overrides.target_object_id ?? 'concepts/topic-1',
    reviewed_at: null,
    review_reason: null,
  });
}

function evaluateAcceptance(workloads: Phase6CandidateDedupWorkloadResult[]) {
  const latency = workloads.find((workload) => workload.name === 'memory_candidate_dedup');
  const correctness = workloads.find((workload) => workload.name === 'memory_candidate_dedup_correctness');
  if (!latency || !correctness) {
    throw new Error('Missing memory candidate dedup benchmark workloads');
  }

  const checks: Phase6CandidateDedupAcceptanceCheck[] = [
    {
      name: 'memory_candidate_dedup_p95_ms',
      status: latency.p95_ms <= THRESHOLDS.memory_candidate_dedup_p95_ms_max ? 'pass' : 'fail',
      actual: latency.p95_ms,
      threshold: {
        operator: '<=',
        value: THRESHOLDS.memory_candidate_dedup_p95_ms_max,
        unit: 'ms',
      },
    },
    {
      name: 'memory_candidate_dedup_correctness_success_rate',
      status: correctness.success_rate === THRESHOLDS.memory_candidate_dedup_correctness_success_rate ? 'pass' : 'fail',
      actual: correctness.success_rate,
      threshold: {
        operator: '===',
        value: THRESHOLDS.memory_candidate_dedup_correctness_success_rate,
        unit: 'percent',
      },
    },
  ];

  const allPass = checks.every((check) => check.status === 'pass');
  return {
    readiness_status: allPass ? 'pass' : 'fail',
    phase6_status: allPass ? 'pass' : 'fail',
    summary: allPass
      ? 'Phase 6 candidate dedup benchmark passed for bounded review backlog grouping.'
      : 'Phase 6 candidate dedup benchmark failed because one or more checks missed the threshold.',
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
