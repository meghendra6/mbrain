import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SQLiteEngine } from '../src/core/sqlite-engine.ts';
import { importFromContent } from '../src/core/import-file.ts';
import { buildStructuralContextMapEntry } from '../src/core/services/context-map-service.ts';
import { selectRetrievalRoute } from '../src/core/services/retrieval-route-selector-service.ts';

test('retrieval route selector dispatches task resume intent', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mbrain-route-selector-task-'));
  const databasePath = join(dir, 'brain.db');
  const engine = new SQLiteEngine();

  try {
    await engine.connect({ engine: 'sqlite', database_path: databasePath });
    await engine.initSchema();

    await engine.createTaskThread({
      id: 'task-1',
      scope: 'work',
      title: 'Phase 3 selector',
      goal: 'Unify route dispatch',
      status: 'active',
      repo_path: '/repo',
      branch_name: 'phase2-note-manifest',
      current_summary: 'Need one selector surface',
    });

    await engine.upsertTaskWorkingSet({
      task_id: 'task-1',
      active_paths: ['src/core/operations.ts'],
      active_symbols: ['selectRetrievalRoute'],
      blockers: ['selector surface missing'],
      open_questions: ['should selector write traces later'],
      next_steps: ['add selector service'],
      verification_notes: ['task state is current'],
      last_verified_at: new Date('2026-04-22T12:20:00.000Z'),
    });

    const result = await selectRetrievalRoute(engine, {
      intent: 'task_resume',
      task_id: 'task-1',
    });

    expect(result.selected_intent).toBe('task_resume');
    expect(result.selection_reason).toBe('direct_task_match');
    expect(result.route?.route_kind).toBe('task_resume');
    expect(result.route?.retrieval_route).toEqual([
      'task_thread',
      'working_set',
      'attempt_decision_history',
      'focused_source_reads',
    ]);
    expect((result.route?.payload as any)?.task_id).toBe('task-1');
  } finally {
    await engine.disconnect();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('retrieval route selector dispatches broad synthesis intent', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mbrain-route-selector-broad-'));
  const databasePath = join(dir, 'brain.db');
  const engine = new SQLiteEngine();

  try {
    await engine.connect({ engine: 'sqlite', database_path: databasePath });
    await engine.initSchema();

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
      query: 'mbrain',
    });

    expect(result.selected_intent).toBe('broad_synthesis');
    expect(result.selection_reason).toBe('selected_fresh_match');
    expect(result.route?.route_kind).toBe('broad_synthesis');
    expect((result.route?.payload as any)?.focal_node_id).toBe('page:systems/mbrain');
  } finally {
    await engine.disconnect();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('retrieval route selector dispatches precision lookup intent', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mbrain-route-selector-precision-'));
  const databasePath = join(dir, 'brain.db');
  const engine = new SQLiteEngine();

  try {
    await engine.connect({ engine: 'sqlite', database_path: databasePath });
    await engine.initSchema();

    await importFromContent(engine, 'systems/mbrain', [
      '---',
      'type: system',
      'title: MBrain',
      '---',
      '# Overview',
      'Coordinates structural extraction.',
      '',
      '## Runtime',
      'Owns exact retrieval routing.',
      '[Source: User, direct message, 2026-04-22 12:30 PM KST]',
    ].join('\n'), { path: 'systems/mbrain.md' });

    const result = await selectRetrievalRoute(engine, {
      intent: 'precision_lookup',
      slug: 'systems/mbrain',
    });

    expect(result.selected_intent).toBe('precision_lookup');
    expect(result.selection_reason).toBe('direct_page_match');
    expect(result.route?.route_kind).toBe('precision_lookup');
    expect((result.route?.payload as any)?.slug).toBe('systems/mbrain');

    const byPath = await selectRetrievalRoute(engine, {
      intent: 'precision_lookup',
      path: 'systems/mbrain.md',
    });

    expect(byPath.selected_intent).toBe('precision_lookup');
    expect(byPath.selection_reason).toBe('direct_path_match');
    expect((byPath.route?.payload as any)?.path).toBe('systems/mbrain.md');

    const bySectionPath = await selectRetrievalRoute(engine, {
      intent: 'precision_lookup',
      path: 'systems/mbrain.md#overview/runtime',
    });

    expect(bySectionPath.selected_intent).toBe('precision_lookup');
    expect(bySectionPath.selection_reason).toBe('direct_section_path_match');
    expect((bySectionPath.route?.payload as any)?.target_kind).toBe('section');
    expect((bySectionPath.route?.payload as any)?.path).toBe('systems/mbrain.md#overview/runtime');

    const bySourceRef = await selectRetrievalRoute(engine, {
      intent: 'precision_lookup',
      source_ref: 'User, direct message, 2026-04-22 12:30 PM KST',
    });

    expect(bySourceRef.selected_intent).toBe('precision_lookup');
    expect(bySourceRef.selection_reason).toBe('direct_source_ref_section_match');
    expect((bySourceRef.route?.payload as any)?.target_kind).toBe('section');
    expect((bySourceRef.route?.payload as any)?.path).toBe('systems/mbrain.md#overview/runtime');

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

    const ambiguous = await selectRetrievalRoute(engine, {
      intent: 'precision_lookup',
      source_ref: 'User, direct message, 2026-04-22 12:31 PM KST',
    });

    expect(ambiguous.selected_intent).toBe('precision_lookup');
    expect(ambiguous.selection_reason).toBe('ambiguous_source_ref_match');
    expect(ambiguous.candidate_count).toBe(2);
    expect(ambiguous.route).toBeNull();
  } finally {
    await engine.disconnect();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('retrieval route selector degrades explicitly when the selected target is missing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mbrain-route-selector-missing-'));
  const databasePath = join(dir, 'brain.db');
  const engine = new SQLiteEngine();

  try {
    await engine.connect({ engine: 'sqlite', database_path: databasePath });
    await engine.initSchema();

    const result = await selectRetrievalRoute(engine, {
      intent: 'precision_lookup',
      slug: 'systems/unknown',
    });

    expect(result.selected_intent).toBe('precision_lookup');
    expect(result.selection_reason).toBe('no_match');
    expect(result.route).toBeNull();
  } finally {
    await engine.disconnect();
    rmSync(dir, { recursive: true, force: true });
  }
});
