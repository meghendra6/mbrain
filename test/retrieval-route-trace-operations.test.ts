import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { operations } from '../src/core/operations.ts';
import { SQLiteEngine } from '../src/core/sqlite-engine.ts';
import { importFromContent } from '../src/core/import-file.ts';
import { buildStructuralContextMapEntry } from '../src/core/services/context-map-service.ts';

test('retrieval route operation persists a trace when requested', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mbrain-route-trace-op-'));
  const databasePath = join(dir, 'brain.db');
  const engine = new SQLiteEngine();
  const route = operations.find((operation) => operation.name === 'select_retrieval_route');

  if (!route) {
    throw new Error('select_retrieval_route operation is missing');
  }

  try {
    await engine.connect({ engine: 'sqlite', database_path: databasePath });
    await engine.initSchema();

    await engine.createTaskThread({
      id: 'task-1',
      scope: 'work',
      title: 'Traceable selector',
      goal: 'Persist retrieval traces',
      status: 'active',
      repo_path: '/repo',
      branch_name: 'phase2-note-manifest',
      current_summary: 'Need durable explainability',
    });

    await importFromContent(engine, 'systems/mbrain', [
      '---',
      'type: system',
      'title: MBrain',
      '---',
      '# Overview',
      'See [[concepts/note-manifest]].',
      '',
      '## Runtime',
      'Owns exact retrieval routing.',
    ].join('\n'), { path: 'systems/mbrain.md' });
    await importFromContent(engine, 'concepts/note-manifest', [
      '---',
      'type: concept',
      'title: Note Manifest',
      '---',
      '# Purpose',
      'Indexes [[systems/mbrain]].',
    ].join('\n'), { path: 'concepts/note-manifest.md' });
    await buildStructuralContextMapEntry(engine);

    const result = await route.handler({
      engine,
      config: {} as any,
      logger: console,
      dryRun: false,
    }, {
      intent: 'broad_synthesis',
      task_id: 'task-1',
      query: 'mbrain',
      persist_trace: true,
    });

    expect((result as any).selected_intent).toBe('broad_synthesis');
    expect((result as any).trace?.task_id).toBe('task-1');
    expect((result as any).trace?.outcome).toBe('broad_synthesis route selected');

    const precision = await route.handler({
      engine,
      config: {} as any,
      logger: console,
      dryRun: false,
    }, {
      intent: 'precision_lookup',
      task_id: 'task-1',
      path: 'systems/mbrain.md#overview/runtime',
      persist_trace: true,
    });

    expect((precision as any).selected_intent).toBe('precision_lookup');
    expect((precision as any).selection_reason).toBe('direct_section_path_match');
    expect((precision as any).trace?.source_refs).toContain('section:systems/mbrain#overview/runtime');
    expect((precision as any).trace?.outcome).toBe('precision_lookup route selected');

    await importFromContent(engine, 'systems/brain-graph', [
      '---',
      'type: system',
      'title: Brain Graph',
      '---',
      '# Overview',
      'Maps knowledge structures.',
      '',
      '## Runtime',
      'Owns graph traversal.',
      '[Source: User, direct message, 2026-04-22 12:31 PM KST]',
    ].join('\n'), { path: 'systems/brain-graph.md' });
    await importFromContent(engine, 'systems/brain-cache', [
      '---',
      'type: system',
      'title: Brain Cache',
      '---',
      '# Overview',
      'Caches memory snapshots.',
      '',
      '## Runtime',
      'Owns cache invalidation.',
      '[Source: User, direct message, 2026-04-22 12:31 PM KST]',
    ].join('\n'), { path: 'systems/brain-cache.md' });

    const ambiguous = await route.handler({
      engine,
      config: {} as any,
      logger: console,
      dryRun: false,
    }, {
      intent: 'precision_lookup',
      task_id: 'task-1',
      source_ref: 'User, direct message, 2026-04-22 12:31 PM KST',
      persist_trace: true,
    });

    expect((ambiguous as any).selection_reason).toBe('ambiguous_source_ref_match');
    expect((ambiguous as any).route).toBeNull();
    expect((ambiguous as any).trace?.route).toEqual([]);
    expect((ambiguous as any).trace?.verification).toContain('selection_reason:ambiguous_source_ref_match');
    expect((ambiguous as any).trace?.outcome).toBe('precision_lookup route unavailable');
  } finally {
    await engine.disconnect();
    rmSync(dir, { recursive: true, force: true });
  }
});
