import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { LATEST_VERSION } from '../src/core/migrate.ts';
import { PGLiteEngine } from '../src/core/pglite-engine.ts';
import { PostgresEngine } from '../src/core/postgres-engine.ts';
import { SQLiteEngine } from '../src/core/sqlite-engine.ts';

const MUTATION_EVENT_COLUMNS = [
  'id',
  'session_id',
  'realm_id',
  'actor',
  'operation',
  'target_kind',
  'target_id',
  'scope_id',
  'source_refs',
  'expected_target_snapshot_hash',
  'current_target_snapshot_hash',
  'result',
  'conflict_info',
  'dry_run',
  'metadata',
  'redaction_visibility',
  'created_at',
  'decided_at',
  'applied_at',
];

const MUTATION_EVENT_INDEXES = [
  'idx_memory_mutation_events_session_created',
  'idx_memory_mutation_events_realm_created',
  'idx_memory_mutation_events_actor_created',
  'idx_memory_mutation_events_operation_created',
  'idx_memory_mutation_events_target',
  'idx_memory_mutation_events_result_created',
  'idx_memory_mutation_events_scope_created',
];

function validInsertSql(id: string): string {
  return `
    INSERT INTO memory_mutation_events (
      id,
      session_id,
      realm_id,
      actor,
      operation,
      target_kind,
      target_id,
      scope_id,
      result,
      dry_run,
      redaction_visibility
    ) VALUES (
      '${id}',
      'session-1',
      'work',
      'agent:test',
      'put_page',
      'page',
      'concepts/phase-9.md',
      'workspace:default',
      'applied',
      false,
      'visible'
    )
  `;
}

function invalidInsertSql(column: string, value: string): string {
  return `
    INSERT INTO memory_mutation_events (
      id,
      session_id,
      realm_id,
      actor,
      operation,
      target_kind,
      result,
      dry_run,
      redaction_visibility
    ) VALUES (
      '${column}-${value}',
      'session-1',
      'work',
      'agent:test',
      ${column === 'operation' ? `'${value}'` : "'put_page'"},
      ${column === 'target_kind' ? `'${value}'` : "'page'"},
      ${column === 'result' ? `'${value}'` : "'applied'"},
      ${column === 'dry_run' ? value : 'false'},
      ${column === 'redaction_visibility' ? `'${value}'` : "'visible'"}
    )
  `;
}

const OLD_V26_POSTGRES_MUTATION_EVENT_SQL = `
  CREATE TABLE memory_mutation_events (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    realm_id TEXT NOT NULL,
    actor TEXT NOT NULL,
    operation TEXT NOT NULL,
    target_kind TEXT NOT NULL CHECK (
      target_kind IN (
        'page',
        'source_record',
        'task_thread',
        'working_set',
        'task_event',
        'task_episode',
        'attempt',
        'decision',
        'procedure',
        'memory_candidate',
        'memory_patch_candidate',
        'profile_memory',
        'personal_episode',
        'context_map',
        'context_atlas',
        'file_artifact',
        'export_artifact',
        'ledger_event'
      )
    ),
    target_id TEXT,
    scope_id TEXT,
    source_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
    expected_target_snapshot_hash TEXT,
    current_target_snapshot_hash TEXT,
    result TEXT NOT NULL CHECK (
      result IN (
        'dry_run',
        'staged_for_review',
        'applied',
        'conflict',
        'denied',
        'failed',
        'redacted'
      )
    ),
    conflict_info JSONB,
    dry_run BOOLEAN NOT NULL DEFAULT false,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    redaction_visibility TEXT NOT NULL DEFAULT 'visible' CHECK (
      redaction_visibility IN ('visible', 'partially_redacted', 'tombstoned')
    ),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_at TIMESTAMPTZ,
    applied_at TIMESTAMPTZ
  );
  CREATE INDEX idx_memory_mutation_events_session_created
    ON memory_mutation_events(session_id, created_at DESC, id DESC);
  CREATE INDEX idx_memory_mutation_events_realm_created
    ON memory_mutation_events(realm_id, created_at DESC, id DESC);
  CREATE INDEX idx_memory_mutation_events_actor_created
    ON memory_mutation_events(actor, created_at DESC, id DESC);
  CREATE INDEX idx_memory_mutation_events_operation_created
    ON memory_mutation_events(operation, created_at DESC, id DESC);
  CREATE INDEX idx_memory_mutation_events_target
    ON memory_mutation_events(target_kind, target_id);
  CREATE INDEX idx_memory_mutation_events_result_created
    ON memory_mutation_events(result, created_at DESC, id DESC);
  CREATE INDEX idx_memory_mutation_events_scope_created
    ON memory_mutation_events(scope_id, created_at DESC, id DESC);
  INSERT INTO memory_mutation_events (
    id, session_id, realm_id, actor, operation, target_kind, target_id, scope_id, result
  ) VALUES (
    'old-v26-valid', 'session-1', 'work', 'agent:test', 'put_page', 'page', 'concepts/phase-9.md', 'workspace:default', 'applied'
  );
`;

const OLD_V26_SQLITE_MUTATION_EVENT_SQL = OLD_V26_POSTGRES_MUTATION_EVENT_SQL
  .replaceAll('JSONB', 'TEXT')
  .replaceAll(" DEFAULT '[]'::jsonb", " DEFAULT '[]'")
  .replaceAll(" DEFAULT '{}'::jsonb", " DEFAULT '{}'")
  .replaceAll('BOOLEAN NOT NULL DEFAULT false', 'INTEGER NOT NULL DEFAULT 0 CHECK (dry_run IN (0, 1))')
  .replaceAll('TIMESTAMPTZ NOT NULL DEFAULT now()', "TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))")
  .replaceAll('TIMESTAMPTZ', 'TEXT');

describe('memory operations control-plane schema', () => {
  const tempPaths: string[] = [];

  afterEach(async () => {
    while (tempPaths.length > 0) {
      rmSync(tempPaths.pop()!, { recursive: true, force: true });
    }
  });

  test('sqlite initSchema creates memory mutation ledger contract', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mbrain-mutation-ledger-sqlite-'));
    tempPaths.push(dir);

    const engine = new SQLiteEngine();
    await engine.connect({ engine: 'sqlite', database_path: join(dir, 'brain.db') });
    await engine.initSchema();

    const db = (engine as any).database;
    const table = db
      .query(
        `SELECT name, sql
         FROM sqlite_master
         WHERE type = 'table'
           AND name = 'memory_mutation_events'`,
      )
      .get() as { name: string; sql: string } | null;

    expect(table?.name).toBe('memory_mutation_events');
    expect(table?.sql).toContain("operation TEXT NOT NULL CHECK");
    expect(table?.sql).toContain("target_kind TEXT NOT NULL CHECK");
    expect(table?.sql).toContain("result TEXT NOT NULL CHECK");
    expect(table?.sql).toContain("dry_run INTEGER NOT NULL DEFAULT 0 CHECK (dry_run IN (0, 1))");
    expect(table?.sql).toContain("redaction_visibility TEXT NOT NULL DEFAULT 'visible' CHECK");

    const columns = db.query(`PRAGMA table_info(memory_mutation_events)`).all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toEqual(MUTATION_EVENT_COLUMNS);

    const indexes = db
      .query(
        `SELECT name, sql
         FROM sqlite_master
         WHERE type = 'index'
           AND tbl_name = 'memory_mutation_events'`,
      )
      .all() as Array<{ name: string; sql: string }>;
    const indexNames = indexes.map((row) => row.name);
    for (const indexName of MUTATION_EVENT_INDEXES) {
      expect(indexNames).toContain(indexName);
    }
    const scopeIndex = indexes.find((row) => row.name === 'idx_memory_mutation_events_scope_created');
    expect(scopeIndex?.sql).toContain('WHERE scope_id IS NOT NULL');

    expect(() => db.query(validInsertSql('sqlite-valid').replace('false', '0')).run()).not.toThrow();
    expect(() => db.query(invalidInsertSql('operation', 'invented_operation').replace('false', '0')).run()).toThrow();
    expect(() => db.query(invalidInsertSql('result', 'approved').replace('false', '0')).run()).toThrow();
    expect(() => db.query(invalidInsertSql('target_kind', 'note').replace('false', '0')).run()).toThrow();
    expect(() => db.query(invalidInsertSql('redaction_visibility', 'hidden').replace('false', '0')).run()).toThrow();
    expect(() => db.query(invalidInsertSql('dry_run', '2')).run()).toThrow();

    await engine.disconnect();
  });

  test('pglite initSchema creates memory mutation ledger contract', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mbrain-mutation-ledger-pglite-'));
    tempPaths.push(dir);

    const engine = new PGLiteEngine();
    await engine.connect({ engine: 'pglite', database_path: dir });
    await engine.initSchema();

    const db = (engine as any).db;
    const tables = await db.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = 'memory_mutation_events'`,
    );
    expect(tables.rows.map((row: { table_name: string }) => row.table_name)).toEqual([
      'memory_mutation_events',
    ]);

    const columns = await db.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'memory_mutation_events'
       ORDER BY ordinal_position`,
    );
    expect(columns.rows.map((row: { column_name: string }) => row.column_name)).toEqual(MUTATION_EVENT_COLUMNS);

    const indexes = await db.query(
      `SELECT indexname
       FROM pg_indexes
       WHERE schemaname = 'public'
         AND tablename = 'memory_mutation_events'`,
    );
    const indexNames = indexes.rows.map((row: { indexname: string }) => row.indexname);
    for (const indexName of MUTATION_EVENT_INDEXES) {
      expect(indexNames).toContain(indexName);
    }

    const operationConstraints = await db.query(
      `SELECT conname
       FROM pg_constraint
       WHERE conrelid = 'memory_mutation_events'::regclass
         AND contype = 'c'
         AND pg_get_constraintdef(oid) LIKE '%operation%'
       ORDER BY conname`,
    );
    expect(operationConstraints.rows.map((row: { conname: string }) => row.conname)).toEqual([
      'chk_memory_mutation_events_operation',
    ]);

    await expect(db.query(validInsertSql('pglite-valid'))).resolves.toBeDefined();
    await expect(db.query(invalidInsertSql('operation', 'invented_operation'))).rejects.toThrow();
    await expect(db.query(invalidInsertSql('result', 'approved'))).rejects.toThrow();
    await expect(db.query(invalidInsertSql('target_kind', 'note'))).rejects.toThrow();
    await expect(db.query(invalidInsertSql('redaction_visibility', 'hidden'))).rejects.toThrow();
    await expect(db.query(invalidInsertSql('dry_run', '2'))).rejects.toThrow();

    await engine.disconnect();
  }, 10_000);

  test('sqlite upgrades version 25 databases to memory mutation ledger contract', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mbrain-mutation-ledger-sqlite-upgrade-'));
    tempPaths.push(dir);

    const engine = new SQLiteEngine();
    await engine.connect({ engine: 'sqlite', database_path: join(dir, 'brain.db') });
    const db = (engine as any).database;
    db.exec(`
      CREATE TABLE config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      INSERT INTO config (key, value) VALUES ('version', '25');
    `);

    await engine.initSchema();

    const table = db
      .query(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'table'
           AND name = 'memory_mutation_events'`,
      )
      .get() as { name: string } | null;
    const version = db.query(`SELECT value FROM config WHERE key = 'version'`).get() as { value: string };

    expect(table?.name).toBe('memory_mutation_events');
    expect(version.value).toBe(String(LATEST_VERSION));

    await engine.disconnect();
  });

  test('pglite upgrades version 25 databases to memory mutation ledger contract', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mbrain-mutation-ledger-pglite-upgrade-'));
    tempPaths.push(dir);

    const engine = new PGLiteEngine();
    await engine.connect({ engine: 'pglite', database_path: dir });
    const db = (engine as any).db;
    await db.exec(`
      CREATE TABLE config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      INSERT INTO config (key, value) VALUES ('version', '25');
    `);

    await engine.initSchema();

    const tables = await db.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = 'memory_mutation_events'`,
    );
    const version = await db.query(`SELECT value FROM config WHERE key = 'version'`);

    expect(tables.rows.map((row: { table_name: string }) => row.table_name)).toEqual([
      'memory_mutation_events',
    ]);
    expect(version.rows).toEqual([{ value: String(LATEST_VERSION) }]);

    await engine.disconnect();
  }, 10_000);

  test('sqlite repairs old version 26 memory mutation ledger operation contract', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mbrain-mutation-ledger-sqlite-v26-repair-'));
    tempPaths.push(dir);

    const engine = new SQLiteEngine();
    await engine.connect({ engine: 'sqlite', database_path: join(dir, 'brain.db') });
    const db = (engine as any).database;
    db.exec(`
      CREATE TABLE config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      INSERT INTO config (key, value) VALUES ('version', '26');
      ${OLD_V26_SQLITE_MUTATION_EVENT_SQL}
    `);

    await engine.initSchema();

    const version = db.query(`SELECT value FROM config WHERE key = 'version'`).get() as { value: string };
    const existing = db
      .query(`SELECT id, operation FROM memory_mutation_events WHERE id = 'old-v26-valid'`)
      .get() as { id: string; operation: string } | null;
    const scopeIndex = db
      .query(
        `SELECT sql
         FROM sqlite_master
         WHERE type = 'index'
           AND tbl_name = 'memory_mutation_events'
           AND name = 'idx_memory_mutation_events_scope_created'`,
      )
      .get() as { sql: string } | null;

    expect(version.value).toBe(String(LATEST_VERSION));
    expect(existing).toEqual({ id: 'old-v26-valid', operation: 'put_page' });
    expect(scopeIndex?.sql).toContain('WHERE scope_id IS NOT NULL');
    expect(() => db.query(invalidInsertSql('operation', 'invented_operation').replace('false', '0')).run()).toThrow();

    await engine.disconnect();
  });

  test('pglite repairs old version 26 memory mutation ledger operation contract', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mbrain-mutation-ledger-pglite-v26-repair-'));
    tempPaths.push(dir);

    const engine = new PGLiteEngine();
    await engine.connect({ engine: 'pglite', database_path: dir });
    const db = (engine as any).db;
    await db.exec(`
      CREATE TABLE config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      INSERT INTO config (key, value) VALUES ('version', '26');
      ${OLD_V26_POSTGRES_MUTATION_EVENT_SQL}
    `);

    await engine.initSchema();

    const version = await db.query(`SELECT value FROM config WHERE key = 'version'`);
    const existing = await db.query(
      `SELECT id, operation
       FROM memory_mutation_events
       WHERE id = 'old-v26-valid'`,
    );
    const indexDefinitions = await db.query(
      `SELECT indexdef
       FROM pg_indexes
       WHERE schemaname = 'public'
         AND tablename = 'memory_mutation_events'
         AND indexname = 'idx_memory_mutation_events_scope_created'`,
    );

    expect(version.rows).toEqual([{ value: String(LATEST_VERSION) }]);
    expect(existing.rows).toEqual([{ id: 'old-v26-valid', operation: 'put_page' }]);
    expect(String(indexDefinitions.rows[0]?.indexdef)).toContain('WHERE (scope_id IS NOT NULL)');
    await expect(db.query(invalidInsertSql('operation', 'invented_operation'))).rejects.toThrow();

    await engine.disconnect();
  }, 10_000);

  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    test('postgres initSchema creates memory mutation ledger contract', async () => {
      const engine = new PostgresEngine();
      const schemaName = `mutation_ledger_${crypto.randomUUID().replace(/-/g, '_')}`;

      await engine.connect({ engine: 'postgres', database_url: databaseUrl, poolSize: 1 });
      await engine.sql.unsafe(`CREATE SCHEMA "${schemaName}"`);
      await engine.sql.unsafe(`SET search_path TO "${schemaName}", public`);

      try {
        await engine.initSchema();

        const tables = await engine.sql`
          SELECT table_name
          FROM information_schema.tables
          WHERE table_schema = ${schemaName}
            AND table_name = 'memory_mutation_events'
        `;
        expect(tables.map((row) => row.table_name)).toEqual(['memory_mutation_events']);

        const columns = await engine.sql`
          SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = ${schemaName}
            AND table_name = 'memory_mutation_events'
          ORDER BY ordinal_position
        `;
        expect(columns.map((row) => row.column_name)).toEqual(MUTATION_EVENT_COLUMNS);

        const indexes = await engine.sql`
          SELECT indexname
          FROM pg_indexes
          WHERE schemaname = ${schemaName}
            AND tablename = 'memory_mutation_events'
        `;
        const indexNames = indexes.map((row) => row.indexname);
        for (const indexName of MUTATION_EVENT_INDEXES) {
          expect(indexNames).toContain(indexName);
        }

        await expect(engine.sql.unsafe(validInsertSql('postgres-valid'))).resolves.toBeDefined();
        await expect(engine.sql.unsafe(invalidInsertSql('operation', 'invented_operation'))).rejects.toThrow();
        await expect(engine.sql.unsafe(invalidInsertSql('result', 'approved'))).rejects.toThrow();
        await expect(engine.sql.unsafe(invalidInsertSql('target_kind', 'note'))).rejects.toThrow();
        await expect(engine.sql.unsafe(invalidInsertSql('redaction_visibility', 'hidden'))).rejects.toThrow();
        await expect(engine.sql.unsafe(invalidInsertSql('dry_run', '2'))).rejects.toThrow();
      } finally {
        await engine.sql.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
        await engine.disconnect();
      }
    }, 20_000);
  } else {
    test.skip('postgres memory mutation ledger schema skipped: DATABASE_URL is not configured', () => {});
  }
});
