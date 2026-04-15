import { afterEach, describe, expect, test } from 'bun:test';
import { hybridSearch } from '../src/core/search/hybrid.ts';
import { resetEmbeddingProviderForTests, setEmbeddingProviderForTests } from '../src/core/embedding.ts';
import type { BrainEngine } from '../src/core/engine.ts';
import type { SearchResult } from '../src/core/types.ts';

function makeResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    slug: 'concepts/hybrid',
    page_id: 1,
    title: 'Hybrid',
    type: 'concept',
    chunk_text: 'hybrid search result',
    chunk_source: 'compiled_truth',
    score: 1,
    stale: false,
    ...overrides,
  };
}

afterEach(() => {
  resetEmbeddingProviderForTests();
});

describe('hybridSearch', () => {
  test('deduplicates expanded query variants before embedding and vector search', async () => {
    const embeddedQueries: string[] = [];
    const vectorCalls: Float32Array[] = [];

    setEmbeddingProviderForTests({
      capability: {
        available: true,
        mode: 'local',
        implementation: 'test-local',
        model: 'test-local-v1',
        dimensions: 3,
      },
      embedBatch: async (texts: string[]) => {
        embeddedQueries.push(...texts);
        return texts.map((text, index) => new Float32Array([text.length, index + 1, 1]));
      },
    });

    const engine = {
      searchKeyword: async () => [makeResult()],
      searchVector: async (embedding: Float32Array) => {
        vectorCalls.push(embedding);
        return [];
      },
    } as Pick<BrainEngine, 'searchKeyword' | 'searchVector'> as BrainEngine;

    const results = await hybridSearch(engine, 'hybrid search', {
      limit: 5,
      expansion: true,
      expandFn: async () => ['hybrid search', 'HYBRID SEARCH', 'hybrid search alternatives'],
    });

    expect(embeddedQueries).toEqual(['hybrid search', 'hybrid search alternatives']);
    expect(vectorCalls).toHaveLength(2);
    expect(results.map((entry) => entry.slug)).toEqual(['concepts/hybrid']);
  });
});
