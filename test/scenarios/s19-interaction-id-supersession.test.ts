/**
 * Scenario S19 — supersession entry carries interaction_id.
 */

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SQLiteEngine } from '../../src/core/sqlite-engine.ts';
import { PGLiteEngine } from '../../src/core/pglite-engine.ts';
import { seedMemoryCandidate } from './helpers.ts';
import { promoteMemoryCandidateEntry } from '../../src/core/services/memory-inbox-promotion-service.ts';
import { supersedeMemoryCandidateEntry } from '../../src/core/services/memory-inbox-supersession-service.ts';

const ENGINE_COLD_START_BUDGET_MS = 30_000;

function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function allocateSqlite(label: string): Promise<{ engine: SQLiteEngine; teardown: () => Promise<void> }> {
  const dir = mkdtempSync(join(tmpdir(), `mbrain-s19-${label}-`));
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
  const dir = mkdtempSync(join(tmpdir(), `mbrain-s19-${label}-`));
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

function runEngineSuite(
  label: 'sqlite' | 'pglite',
  allocate: (l: string) => Promise<{ engine: SQLiteEngine | PGLiteEngine; teardown: () => Promise<void> }>,
) {
  describe(`S19 [${label}] — supersession carries interaction_id`, () => {
    test(
      'interaction_id is persisted and readable on the supersession entry',
      async () => {
        const handle = await allocate(label);
        const interactionId = uniqueId(`interaction-${label}`);
        const oldId = uniqueId(`old-${label}`);
        const newId = uniqueId(`new-${label}`);

        try {
          await seedMemoryCandidate(handle.engine, {
            id: oldId,
            status: 'staged_for_review',
            target_object_id: `concepts/${label}`,
          });
          await seedMemoryCandidate(handle.engine, {
            id: newId,
            status: 'staged_for_review',
            target_object_id: `concepts/${label}`,
          });
          await promoteMemoryCandidateEntry(handle.engine, { id: oldId });
          await promoteMemoryCandidateEntry(handle.engine, { id: newId });

          const result = await supersedeMemoryCandidateEntry(handle.engine, {
            superseded_candidate_id: oldId,
            replacement_candidate_id: newId,
            interaction_id: interactionId,
          });

          expect(result.supersession_entry).not.toBeNull();
          expect(result.supersession_entry!.interaction_id).toBe(interactionId);

          const stored = await handle.engine.getMemoryCandidateSupersessionEntry(result.supersession_entry!.id);
          expect(stored?.interaction_id).toBe(interactionId);
        } finally {
          await handle.teardown();
        }
      },
      ENGINE_COLD_START_BUDGET_MS,
    );
  });
}

runEngineSuite('sqlite', allocateSqlite);
runEngineSuite('pglite', allocatePglite);
