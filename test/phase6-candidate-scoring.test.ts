import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'bun';

describe('phase6 candidate-scoring benchmark', () => {
  test('--json prints a phase6 candidate-scoring benchmark report shape', () => {
    const proc = spawnSync(['bun', 'run', 'scripts/bench/phase6-candidate-scoring.ts', '--json'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    expect(proc.exitCode).toBe(0);
    const payload = JSON.parse(new TextDecoder().decode(proc.stdout));

    expect(payload.phase).toBe('phase6');
    expect(Array.isArray(payload.workloads)).toBe(true);
    expect(payload.workloads.map((workload: any) => workload.name)).toEqual([
      'memory_candidate_scoring_correctness',
      'memory_candidate_scoring',
    ]);
    expect(payload.acceptance.readiness_status).toBe('pass');
    expect(payload.acceptance.phase6_status).toBe('pass');
  });
});
