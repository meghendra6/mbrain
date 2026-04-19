import { describe, expect, test } from 'bun:test';
import { resolveConfig } from '../src/core/config.ts';
import { buildExecutionEnvelope } from '../src/core/execution-envelope.ts';

describe('execution envelope', () => {
  test('sqlite local/offline profile exposes explicit unsupported surfaces', () => {
    const config = resolveConfig({
      engine: 'sqlite',
      database_path: '/tmp/brain.db',
      offline: true,
      embedding_provider: 'local',
      query_rewrite_provider: 'heuristic',
    });

    const envelope = buildExecutionEnvelope(config);
    expect(envelope.mode).toBe('local_offline');
    expect(envelope.markdownCanonical).toBe(true);
    expect(envelope.derivedArtifactsRegenerable).toBe(true);
    expect(envelope.publicContract.files.status).toBe('unsupported');
    expect(envelope.publicContract.files.reason).toContain('sqlite');
    expect(envelope.baselineFamilies).toContain('local_performance');
    expect(envelope.parity.requiresSemanticAlignment).toBe(true);
  });

  test('postgres profile keeps the cloud contract while advertising the same baseline families', () => {
    const config = resolveConfig({
      engine: 'postgres',
      database_url: 'postgresql://localhost/mbrain',
      offline: false,
      embedding_provider: 'none',
      query_rewrite_provider: 'none',
    });

    const envelope = buildExecutionEnvelope(config);
    expect(envelope.mode).toBe('standard');
    expect(envelope.publicContract.files.status).toBe('supported');
    expect(envelope.publicContract.checkUpdate.status).toBe('supported');
    expect(envelope.baselineFamilies).toEqual([
      'repeated_work',
      'markdown_retrieval',
      'context_map',
      'governance',
      'provenance_trace',
      'local_performance',
      'scope_isolation',
    ]);
  });

  test('pglite follows local-path semantics instead of cloud defaults', () => {
    const config = resolveConfig({
      engine: 'pglite',
      database_path: '/tmp/brain.pglite',
      embedding_provider: 'none',
      query_rewrite_provider: 'none',
    });

    const envelope = buildExecutionEnvelope(config);
    expect(envelope.mode).toBe('local_offline');
    expect(envelope.publicContract.files.status).toBe('unsupported');
    expect(envelope.publicContract.files.reason).toContain('pglite');
    expect(envelope.publicContract.checkUpdate.status).toBe('unsupported');
  });
});
