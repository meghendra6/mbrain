import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { operations, OperationError } from '../src/core/operations.ts';
import { createMemoryInboxOperations } from '../src/core/operations-memory-inbox.ts';
import { SQLiteEngine } from '../src/core/sqlite-engine.ts';

test('memory candidate scoring operations are registered with the inbox domain module and CLI hints', () => {
  const built = createMemoryInboxOperations({
    defaultScopeId: 'workspace:default',
    OperationError,
  });
  const rank = built.find((operation) => operation.name === 'rank_memory_candidate_entries');
  const registered = operations.find((operation) => operation.name === 'rank_memory_candidate_entries');

  expect(rank?.cliHints?.name).toBe('rank-memory-candidates');
  expect(registered?.cliHints?.name).toBe('rank-memory-candidates');
});

test('memory candidate scoring operation returns ranked read-only results with bounded limits', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mbrain-memory-candidate-scoring-op-'));
  const databasePath = join(dir, 'brain.db');
  const engine = new SQLiteEngine();
  const create = operations.find((operation) => operation.name === 'create_memory_candidate_entry');
  const rank = operations.find((operation) => operation.name === 'rank_memory_candidate_entries');

  if (!create || !rank) {
    throw new Error('memory candidate create/rank operations are missing');
  }

  try {
    await engine.connect({ engine: 'sqlite', database_path: databasePath });
    await engine.initSchema();

    await create.handler({ engine, config: {} as any, logger: console, dryRun: false }, {
      id: 'candidate-low',
      candidate_type: 'fact',
      proposed_content: 'Low-ranked candidate.',
      source_refs: ['User, direct message, 2026-04-23 11:00 AM KST'],
      confidence_score: 0.4,
      importance_score: 0.4,
      recurrence_score: 0.1,
    });
    await create.handler({ engine, config: {} as any, logger: console, dryRun: false }, {
      id: 'candidate-high',
      candidate_type: 'fact',
      proposed_content: 'High-ranked candidate.',
      source_refs: [
        'User, direct message, 2026-04-23 11:00 AM KST',
        'Meeting notes "Scoring Sync", 2026-04-23 11:05 AM KST',
      ],
      confidence_score: 0.8,
      importance_score: 0.9,
      recurrence_score: 0.6,
    });

    const before = await engine.getMemoryCandidateEntry('candidate-high');

    const ranked = await rank.handler({ engine, config: {} as any, logger: console, dryRun: false }, {
      scope_id: 'workspace:default',
      limit: 1,
    });

    expect(Array.isArray(ranked)).toBe(true);
    expect((ranked as any[]).length).toBe(1);
    expect((ranked as any[])[0].candidate.id).toBe('candidate-high');
    expect((ranked as any[])[0].review_priority_score).toBeGreaterThan((ranked as any[])[0].effective_confidence_score - 0.01);

    const after = await engine.getMemoryCandidateEntry('candidate-high');
    expect(after).toEqual(before);
  } finally {
    await engine.disconnect();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('memory candidate scoring operation ranks across every matching page before applying limit', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mbrain-memory-candidate-scoring-window-'));
  const databasePath = join(dir, 'brain.db');
  const engine = new SQLiteEngine();
  const create = operations.find((operation) => operation.name === 'create_memory_candidate_entry');
  const rank = operations.find((operation) => operation.name === 'rank_memory_candidate_entries');

  if (!create || !rank) {
    throw new Error('memory candidate create/rank operations are missing');
  }

  try {
    await engine.connect({ engine: 'sqlite', database_path: databasePath });
    await engine.initSchema();

    await create.handler({ engine, config: {} as any, logger: console, dryRun: false }, {
      id: 'candidate-high-beyond-first-page',
      candidate_type: 'fact',
      proposed_content: 'Highest ranked candidate but older than the first engine page.',
      source_refs: [
        'User, direct message, 2026-04-23 11:00 AM KST',
        'Meeting notes "Scoring Sync", 2026-04-23 11:05 AM KST',
      ],
      confidence_score: 1,
      importance_score: 1,
      recurrence_score: 1,
    });
    (engine as any).database.run(
      `UPDATE memory_candidate_entries
       SET updated_at = ?
       WHERE id = ?`,
      ['2026-04-23T00:00:00.000Z', 'candidate-high-beyond-first-page'],
    );

    for (let index = 0; index < 101; index++) {
      await create.handler({ engine, config: {} as any, logger: console, dryRun: false }, {
        id: `candidate-low-${String(index).padStart(3, '0')}`,
        candidate_type: 'fact',
        proposed_content: `Low-ranked candidate ${index}.`,
        source_refs: [],
        confidence_score: 0.1,
        importance_score: 0.1,
        recurrence_score: 0,
      });
    }

    const ranked = await rank.handler({ engine, config: {} as any, logger: console, dryRun: false }, {
      scope_id: 'workspace:default',
      limit: 1,
    });

    expect((ranked as any[])[0].candidate.id).toBe('candidate-high-beyond-first-page');
  } finally {
    await engine.disconnect();
    rmSync(dir, { recursive: true, force: true });
  }
});
