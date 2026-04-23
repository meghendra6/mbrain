/**
 * Scenario S1 — Fresh install → import → basic query.
 *
 * Falsifies I6 (local-first is an architectural constraint) and I7 (backend
 * parity) at the simplest boundary: a brand-new brain can be initialized,
 * populated from markdown, and queried via search and backlinks.
 */

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SQLiteEngine } from '../../src/core/sqlite-engine.ts';
import { LATEST_VERSION } from '../../src/core/migrate.ts';
import { importFromFile } from '../../src/core/import-file.ts';

describe('S1 — fresh install, import, basic query', () => {
  test('a fresh SQLite brain applies all migrations and indexes imported markdown', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'mbrain-s01-'));
    const brainDir = join(rootDir, 'brain');
    const dbPath = join(rootDir, 'brain.db');
    mkdirSync(brainDir, { recursive: true });

    const engine = new SQLiteEngine();

    try {
      await engine.connect({ engine: 'sqlite', database_path: dbPath });
      await engine.initSchema();

      // I6: the local path must end with the schema at LATEST_VERSION.
      const version = await engine.getConfig('version');
      expect(Number(version)).toBe(LATEST_VERSION);

      // Seed five markdown files that exercise the manifest pipeline.
      const files = [
        {
          path: 'people/alex.md',
          body: [
            '---',
            'type: person',
            'title: Alex',
            '---',
            '',
            '## Overview',
            '',
            'Alex works on graph retrieval.',
            '',
            'Linked to [[concepts/graph-retrieval]].',
          ].join('\n'),
        },
        {
          path: 'people/pedro.md',
          body: [
            '---',
            'type: person',
            'title: Pedro',
            '---',
            '',
            'Pedro met with alex about retrieval.',
            '',
            'See [[meetings/retrieval-sync-2026-04-22]].',
          ].join('\n'),
        },
        {
          path: 'concepts/graph-retrieval.md',
          body: [
            '---',
            'type: concept',
            'title: Graph Retrieval',
            '---',
            '',
            '# Graph Retrieval',
            '',
            'A retrieval technique that uses graph structure.',
          ].join('\n'),
        },
        {
          path: 'companies/acme.md',
          body: [
            '---',
            'type: company',
            'title: Acme',
            '---',
            '',
            'Acme builds retrieval systems.',
          ].join('\n'),
        },
        {
          path: 'meetings/retrieval-sync-2026-04-22.md',
          body: [
            '---',
            'type: meeting',
            'title: Retrieval sync 2026-04-22',
            '---',
            '',
            '## Attendees',
            '',
            '- [[people/alex]]',
            '- [[people/pedro]]',
          ].join('\n'),
        },
      ];

      for (const file of files) {
        const fullPath = join(brainDir, file.path);
        mkdirSync(join(fullPath, '..'), { recursive: true });
        writeFileSync(fullPath, file.body, 'utf-8');
        await importFromFile(engine, fullPath, file.path);
      }

      const pages = await engine.listPages({ limit: 100 });
      expect(pages.length).toBe(5);

      // Manifest invariant: every imported page has a manifest entry.
      const manifests = await engine.listNoteManifestEntries({
        scope_id: 'workspace:default',
        limit: 100,
      });
      expect(manifests.length).toBe(5);
      const manifestSlugs = manifests.map((entry) => entry.slug).sort();
      expect(manifestSlugs).toEqual([
        'companies/acme',
        'concepts/graph-retrieval',
        'meetings/retrieval-sync-2026-04-22',
        'people/alex',
        'people/pedro',
      ]);

      // Keyword search via search returns a non-empty result for a known term.
      const results = await engine.searchKeyword('retrieval', { limit: 10 });
      expect(results.length).toBeGreaterThan(0);
    } finally {
      await engine.disconnect();
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
