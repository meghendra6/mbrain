import { readFileSync, writeFileSync, mkdirSync, chmodSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { StorageConfig } from './storage.ts';
import { GBrainError, type EngineConfig } from './types.ts';

export type EngineType = 'postgres' | 'sqlite' | 'pglite';
export type EmbeddingProvider = 'none' | 'local';
export type QueryRewriteProvider = 'none' | 'heuristic' | 'local_llm';

export interface GBrainConfig {
  engine: EngineType;
  database_url?: string;
  database_path?: string;
  offline: boolean;
  embedding_provider: EmbeddingProvider;
  embedding_model?: string;
  query_rewrite_provider: QueryRewriteProvider;
  openai_api_key?: string;
  anthropic_api_key?: string;
  storage?: StorageConfig;
}

export interface GBrainConfigInput {
  engine?: EngineType;
  database_url?: string;
  database_path?: string;
  offline?: boolean;
  embedding_provider?: EmbeddingProvider;
  embedding_model?: string;
  query_rewrite_provider?: QueryRewriteProvider;
  openai_api_key?: string;
  anthropic_api_key?: string;
  storage?: StorageConfig;
}

const VALID_ENGINES = new Set<EngineType>(['postgres', 'sqlite', 'pglite']);
const VALID_EMBEDDING_PROVIDERS = new Set<EmbeddingProvider>(['none', 'local']);
const VALID_QUERY_REWRITE_PROVIDERS = new Set<QueryRewriteProvider>(['none', 'heuristic', 'local_llm']);

// Lazy-evaluated to avoid calling homedir() at module scope (breaks in Deno Edge Functions)
function getConfigDir() { return process.env.GBRAIN_CONFIG_DIR || join(process.env.HOME || homedir(), '.gbrain'); }
function getConfigPath() { return join(getConfigDir(), 'config.json'); }

/**
 * Load config with credential precedence: env vars > config file, unless a local engine is explicitly configured.
 * Plugin config is handled by the plugin runtime injecting env vars.
 */
export function loadConfig(): GBrainConfig | null {
  let fileConfig: GBrainConfigInput | null = null;
  try {
    const raw = readFileSync(getConfigPath(), 'utf-8');
    fileConfig = JSON.parse(raw) as GBrainConfigInput;
  } catch {
    /* no config file */
  }

  const dbUrl = process.env.GBRAIN_DATABASE_URL || process.env.DATABASE_URL;
  if (!fileConfig && !dbUrl) return null;

  const preferLocalConfig = fileConfig?.engine === 'sqlite' || fileConfig?.engine === 'pglite';
  const inferredEngine = fileConfig?.engine ?? (fileConfig?.database_path ? 'pglite' : undefined);

  const merged: GBrainConfigInput = {
    ...fileConfig,
    ...(inferredEngine ? { engine: inferredEngine } : {}),
    ...(!preferLocalConfig && dbUrl ? { database_url: dbUrl } : {}),
    ...(process.env.OPENAI_API_KEY ? { openai_api_key: process.env.OPENAI_API_KEY } : {}),
  };

  return resolveConfig(merged);
}

export function saveConfig(config: GBrainConfigInput): void {
  mkdirSync(getConfigDir(), { recursive: true });
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  try {
    chmodSync(getConfigPath(), 0o600);
  } catch {
    // chmod may fail on some platforms
  }
}

export function resolveConfig(input: GBrainConfigInput): GBrainConfig {
  if (input.engine !== undefined && !VALID_ENGINES.has(input.engine)) {
    throw new GBrainError(
      'Invalid engine selection',
      `Unsupported engine: ${String(input.engine)}`,
      'Use engine="postgres", engine="sqlite", or engine="pglite" in ~/.gbrain/config.json',
    );
  }

  const engine: EngineType = input.engine ?? (input.database_path ? 'pglite' : 'postgres');
  const isSQLite = engine === 'sqlite';
  const resolved: GBrainConfig = {
    engine,
    database_url: input.database_url,
    database_path: input.database_path,
    offline: input.offline ?? isSQLite,
    embedding_provider: input.embedding_provider ?? (isSQLite ? 'local' : 'none'),
    embedding_model: input.embedding_model,
    query_rewrite_provider: input.query_rewrite_provider ?? (isSQLite ? 'heuristic' : 'none'),
    storage: input.storage,
    openai_api_key: input.openai_api_key,
    anthropic_api_key: input.anthropic_api_key,
  };

  validateResolvedConfig(resolved);
  return resolved;
}

export function validateResolvedConfig(config: GBrainConfig): void {
  if (!VALID_EMBEDDING_PROVIDERS.has(config.embedding_provider)) {
    throw new GBrainError(
      'Invalid embedding provider',
      `Unsupported embedding_provider: ${String(config.embedding_provider)}`,
      'Use embedding_provider="none" or embedding_provider="local"',
    );
  }

  if (!VALID_QUERY_REWRITE_PROVIDERS.has(config.query_rewrite_provider)) {
    throw new GBrainError(
      'Invalid query rewrite provider',
      `Unsupported query_rewrite_provider: ${String(config.query_rewrite_provider)}`,
      'Use query_rewrite_provider="none", "heuristic", or "local_llm"',
    );
  }

  if (config.engine === 'postgres') {
    if (!config.database_url) {
      throw new GBrainError(
        'No database URL',
        'database_url is missing from config',
        'Run gbrain init --url <connection_string> or set GBRAIN_DATABASE_URL / DATABASE_URL',
      );
    }
    if (config.database_path) {
      throw new GBrainError(
        'Invalid Postgres config',
        'database_path is only supported when engine="sqlite" or engine="pglite"',
        'Remove database_path or switch engine to sqlite/pglite',
      );
    }
    if (config.offline) {
      throw new GBrainError(
        'Invalid Postgres config',
        'offline=true is only supported for local engines',
        'Disable offline mode or switch engine to sqlite',
      );
    }
    if (config.embedding_provider === 'local') {
      throw new GBrainError(
        'Invalid engine/provider combination',
        'embedding_provider="local" requires sqlite engine',
        'Set embedding_provider="none" or switch engine to sqlite',
      );
    }
  }

  if (config.engine === 'sqlite' || config.engine === 'pglite') {
    if (!config.database_path) {
      throw new GBrainError(
        'No database path',
        `database_path is missing from config for engine="${config.engine}"`,
        'Set database_path in ~/.gbrain/config.json before using a local engine',
      );
    }
    if (config.database_url) {
      throw new GBrainError(
        `Invalid ${config.engine} config`,
        'database_url is only supported when engine="postgres"',
        'Remove database_url or switch engine to postgres',
      );
    }
  }
}

export function toEngineConfig(
  config: GBrainConfig,
  options?: { poolSize?: number },
): EngineConfig {
  return {
    engine: config.engine,
    database_url: config.database_url,
    database_path: config.database_path,
    ...(options?.poolSize ? { poolSize: options.poolSize } : {}),
  };
}

export function configDir(): string {
  return getConfigDir();
}

export function configPath(): string {
  return join(configDir(), 'config.json');
}

export function defaultLocalDatabasePath(): string {
  return join(configDir(), 'brain.db');
}

export function defaultPGLiteDatabasePath(): string {
  return join(configDir(), 'brain.pglite');
}

export function createLocalConfigDefaults(
  overrides: GBrainConfigInput = {},
): GBrainConfig {
  return resolveConfig({
    engine: 'sqlite',
    database_path: overrides.database_path ?? process.env.GBRAIN_DATABASE_PATH ?? defaultLocalDatabasePath(),
    offline: overrides.offline ?? true,
    embedding_provider: overrides.embedding_provider ?? 'local',
    embedding_model: overrides.embedding_model ?? 'nomic-embed-text',
    query_rewrite_provider: overrides.query_rewrite_provider ?? 'heuristic',
    openai_api_key: overrides.openai_api_key,
    anthropic_api_key: overrides.anthropic_api_key,
    storage: overrides.storage,
  });
}
