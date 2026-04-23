/**
 * Scenario S10 — Precision lookup degrades explicitly on miss.
 *
 * Falsifies L3 (if the exact artifact cannot be found, the answer should
 * degrade explicitly rather than pretending a remembered summary is
 * equivalent).
 */

import { describe, expect, test } from 'bun:test';
import { allocateSqliteBrain } from './helpers.ts';
import { getPrecisionLookupRoute } from '../../src/core/services/precision-lookup-route-service.ts';

describe('S10 — precision lookup degrades explicitly', () => {
  test('slug miss returns no_match, not a fuzzy fallback', async () => {
    const handle = await allocateSqliteBrain('s10-slug');

    try {
      // Seed a similarly-named manifest entry. Precision lookup must not
      // surface it when the caller asked for a different exact slug.
      const page = await handle.engine.putPage('concepts/graph-retrieval-details', {
        type: 'concept',
        title: 'Graph retrieval details',
        compiled_truth: 'Unrelated body.',
        frontmatter: {},
      });
      await handle.engine.upsertNoteManifestEntry({
        scope_id: 'workspace:default',
        page_id: page.id,
        slug: 'concepts/graph-retrieval-details',
        path: 'concepts/graph-retrieval-details.md',
        page_type: 'concept',
        title: 'Graph retrieval details',
        frontmatter: {},
        aliases: [],
        tags: [],
        outgoing_wikilinks: [],
        outgoing_urls: [],
        source_refs: [],
        heading_index: [],
        content_hash: 'hash-a',
        extractor_version: 'test',
      });

      const result = await getPrecisionLookupRoute(handle.engine, {
        slug: 'concepts/graph-retrieval', // exact, different slug
      });

      expect(result.selection_reason).toBe('no_match');
      expect(result.candidate_count).toBe(0);
      expect(result.route).toBeNull();
    } finally {
      await handle.teardown();
    }
  });

  test('path miss returns no_match even when a similarly named page exists', async () => {
    const handle = await allocateSqliteBrain('s10-path');

    try {
      const page = await handle.engine.putPage('concepts/similar-path', {
        type: 'concept',
        title: 'Similar Path',
        compiled_truth: 'Body.',
        frontmatter: {},
      });
      await handle.engine.upsertNoteManifestEntry({
        scope_id: 'workspace:default',
        page_id: page.id,
        slug: 'concepts/similar-path',
        path: 'concepts/similar-path.md',
        page_type: 'concept',
        title: 'Similar Path',
        frontmatter: {},
        aliases: [],
        tags: [],
        outgoing_wikilinks: [],
        outgoing_urls: [],
        source_refs: [],
        heading_index: [],
        content_hash: 'hash-b',
        extractor_version: 'test',
      });

      const result = await getPrecisionLookupRoute(handle.engine, {
        path: 'concepts/exact-path-that-does-not-exist.md',
      });

      expect(result.selection_reason).toBe('no_match');
      expect(result.route).toBeNull();
    } finally {
      await handle.teardown();
    }
  });

  test('source_ref miss returns no_match', async () => {
    const handle = await allocateSqliteBrain('s10-source-ref');

    try {
      const result = await getPrecisionLookupRoute(handle.engine, {
        source_ref: 'Meeting X, direct, 2026-04-01',
      });

      expect(result.selection_reason).toBe('no_match');
      expect(result.route).toBeNull();
    } finally {
      await handle.teardown();
    }
  });
});
