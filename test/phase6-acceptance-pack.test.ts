import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'bun';

describe('phase6 acceptance-pack benchmark', () => {
  test('--json prints a phase6 acceptance summary shape', () => {
    const proc = spawnSync(['bun', 'run', 'scripts/bench/phase6-acceptance-pack.ts', '--json'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    expect(proc.exitCode).toBe(0);
    const payload = JSON.parse(new TextDecoder().decode(proc.stdout));

    expect(payload.phase).toBe('phase6');
    expect(Array.isArray(payload.benchmarks)).toBe(true);
    expect(payload.benchmarks.map((benchmark: any) => benchmark.name)).toEqual([
      'memory_candidate_scoring',
    ]);
    expect(payload.acceptance.readiness_status).toBe('pass');
    expect(payload.acceptance.phase6_status).toBe('pass');
  });
});
