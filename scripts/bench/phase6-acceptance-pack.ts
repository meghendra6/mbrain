#!/usr/bin/env bun

import { spawnSync } from 'bun';

interface Phase6BenchmarkSummary {
  name: string;
  readiness_status: 'pass' | 'fail';
  phase6_status: 'pass' | 'fail';
}

const BENCHMARKS = [
  { name: 'memory_candidate_scoring', path: 'scripts/bench/phase6-candidate-scoring.ts' },
  { name: 'map_derived_candidates', path: 'scripts/bench/phase6-map-derived-candidates.ts' },
  { name: 'memory_candidate_dedup', path: 'scripts/bench/phase6-candidate-dedup.ts' },
] as const;

const summaries = BENCHMARKS.map(runBenchmark);
const allPass = summaries.every((item) => item.readiness_status === 'pass' && item.phase6_status === 'pass');

const payload = {
  generated_at: new Date().toISOString(),
  engine: 'sqlite',
  phase: 'phase6',
  benchmarks: summaries,
  acceptance: {
    readiness_status: allPass ? 'pass' : 'fail',
    phase6_status: allPass ? 'pass' : 'fail',
    summary: allPass
      ? 'Phase 6 acceptance pack passed across all published benchmark slices.'
      : 'Phase 6 acceptance pack failed because one or more benchmark slices failed.',
  },
};

console.log(JSON.stringify(payload, null, 2));

if (!allPass) {
  process.exit(1);
}

function runBenchmark(benchmark: typeof BENCHMARKS[number]): Phase6BenchmarkSummary {
  const proc = spawnSync(['bun', 'run', benchmark.path, '--json'], {
    stdout: 'pipe',
    stderr: 'pipe',
  });

  if (proc.exitCode !== 0) {
    return {
      name: benchmark.name,
      readiness_status: 'fail',
      phase6_status: 'fail',
    };
  }

  const stdout = new TextDecoder().decode(proc.stdout);
  const parsed = JSON.parse(stdout);
  const acceptance = parsed?.acceptance ?? {};
  const readinessStatus = acceptance.readiness_status === 'pass' ? 'pass' : 'fail';
  const phase6Status = acceptance.phase6_status === 'pass' ? 'pass' : 'fail';

  return {
    name: benchmark.name,
    readiness_status: readinessStatus,
    phase6_status: phase6Status,
  };
}
