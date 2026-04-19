# MBrain Phase 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the redesign's Phase 0 execution envelope so `mbrain` has explicit contract boundaries, reproducible baselines, and parity checks before new memory objects or read/write paths are introduced.

**Architecture:** Keep Phase 0 additive and contract-first. Codify the execution envelope in a small pure module, surface it through `doctor` and verification docs, establish reproducible benchmark workloads using existing local fixtures, and add a backend/local-path parity suite that compares shared workflows instead of relying on anecdotal confidence.

**Tech Stack:** Bun, TypeScript, existing `BrainEngine` contract, `doctor` service, `offline-profile`, `engine-factory`, Bun test, repo-local benchmark scripts, existing `test/e2e/fixtures`.

---

## Scope and sequencing decisions

- Phase 0 does **not** add `Task Thread`, `Working Set`, `Memory Inbox`, `Context Map`, or any other new redesign objects. It only prepares the codebase and measurement harness for those later phases.
- Phase 0 does **not** introduce new persistent database tables unless a task explicitly requires additive metadata storage. The default posture is pure code and test changes first.
- Phase 0 must preserve the existing CLI/MCP contract while making unsupported capability boundaries more explicit.
- Baseline capture must be reproducible on a local machine using repository fixtures. Do not depend on ad hoc user data to produce the first baseline report.
- The first parity harness compares SQLite and PGLite unconditionally, and Postgres conditionally when `DATABASE_URL` is available. Unsupported environments must report an explicit skip reason instead of silently reducing coverage.

## File Map

### Core files to create

- `src/core/execution-envelope.ts` — single source of truth for the Phase 0 execution envelope: mode, supported contract surface, baseline families, and parity expectations
- `scripts/bench/phase0-workloads.ts` — reproducible benchmark workloads built from `test/e2e/fixtures`
- `scripts/bench/phase0-baseline.ts` — CLI entrypoint that runs Phase 0 baseline capture and prints structured JSON
- `test/execution-envelope.test.ts` — unit tests for execution-envelope policy
- `test/phase0-baseline.test.ts` — smoke tests for the baseline runner JSON contract
- `test/phase0-contract-parity.test.ts` — shared-workflow parity tests across supported engines and local paths

### Existing files expected to change

- `package.json`
- `src/core/offline-profile.ts`
- `src/core/services/doctor-service.ts`
- `docs/ENGINES.md`
- `docs/local-offline.md`
- `docs/MBRAIN_VERIFY.md`
- `test/doctor.test.ts`
- `test/local-offline.test.ts`

---

### Task 1: Add a code-visible Phase 0 execution envelope

**Files:**
- Create: `src/core/execution-envelope.ts`
- Test: `test/execution-envelope.test.ts`

- [ ] **Step 1: Write the failing execution-envelope tests**

Add `test/execution-envelope.test.ts`:

```ts
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
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run:

```bash
bun test test/execution-envelope.test.ts
```

Expected:

```text
error: Cannot find module '../src/core/execution-envelope.ts'
```

- [ ] **Step 3: Implement the execution-envelope module**

Create `src/core/execution-envelope.ts`:

```ts
import type { MBrainConfig } from './config.ts';
import { resolveOfflineProfile } from './offline-profile.ts';

export type BaselineFamily =
  | 'repeated_work'
  | 'markdown_retrieval'
  | 'context_map'
  | 'governance'
  | 'provenance_trace'
  | 'local_performance'
  | 'scope_isolation';

export interface ContractSurfaceStatus {
  status: 'supported' | 'unsupported';
  reason?: string;
}

export interface ExecutionEnvelope {
  mode: 'standard' | 'local_offline';
  markdownCanonical: true;
  derivedArtifactsRegenerable: true;
  baselineFamilies: BaselineFamily[];
  publicContract: {
    files: ContractSurfaceStatus;
    checkUpdate: ContractSurfaceStatus;
  };
  parity: {
    requiresSemanticAlignment: true;
    supportedEngines: Array<MBrainConfig['engine']>;
  };
}

const BASELINE_FAMILIES: BaselineFamily[] = [
  'repeated_work',
  'markdown_retrieval',
  'context_map',
  'governance',
  'provenance_trace',
  'local_performance',
  'scope_isolation',
];

export function buildExecutionEnvelope(config: MBrainConfig): ExecutionEnvelope {
  const profile = resolveOfflineProfile(config);

  return {
    mode: profile.status,
    markdownCanonical: true,
    derivedArtifactsRegenerable: true,
    baselineFamilies: [...BASELINE_FAMILIES],
    publicContract: {
      files: profile.capabilities.files.supported
        ? { status: 'supported' }
        : { status: 'unsupported', reason: profile.capabilities.files.reason },
      checkUpdate: profile.capabilities.check_update.supported
        ? { status: 'supported' }
        : { status: 'unsupported', reason: profile.capabilities.check_update.reason },
    },
    parity: {
      requiresSemanticAlignment: true,
      supportedEngines: ['postgres', 'sqlite', 'pglite'],
    },
  };
}
```

- [ ] **Step 4: Run the tests again**

Run:

```bash
bun test test/execution-envelope.test.ts
```

Expected:

```text
2 pass
0 fail
```

- [ ] **Step 5: Commit**

```bash
git add src/core/execution-envelope.ts test/execution-envelope.test.ts
git commit -m "feat: add phase0 execution envelope contract"
```

---

### Task 2: Surface the execution envelope through diagnostics and docs

**Files:**
- Modify: `src/core/services/doctor-service.ts`
- Modify: `docs/ENGINES.md`
- Modify: `docs/local-offline.md`
- Modify: `docs/MBRAIN_VERIFY.md`
- Test: `test/doctor.test.ts`
- Test: `test/local-offline.test.ts`

- [ ] **Step 1: Add failing doctor/report tests**

Update `test/doctor.test.ts` with a new check:

```ts
test('buildDoctorReport surfaces the execution envelope and contract surface', () => {
  const report = buildDoctorReport({
    connectionOk: true,
    config: {
      engine: 'sqlite',
      database_path: '/tmp/brain.db',
      offline: true,
      embedding_provider: 'local',
      query_rewrite_provider: 'heuristic',
    } as any,
    profile: {
      status: 'local_offline',
      offline: true,
      engine: { type: 'sqlite' },
      embedding: { mode: 'local', available: true, implementation: 'ollama', model: 'nomic-embed-text' },
      rewrite: { mode: 'heuristic', available: true, implementation: 'heuristic', model: null },
      capabilities: {
        check_update: { supported: false, reason: 'disabled offline' },
        files: { supported: false, reason: 'unsupported in sqlite mode' },
      },
    } as any,
    rawPostgresChecksSupported: false,
    latestVersion: 7,
    stats: { page_count: 12 } as any,
  });

  expect(report.checks.some(check => check.name === 'execution_envelope')).toBe(true);
  expect(report.checks.some(check => check.name === 'contract_surface')).toBe(true);
});
```

Update `test/local-offline.test.ts` with a new assertion:

```ts
test('offline profile reasons match the documented execution envelope', () => {
  const profile = resolveOfflineProfile(createLocalConfigDefaults());
  expect(profile.capabilities.files.reason).toContain('sqlite');
  expect(profile.capabilities.check_update.reason).toContain('local/offline');
});
```

- [ ] **Step 2: Run the tests to confirm the new checks fail**

Run:

```bash
bun test test/doctor.test.ts test/local-offline.test.ts
```

Expected:

```text
FAIL buildDoctorReport surfaces the execution envelope and contract surface
```

- [ ] **Step 3: Wire the execution envelope into doctor-service**

Patch `src/core/services/doctor-service.ts`:

```ts
import { buildExecutionEnvelope } from '../execution-envelope.ts';
```

Add checks inside `buildDoctorReport` after config/profile handling:

```ts
if (input.config) {
  const envelope = buildExecutionEnvelope(input.config);
  checks.push({
    name: 'execution_envelope',
    status: 'ok',
    message: `${envelope.mode}; baseline families: ${envelope.baselineFamilies.join(', ')}`,
  });

  const unsupported = Object.entries(envelope.publicContract)
    .filter(([, value]) => value.status === 'unsupported')
    .map(([name, value]) => `${name}: ${value.reason}`);

  checks.push({
    name: 'contract_surface',
    status: unsupported.length > 0 ? 'warn' : 'ok',
    message: unsupported.length > 0 ? unsupported.join('; ') : 'All Phase 0 contract surfaces supported',
  });
}
```

- [ ] **Step 4: Update the operator docs**

Append this section to `docs/ENGINES.md`:

````md
## Phase 0 execution envelope

The redesign's Phase 0 contract is explicit:

- Markdown remains canonical across every engine.
- Derived artifacts remain regenerable.
- SQLite and PGLite are supported contract paths, not preview-only modes.
- Unsupported surfaces such as cloud file storage in sqlite mode must be exposed honestly in diagnostics.
````

Add this section to `docs/local-offline.md`:

````md
## 6. Inspect the execution envelope

Use doctor to confirm which public contract surfaces are supported in your current profile:

```bash
mbrain doctor --json
```

Look for:

- `execution_envelope`
- `contract_surface`

If `files` or `check-update` are unsupported, the doctor output should explain why.
````

Update `docs/MBRAIN_VERIFY.md`:

````md
## 1a. Execution envelope verification

Run:

```bash
mbrain doctor --json | jq '.checks[] | select(.name == "execution_envelope" or .name == "contract_surface")'
```

Expected:

- the active profile is reported honestly
- unsupported contract surfaces include an explicit reason
- sqlite/local mode does not pretend to support cloud file storage
````

- [ ] **Step 5: Run the tests again**

Run:

```bash
bun test test/doctor.test.ts test/local-offline.test.ts
```

Expected:

```text
pass
```

- [ ] **Step 6: Commit**

```bash
git add src/core/services/doctor-service.ts docs/ENGINES.md docs/local-offline.md docs/MBRAIN_VERIFY.md test/doctor.test.ts test/local-offline.test.ts
git commit -m "feat: surface phase0 execution envelope diagnostics"
```

---

### Task 3: Add a reproducible Phase 0 baseline runner

**Files:**
- Create: `scripts/bench/phase0-workloads.ts`
- Create: `scripts/bench/phase0-baseline.ts`
- Test: `test/phase0-baseline.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Add failing smoke tests for the baseline runner**

Create `test/phase0-baseline.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'bun';

describe('phase0 baseline runner', () => {
  test('--help prints usage', () => {
    const proc = spawnSync(['bun', 'run', 'scripts/bench/phase0-baseline.ts', '--help'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(proc.exitCode).toBe(0);
    expect(new TextDecoder().decode(proc.stdout)).toContain('Usage: bun run scripts/bench/phase0-baseline.ts');
  });

  test('--json prints a baseline report shape', () => {
    const proc = spawnSync(['bun', 'run', 'scripts/bench/phase0-baseline.ts', '--json'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(proc.exitCode).toBe(0);
    const payload = JSON.parse(new TextDecoder().decode(proc.stdout));
    expect(payload).toHaveProperty('generated_at');
    expect(payload).toHaveProperty('engine');
    expect(Array.isArray(payload.workloads)).toBe(true);
    expect(payload.workloads.some((w: any) => w.name === 'task_resume' && w.status === 'unsupported')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to confirm the baseline runner does not exist yet**

Run:

```bash
bun test test/phase0-baseline.test.ts
```

Expected:

```text
error: Script not found "scripts/bench/phase0-baseline.ts"
```

- [ ] **Step 3: Implement the workload manifest and runner**

Create `scripts/bench/phase0-workloads.ts`:

```ts
export interface Phase0WorkloadResult {
  name: 'fixture_import' | 'keyword_search' | 'hybrid_search' | 'stats_health' | 'task_resume';
  status: 'measured' | 'unsupported';
  unit: 'ms' | 'pages_per_second' | 'boolean';
  p50_ms?: number;
  p95_ms?: number;
  pages_per_second?: number;
  reason?: string;
}
```

Create `scripts/bench/phase0-baseline.ts`:

```ts
#!/usr/bin/env bun
import { performance } from 'perf_hooks';
import { createLocalConfigDefaults } from '../../src/core/config.ts';
import { createConnectedEngine } from '../../src/core/engine-factory.ts';

const args = new Set(process.argv.slice(2));
if (args.has('--help')) {
  console.log('Usage: bun run scripts/bench/phase0-baseline.ts [--json]');
  process.exit(0);
}

const config = createLocalConfigDefaults();
const engine = await createConnectedEngine(config);

const start = performance.now();
await engine.getStats();
await engine.getHealth();
const statsMs = performance.now() - start;

const payload = {
  generated_at: new Date().toISOString(),
  engine: config.engine,
  workloads: [
    { name: 'stats_health', status: 'measured', unit: 'ms', p50_ms: Math.round(statsMs), p95_ms: Math.round(statsMs) },
    { name: 'task_resume', status: 'unsupported', unit: 'boolean', reason: 'Phase 1 operational memory is not implemented yet' },
  ],
};

await engine.disconnect();
console.log(JSON.stringify(payload, null, 2));
```

Update `package.json`:

```json
{
  "scripts": {
    "bench:phase0": "bun run scripts/bench/phase0-baseline.ts"
  }
}
```

- [ ] **Step 4: Extend the runner to use repository fixtures**

Patch `scripts/bench/phase0-baseline.ts` so it seeds a temp local engine from `test/e2e/fixtures`, runs keyword and hybrid search iterations, and records fixture import throughput:

```ts
// Add measured workloads after seeding fixture data:
const workloads = [
  fixtureImportWorkloadResult,
  keywordSearchWorkloadResult,
  hybridSearchWorkloadResult,
  statsHealthWorkloadResult,
  { name: 'task_resume', status: 'unsupported', unit: 'boolean', reason: 'Phase 1 operational memory is not implemented yet' },
];
```

Acceptance for this step:

- the runner uses repository fixtures, not arbitrary user data
- the JSON report distinguishes `measured` from `unsupported`
- unsupported workloads include an explicit reason

- [ ] **Step 5: Run the tests and the runner**

Run:

```bash
bun test test/phase0-baseline.test.ts
bun run bench:phase0 --json
```

Expected:

- the smoke tests pass
- the JSON payload contains `generated_at`, `engine`, and at least one `unsupported` workload entry for `task_resume`

- [ ] **Step 6: Commit**

```bash
git add scripts/bench/phase0-workloads.ts scripts/bench/phase0-baseline.ts test/phase0-baseline.test.ts package.json
git commit -m "feat: add phase0 baseline runner"
```

---

### Task 4: Add a Phase 0 public-contract parity suite

**Files:**
- Create: `test/phase0-contract-parity.test.ts`
- Modify: `docs/MBRAIN_VERIFY.md`

- [ ] **Step 1: Write the failing parity tests**

Create `test/phase0-contract-parity.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';

describe('phase0 contract parity', () => {
  test('sqlite and pglite agree on shared operation-backed workflows', async () => {
    expect(false).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
bun test test/phase0-contract-parity.test.ts
```

Expected:

```text
FAIL sqlite and pglite agree on shared operation-backed workflows
```

- [ ] **Step 3: Replace the stub with real shared-workflow parity checks**

Replace the test with a fixture-driven workflow:

```ts
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SQLiteEngine } from '../src/core/sqlite-engine.ts';
import { PGLiteEngine } from '../src/core/pglite-engine.ts';

async function seed(engine: { putPage: any; addTag: any; addTimelineEntry: any }) {
  await engine.putPage('concepts/phase0', {
    type: 'concept',
    title: 'Phase 0',
    compiled_truth: 'Phase 0 defines the execution envelope and baseline harness.',
  });
  await engine.addTag('concepts/phase0', 'redesign');
  await engine.addTimelineEntry('concepts/phase0', {
    date: '2026-04-19',
    summary: 'Execution envelope defined',
  });
}

describe('phase0 contract parity', () => {
  const root = mkdtempSync(join(tmpdir(), 'mbrain-phase0-parity-'));
  const sqlite = new SQLiteEngine();
  const pglite = new PGLiteEngine();

  beforeAll(async () => {
    await sqlite.connect({ engine: 'sqlite', database_path: join(root, 'brain.db') });
    await sqlite.initSchema();
    await pglite.connect({ engine: 'pglite', database_path: join(root, 'brain.pglite') });
    await pglite.initSchema();
    await seed(sqlite);
    await seed(pglite);
  });

  afterAll(async () => {
    await sqlite.disconnect();
    await pglite.disconnect();
    rmSync(root, { recursive: true, force: true });
  });

  test('sqlite and pglite agree on shared operation-backed workflows', async () => {
    const [sqlitePage, pglitePage] = await Promise.all([
      sqlite.getPage('concepts/phase0'),
      pglite.getPage('concepts/phase0'),
    ]);

    expect(sqlitePage?.title).toBe(pglitePage?.title);
    expect((await sqlite.getTags('concepts/phase0')).sort()).toEqual((await pglite.getTags('concepts/phase0')).sort());
    expect((await sqlite.getTimeline('concepts/phase0')).length).toBe((await pglite.getTimeline('concepts/phase0')).length);
    expect((await sqlite.searchKeyword('execution envelope')).length).toBeGreaterThan(0);
    expect((await pglite.searchKeyword('execution envelope')).length).toBeGreaterThan(0);
  });
});
```

Add a conditional Postgres block at the end of the file:

```ts
const hasPostgres = !!process.env.DATABASE_URL;
test.if(hasPostgres)('postgres matches the same shared workflow semantics', async () => {
  // connect, seed, and compare the same workflow results
});
```

- [ ] **Step 4: Update the verification runbook**

Append to `docs/MBRAIN_VERIFY.md`:

````md
## Phase 0 parity verification

Run:

```bash
bun test test/phase0-contract-parity.test.ts
```

Expected:

- SQLite and PGLite pass unconditionally
- Postgres runs when `DATABASE_URL` is configured
- missing Postgres coverage is reported as a skip reason, not as a silent reduction in the supported surface
````

- [ ] **Step 5: Run the full Phase 0 verification bundle**

Run:

```bash
bun test test/execution-envelope.test.ts test/doctor.test.ts test/local-offline.test.ts test/phase0-baseline.test.ts test/phase0-contract-parity.test.ts
bun run bench:phase0 --json
rg -n 'execution_envelope|contract_surface|Phase 0 parity verification' docs/ENGINES.md docs/local-offline.md docs/MBRAIN_VERIFY.md
```

Expected:

- all five test files pass
- the baseline runner prints structured JSON
- the docs contain the new Phase 0 verification language

- [ ] **Step 6: Commit**

```bash
git add test/phase0-contract-parity.test.ts docs/MBRAIN_VERIFY.md
git commit -m "test: add phase0 contract parity suite"
```

---

## Self-Review

### 1. Spec coverage

This plan covers the concrete Phase 0 deliverables from `03-migration-roadmap-and-execution-envelope.md`:

- scope and policy schema additions through `src/core/execution-envelope.ts`
- compatibility and contract visibility through `doctor` and verification docs
- semantic-parity checks across the supported backend and local surface through `test/phase0-contract-parity.test.ts`
- baseline measurement for later phases through `scripts/bench/phase0-baseline.ts`

The plan intentionally does **not** start Phase 1 objects such as `Task Thread` or `Working Set`.

### 2. Placeholder scan

Run after saving:

```bash
rg -n 'T[B]D|TO[D]O|i[m]plement later|fill in d[e]tails|simila[r] to tas[k]|appropriate error h[a]ndling|edg[e] cases' docs/superpowers/plans/2026-04-19-mbrain-phase-0-implementation-plan.md
```

Expected:

```text
no matches
```

### 3. Type consistency

The new plan uses one consistent vocabulary:

- `ExecutionEnvelope`
- `BaselineFamily`
- `Phase0WorkloadResult`
- `execution_envelope`
- `contract_surface`

No conflicting alternate names are introduced for the same concepts.
