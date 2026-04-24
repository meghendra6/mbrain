import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { BrainEngine } from '../src/core/engine.ts';
import { OperationError, operations } from '../src/core/operations.ts';
import { createBrainLoopAuditOperations } from '../src/core/operations-brain-loop-audit.ts';
import { SQLiteEngine } from '../src/core/sqlite-engine.ts';

test('brain-loop audit operations can be built from a dedicated domain module', () => {
  const built = createBrainLoopAuditOperations({ OperationError });

  expect(built.map((operation) => operation.name)).toEqual(['audit_brain_loop']);
});

test('audit_brain_loop operation is registered with CLI hints', () => {
  const audit = operations.find((operation) => operation.name === 'audit_brain_loop');

  expect(audit?.cliHints?.name).toBe('audit-brain-loop');
  expect(audit?.params.scope?.enum).toEqual(['work', 'personal', 'mixed', 'unknown']);
});

test('audit_brain_loop supports dry-run parameter parsing', async () => {
  const audit = operations.find((operation) => operation.name === 'audit_brain_loop');

  if (!audit) {
    throw new Error('audit_brain_loop operation is missing');
  }

  const result = await audit.handler({
    engine: {} as any,
    config: {} as any,
    logger: console,
    dryRun: true,
  }, {
    since: '24h',
    until: '2026-04-24T12:00:00.000Z',
    scope: 'work',
    limit: 100,
    json: true,
  });

  expect((result as any).dry_run).toBe(true);
  expect((result as any).action).toBe('audit_brain_loop');
  expect((result as any).scope).toBe('work');
  expect((result as any).limit).toBe(100);
});

test('audit_brain_loop rejects invalid scope and limit params', async () => {
  const audit = operations.find((operation) => operation.name === 'audit_brain_loop');

  if (!audit) {
    throw new Error('audit_brain_loop operation is missing');
  }

  await expect(audit.handler({
    engine: {} as any,
    config: {} as any,
    logger: console,
    dryRun: true,
  }, {
    scope: 'public',
  })).rejects.toThrow('scope must be one of');

  await expect(audit.handler({
    engine: {} as any,
    config: {} as any,
    logger: console,
    dryRun: true,
  }, {
    limit: -1,
  })).rejects.toThrow('limit must be a positive number');
});

test('audit_brain_loop operation returns an audit report', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mbrain-brain-loop-audit-op-'));
  const engine = new SQLiteEngine();
  const audit = operations.find((operation) => operation.name === 'audit_brain_loop');

  if (!audit) {
    throw new Error('audit_brain_loop operation is missing');
  }

  try {
    await engine.connect({ engine: 'sqlite', database_path: join(dir, 'brain.db') });
    await engine.initSchema();
    await engine.putRetrievalTrace({
      id: 'trace-op-audit',
      task_id: null,
      scope: 'unknown',
      route: [],
      source_refs: [],
      verification: ['intent:precision_lookup'],
      selected_intent: 'precision_lookup',
      outcome: 'precision_lookup route unavailable',
    });

    const result = await audit.handler({
      engine: engine as unknown as BrainEngine,
      config: {} as any,
      logger: console,
      dryRun: false,
    }, {
      since: '24h',
      until: new Date(Date.now() + 1000).toISOString(),
    });

    expect((result as any).total_traces).toBe(1);
    expect((result as any).by_selected_intent.precision_lookup).toBe(1);
  } finally {
    await engine.disconnect();
    rmSync(dir, { recursive: true, force: true });
  }
});
