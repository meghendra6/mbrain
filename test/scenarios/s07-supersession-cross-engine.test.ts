/**
 * Scenario S7 — Supersession invariant holds identically across engines.
 *
 * Falsifies I7 (backend parity: SQLite, Postgres, and local execution paths
 * must preserve the same semantic behavior at the system boundary) and
 * L5 (explicit supersede, not silent deletion).
 *
 * The supersession invariant: updating a candidate's status to 'superseded'
 * without first recording a supersession link must fail. This is enforced
 * via a plpgsql trigger on Postgres/PGLite and via hand-coded logic on
 * SQLite. Both paths must reject the same way.
 */

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SQLiteEngine } from '../../src/core/sqlite-engine.ts';
import { PGLiteEngine } from '../../src/core/pglite-engine.ts';
import { supersedeMemoryCandidateEntry } from '../../src/core/services/memory-inbox-supersession-service.ts';
import type { BrainEngine } from '../../src/core/engine.ts';
import { seedMemoryCandidate } from './helpers.ts';
import { promoteMemoryCandidateEntry } from '../../src/core/services/memory-inbox-promotion-service.ts';

async function seedTwoPromotedCandidates(engine: BrainEngine, prefix: string): Promise<void> {
  await seedMemoryCandidate(engine, {
    id: `${prefix}-old`,
    status: 'staged_for_review',
    target_object_id: `concepts/${prefix}`,
  });
  await seedMemoryCandidate(engine, {
    id: `${prefix}-new`,
    status: 'staged_for_review',
    target_object_id: `concepts/${prefix}`,
  });
  await promoteMemoryCandidateEntry(engine, { id: `${prefix}-old` });
  await promoteMemoryCandidateEntry(engine, { id: `${prefix}-new` });
}

async function allocateSqlite(label: string): Promise<{ engine: SQLiteEngine; teardown: () => Promise<void> }> {
  const dir = mkdtempSync(join(tmpdir(), `mbrain-s07-${label}-`));
  const engine = new SQLiteEngine();
  await engine.connect({ engine: 'sqlite', database_path: join(dir, 'brain.db') });
  await engine.initSchema();
  return {
    engine,
    teardown: async () => {
      await engine.disconnect();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function allocatePglite(label: string): Promise<{ engine: PGLiteEngine; teardown: () => Promise<void> }> {
  const dir = mkdtempSync(join(tmpdir(), `mbrain-s07-${label}-`));
  const engine = new PGLiteEngine();
  await engine.connect({ engine: 'pglite', database_path: join(dir, 'pglite') });
  await engine.initSchema();
  return {
    engine,
    teardown: async () => {
      await engine.disconnect();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

// PGLite cold-starts are ~2-4s (instantiation + 19 migrations). Under full
// suite load these can exceed the default 5s test timeout. Per-test timeout
// override is the pattern PR #36 applied to phase8 bench tests.
const ENGINE_COLD_START_BUDGET_MS = 30_000;

function runEngineSuite(label: 'sqlite' | 'pglite', allocate: (label: string) => Promise<{ engine: BrainEngine; teardown: () => Promise<void> }>) {
  describe(`S7 [${label}] — supersession invariant`, () => {
    test('recording a supersession link succeeds and flips old status to superseded', async () => {
      const handle = await allocate(`succ-${label}`);
      try {
        await seedTwoPromotedCandidates(handle.engine, 'basic');

        const result = await supersedeMemoryCandidateEntry(handle.engine, {
          superseded_candidate_id: 'basic-old',
          replacement_candidate_id: 'basic-new',
          review_reason: 'Newer claim replaces older one',
        });

        expect(result.supersession_entry).not.toBeNull();
        expect(result.supersession_entry!.superseded_candidate_id).toBe('basic-old');
        expect(result.supersession_entry!.replacement_candidate_id).toBe('basic-new');

        const superseded = await handle.engine.getMemoryCandidateEntry('basic-old');
        expect(superseded?.status).toBe('superseded');
      } finally {
        await handle.teardown();
      }
    }, ENGINE_COLD_START_BUDGET_MS);

    test('self-supersession (same id as both sides) is rejected', async () => {
      const handle = await allocate(`self-${label}`);
      try {
        await seedMemoryCandidate(handle.engine, {
          id: 'self-cand',
          status: 'staged_for_review',
        });
        await promoteMemoryCandidateEntry(handle.engine, { id: 'self-cand' });

        await expect(
          supersedeMemoryCandidateEntry(handle.engine, {
            superseded_candidate_id: 'self-cand',
            replacement_candidate_id: 'self-cand',
          }),
        ).rejects.toThrow();
      } finally {
        await handle.teardown();
      }
    }, ENGINE_COLD_START_BUDGET_MS);
  });
}

runEngineSuite('sqlite', allocateSqlite);
runEngineSuite('pglite', allocatePglite);
