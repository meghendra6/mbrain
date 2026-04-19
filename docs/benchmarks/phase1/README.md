# Phase 1 Baselines

This directory exists for published Phase 1 operational-memory baseline artifacts.

Use it when you need a comparable benchmark payload for:

- `bun run bench:phase1 --json --baseline <path>`
- regression checks against a previously captured environment
- release notes or PR evidence that links a measured benchmark to a durable file

Capture a new baseline with:

```bash
bun run bench:phase1 --json --write-baseline docs/benchmarks/phase1/YYYY-MM-DD-<env>.json
```

Rules:

- capture the baseline on the same engine and runtime class you plan to compare later
- treat the file as environment-specific evidence, not as a universal pass/fail target across every machine
- do not overwrite an existing baseline silently; add a new dated file when the environment or contract changes
- if you need full Phase 1 acceptance, compare against a baseline that actually represents the prior repeated-work state for that same environment

This directory does not currently ship a normative checked-in latency baseline because cross-machine timing comparisons would be misleading. The benchmark runner and tests enforce the file shape; this directory is for published environment-specific artifacts.
