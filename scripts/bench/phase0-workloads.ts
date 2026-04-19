import { resolve } from 'path';

export const PHASE0_FIXTURES_DIR = resolve(import.meta.dir, '../../test/e2e/fixtures');
export const PHASE0_UNSUPPORTED_REASON = 'Phase 1 operational memory is not implemented yet';

export type Phase0MeasuredWorkloadName =
  | 'fixture_import'
  | 'keyword_search'
  | 'hybrid_search'
  | 'stats_health';

export type Phase0WorkloadName = Phase0MeasuredWorkloadName | 'task_resume';

export interface Phase0MeasuredWorkloadResult {
  name: Phase0MeasuredWorkloadName;
  status: 'measured';
  unit: 'ms' | 'pages_per_second';
  p50_ms?: number;
  p95_ms?: number;
  pages_per_second?: number;
}

export interface Phase0UnsupportedWorkloadResult {
  name: 'task_resume';
  status: 'unsupported';
  unit: 'boolean';
  reason: string;
}

export type Phase0WorkloadResult =
  | Phase0MeasuredWorkloadResult
  | Phase0UnsupportedWorkloadResult;

export interface Phase0WorkloadDefinition {
  name: Phase0WorkloadName;
  unit: Phase0WorkloadResult['unit'];
  samples?: number;
  queries?: string[];
  reason?: string;
}

export const PHASE0_WORKLOADS: Phase0WorkloadDefinition[] = [
  {
    name: 'fixture_import',
    unit: 'pages_per_second',
  },
  {
    name: 'keyword_search',
    unit: 'ms',
    samples: 5,
    queries: ['NovaMind', 'hybrid search', 'Sarah Chen', 'Threshold Ventures'],
  },
  {
    name: 'hybrid_search',
    unit: 'ms',
    samples: 5,
    queries: ['NovaMind', 'hybrid search', 'Sarah Chen', 'Threshold Ventures'],
  },
  {
    name: 'stats_health',
    unit: 'ms',
    samples: 5,
  },
  {
    name: 'task_resume',
    unit: 'boolean',
    reason: PHASE0_UNSUPPORTED_REASON,
  },
];
