import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SQLiteEngine } from '../src/core/sqlite-engine.ts';
import { importFromContent } from '../src/core/import-file.ts';
import {
  buildStructuralContextMapEntry,
  WORKSPACE_CONTEXT_MAP_KIND,
  workspaceContextMapId,
} from '../src/core/services/context-map-service.ts';

test('context-map service builds a persisted structural workspace map', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mbrain-context-map-service-'));
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

    const entry = await buildStructuralContextMapEntry(engine);

    expect(entry.id).toBe(workspaceContextMapId('workspace:default'));
    expect(entry.kind).toBe(WORKSPACE_CONTEXT_MAP_KIND);
    expect(entry.build_mode).toBe('structural');
    expect(entry.node_count).toBeGreaterThan(0);
    expect(entry.edge_count).toBeGreaterThan(0);
    expect((entry.graph_json as any).nodes.length).toBeGreaterThan(0);
    expect(await engine.getContextMapEntry(entry.id)).not.toBeNull();
  } finally {
    await engine.disconnect();
    rmSync(dir, { recursive: true, force: true });
  }
});
