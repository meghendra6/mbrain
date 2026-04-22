import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'bun';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('phase6 candidate-dedup benchmark', () => {
  test('--json prints a phase6 candidate-dedup benchmark report shape', () => {
    const proc = spawnSync(['bun', 'run', 'scripts/bench/phase6-candidate-dedup.ts', '--json'], {
      cwd: repoRoot,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    expect(proc.exitCode).toBe(0);
    const payload = JSON.parse(new TextDecoder().decode(proc.stdout));

    expect(payload.phase).toBe('phase6');
    expect(Array.isArray(payload.workloads)).toBe(true);
    expect(payload.workloads.map((workload: any) => workload.name)).toEqual([
      'memory_candidate_dedup_correctness',
      'memory_candidate_dedup',
    ]);
    expect(payload.acceptance.readiness_status).toBe('pass');
    expect(payload.acceptance.phase6_status).toBe('pass');
  });
});
