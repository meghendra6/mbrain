import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { importFromContent } from '../src/core/import-file.ts';
import { SQLiteEngine } from '../src/core/sqlite-engine.ts';
import { buildStructuralContextMapEntry } from '../src/core/services/context-map-service.ts';
import { captureMapDerivedCandidates } from '../src/core/services/map-derived-candidate-service.ts';
import { rebuildNoteManifestEntries } from '../src/core/services/note-manifest-service.ts';
import { rebuildNoteSectionEntries } from '../src/core/services/note-section-service.ts';

async function seedWorkspace(engine: SQLiteEngine, pageCount = 2, scopeId = 'workspace:default') {
  for (let index = 1; index <= pageCount; index += 1) {
    await importFromContent(engine, `concepts/topic-${index}`, [
      '---',
      'type: concept',
      `title: Topic ${index}`,
      '---',
      '# Overview',
      index < pageCount ? `See [[concepts/topic-${index + 1}]].` : 'Terminal node.',
    ].join('\n'), { path: `concepts/topic-${index}.md` });
  }

  if (scopeId !== 'workspace:default') {
    await rebuildNoteManifestEntries(engine, { scope_id: scopeId });
    await rebuildNoteSectionEntries(engine, { scope_id: scopeId });
  }
}

test('map-derived candidate service captures ready-map reads as inferred map-analysis inbox candidates', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mbrain-map-derived-service-ready-'));
  const databasePath = join(dir, 'brain.db');
  const engine = new SQLiteEngine();

  try {
    await engine.connect({ engine: 'sqlite', database_path: databasePath });
    await engine.initSchema();
    await seedWorkspace(engine, 2);

    const built = await buildStructuralContextMapEntry(engine);
    const before = await engine.getContextMapEntry(built.id);

    const result = await captureMapDerivedCandidates(engine, {
      map_id: built.id,
    });

    expect(result.selection_reason).toBe('direct_map_id');
    expect(result.map_status).toBe('ready');
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.every((entry) => entry.status === 'captured')).toBe(true);
    expect(result.candidates.every((entry) => entry.generated_by === 'map_analysis')).toBe(true);
    expect(result.candidates.every((entry) => entry.extraction_kind === 'inferred')).toBe(true);
    expect(result.candidates.every((entry) => entry.target_object_type === 'curated_note')).toBe(true);
    expect(result.candidates.every((entry) => entry.source_refs.some((ref) => ref.includes(`map_id=${built.id}`)))).toBe(true);
    expect(result.candidates.every((entry) => entry.source_refs.some((ref) => ref.includes('path=')))).toBe(true);
    const createdEvents = await engine.listMemoryCandidateStatusEvents({
      scope_id: 'workspace:default',
      event_kind: 'created',
      limit: 100,
    });
    expect(createdEvents.map((event) => event.candidate_id).sort()).toEqual(
      result.candidates.map((entry) => entry.id).sort(),
    );
    expect(createdEvents.every((event) => event.interaction_id === null)).toBe(true);

    const after = await engine.getContextMapEntry(built.id);
    expect(after).toEqual(before);
  } finally {
    await engine.disconnect();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('map-derived candidate service degrades stale maps to ambiguous lower-confidence candidates', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mbrain-map-derived-service-stale-'));
  const databasePath = join(dir, 'brain.db');
  const engine = new SQLiteEngine();

  try {
    await engine.connect({ engine: 'sqlite', database_path: databasePath });
    await engine.initSchema();
    await seedWorkspace(engine, 2);

    const built = await buildStructuralContextMapEntry(engine);

    await importFromContent(engine, 'concepts/topic-2', [
      '---',
      'type: concept',
      'title: Topic 2',
      '---',
      '# Overview',
      'Topic 2 changed and makes the map stale.',
    ].join('\n'), { path: 'concepts/topic-2.md' });

    const result = await captureMapDerivedCandidates(engine, {
      map_id: built.id,
      limit: 1,
    });

    expect(result.map_status).toBe('stale');
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.status).toBe('captured');
    expect(result.candidates[0]?.generated_by).toBe('map_analysis');
    expect(result.candidates[0]?.extraction_kind).toBe('ambiguous');
    expect(result.candidates[0]?.confidence_score).toBe(0.35);
    expect(result.candidates[0]?.source_refs.some((ref) => ref.includes(`map_id=${built.id}`))).toBe(true);
    expect(result.candidates[0]?.source_refs.some((ref) => ref.includes('path='))).toBe(true);
  } finally {
    await engine.disconnect();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('map-derived candidate service respects the selected map scope when map_id is provided without scope_id', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mbrain-map-derived-service-nondefault-'));
  const databasePath = join(dir, 'brain.db');
  const engine = new SQLiteEngine();
  const scopeId = 'workspace:project-alpha';

  try {
    await engine.connect({ engine: 'sqlite', database_path: databasePath });
    await engine.initSchema();
    await seedWorkspace(engine, 2, scopeId);

    const built = await buildStructuralContextMapEntry(engine, scopeId);
    const result = await captureMapDerivedCandidates(engine, {
      map_id: built.id,
    });

    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.every((entry) => entry.scope_id === scopeId)).toBe(true);
  } finally {
    await engine.disconnect();
    rmSync(dir, { recursive: true, force: true });
  }
});
