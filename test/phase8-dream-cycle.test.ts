import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'bun';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('phase8 dream-cycle benchmark', () => {
  test('--json prints a phase8 dream-cycle benchmark report shape', () => {
    const proc = spawnSync(['bun', 'run', 'scripts/bench/phase8-dream-cycle.ts', '--json'], {
      cwd: repoRoot,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    expect(proc.exitCode).toBe(0);
    const payload = JSON.parse(new TextDecoder().decode(proc.stdout));

    expect(payload.phase).toBe('phase8');
    expect(Array.isArray(payload.workloads)).toBe(true);
    expect(payload.workloads.map((workload: any) => workload.name)).toEqual([
      'dream_cycle_candidate_only',
      'dream_cycle',
    ]);
    expect(payload.acceptance.readiness_status).toBe('pass');
    expect(payload.acceptance.phase8_status).toBe('pass');
  });
});
