import {
  PHASE_DEFINITIONS,
  evaluateLongitudinalAcceptance,
  getProcessOutcome,
  type Phase8LongitudinalPhaseSummary,
  type Phase8Payload,
} from '../../scripts/bench/phase8-longitudinal-evaluation.ts';

const phaseSummaries: Phase8LongitudinalPhaseSummary[] = PHASE_DEFINITIONS.map((definition) => {
  if (definition.phase === 'phase3') {
    return {
      phase: definition.phase,
      baseline_family: definition.baseline_family,
      comparable_status: 'fail',
      readiness_status: 'fail',
      phase_status: 'fail',
      benchmark_names: definition.expected_benchmark_names.slice(0, -1),
      regression_reasons: ['benchmark_manifest_mismatch'],
    };
  }

  return {
    phase: definition.phase,
    baseline_family: definition.baseline_family,
    comparable_status: 'pass',
    readiness_status: 'pass',
    phase_status: 'pass',
    benchmark_names: [...definition.expected_benchmark_names],
    regression_reasons: [],
  };
});

const payload: Phase8Payload = {
  generated_at: '2026-04-23T00:00:00.000Z',
  engine: 'sqlite',
  phase: 'phase8',
  phase_summaries: phaseSummaries,
  acceptance: evaluateLongitudinalAcceptance(phaseSummaries),
};

const outcome = getProcessOutcome(payload);
console.log(outcome.stdout);
process.exit(outcome.exitCode);
