import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { operations } from '../src/core/operations.ts';
import { SQLiteEngine } from '../src/core/sqlite-engine.ts';
import { importFromContent } from '../src/core/import-file.ts';

test('context-atlas operations are registered with CLI hints', () => {
  const build = operations.find((operation) => operation.name === 'build_context_atlas');
  const get = operations.find((operation) => operation.name === 'get_context_atlas_entry');
  const list = operations.find((operation) => operation.name === 'list_context_atlas_entries');

  expect(build?.cliHints?.name).toBe('atlas-build');
  expect(get?.cliHints?.name).toBe('atlas-get');
  expect(list?.cliHints?.name).toBe('atlas-list');
});

test('context-atlas operations expose freshness-aware reads', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mbrain-context-atlas-op-'));
  const databasePath = join(dir, 'brain.db');
  const engine = new SQLiteEngine();
  const build = operations.find((operation) => operation.name === 'build_context_atlas');
  const get = operations.find((operation) => operation.name === 'get_context_atlas_entry');
  const list = operations.find((operation) => operation.name === 'list_context_atlas_entries');

  if (!build || !get || !list) {
    throw new Error('context-atlas operations are missing');
  }

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

    const built = await build.handler({
      engine,
      config: {} as any,
      logger: console,
      dryRun: false,
    }, {});

    expect((built as any).freshness).toBe('fresh');

    await importFromContent(engine, 'concepts/note-manifest', [
      '---',
      'type: concept',
      'title: Note Manifest',
      '---',
      '# Purpose',
      'Indexes [[systems/mbrain]] and makes atlas stale.',
    ].join('\n'), { path: 'concepts/note-manifest.md' });

    const atlasId = 'context-atlas:workspace:workspace:default';
    const entry = await get.handler({
      engine,
      config: {} as any,
      logger: console,
      dryRun: false,
    }, { id: atlasId });

    const entries = await list.handler({
      engine,
      config: {} as any,
      logger: console,
      dryRun: false,
    }, {});

    expect((entry as any).freshness).toBe('stale');
    expect((entries as any[])[0]?.freshness).toBe('stale');
  } finally {
    await engine.disconnect();
    rmSync(dir, { recursive: true, force: true });
  }
});
