import type { BrainEngine } from './engine.ts';
import { PostgresEngine } from './postgres-engine.ts';
import { SQLiteEngine } from './sqlite-engine.ts';
import { GBrainError, type EngineConfig } from './types.ts';
import type {
  GBrainConfig,
} from './config.ts';
import { toEngineConfig, validateResolvedConfig } from './config.ts';

export { resolveConfig, toEngineConfig } from './config.ts';

export const DEFAULT_RUNTIME_CONFIG: GBrainConfig = {
  engine: 'postgres',
  offline: false,
  embedding_provider: 'none',
  query_rewrite_provider: 'none',
};

export function createEngineFromConfig(config: GBrainConfig): BrainEngine {
  validateResolvedConfig(config);

  switch (config.engine) {
    case 'postgres':
      return new PostgresEngine();
    case 'sqlite':
      return new SQLiteEngine();
    case 'pglite':
      throw new GBrainError(
        'Async engine required',
        'pglite engine must be created asynchronously',
        'Use createEngine() or createConnectedEngine() for pglite configurations',
      );
  }
}

/**
 * Create an engine instance based on config.
 * Uses a dynamic import so PGLite WASM is never loaded for Postgres/SQLite users.
 */
export async function createEngine(config: EngineConfig): Promise<BrainEngine> {
  const engineType = config.engine || 'postgres';

  switch (engineType) {
    case 'postgres':
      return new PostgresEngine();
    case 'sqlite':
      return new SQLiteEngine();
    case 'pglite': {
      const { PGLiteEngine } = await import('./pglite-engine.ts');
      return new PGLiteEngine();
    }
    default:
      throw new Error(
        `Unknown engine type: "${engineType}". Supported engines: postgres, sqlite, pglite.`,
      );
  }
}

export async function createConnectedEngine(
  config: GBrainConfig,
  options?: { poolSize?: number },
): Promise<BrainEngine> {
  validateResolvedConfig(config);
  const engine = config.engine === 'pglite'
    ? await createEngine(toEngineConfig(config, options))
    : createEngineFromConfig(config);
  await engine.connect(toEngineConfig(config, options));
  return engine;
}

export function supportsParallelWorkers(config: GBrainConfig): boolean {
  return config.engine === 'postgres';
}

export function supportsRawPostgresAccess(config: GBrainConfig): boolean {
  return config.engine === 'postgres';
}
