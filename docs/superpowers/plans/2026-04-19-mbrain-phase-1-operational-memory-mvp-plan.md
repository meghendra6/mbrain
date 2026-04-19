# MBrain Phase 1 Operational Memory MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the first durable operational-memory slice so `mbrain` can resume active work from canonical task state instead of reconstructing that state from raw sources each session.

**Architecture:** Keep Phase 1 additive and contract-first. Introduce a small DB-backed operational-memory model (`Task Thread`, `Working Set`, `Attempt`, `Decision`, `Retrieval Trace`), expose it through the shared `BrainEngine` contract, assemble resume behavior in a focused service module, and project that behavior through shared operations so CLI and MCP stay aligned.

**Tech Stack:** Bun, TypeScript, existing `BrainEngine` boundary, SQLite/Postgres/PGLite engines, shared `operations.ts`, Bun test, repo-local benchmark scripts, existing local/offline execution envelope.

---

## Scope and sequencing decisions

- Phase 1 implements only the minimum operational-memory slice needed for repeated-work prevention.
- `Task Thread`, `Working Set`, `Attempt`, `Decision`, and `Retrieval Trace` are in scope now.
- `Event`, `Episode`, and the full `Procedure` lifecycle are intentionally deferred. The MVP should leave clean extension points for them, not partial versions that muddy the contract.
- Resume behavior must be task-first. The service reads task state before touching raw sources.
- All new persistence is additive. Existing page, chunk, and import flows must keep working without task-memory participation.
- Local/offline execution is not a follow-up task. SQLite and PGLite must support the same Phase 1 public semantics as Postgres.
- Shared operations are the source of truth for the new surface. Do not add a CLI-only task subsystem.

## MVP object boundary

| Object | MVP responsibility | Explicitly deferred |
|---|---|---|
| `Task Thread` | durable task identity, scope, goal, status, repo/branch context, summary timestamps | episode membership, procedure linkage |
| `Working Set` | current resume state: active files, active symbols, blockers, open questions, next steps, verification timestamp | generated Markdown views, cross-task aggregation |
| `Attempt` | anti-repetition record of tried approaches and outcomes | automatic extraction from generic events |
| `Decision` | rationale and validity record for choices that should shape resume | supersession graphs beyond one direct link |
| `Retrieval Trace` | durable explainability record for Phase 1 resume flows | broad system-wide trace coverage outside operational memory |

## File Map

### Core files to create

- `src/core/services/task-memory-service.ts` — assembles resume behavior over the new engine methods and produces a stable resume projection
- `test/task-memory-service.test.ts` — service-level tests for resume ordering, stale-state handling, and repeated-work prevention
- `test/task-memory-operations.test.ts` — shared-operation and formatting tests for the new task surface

### Existing files expected to change

- `src/core/types.ts`
- `src/core/engine.ts`
- `src/core/migrate.ts`
- `src/schema.sql`
- `src/core/schema-embedded.ts`
- `src/core/pglite-schema.ts`
- `src/core/sqlite-engine.ts`
- `src/core/pglite-engine.ts`
- `src/core/postgres-engine.ts`
- `src/core/operations.ts`
- `src/cli.ts`
- `package.json`
- `docs/MBRAIN_VERIFY.md`
- `test/sqlite-engine.test.ts`
- `test/pglite-engine.test.ts`
- `test/postgres-engine.test.ts`
- `test/phase0-contract-parity.test.ts`

---

### Task 1: Add the Phase 1 schema and type foundations

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/migrate.ts`
- Modify: `src/schema.sql`
- Modify: `src/core/schema-embedded.ts`
- Modify: `src/core/pglite-schema.ts`
- Modify: `src/core/sqlite-engine.ts`
- Test: `test/task-memory-schema.test.ts`

- [ ] **Step 1: Write failing schema tests**

Create `test/task-memory-schema.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SQLiteEngine } from '../src/core/sqlite-engine.ts';
import { PGLiteEngine } from '../src/core/pglite-engine.ts';

describe('task-memory schema', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
  });

  test('sqlite initSchema creates task-memory tables', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mbrain-task-schema-sqlite-'));
    tempDirs.push(dir);

    const engine = new SQLiteEngine() as SQLiteEngine & { db?: any };
    await engine.connect({ engine: 'sqlite', database_path: join(dir, 'brain.db') });
    await engine.initSchema();

    const tables = engine['database']
      .query(`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'task_%' OR name = 'retrieval_traces'`)
      .all()
      .map((row: any) => row.name)
      .sort();

    expect(tables).toEqual([
      'retrieval_traces',
      'task_attempts',
      'task_decisions',
      'task_threads',
      'task_working_sets',
    ]);

    await engine.disconnect();
  });

  test('pglite initSchema creates task-memory tables', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mbrain-task-schema-pglite-'));
    tempDirs.push(dir);

    const engine = new PGLiteEngine();
    await engine.connect({ engine: 'pglite', database_path: dir });
    await engine.initSchema();

    const result = await engine.db.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND (table_name LIKE 'task_%' OR table_name = 'retrieval_traces')
       ORDER BY table_name`,
    );

    expect(result.rows.map((row: any) => row.table_name)).toEqual([
      'retrieval_traces',
      'task_attempts',
      'task_decisions',
      'task_threads',
      'task_working_sets',
    ]);

    await engine.disconnect();
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run:

```bash
bun test test/task-memory-schema.test.ts
```

Expected:

```text
Expected sqlite and pglite to expose task-memory tables, but the schema has not created them yet
```

- [ ] **Step 3: Add the new operational-memory types**

Update `src/core/types.ts` with the Phase 1 canonical object types:

```ts
export type TaskScope = 'work' | 'personal' | 'mixed';
export type TaskStatus = 'active' | 'paused' | 'blocked' | 'completed' | 'abandoned';
export type AttemptOutcome = 'failed' | 'partial' | 'succeeded' | 'abandoned';

export interface TaskThread {
  id: string;
  scope: TaskScope;
  title: string;
  goal: string;
  status: TaskStatus;
  repo_path: string | null;
  branch_name: string | null;
  current_summary: string;
  created_at: Date;
  updated_at: Date;
}

export interface TaskWorkingSet {
  task_id: string;
  active_paths: string[];
  active_symbols: string[];
  blockers: string[];
  open_questions: string[];
  next_steps: string[];
  verification_notes: string[];
  last_verified_at: Date | null;
  updated_at: Date;
}

export interface TaskAttempt {
  id: string;
  task_id: string;
  summary: string;
  outcome: AttemptOutcome;
  applicability_context: Record<string, unknown>;
  evidence: string[];
  created_at: Date;
}

export interface TaskDecision {
  id: string;
  task_id: string;
  summary: string;
  rationale: string;
  consequences: string[];
  validity_context: Record<string, unknown>;
  created_at: Date;
}

export interface RetrievalTrace {
  id: string;
  task_id: string | null;
  scope: TaskScope;
  route: string[];
  source_refs: string[];
  verification: string[];
  outcome: string;
  created_at: Date;
}
```

- [ ] **Step 4: Add additive schema for the new objects**

Update `src/schema.sql`, `src/core/pglite-schema.ts`, and the SQLite `SCHEMA_SQL` block in `src/core/sqlite-engine.ts` with matching tables:

```sql
CREATE TABLE IF NOT EXISTS task_threads (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  title TEXT NOT NULL,
  goal TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  repo_path TEXT,
  branch_name TEXT,
  current_summary TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS task_working_sets (
  task_id TEXT PRIMARY KEY REFERENCES task_threads(id) ON DELETE CASCADE,
  active_paths JSONB NOT NULL DEFAULT '[]',
  active_symbols JSONB NOT NULL DEFAULT '[]',
  blockers JSONB NOT NULL DEFAULT '[]',
  open_questions JSONB NOT NULL DEFAULT '[]',
  next_steps JSONB NOT NULL DEFAULT '[]',
  verification_notes JSONB NOT NULL DEFAULT '[]',
  last_verified_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS task_attempts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES task_threads(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  outcome TEXT NOT NULL,
  applicability_context JSONB NOT NULL DEFAULT '{}',
  evidence JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS task_decisions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES task_threads(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  rationale TEXT NOT NULL DEFAULT '',
  consequences JSONB NOT NULL DEFAULT '[]',
  validity_context JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS retrieval_traces (
  id TEXT PRIMARY KEY,
  task_id TEXT REFERENCES task_threads(id) ON DELETE SET NULL,
  scope TEXT NOT NULL,
  route JSONB NOT NULL DEFAULT '[]',
  source_refs JSONB NOT NULL DEFAULT '[]',
  verification JSONB NOT NULL DEFAULT '[]',
  outcome TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

For SQLite, use `TEXT` columns containing JSON arrays/objects instead of `JSONB`.

- [ ] **Step 5: Add a migration for existing databases and regenerate embedded schema**

Append migration `version: 8` in `src/core/migrate.ts`:

```ts
{
  version: 8,
  name: 'task_memory_foundations',
  sql: `
    CREATE TABLE IF NOT EXISTS task_threads (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      title TEXT NOT NULL,
      goal TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      repo_path TEXT,
      branch_name TEXT,
      current_summary TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS task_working_sets (
      task_id TEXT PRIMARY KEY REFERENCES task_threads(id) ON DELETE CASCADE,
      active_paths JSONB NOT NULL DEFAULT '[]',
      active_symbols JSONB NOT NULL DEFAULT '[]',
      blockers JSONB NOT NULL DEFAULT '[]',
      open_questions JSONB NOT NULL DEFAULT '[]',
      next_steps JSONB NOT NULL DEFAULT '[]',
      verification_notes JSONB NOT NULL DEFAULT '[]',
      last_verified_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS task_attempts (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES task_threads(id) ON DELETE CASCADE,
      summary TEXT NOT NULL,
      outcome TEXT NOT NULL,
      applicability_context JSONB NOT NULL DEFAULT '{}',
      evidence JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS task_decisions (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES task_threads(id) ON DELETE CASCADE,
      summary TEXT NOT NULL,
      rationale TEXT NOT NULL DEFAULT '',
      consequences JSONB NOT NULL DEFAULT '[]',
      validity_context JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS retrieval_traces (
      id TEXT PRIMARY KEY,
      task_id TEXT REFERENCES task_threads(id) ON DELETE SET NULL,
      scope TEXT NOT NULL,
      route JSONB NOT NULL DEFAULT '[]',
      source_refs JSONB NOT NULL DEFAULT '[]',
      verification JSONB NOT NULL DEFAULT '[]',
      outcome TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `,
}
```

Then regenerate the embedded Postgres schema:

```bash
bun run build:schema
```

- [ ] **Step 6: Run the schema tests**

Run:

```bash
bun test test/task-memory-schema.test.ts
```

Expected:

```text
2 pass
0 fail
```

- [ ] **Step 7: Commit**

```bash
git add src/core/types.ts src/core/migrate.ts src/schema.sql src/core/schema-embedded.ts src/core/pglite-schema.ts src/core/sqlite-engine.ts test/task-memory-schema.test.ts
git commit -m "feat: add phase1 operational memory schema"
```

---

### Task 2: Extend the `BrainEngine` contract and backend persistence

**Files:**
- Modify: `src/core/engine.ts`
- Modify: `src/core/sqlite-engine.ts`
- Modify: `src/core/pglite-engine.ts`
- Modify: `src/core/postgres-engine.ts`
- Test: `test/sqlite-engine.test.ts`
- Test: `test/pglite-engine.test.ts`
- Test: `test/postgres-engine.test.ts`

- [ ] **Step 1: Add failing engine tests for the new persistence surface**

Add a new block to `test/sqlite-engine.test.ts`:

```ts
test('creates and resumes a task thread with attempts and decisions', async () => {
  const thread = await engine.createTaskThread({
    id: 'task-1',
    scope: 'work',
    title: 'Phase 1 MVP',
    goal: 'Add operational memory',
    status: 'active',
    repo_path: '/repo',
    branch_name: 'docs/mbrain-redesign-doc-set',
    current_summary: 'Need schema first',
  });

  await engine.upsertTaskWorkingSet({
    task_id: thread.id,
    active_paths: ['src/core/types.ts'],
    active_symbols: ['TaskThread'],
    blockers: ['schema not landed'],
    open_questions: ['whether retrieval traces are task-scoped only'],
    next_steps: ['add schema tables'],
    verification_notes: [],
  });

  await engine.recordTaskAttempt({
    id: 'attempt-1',
    task_id: thread.id,
    summary: 'Tried to infer resume state from raw source only',
    outcome: 'failed',
    applicability_context: { branch: 'docs/mbrain-redesign-doc-set' },
    evidence: ['lost prior blocker context'],
  });

  await engine.recordTaskDecision({
    id: 'decision-1',
    task_id: thread.id,
    summary: 'Keep working set canonical in DB',
    rationale: 'high-churn state',
    consequences: ['resume reads stay cheap'],
    validity_context: { branch: 'docs/mbrain-redesign-doc-set' },
  });

  const stored = await engine.getTaskThread(thread.id);
  const workingSet = await engine.getTaskWorkingSet(thread.id);
  const attempts = await engine.listTaskAttempts(thread.id, { limit: 5 });
  const decisions = await engine.listTaskDecisions(thread.id, { limit: 5 });

  expect(stored?.title).toBe('Phase 1 MVP');
  expect(workingSet?.active_paths).toEqual(['src/core/types.ts']);
  expect(attempts[0]?.outcome).toBe('failed');
  expect(decisions[0]?.summary).toContain('working set');
});
```

- [ ] **Step 2: Run the targeted engine test to verify it fails**

Run:

```bash
bun test test/sqlite-engine.test.ts -t "creates and resumes a task thread with attempts and decisions"
```

Expected:

```text
Property 'createTaskThread' does not exist on type 'SQLiteEngine'
```

- [ ] **Step 3: Add the new engine methods**

Update `src/core/engine.ts`:

```ts
createTaskThread(input: TaskThreadInput): Promise<TaskThread>;
updateTaskThread(id: string, patch: TaskThreadPatch): Promise<TaskThread>;
listTaskThreads(filters?: TaskThreadFilters): Promise<TaskThread[]>;
getTaskThread(id: string): Promise<TaskThread | null>;
getTaskWorkingSet(taskId: string): Promise<TaskWorkingSet | null>;
upsertTaskWorkingSet(input: TaskWorkingSetInput): Promise<TaskWorkingSet>;
recordTaskAttempt(input: TaskAttemptInput): Promise<TaskAttempt>;
listTaskAttempts(taskId: string, opts?: { limit?: number }): Promise<TaskAttempt[]>;
recordTaskDecision(input: TaskDecisionInput): Promise<TaskDecision>;
listTaskDecisions(taskId: string, opts?: { limit?: number }): Promise<TaskDecision[]>;
putRetrievalTrace(input: RetrievalTraceInput): Promise<RetrievalTrace>;
listRetrievalTraces(taskId: string, opts?: { limit?: number }): Promise<RetrievalTrace[]>;
```

- [ ] **Step 4: Implement persistence in each backend**

Add matching SQL in all three engines. Use shared JSON serialization helpers where the file already follows that pattern; avoid introducing a generic abstraction layer before there is real duplication pressure.

Representative SQLite shape:

```ts
async createTaskThread(input: TaskThreadInput): Promise<TaskThread> {
  this.database.run(
    `INSERT INTO task_threads (
      id, scope, title, goal, status, repo_path, branch_name, current_summary
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.id,
      input.scope,
      input.title,
      input.goal,
      input.status,
      input.repo_path ?? null,
      input.branch_name ?? null,
      input.current_summary ?? '',
    ],
  );

  return this.getTaskThread(input.id).then((thread) => {
    if (!thread) throw new Error(`task thread ${input.id} was not persisted`);
    return thread;
  });
}
```

- [ ] **Step 5: Run backend tests**

Run:

```bash
bun test test/sqlite-engine.test.ts test/pglite-engine.test.ts test/postgres-engine.test.ts
```

Expected:

```text
sqlite and pglite pass
postgres passes when DATABASE_URL is set, otherwise skips the new task-memory block explicitly
```

- [ ] **Step 6: Commit**

```bash
git add src/core/engine.ts src/core/sqlite-engine.ts src/core/pglite-engine.ts src/core/postgres-engine.ts test/sqlite-engine.test.ts test/pglite-engine.test.ts test/postgres-engine.test.ts
git commit -m "feat: persist operational memory records"
```

---

### Task 3: Build the operational-memory service and resume projection

**Files:**
- Create: `src/core/services/task-memory-service.ts`
- Test: `test/task-memory-service.test.ts`

- [ ] **Step 1: Add failing service tests for resume ordering**

Create `test/task-memory-service.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { buildTaskResumeCard } from '../src/core/services/task-memory-service.ts';

test('resume reads task state before raw-source expansion', async () => {
  const calls: string[] = [];
  const engine = {
    getTaskThread: async () => {
      calls.push('thread');
      return { id: 'task-1', scope: 'work', title: 'Phase 1', goal: 'Ship MVP', status: 'active', repo_path: '/repo', branch_name: 'feature', current_summary: 'Need resume flow', created_at: new Date(), updated_at: new Date() };
    },
    getTaskWorkingSet: async () => {
      calls.push('working_set');
      return { task_id: 'task-1', active_paths: ['src/core/operations.ts'], active_symbols: ['operations'], blockers: ['task commands missing'], open_questions: [], next_steps: ['add shared operations'], verification_notes: [], last_verified_at: null, updated_at: new Date() };
    },
    listTaskAttempts: async () => {
      calls.push('attempts');
      return [{ id: 'attempt-1', task_id: 'task-1', summary: 'CLI-only prototype', outcome: 'failed', applicability_context: { branch: 'feature' }, evidence: ['would drift from MCP'], created_at: new Date() }];
    },
    listTaskDecisions: async () => {
      calls.push('decisions');
      return [{ id: 'decision-1', task_id: 'task-1', summary: 'Keep task surface in operations.ts', rationale: 'shared contract first', consequences: ['CLI and MCP stay aligned'], validity_context: { branch: 'feature' }, created_at: new Date() }];
    },
    listRetrievalTraces: async () => {
      calls.push('traces');
      return [];
    },
  } as any;

  const resume = await buildTaskResumeCard(engine, 'task-1');

  expect(calls).toEqual(['thread', 'working_set', 'attempts', 'decisions', 'traces']);
  expect(resume.failed_attempts[0]).toContain('CLI-only prototype');
  expect(resume.next_steps).toEqual(['add shared operations']);
});
```

- [ ] **Step 2: Run the service test to verify it fails**

Run:

```bash
bun test test/task-memory-service.test.ts
```

Expected:

```text
Cannot find module '../src/core/services/task-memory-service.ts'
```

- [ ] **Step 3: Implement the service**

Create `src/core/services/task-memory-service.ts`:

```ts
import type { BrainEngine } from '../engine.ts';

export interface TaskResumeCard {
  task_id: string;
  title: string;
  status: string;
  goal: string;
  current_summary: string;
  active_paths: string[];
  active_symbols: string[];
  blockers: string[];
  open_questions: string[];
  next_steps: string[];
  failed_attempts: string[];
  active_decisions: string[];
  stale: boolean;
}

export async function buildTaskResumeCard(engine: BrainEngine, taskId: string): Promise<TaskResumeCard> {
  const thread = await engine.getTaskThread(taskId);
  if (!thread) throw new Error(`Task thread not found: ${taskId}`);

  const workingSet = await engine.getTaskWorkingSet(taskId);
  const attempts = await engine.listTaskAttempts(taskId, { limit: 5 });
  const decisions = await engine.listTaskDecisions(taskId, { limit: 5 });
  await engine.listRetrievalTraces(taskId, { limit: 1 });

  return {
    task_id: thread.id,
    title: thread.title,
    status: thread.status,
    goal: thread.goal,
    current_summary: thread.current_summary,
    active_paths: workingSet?.active_paths ?? [],
    active_symbols: workingSet?.active_symbols ?? [],
    blockers: workingSet?.blockers ?? [],
    open_questions: workingSet?.open_questions ?? [],
    next_steps: workingSet?.next_steps ?? [],
    failed_attempts: attempts.filter((attempt) => attempt.outcome === 'failed').map((attempt) => attempt.summary),
    active_decisions: decisions.map((decision) => decision.summary),
    stale: workingSet?.last_verified_at == null,
  };
}
```

- [ ] **Step 4: Run the service tests**

Run:

```bash
bun test test/task-memory-service.test.ts
```

Expected:

```text
1 pass
0 fail
```

- [ ] **Step 5: Commit**

```bash
git add src/core/services/task-memory-service.ts test/task-memory-service.test.ts
git commit -m "feat: add operational memory resume service"
```

---

### Task 4: Expose operational memory through shared operations and CLI

**Files:**
- Modify: `src/core/operations.ts`
- Modify: `src/cli.ts`
- Test: `test/task-memory-operations.test.ts`
- Test: `test/cli.test.ts`

- [ ] **Step 1: Add failing operation tests**

Create `test/task-memory-operations.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { operations, formatResult } from '../src/core/operations.ts';

test('task resume operation is registered with CLI hints', () => {
  const op = operations.find((candidate) => candidate.name === 'resume_task');
  expect(op).toBeDefined();
  expect(op?.cliHints?.name).toBe('task-resume');
});

test('formatResult renders a resume card', () => {
  const output = formatResult('resume_task', {
    task_id: 'task-1',
    title: 'Phase 1 MVP',
    status: 'active',
    goal: 'Ship operational memory',
    current_summary: 'Schema is in flight',
    active_paths: ['src/core/types.ts'],
    active_symbols: ['TaskThread'],
    blockers: ['engine methods missing'],
    open_questions: ['should traces be task-scoped'],
    next_steps: ['add engine methods'],
    failed_attempts: ['CLI-only task path'],
    active_decisions: ['keep working set canonical in DB'],
    stale: true,
  });

  expect(output).toContain('Phase 1 MVP');
  expect(output).toContain('CLI-only task path');
  expect(output).toContain('stale');
});
```

- [ ] **Step 2: Run the new operation tests**

Run:

```bash
bun test test/task-memory-operations.test.ts
```

Expected:

```text
Expected op to be defined
```

- [ ] **Step 3: Add the shared task operations**

Update `src/core/operations.ts` with:

```ts
{
  name: 'start_task',
  description: 'Create a new operational-memory task thread.',
  params: { title: { type: 'string', required: true }, goal: { type: 'string' }, scope: { type: 'string', default: 'work' } },
  cliHints: { name: 'task-start' },
  handler: async (ctx, params) => {
    const id = crypto.randomUUID();
    await ctx.engine.createTaskThread({
      id,
      scope: String(params.scope ?? 'work') as TaskScope,
      title: String(params.title),
      goal: String(params.goal ?? ''),
      status: 'active',
      repo_path: process.cwd(),
      branch_name: null,
      current_summary: '',
    });
    await ctx.engine.upsertTaskWorkingSet({
      task_id: id,
      active_paths: [],
      active_symbols: [],
      blockers: [],
      open_questions: [],
      next_steps: [],
      verification_notes: [],
      last_verified_at: null,
    });
    return ctx.engine.getTaskThread(id);
  },
},
{
  name: 'resume_task',
  description: 'Resume an existing task thread from canonical task state.',
  params: { task_id: { type: 'string', required: true } },
  cliHints: { name: 'task-resume', positional: ['task_id'] },
  handler: async (ctx, params) => buildTaskResumeCard(ctx.engine, String(params.task_id)),
},
{
  name: 'record_attempt',
  description: 'Record a task attempt outcome for repeated-work prevention.',
  params: { task_id: { type: 'string', required: true }, summary: { type: 'string', required: true }, outcome: { type: 'string', required: true } },
  cliHints: { name: 'task-attempt' },
  handler: async (ctx, params) => ctx.engine.recordTaskAttempt({
    id: crypto.randomUUID(),
    task_id: String(params.task_id),
    summary: String(params.summary),
    outcome: String(params.outcome) as AttemptOutcome,
    applicability_context: {},
    evidence: [],
  }),
},
```

- [ ] **Step 4: Keep CLI routing shared-contract only**

Update `src/cli.ts` only if needed for help text or aliases. Do not add a CLI-only task command file; the new task commands should appear automatically via `operations`.

- [ ] **Step 5: Run the shared-surface tests**

Run:

```bash
bun test test/task-memory-operations.test.ts test/cli.test.ts
```

Expected:

```text
task operations show up in the shared command list and format correctly
```

- [ ] **Step 6: Commit**

```bash
git add src/core/operations.ts src/cli.ts test/task-memory-operations.test.ts test/cli.test.ts
git commit -m "feat: add shared operational memory commands"
```

---

### Task 5: Verify parity, local/offline behavior, and Phase 1 acceptance hooks

**Files:**
- Modify: `test/phase0-contract-parity.test.ts`
- Modify: `docs/MBRAIN_VERIFY.md`
- Modify: `package.json`

- [ ] **Step 1: Extend parity coverage to the new task surface**

Add a new parity test:

```ts
test('sqlite and pglite agree on task resume semantics', async () => {
  const sqliteResume = await seedAndResume(sqliteEngine);
  const pgliteResume = await seedAndResume(pgliteEngine);

  expect({
    title: sqliteResume.title,
    blockers: sqliteResume.blockers,
    failed_attempts: sqliteResume.failed_attempts,
    active_decisions: sqliteResume.active_decisions,
  }).toEqual({
    title: pgliteResume.title,
    blockers: pgliteResume.blockers,
    failed_attempts: pgliteResume.failed_attempts,
    active_decisions: pgliteResume.active_decisions,
  });
});
```

- [ ] **Step 2: Document the Phase 1 verification commands**

Update `docs/MBRAIN_VERIFY.md` with a new section:

```md
## Phase 1 Operational Memory

Run:

```bash
bun test test/task-memory-schema.test.ts test/task-memory-service.test.ts test/task-memory-operations.test.ts
bun test test/sqlite-engine.test.ts test/pglite-engine.test.ts test/postgres-engine.test.ts
bun test test/phase0-contract-parity.test.ts -t "task resume semantics"
```
```

- [ ] **Step 3: Add a package shortcut if the suite becomes long**

If the command length is high enough to justify it, add to `package.json`:

```json
{
  "scripts": {
    "test:phase1": "bun test test/task-memory-schema.test.ts test/task-memory-service.test.ts test/task-memory-operations.test.ts test/sqlite-engine.test.ts test/pglite-engine.test.ts test/postgres-engine.test.ts test/phase0-contract-parity.test.ts"
  }
}
```

- [ ] **Step 4: Run the Phase 1 verification suite**

Run:

```bash
bun test test/task-memory-schema.test.ts test/task-memory-service.test.ts test/task-memory-operations.test.ts test/sqlite-engine.test.ts test/pglite-engine.test.ts test/postgres-engine.test.ts test/phase0-contract-parity.test.ts
```

Expected:

```text
new Phase 1 suites pass
postgres-specific task-memory checks skip cleanly when DATABASE_URL is unset
```

- [ ] **Step 5: Commit**

```bash
git add test/phase0-contract-parity.test.ts docs/MBRAIN_VERIFY.md package.json
git commit -m "test: add phase1 operational memory verification"
```

---

## Self-review checklist

- Phase 1 scope stays inside the approved MVP object boundary and does not smuggle in `Episode` or `Procedure`.
- Every new public behavior routes through shared operations rather than a CLI-only task subsystem.
- SQLite, PGLite, and Postgres all implement the same task-memory semantics at the public contract boundary.
- Resume behavior is task-first and does not read raw sources before task state.
- Retrieval Trace persistence exists in the schema and engine contract even if broader system-wide adoption lands later.
- Verification commands cover schema, service logic, backend persistence, and parity.
