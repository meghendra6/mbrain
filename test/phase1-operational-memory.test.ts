import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'bun';

describe('phase1 operational-memory benchmark', () => {
  test('--help prints usage', () => {
    const proc = spawnSync(['bun', 'run', 'scripts/bench/phase1-operational-memory.ts', '--help'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    expect(proc.exitCode).toBe(0);
    expect(new TextDecoder().decode(proc.stdout)).toContain(
      'Usage: bun run scripts/bench/phase1-operational-memory.ts',
    );
  });

  test('--json prints a phase1 benchmark report shape', () => {
    const proc = spawnSync(['bun', 'run', 'scripts/bench/phase1-operational-memory.ts', '--json'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    expect(proc.exitCode).toBe(0);
    const payload = JSON.parse(new TextDecoder().decode(proc.stdout));
    expect(payload).toHaveProperty('generated_at');
    expect(payload).toHaveProperty('engine');
    expect(Array.isArray(payload.workloads)).toBe(true);
    expect(payload).toHaveProperty('acceptance');

    const names = payload.workloads.map((workload: any) => workload.name).sort();
    expect(names).toEqual([
      'attempt_history',
      'decision_history',
      'resume_projection',
      'task_resume',
    ]);

    for (const workload of payload.workloads) {
      expect(workload.status).toBe('measured');
      if (workload.unit === 'ms') {
        expect(typeof workload.p50_ms).toBe('number');
        expect(typeof workload.p95_ms).toBe('number');
        expect(workload.p50_ms).toBeGreaterThan(0);
        expect(workload.p95_ms).toBeGreaterThanOrEqual(workload.p50_ms);
      }

      if (workload.name === 'resume_projection') {
        expect(workload.unit).toBe('percent');
        expect(typeof workload.success_rate).toBe('number');
        expect(workload.success_rate).toBe(100);
      }
    }

    expect(payload.acceptance).toHaveProperty('thresholds');
    expect(Array.isArray(payload.acceptance.checks)).toBe(true);
    expect(payload.acceptance.readiness_status).toBe('pass');
    expect(payload.acceptance.phase1_status).toBe('pending_baseline');

    const checkNames = payload.acceptance.checks.map((check: any) => check.name).sort();
    expect(checkNames).toEqual([
      'attempt_history_p95_ms',
      'decision_history_p95_ms',
      'primary_improvement_threshold',
      'resume_projection_success_rate',
      'task_resume_p95_ms',
    ]);

    const pendingCheck = payload.acceptance.checks.find((check: any) => check.name === 'primary_improvement_threshold');
    expect(pendingCheck.status).toBe('pending_baseline');
    expect(typeof pendingCheck.reason).toBe('string');
    expect(pendingCheck.reason.length).toBeGreaterThan(0);
  });
});
