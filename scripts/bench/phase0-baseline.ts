#!/usr/bin/env bun

import { readdirSync, readFileSync, statSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { performance } from 'perf_hooks';
import { parseMarkdown } from '../../src/core/markdown.ts';
import { importFromContent } from '../../src/core/import-file.ts';
import { createConnectedEngine } from '../../src/core/engine-factory.ts';
import { createLocalConfigDefaults } from '../../src/core/config.ts';
import { hybridSearch } from '../../src/core/search/hybrid.ts';
import { embedChunks, resetEmbeddingProviderForTests, setEmbeddingProviderForTests } from '../../src/core/embedding.ts';
import type { ResolvedEmbeddingProvider } from '../../src/core/embedding/provider.ts';
import {
  PHASE0_FIXTURES_DIR,
  PHASE0_UNSUPPORTED_REASON,
  PHASE0_WORKLOADS,
  type Phase0WorkloadResult,
} from './phase0-workloads.ts';

const args = new Set(process.argv.slice(2));

if (args.has('--help')) {
  console.log('Usage: bun run scripts/bench/phase0-baseline.ts [--json]');
  process.exit(0);
}

const jsonOutput = args.has('--json');
const tempDir = mkdtempSync(join(tmpdir(), 'mbrain-phase0-'));
const databasePath = join(tempDir, 'phase0.db');
const fixtureFiles = listMarkdownFiles(PHASE0_FIXTURES_DIR);
const benchmarkProvider = createDeterministicEmbeddingProvider();

setEmbeddingProviderForTests(benchmarkProvider);

let engine: Awaited<ReturnType<typeof createConnectedEngine>> | null = null;

try {
  const config = createLocalConfigDefaults({
    database_path: databasePath,
    embedding_provider: 'none',
    query_rewrite_provider: 'none',
  });

  engine = await createConnectedEngine(config);
  await engine.initSchema();

  const workloads: Phase0WorkloadResult[] = [];
  const { summary: fixtureImportResult, importedSlugs } = await runFixtureImportWorkload(engine, fixtureFiles);
  await backfillImportedEmbeddings(engine, importedSlugs);
  workloads.push(fixtureImportResult);
  workloads.push(await runKeywordSearchWorkload(engine));
  workloads.push(await runHybridSearchWorkload(engine));
  workloads.push(await runStatsHealthWorkload(engine));
  workloads.push({
    name: 'task_resume',
    status: 'unsupported',
    unit: 'boolean',
    reason: PHASE0_UNSUPPORTED_REASON,
  });

  const payload = {
    generated_at: new Date().toISOString(),
    engine: config.engine,
    workloads,
  };

  if (jsonOutput) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`Phase 0 baseline complete for ${config.engine}`);
    console.log(JSON.stringify(payload, null, 2));
  }
} finally {
  resetEmbeddingProviderForTests();
  if (engine) {
    await engine.disconnect();
  }
  rmSync(tempDir, { recursive: true, force: true });
}

async function runFixtureImportWorkload(
  engine: NonNullable<typeof engine>,
  files: string[],
): Promise<{ summary: Phase0WorkloadResult; importedSlugs: string[] }> {
  const importedSlugs: string[] = [];
  const start = performance.now();
  for (const filePath of files) {
    const relativePath = filePath.slice(PHASE0_FIXTURES_DIR.length + 1);
    const content = readFileSync(filePath, 'utf-8');
    const parsed = parseMarkdown(content, relativePath);
    const result = await importFromContent(engine, parsed.slug, content);
    if (result.status !== 'imported' && result.status !== 'skipped') {
      throw new Error(`Fixture import failed for ${relativePath}: ${result.status}`);
    }
    if (result.status === 'imported') {
      importedSlugs.push(result.slug);
    }
  }
  const totalMs = performance.now() - start;
  const throughput = importedSlugs.length > 0 ? importedSlugs.length / (totalMs / 1000) : 0;
  return {
    importedSlugs,
    summary: {
      name: 'fixture_import',
      status: 'measured',
      unit: 'pages_per_second',
      pages_per_second: throughput > 0 ? roundTo(throughput, 2) : 0,
    },
  };
}

async function backfillImportedEmbeddings(engine: NonNullable<typeof engine>, slugs: string[]): Promise<void> {
  for (const slug of slugs) {
    const chunks = await engine.getChunks(slug);
    if (chunks.length === 0) continue;
    const embedded = await embedChunks(chunks);
    await engine.upsertChunks(slug, embedded.chunks);
  }
}

async function runKeywordSearchWorkload(engine: NonNullable<typeof engine>): Promise<Phase0WorkloadResult> {
  const definition = PHASE0_WORKLOADS.find((workload) => workload.name === 'keyword_search');
  const durations = await measureSearchWorkload(async (query) => {
    await engine.searchKeyword(query, { limit: 5 });
  }, definition?.queries ?? [], definition?.samples);

  return measuredMsResult('keyword_search', durations);
}

async function runHybridSearchWorkload(engine: NonNullable<typeof engine>): Promise<Phase0WorkloadResult> {
  const definition = PHASE0_WORKLOADS.find((workload) => workload.name === 'hybrid_search');
  const durations = await measureSearchWorkload(async (query) => {
    await hybridSearch(engine, query, { limit: 5 });
  }, definition?.queries ?? [], definition?.samples);

  return measuredMsResult('hybrid_search', durations);
}

async function runStatsHealthWorkload(engine: NonNullable<typeof engine>): Promise<Phase0WorkloadResult> {
  const samples = PHASE0_WORKLOADS.find((workload) => workload.name === 'stats_health')?.samples ?? 5;
  const durations: number[] = [];

  for (let i = 0; i < samples; i++) {
    const start = performance.now();
    await engine.getStats();
    await engine.getHealth();
    durations.push(performance.now() - start);
  }

  return measuredMsResult('stats_health', durations);
}

async function measureSearchWorkload(
  run: (query: string) => Promise<void>,
  queries: string[],
  samples = 5,
): Promise<number[]> {
  const durations: number[] = [];

  for (let i = 0; i < samples; i++) {
    for (const query of queries) {
      const start = performance.now();
      await run(query);
      durations.push(performance.now() - start);
    }
  }

  return durations;
}

function measuredMsResult(
  name: 'keyword_search' | 'hybrid_search' | 'stats_health',
  durations: number[],
): Phase0WorkloadResult {
  const p50 = percentile(durations, 0.5);
  const p95 = percentile(durations, 0.95);
  return {
    name,
    status: 'measured',
    unit: 'ms',
    p50_ms: formatMeasuredMs(p50),
    p95_ms: formatMeasuredMs(p95),
  };
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index] ?? 0;
}

function formatMeasuredMs(value: number): number {
  if (value <= 0) return 0;
  return Math.max(0.001, roundTo(value, 3));
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function listMarkdownFiles(dir: string): string[] {
  const entries: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      entries.push(...listMarkdownFiles(fullPath));
      continue;
    }
    if (entry.endsWith('.md')) {
      entries.push(fullPath);
    }
  }
  return entries.sort();
}

function createDeterministicEmbeddingProvider(): ResolvedEmbeddingProvider {
  const dimensions = 32;

  return {
    capability: {
      mode: 'local',
      available: true,
      implementation: 'test-local',
      model: 'phase0-deterministic-v1',
      dimensions,
    },
    embedBatch: async (texts: string[]) => texts.map(text => vectorizeText(text, dimensions)),
  };
}

function vectorizeText(text: string, dimensions: number): Float32Array {
  const vector = new Float32Array(dimensions);
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];

  for (const token of tokens) {
    let hash = 2166136261;
    for (let i = 0; i < token.length; i++) {
      hash ^= token.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    vector[Math.abs(hash) % dimensions] += 1;
  }

  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm);

  if (norm > 0) {
    for (let i = 0; i < vector.length; i++) {
      vector[i] /= norm;
    }
  }

  return vector;
}
