import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createMemoryInboxOperations } from '../src/core/operations-memory-inbox.ts';
import { operations } from '../src/core/operations.ts';
import { OperationError } from '../src/core/operations.ts';
import { SQLiteEngine } from '../src/core/sqlite-engine.ts';

test('memory inbox operations can be built from a dedicated domain module', () => {
  const built = createMemoryInboxOperations({
    defaultScopeId: 'workspace:default',
    OperationError,
  });

  expect(built.map((operation) => operation.name)).toEqual([
    'get_memory_candidate_entry',
    'list_memory_candidate_entries',
    'create_memory_candidate_entry',
    'rank_memory_candidate_entries',
    'capture_map_derived_candidates',
    'list_memory_candidate_review_backlog',
    'advance_memory_candidate_status',
    'reject_memory_candidate_entry',
    'preflight_promote_memory_candidate',
    'promote_memory_candidate_entry',
    'supersede_memory_candidate_entry',
    'resolve_memory_candidate_contradiction',
  ]);
});

test('memory inbox operations are registered with CLI hints', () => {
  const create = operations.find((operation) => operation.name === 'create_memory_candidate_entry');
  const get = operations.find((operation) => operation.name === 'get_memory_candidate_entry');
  const list = operations.find((operation) => operation.name === 'list_memory_candidate_entries');
  const rank = operations.find((operation) => operation.name === 'rank_memory_candidate_entries');
  const captureMapDerived = operations.find((operation) => operation.name === 'capture_map_derived_candidates');
  const reviewBacklog = operations.find((operation) => operation.name === 'list_memory_candidate_review_backlog');
  const advance = operations.find((operation) => operation.name === 'advance_memory_candidate_status');
  const reject = operations.find((operation) => operation.name === 'reject_memory_candidate_entry');
  const preflight = operations.find((operation) => operation.name === 'preflight_promote_memory_candidate');
  const promote = operations.find((operation) => operation.name === 'promote_memory_candidate_entry');
  const supersede = operations.find((operation) => operation.name === 'supersede_memory_candidate_entry');
  const contradiction = operations.find((operation) => operation.name === 'resolve_memory_candidate_contradiction');

  expect(create?.cliHints?.name).toBe('create-memory-candidate');
  expect(get?.cliHints?.name).toBe('get-memory-candidate');
  expect(list?.cliHints?.name).toBe('list-memory-candidates');
  expect(rank?.cliHints?.name).toBe('rank-memory-candidates');
  expect(captureMapDerived?.cliHints?.name).toBe('capture-map-derived-candidates');
  expect(reviewBacklog?.cliHints?.name).toBe('list-memory-candidate-review-backlog');
  expect(advance?.cliHints?.name).toBe('advance-memory-candidate-status');
  expect(reject?.cliHints?.name).toBe('reject-memory-candidate');
  expect(preflight?.cliHints?.name).toBe('preflight-promote-memory-candidate');
  expect(promote?.cliHints?.name).toBe('promote-memory-candidate');
  expect(supersede?.cliHints?.name).toBe('supersede-memory-candidate');
  expect(contradiction?.cliHints?.name).toBe('resolve-memory-candidate-contradiction');
  expect(create?.params.status?.enum).toEqual(['captured', 'candidate', 'staged_for_review']);
  expect(list?.params.status?.enum).toEqual(['captured', 'candidate', 'staged_for_review', 'rejected', 'promoted', 'superseded']);
  expect(advance?.params.next_status?.description).toContain('depends on the current stored status');
});

test('memory inbox operations expose dry-run, direct get, filtered list, and bounded advance behavior', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mbrain-memory-inbox-op-'));
  const databasePath = join(dir, 'brain.db');
  const engine = new SQLiteEngine();
  const create = operations.find((operation) => operation.name === 'create_memory_candidate_entry');
  const get = operations.find((operation) => operation.name === 'get_memory_candidate_entry');
  const list = operations.find((operation) => operation.name === 'list_memory_candidate_entries');
  const advance = operations.find((operation) => operation.name === 'advance_memory_candidate_status');
  const reject = operations.find((operation) => operation.name === 'reject_memory_candidate_entry');
  const preflight = operations.find((operation) => operation.name === 'preflight_promote_memory_candidate');

  if (!create || !get || !list || !advance || !reject || !preflight) {
    throw new Error('memory inbox operations are missing');
  }

  try {
    await engine.connect({ engine: 'sqlite', database_path: databasePath });
    await engine.initSchema();

    const preview = await create.handler({
      engine,
      config: {} as any,
      logger: console,
      dryRun: true,
    }, {
      candidate_type: 'fact',
      proposed_content: 'Context maps can propose a note update candidate.',
      source_ref: 'User, direct message, 2026-04-22 3:01 PM KST',
    });

    expect((preview as any).dry_run).toBe(true);
    expect((preview as any).action).toBe('create_memory_candidate_entry');
    expect((preview as any).scope_id).toBe('workspace:default');
    expect((preview as any).status).toBe('captured');

    const created = await create.handler({
      engine,
      config: {} as any,
      logger: console,
      dryRun: false,
    }, {
      id: 'candidate-1',
      candidate_type: 'fact',
      proposed_content: 'Context maps can propose a note update candidate.',
      source_ref: 'User, direct message, 2026-04-22 3:01 PM KST',
      target_object_type: 'curated_note',
      target_object_id: 'concepts/note-manifest',
    });

    expect((created as any).id).toBe('candidate-1');
    expect((created as any).scope_id).toBe('workspace:default');
    expect((created as any).status).toBe('captured');
    expect((created as any).source_refs).toEqual(['User, direct message, 2026-04-22 3:01 PM KST']);

    const loaded = await get.handler({
      engine,
      config: {} as any,
      logger: console,
      dryRun: false,
    }, {
      id: 'candidate-1',
    });

    expect((loaded as any).id).toBe('candidate-1');
    expect((loaded as any).candidate_type).toBe('fact');

    const listed = await list.handler({
      engine,
      config: {} as any,
      logger: console,
      dryRun: false,
    }, {
      scope_id: 'workspace:default',
      status: 'captured',
      candidate_type: 'fact',
      limit: 10,
    });

    expect((listed as any[]).map((entry) => entry.id)).toEqual(['candidate-1']);

    const advanced = await advance.handler({
      engine,
      config: {} as any,
      logger: console,
      dryRun: false,
    }, {
      id: 'candidate-1',
      next_status: 'candidate',
    });

    expect((advanced as any).id).toBe('candidate-1');
    expect((advanced as any).status).toBe('candidate');

    const staged = await advance.handler({
      engine,
      config: {} as any,
      logger: console,
      dryRun: false,
    }, {
      id: 'candidate-1',
      next_status: 'staged_for_review',
      review_reason: 'Prepared for explicit decision.',
    });

    expect((staged as any).status).toBe('staged_for_review');

    const rejected = await reject.handler({
      engine,
      config: {} as any,
      logger: console,
      dryRun: false,
    }, {
      id: 'candidate-1',
      review_reason: 'Insufficient provenance for durable memory.',
    });

    expect((rejected as any).id).toBe('candidate-1');
    expect((rejected as any).status).toBe('rejected');

    const preflightResult = await preflight.handler({
      engine,
      config: {} as any,
      logger: console,
      dryRun: false,
    }, {
      id: 'candidate-1',
    });

    expect((preflightResult as any).candidate_id).toBe('candidate-1');
    expect((preflightResult as any).decision).toBe('deny');
    expect((preflightResult as any).reasons).toContain('candidate_not_staged_for_review');
  } finally {
    await engine.disconnect();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('memory inbox promotion preflight operation returns explicit allow and not-found errors', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mbrain-memory-inbox-op-preflight-'));
  const databasePath = join(dir, 'brain.db');
  const engine = new SQLiteEngine();
  const create = operations.find((operation) => operation.name === 'create_memory_candidate_entry');
  const advance = operations.find((operation) => operation.name === 'advance_memory_candidate_status');
  const preflight = operations.find((operation) => operation.name === 'preflight_promote_memory_candidate');

  if (!create || !advance || !preflight) {
    throw new Error('memory inbox create/advance/preflight operations are missing');
  }

  try {
    await engine.connect({ engine: 'sqlite', database_path: databasePath });
    await engine.initSchema();

    await create.handler({
      engine,
      config: {} as any,
      logger: console,
      dryRun: false,
    }, {
      id: 'candidate-preflight',
      candidate_type: 'fact',
      proposed_content: 'Promotion preflight stays read-only and explicit.',
      source_ref: 'User, direct message, 2026-04-23 7:10 PM KST',
      target_object_type: 'curated_note',
      target_object_id: 'concepts/memory-inbox',
    });

    await advance.handler({
      engine,
      config: {} as any,
      logger: console,
      dryRun: false,
    }, {
      id: 'candidate-preflight',
      next_status: 'candidate',
    });

    await advance.handler({
      engine,
      config: {} as any,
      logger: console,
      dryRun: false,
    }, {
      id: 'candidate-preflight',
      next_status: 'staged_for_review',
      review_reason: 'Ready for promotion governance.',
    });

    const result = await preflight.handler({
      engine,
      config: {} as any,
      logger: console,
      dryRun: false,
    }, {
      id: 'candidate-preflight',
    });

    expect((result as any).decision).toBe('allow');
    expect((result as any).reasons).toEqual(['candidate_ready_for_promotion']);

    await expect(preflight.handler({
      engine,
      config: {} as any,
      logger: console,
      dryRun: false,
    }, {
      id: 'missing-candidate',
    })).rejects.toMatchObject({
      code: 'memory_candidate_not_found',
    });

    await expect(preflight.handler({
      engine,
      config: {} as any,
      logger: console,
      dryRun: false,
    }, {})).rejects.toMatchObject({
      code: 'invalid_params',
    });
  } finally {
    await engine.disconnect();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('memory inbox promotion operation promotes staged candidates and rejects blocked ones', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mbrain-memory-inbox-op-promote-'));
  const databasePath = join(dir, 'brain.db');
  const engine = new SQLiteEngine();
  const create = operations.find((operation) => operation.name === 'create_memory_candidate_entry');
  const advance = operations.find((operation) => operation.name === 'advance_memory_candidate_status');
  const promote = operations.find((operation) => operation.name === 'promote_memory_candidate_entry');

  if (!create || !advance || !promote) {
    throw new Error('memory inbox create/advance/promote operations are missing');
  }

  try {
    await engine.connect({ engine: 'sqlite', database_path: databasePath });
    await engine.initSchema();

    await create.handler({
      engine,
      config: {} as any,
      logger: console,
      dryRun: false,
    }, {
      id: 'candidate-promote',
      candidate_type: 'fact',
      proposed_content: 'Promotion writes an explicit governance outcome.',
      source_ref: 'User, direct message, 2026-04-23 8:10 PM KST',
      target_object_type: 'curated_note',
      target_object_id: 'concepts/memory-inbox',
    });

    await advance.handler({ engine, config: {} as any, logger: console, dryRun: false }, {
      id: 'candidate-promote',
      next_status: 'candidate',
    });
    await advance.handler({ engine, config: {} as any, logger: console, dryRun: false }, {
      id: 'candidate-promote',
      next_status: 'staged_for_review',
      review_reason: 'Ready for promotion.',
    });

    const promoted = await promote.handler({
      engine,
      config: {} as any,
      logger: console,
      dryRun: false,
    }, {
      id: 'candidate-promote',
      review_reason: 'Promoted after passing preflight.',
    });

    expect((promoted as any).status).toBe('promoted');
    expect((promoted as any).review_reason).toBe('Promoted after passing preflight.');

    await create.handler({
      engine,
      config: {} as any,
      logger: console,
      dryRun: false,
    }, {
      id: 'candidate-promote-blocked',
      candidate_type: 'fact',
      proposed_content: 'Blocked promotion should stay staged when target binding is missing.',
      source_ref: 'User, direct message, 2026-04-23 8:15 PM KST',
    });

    await advance.handler({ engine, config: {} as any, logger: console, dryRun: false }, {
      id: 'candidate-promote-blocked',
      next_status: 'candidate',
    });
    await advance.handler({ engine, config: {} as any, logger: console, dryRun: false }, {
      id: 'candidate-promote-blocked',
      next_status: 'staged_for_review',
      review_reason: 'Waiting for deterministic governance check.',
    });

    await expect(promote.handler({
      engine,
      config: {} as any,
      logger: console,
      dryRun: false,
    }, {
      id: 'candidate-promote-blocked',
    })).rejects.toMatchObject({
      code: 'invalid_params',
    });

    const blocked = await engine.getMemoryCandidateEntry('candidate-promote-blocked');
    expect(blocked?.status).toBe('staged_for_review');

    await expect(promote.handler({
      engine,
      config: {} as any,
      logger: console,
      dryRun: false,
    }, {
      id: 'missing-promoted-candidate',
    })).rejects.toMatchObject({
      code: 'memory_candidate_not_found',
    });

    await expect(promote.handler({
      engine,
      config: {} as any,
      logger: console,
      dryRun: false,
    }, {
      id: 'candidate-promote',
      review_reason: 123,
    })).rejects.toMatchObject({
      code: 'invalid_params',
    });
  } finally {
    await engine.disconnect();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('memory inbox supersession operation records explicit old/new links', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mbrain-memory-inbox-op-supersede-'));
  const databasePath = join(dir, 'brain.db');
  const engine = new SQLiteEngine();
  const create = operations.find((operation) => operation.name === 'create_memory_candidate_entry');
  const advance = operations.find((operation) => operation.name === 'advance_memory_candidate_status');
  const promote = operations.find((operation) => operation.name === 'promote_memory_candidate_entry');
  const supersede = operations.find((operation) => operation.name === 'supersede_memory_candidate_entry');

  if (!create || !advance || !promote || !supersede) {
    throw new Error('memory inbox supersession operation is missing');
  }

  try {
    await engine.connect({ engine: 'sqlite', database_path: databasePath });
    await engine.initSchema();

    for (const id of ['candidate-old', 'candidate-new']) {
      await create.handler({ engine, config: {} as any, logger: console, dryRun: false }, {
        id,
        candidate_type: 'fact',
        proposed_content: `Candidate ${id} participates in supersession review.`,
        source_ref: 'User, direct message, 2026-04-23 11:30 PM KST',
        target_object_type: 'curated_note',
        target_object_id: 'concepts/memory-inbox',
      });
      await advance.handler({ engine, config: {} as any, logger: console, dryRun: false }, {
        id,
        next_status: 'candidate',
      });
      await advance.handler({ engine, config: {} as any, logger: console, dryRun: false }, {
        id,
        next_status: 'staged_for_review',
      });
      await promote.handler({ engine, config: {} as any, logger: console, dryRun: false }, {
        id,
        review_reason: 'Promotion before supersession test.',
      });
    }

    const result = await supersede.handler({
      engine,
      config: {} as any,
      logger: console,
      dryRun: false,
    }, {
      superseded_candidate_id: 'candidate-old',
      replacement_candidate_id: 'candidate-new',
      review_reason: 'Newer promoted candidate replaced the older one.',
    });

    expect((result as any).superseded_candidate.status).toBe('superseded');
    expect((result as any).supersession_entry.replacement_candidate_id).toBe('candidate-new');

    await expect(supersede.handler({
      engine,
      config: {} as any,
      logger: console,
      dryRun: false,
    }, {
      superseded_candidate_id: 'missing-candidate',
      replacement_candidate_id: 'candidate-new',
    })).rejects.toMatchObject({
      code: 'memory_candidate_not_found',
    });

    await create.handler({ engine, config: {} as any, logger: console, dryRun: false }, {
      id: 'candidate-not-promoted',
      candidate_type: 'fact',
      proposed_content: 'Replacement is not yet promoted.',
      source_ref: 'User, direct message, 2026-04-23 11:35 PM KST',
      target_object_type: 'curated_note',
      target_object_id: 'concepts/memory-inbox',
    });
    await advance.handler({ engine, config: {} as any, logger: console, dryRun: false }, {
      id: 'candidate-not-promoted',
      next_status: 'candidate',
    });

    await expect(supersede.handler({
      engine,
      config: {} as any,
      logger: console,
      dryRun: false,
    }, {
      superseded_candidate_id: 'candidate-new',
      replacement_candidate_id: 'candidate-not-promoted',
    })).rejects.toMatchObject({
      code: 'invalid_params',
    });

    await expect(supersede.handler({
      engine,
      config: {} as any,
      logger: console,
      dryRun: false,
    }, {
      superseded_candidate_id: 'candidate-new',
      replacement_candidate_id: 'candidate-not-promoted',
      reviewed_at: 'Thu Apr 23 2026 10:15:00 GMT+0900 (Korean Standard Time)',
    })).rejects.toMatchObject({
      code: 'invalid_params',
    });

    await expect(supersede.handler({
      engine,
      config: {} as any,
      logger: console,
      dryRun: false,
    }, {
      superseded_candidate_id: 'candidate-new',
      replacement_candidate_id: 'candidate-not-promoted',
      reviewed_at: '2026-99-99T25:61:61Z',
    })).rejects.toMatchObject({
      code: 'invalid_params',
    });
  } finally {
    await engine.disconnect();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('memory inbox create accepts source_refs arrays and rejects future-only statuses', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mbrain-memory-inbox-op-source-refs-'));
  const databasePath = join(dir, 'brain.db');
  const engine = new SQLiteEngine();
  const create = operations.find((operation) => operation.name === 'create_memory_candidate_entry');

  if (!create) {
    throw new Error('create memory candidate operation is missing');
  }

  try {
    await engine.connect({ engine: 'sqlite', database_path: databasePath });
    await engine.initSchema();

    const created = await create.handler({
      engine,
      config: {} as any,
      logger: console,
      dryRun: false,
    }, {
      id: 'candidate-multi-source',
      candidate_type: 'fact',
      proposed_content: 'Multiple provenance strings stay attached to one candidate.',
      source_refs: [
        'User, direct message, 2026-04-23 1:15 PM KST',
        'Meeting notes, Architecture Sync, 2026-04-23 1:20 PM KST',
      ],
    });

    expect((created as any).source_refs).toEqual([
      'User, direct message, 2026-04-23 1:15 PM KST',
      'Meeting notes, Architecture Sync, 2026-04-23 1:20 PM KST',
    ]);

    await expect(create.handler({
      engine,
      config: {} as any,
      logger: console,
      dryRun: false,
    }, {
      id: 'candidate-invalid-status',
      candidate_type: 'fact',
      proposed_content: 'Future-only statuses should stay hidden in Phase 5.',
      status: 'promoted',
    })).rejects.toBeInstanceOf(OperationError);

    await expect(create.handler({
      engine,
      config: {} as any,
      logger: console,
      dryRun: false,
    }, {
      id: 'candidate-invalid-status',
      candidate_type: 'fact',
      proposed_content: 'Future-only statuses should stay hidden in Phase 5.',
      status: 'promoted',
    })).rejects.toMatchObject({
      code: 'invalid_params',
    });

    await expect(create.handler({
      engine,
      config: {} as any,
      logger: console,
      dryRun: false,
    }, {
      id: 'candidate-blank-source-ref',
      candidate_type: 'fact',
      proposed_content: 'Blank provenance strings should be rejected.',
      source_refs: [''],
    })).rejects.toMatchObject({
      code: 'invalid_params',
    });

    await expect(create.handler({
      engine,
      config: {} as any,
      logger: console,
      dryRun: false,
    }, {
      id: 'candidate-blank-target-id',
      candidate_type: 'fact',
      proposed_content: 'Blank target ids should be rejected.',
      target_object_type: 'curated_note',
      target_object_id: '   ',
    })).rejects.toMatchObject({
      code: 'invalid_params',
    });
  } finally {
    await engine.disconnect();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('memory inbox list caps oversized limits', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mbrain-memory-inbox-op-limit-cap-'));
  const databasePath = join(dir, 'brain.db');
  const engine = new SQLiteEngine();
  const create = operations.find((operation) => operation.name === 'create_memory_candidate_entry');
  const list = operations.find((operation) => operation.name === 'list_memory_candidate_entries');

  if (!create || !list) {
    throw new Error('memory inbox create/list operations are missing');
  }

  try {
    await engine.connect({ engine: 'sqlite', database_path: databasePath });
    await engine.initSchema();

    for (let index = 0; index < 105; index++) {
      await create.handler({
        engine,
        config: {} as any,
        logger: console,
        dryRun: false,
      }, {
        id: `candidate-cap-${index}`,
        candidate_type: 'fact',
        proposed_content: `Candidate ${index}`,
      });
    }

    const listed = await list.handler({
      engine,
      config: {} as any,
      logger: console,
      dryRun: false,
    }, {
      scope_id: 'workspace:default',
      limit: 999,
    });

    expect((listed as any[])).toHaveLength(100);
  } finally {
    await engine.disconnect();
    rmSync(dir, { recursive: true, force: true });
  }
});
