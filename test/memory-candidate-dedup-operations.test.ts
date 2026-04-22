import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { operations } from '../src/core/operations.ts';
import { SQLiteEngine } from '../src/core/sqlite-engine.ts';

test('memory candidate dedup backlog operation is registered with CLI hints', () => {
  const backlog = operations.find((operation) => operation.name === 'list_memory_candidate_review_backlog');
  expect(backlog?.cliHints?.name).toBe('list-memory-candidate-review-backlog');
});

test('memory candidate dedup backlog operation groups before applying limit and stays read-only', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mbrain-memory-candidate-dedup-op-'));
  const databasePath = join(dir, 'brain.db');
  const engine = new SQLiteEngine();
  const create = operations.find((operation) => operation.name === 'create_memory_candidate_entry');
  const backlog = operations.find((operation) => operation.name === 'list_memory_candidate_review_backlog');

  if (!create || !backlog) {
    throw new Error('memory candidate create/backlog operations are missing');
  }

  try {
    await engine.connect({ engine: 'sqlite', database_path: databasePath });
    await engine.initSchema();

    await create.handler({ engine, config: {} as any, logger: console, dryRun: false }, {
      id: 'dup-a',
      candidate_type: 'note_update',
      proposed_content: 'Review the context map recommendation.',
      source_refs: ['A'],
      generated_by: 'map_analysis',
      extraction_kind: 'inferred',
      confidence_score: 0.8,
      importance_score: 0.8,
      recurrence_score: 0.4,
      target_object_type: 'curated_note',
      target_object_id: 'concepts/topic-1',
    });
    await create.handler({ engine, config: {} as any, logger: console, dryRun: false }, {
      id: 'dup-b',
      candidate_type: 'note_update',
      proposed_content: ' review  the context map recommendation. ',
      source_refs: ['B'],
      generated_by: 'map_analysis',
      extraction_kind: 'inferred',
      confidence_score: 0.6,
      importance_score: 0.7,
      recurrence_score: 0.2,
      target_object_type: 'curated_note',
      target_object_id: 'concepts/topic-1',
    });
    await create.handler({ engine, config: {} as any, logger: console, dryRun: false }, {
      id: 'distinct',
      candidate_type: 'note_update',
      proposed_content: 'Review another recommendation.',
      source_refs: ['C'],
      generated_by: 'map_analysis',
      extraction_kind: 'inferred',
      confidence_score: 0.7,
      importance_score: 0.7,
      recurrence_score: 0.1,
      target_object_type: 'curated_note',
      target_object_id: 'concepts/topic-2',
    });

    const before = await engine.getMemoryCandidateEntry('dup-a');

    const result = await backlog.handler({ engine, config: {} as any, logger: console, dryRun: false }, {
      scope_id: 'workspace:default',
      limit: 1,
    });

    expect((result as any[])).toHaveLength(1);
    expect((result as any[])[0].duplicate_count).toBe(2);
    expect((result as any[])[0].grouped_candidate_ids).toEqual(['dup-a', 'dup-b']);

    const after = await engine.getMemoryCandidateEntry('dup-a');
    expect(after).toEqual(before);
  } finally {
    await engine.disconnect();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('memory candidate dedup backlog operation paginates raw candidates before grouping so duplicate groups are not truncated', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mbrain-memory-candidate-dedup-op-pagination-'));
  const databasePath = join(dir, 'brain.db');
  const engine = new SQLiteEngine();
  const create = operations.find((operation) => operation.name === 'create_memory_candidate_entry');
  const backlog = operations.find((operation) => operation.name === 'list_memory_candidate_review_backlog');

  if (!create || !backlog) {
    throw new Error('memory candidate create/backlog operations are missing');
  }

  try {
    await engine.connect({ engine: 'sqlite', database_path: databasePath });
    await engine.initSchema();

    for (let index = 0; index < 101; index += 1) {
      await create.handler({ engine, config: {} as any, logger: console, dryRun: false }, {
        id: `dup-${index}`,
        candidate_type: 'note_update',
        proposed_content: 'Review the context map recommendation.',
        source_refs: [`ref-${index}`],
        generated_by: 'map_analysis',
        extraction_kind: 'inferred',
        confidence_score: 0.8,
        importance_score: 0.8,
        recurrence_score: 0.1,
        target_object_type: 'curated_note',
        target_object_id: 'concepts/topic-1',
      });
    }

    const result = await backlog.handler({ engine, config: {} as any, logger: console, dryRun: false }, {
      scope_id: 'workspace:default',
      limit: 1,
    });

    expect((result as any[])).toHaveLength(1);
    expect((result as any[])[0].duplicate_count).toBe(101);
  } finally {
    await engine.disconnect();
    rmSync(dir, { recursive: true, force: true });
  }
});
