import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SQLiteEngine } from '../src/core/sqlite-engine.ts';
import { importFromContent } from '../src/core/import-file.ts';
import { buildStructuralContextMapEntry } from '../src/core/services/context-map-service.ts';
import {
  ATLAS_WORKSPACE_KIND,
  buildStructuralContextAtlasEntry,
  getStructuralContextAtlasEntry,
  listStructuralContextAtlasEntries,
  workspaceContextAtlasId,
} from '../src/core/services/context-atlas-service.ts';

test('context-atlas service builds a deterministic workspace atlas entry', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mbrain-context-atlas-service-'));
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
    const entry = await buildStructuralContextAtlasEntry(engine);

    expect(entry.id).toBe(workspaceContextAtlasId('workspace:default'));
    expect(entry.kind).toBe(ATLAS_WORKSPACE_KIND);
    expect(entry.freshness).toBe('fresh');
    expect(entry.entrypoints.length).toBeGreaterThan(0);
    expect(entry.entrypoints[0]).toBe('page:concepts/note-manifest');
    expect(entry.budget_hint).toBeGreaterThan(0);
  } finally {
    await engine.disconnect();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('context-atlas service mirrors context-map staleness until atlas rebuild', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mbrain-context-atlas-stale-'));
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
    await buildStructuralContextAtlasEntry(engine);

    await importFromContent(engine, 'concepts/note-manifest', [
      '---',
      'type: concept',
      'title: Note Manifest',
      '---',
      '# Purpose',
      'Indexes [[systems/mbrain]] and changes map freshness.',
    ].join('\n'), { path: 'concepts/note-manifest.md' });

    const id = workspaceContextAtlasId('workspace:default');
    const staleEntry = await getStructuralContextAtlasEntry(engine, id);
    expect(staleEntry?.freshness).toBe('stale');

    const listed = await listStructuralContextAtlasEntries(engine, { scope_id: 'workspace:default' });
    expect(listed[0]?.freshness).toBe('stale');

    await buildStructuralContextMapEntry(engine);
    const rebuilt = await buildStructuralContextAtlasEntry(engine);
    expect(rebuilt.freshness).toBe('fresh');

    const refreshed = await getStructuralContextAtlasEntry(engine, id);
    expect(refreshed?.freshness).toBe('fresh');
  } finally {
    await engine.disconnect();
    rmSync(dir, { recursive: true, force: true });
  }
});
