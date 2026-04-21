import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SQLiteEngine } from '../src/core/sqlite-engine.ts';
import { importFromContent } from '../src/core/import-file.ts';
import { buildStructuralContextMapEntry } from '../src/core/services/context-map-service.ts';
import { selectRetrievalRoute } from '../src/core/services/retrieval-route-selector-service.ts';

test('retrieval route selector persists a task-scoped trace for successful broad synthesis', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mbrain-route-trace-success-'));
  const databasePath = join(dir, 'brain.db');
  const engine = new SQLiteEngine();

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

    const result = await selectRetrievalRoute(engine, {
      intent: 'broad_synthesis',
      task_id: 'task-1',
      query: 'mbrain',
      persist_trace: true,
    });

    expect(result.selected_intent).toBe('broad_synthesis');
    expect(result.trace?.task_id).toBe('task-1');
    expect(result.trace?.scope).toBe('work');
    expect(result.trace?.route).toEqual([
      'curated_notes',
      'context_map_report',
      'context_map_query',
      'context_map_explain',
      'canonical_follow_through',
    ]);
    expect(result.trace?.source_refs).toContain('page:systems/mbrain');
    expect(result.trace?.verification).toContain('intent:broad_synthesis');
    expect(result.trace?.verification).toContain('selection_reason:selected_fresh_match');
    expect(result.trace?.outcome).toBe('broad_synthesis route selected');
  } finally {
    await engine.disconnect();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('retrieval route selector persists a degraded task-scoped trace for no-match precision lookup', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mbrain-route-trace-miss-'));
  const databasePath = join(dir, 'brain.db');
  const engine = new SQLiteEngine();

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

    const result = await selectRetrievalRoute(engine, {
      intent: 'precision_lookup',
      task_id: 'task-1',
      slug: 'systems/unknown',
      persist_trace: true,
    });

    expect(result.selected_intent).toBe('precision_lookup');
    expect(result.selection_reason).toBe('no_match');
    expect(result.route).toBeNull();
    expect(result.trace?.task_id).toBe('task-1');
    expect(result.trace?.route).toEqual([]);
    expect(result.trace?.source_refs).toEqual([]);
    expect(result.trace?.verification).toContain('intent:precision_lookup');
    expect(result.trace?.verification).toContain('selection_reason:no_match');
    expect(result.trace?.outcome).toBe('precision_lookup route unavailable');
  } finally {
    await engine.disconnect();
    rmSync(dir, { recursive: true, force: true });
  }
});
