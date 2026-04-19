import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'bun';

describe('phase0 baseline runner', () => {
  test('--help prints usage', () => {
    const proc = spawnSync(['bun', 'run', 'scripts/bench/phase0-baseline.ts', '--help'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    expect(proc.exitCode).toBe(0);
    expect(new TextDecoder().decode(proc.stdout)).toContain('Usage: bun run scripts/bench/phase0-baseline.ts');
  });

  test('--json prints a baseline report shape', () => {
    const proc = spawnSync(['bun', 'run', 'scripts/bench/phase0-baseline.ts', '--json'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    expect(proc.exitCode).toBe(0);
    const payload = JSON.parse(new TextDecoder().decode(proc.stdout));
    expect(payload).toHaveProperty('generated_at');
    expect(payload).toHaveProperty('engine');
    expect(Array.isArray(payload.workloads)).toBe(true);
    expect(payload.workloads.some((w: any) => w.name === 'task_resume' && w.status === 'unsupported' && typeof w.reason === 'string' && w.reason.length > 0)).toBe(true);

    const measured = payload.workloads.filter((w: any) => w.status === 'measured');
    expect(measured.length).toBeGreaterThanOrEqual(4);
    for (const workload of measured) {
      if (workload.unit === 'ms') {
        expect(typeof workload.p50_ms).toBe('number');
        expect(typeof workload.p95_ms).toBe('number');
        expect(workload.p50_ms).toBeGreaterThan(0);
        expect(workload.p95_ms).toBeGreaterThanOrEqual(workload.p50_ms);
      }

      if (workload.name === 'fixture_import') {
        expect(workload.pages_per_second).toBeGreaterThan(0);
      }
    }
  });
});
