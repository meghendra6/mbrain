import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SQLiteEngine } from '../src/core/sqlite-engine.ts';
import { advanceMemoryCandidateStatus } from '../src/core/services/memory-inbox-service.ts';
import { promoteMemoryCandidateEntry } from '../src/core/services/memory-inbox-promotion-service.ts';
import { recordCanonicalHandoff } from '../src/core/services/canonical-handoff-service.ts';
import { runDreamCycleMaintenance } from '../src/core/services/dream-cycle-maintenance-service.ts';

test('dream-cycle maintenance creates only governed dream-cycle candidates', async () => {
  const harness = await createHarness('writes');

  try {
    await seedDuplicateCandidates(harness.engine, 'workspace:default');
    await seedStalePromotedCandidate(harness.engine, 'stale-default', 'workspace:default');

    const result = await runDreamCycleMaintenance(harness.engine, {
      scope_id: 'workspace:default',
      now: new Date('2026-04-23T12:00:00.000Z'),
      limit: 3,
      write_candidates: true,
    });

    expect(result.suggestions.map((suggestion) => suggestion.suggestion_type).sort()).toEqual([
      'duplicate_merge',
      'recap',
      'stale_claim_challenge',
    ]);
    expect(result.suggestions).toHaveLength(3);
    expect(result.suggestions.every((suggestion) => suggestion.candidate_id != null)).toBe(true);

    for (const suggestion of result.suggestions) {
      const stored = await harness.engine.getMemoryCandidateEntry(suggestion.candidate_id ?? '');
      expect(stored?.generated_by).toBe('dream_cycle');
      expect(stored?.status).toBe('candidate');
      expect(stored?.scope_id).toBe('workspace:default');
    }
  } finally {
    await harness.cleanup();
  }
});

test('dream-cycle dry-run emits bounded suggestions without creating candidates', async () => {
  const harness = await createHarness('dry-run');

  try {
    await seedDuplicateCandidates(harness.engine, 'workspace:default');
    const before = await harness.engine.listMemoryCandidateEntries({
      scope_id: 'workspace:default',
      limit: 100,
      offset: 0,
    });

    const result = await runDreamCycleMaintenance(harness.engine, {
      scope_id: 'workspace:default',
      now: '2026-04-23T12:00:00.000Z',
      limit: 1,
      write_candidates: false,
    });

    expect(result.write_candidates).toBe(false);
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]?.suggestion_type).toBe('recap');
    expect(result.suggestions[0]?.candidate_id).toBeNull();

    const after = await harness.engine.listMemoryCandidateEntries({
      scope_id: 'workspace:default',
      limit: 100,
      offset: 0,
    });
    expect(after.map((entry) => entry.id).sort()).toEqual(before.map((entry) => entry.id).sort());
  } finally {
    await harness.cleanup();
  }
});

test('dream-cycle limit zero emits no suggestions before reading candidates', async () => {
  const result = await runDreamCycleMaintenance({
    listMemoryCandidateEntries: async () => {
      throw new Error('limit zero should not read candidates');
    },
  } as any, {
    scope_id: 'workspace:default',
    now: '2026-04-23T12:00:00.000Z',
    limit: 0,
    write_candidates: false,
  });

  expect(result.suggestions).toEqual([]);
  expect(result.summary_lines[0]).toContain('inspected 0 candidates');
});

test('dream-cycle maintenance ignores prior dream-cycle candidates as input', async () => {
  const harness = await createHarness('ignore-dream');

  try {
    await seedCandidate(harness.engine, {
      id: 'manual-source',
      scope_id: 'workspace:default',
      proposed_content: 'Manual source candidate.',
      source_refs: ['manual'],
    });
    await harness.engine.createMemoryCandidateEntry({
      id: 'previous-dream-output',
      scope_id: 'workspace:default',
      candidate_type: 'rationale',
      proposed_content: 'Manual source candidate.',
      source_refs: ['dream'],
      generated_by: 'dream_cycle',
      extraction_kind: 'inferred',
      confidence_score: 0.7,
      importance_score: 0.5,
      recurrence_score: 0,
      sensitivity: 'work',
      status: 'candidate',
      target_object_type: 'curated_note',
      target_object_id: 'concepts/dream-cycle',
      reviewed_at: null,
      review_reason: null,
    });

    const result = await runDreamCycleMaintenance(harness.engine, {
      scope_id: 'workspace:default',
      now: '2026-04-23T12:00:00.000Z',
      limit: 3,
      write_candidates: false,
    });

    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]?.suggestion_type).toBe('recap');
    expect(result.suggestions[0]?.source_candidate_ids).toEqual(['manual-source']);
  } finally {
    await harness.cleanup();
  }
});

test('dream-cycle maintenance uses one capped raw candidate read window', async () => {
  const calls: any[] = [];
  const result = await runDreamCycleMaintenance({
    listMemoryCandidateEntries: async (filters: any) => {
      calls.push(filters);
      return [];
    },
  } as any, {
    scope_id: 'workspace:default',
    now: '2026-04-23T12:00:00.000Z',
    limit: 5,
    write_candidates: false,
  });

  expect(result.suggestions).toEqual([]);
  expect(calls).toEqual([
    {
      scope_id: 'workspace:default',
      limit: 100,
      offset: 0,
    },
  ]);
});

test('dream-cycle candidate writes roll back when a mid-loop create fails', async () => {
  const harness = await createHarness('rollback');

  try {
    await seedDuplicateCandidates(harness.engine, 'workspace:default');
    const originalCreate = harness.engine.createMemoryCandidateEntry.bind(harness.engine);
    let createCount = 0;
    harness.engine.createMemoryCandidateEntry = (async (input) => {
      createCount += 1;
      if (createCount === 2) {
        throw new Error('simulated dream-cycle create failure');
      }
      return originalCreate(input);
    }) as typeof harness.engine.createMemoryCandidateEntry;

    await expect(runDreamCycleMaintenance(harness.engine, {
      scope_id: 'workspace:default',
      now: '2026-04-23T12:00:00.000Z',
      limit: 2,
      write_candidates: true,
    })).rejects.toThrow('simulated dream-cycle create failure');

    const after = await harness.engine.listMemoryCandidateEntries({
      scope_id: 'workspace:default',
      limit: 100,
      offset: 0,
    });
    expect(after.filter((entry) => entry.generated_by === 'dream_cycle')).toEqual([]);
  } finally {
    await harness.cleanup();
  }
});

test('dream-cycle maintenance is scope-local and ignores other-scope duplicate groups', async () => {
  const harness = await createHarness('scope-local');

  try {
    await seedCandidate(harness.engine, {
      id: 'default-single',
      scope_id: 'workspace:default',
      proposed_content: 'Default scope single candidate.',
      source_refs: ['default'],
    });
    await seedDuplicateCandidates(harness.engine, 'workspace:other');

    const result = await runDreamCycleMaintenance(harness.engine, {
      scope_id: 'workspace:default',
      now: '2026-04-23T12:00:00.000Z',
      limit: 5,
      write_candidates: false,
    });

    expect(result.suggestions.map((suggestion) => suggestion.suggestion_type)).toEqual(['recap']);
    expect(result.suggestions[0]?.source_candidate_ids).toEqual(['default-single']);
  } finally {
    await harness.cleanup();
  }
});

test('dream-cycle maintenance rejects invalid now values before stale checks', async () => {
  const harness = await createHarness('invalid-now');

  try {
    await expect(runDreamCycleMaintenance(harness.engine, {
      scope_id: 'workspace:default',
      now: new Date('not-a-date'),
      write_candidates: false,
    })).rejects.toMatchObject({ code: 'invalid_status_transition' });

    await expect(runDreamCycleMaintenance(harness.engine, {
      scope_id: 'workspace:default',
      now: 'not-a-date',
      write_candidates: false,
    })).rejects.toMatchObject({ code: 'invalid_status_transition' });
  } finally {
    await harness.cleanup();
  }
});

async function createHarness(label: string) {
  const dir = mkdtempSync(join(tmpdir(), `mbrain-dream-cycle-${label}-`));
  const databasePath = join(dir, 'brain.db');
  const engine = new SQLiteEngine();
  await engine.connect({ engine: 'sqlite', database_path: databasePath });
  await engine.initSchema();

  return {
    engine,
    cleanup: async () => {
      await engine.disconnect();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function seedDuplicateCandidates(engine: SQLiteEngine, scopeId: string) {
  await seedCandidate(engine, {
    id: `${scopeId}:dup-a`,
    scope_id: scopeId,
    proposed_content: 'Duplicate maintenance claim.',
    source_refs: [`${scopeId}:a`],
    recurrence_score: 0.3,
  });
  await seedCandidate(engine, {
    id: `${scopeId}:dup-b`,
    scope_id: scopeId,
    proposed_content: ' duplicate   maintenance claim. ',
    source_refs: [`${scopeId}:b`],
    recurrence_score: 0.2,
  });
}

async function seedStalePromotedCandidate(engine: SQLiteEngine, id: string, scopeId: string) {
  await seedCandidate(engine, {
    id,
    scope_id: scopeId,
    proposed_content: 'A stale promoted maintenance claim.',
    source_refs: [`${scopeId}:stale`],
    reviewed_at: null,
  });
  await advanceMemoryCandidateStatus(engine, {
    id,
    next_status: 'staged_for_review',
    review_reason: 'Prepared for stale validation.',
  });
  await promoteMemoryCandidateEntry(engine, {
    id,
    reviewed_at: '2026-02-01T10:00:00.000Z',
    review_reason: 'Promoted before the review window.',
  });
  await recordCanonicalHandoff(engine, {
    candidate_id: id,
    reviewed_at: '2026-02-01T10:05:00.000Z',
  });
}

async function seedCandidate(
  engine: SQLiteEngine,
  input: {
    id: string;
    scope_id: string;
    proposed_content: string;
    source_refs: string[];
    recurrence_score?: number;
    reviewed_at?: string | null;
  },
) {
  await engine.createMemoryCandidateEntry({
    id: input.id,
    scope_id: input.scope_id,
    candidate_type: 'note_update',
    proposed_content: input.proposed_content,
    source_refs: input.source_refs,
    generated_by: 'manual',
    extraction_kind: 'manual',
    confidence_score: 0.75,
    importance_score: 0.7,
    recurrence_score: input.recurrence_score ?? 0.1,
    sensitivity: 'work',
    status: 'candidate',
    target_object_type: 'curated_note',
    target_object_id: 'concepts/dream-cycle',
    reviewed_at: input.reviewed_at ?? null,
    review_reason: null,
  });
}
