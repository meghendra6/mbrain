import type {
  MemoryScenario,
  MemoryScenarioClassifierInput,
  MemoryScenarioClassifierResult,
  MemoryScenarioConfidence,
  MemoryScenarioDecomposedRoute,
  MemoryScenarioKnownSubject,
  MemoryScenarioKnownSubjectKind,
  MemoryScenarioScopeDecision,
  MemoryScenarioSourceKind,
} from '../types.ts';

type MaterialScenario = Exclude<MemoryScenario, 'mixed'>;

interface ScenarioSignal {
  scenario: MaterialScenario;
  confidence: MemoryScenarioConfidence;
  reason_codes: string[];
  suppressible?: boolean;
}

const MIXED_ROUTE_ORDER: MaterialScenario[] = [
  'personal_recall',
  'coding_continuation',
  'project_qa',
  'knowledge_qa',
  'auto_accumulation',
];

const ACCUMULATION_SOURCE_KINDS = new Set<MemoryScenarioSourceKind>([
  'import',
  'meeting',
  'cron',
  'session_end',
  'trace_review',
] as const);

const PROJECT_SUBJECT_KINDS = new Set<MemoryScenarioKnownSubjectKind>([
  'project',
  'system',
  'file',
  'symbol',
]);

const KNOWLEDGE_SUBJECT_KINDS = new Set<MemoryScenarioKnownSubjectKind>([
  'concept',
  'person',
  'company',
  'source',
]);

const PERSONAL_SUBJECT_KINDS = new Set<MemoryScenarioKnownSubjectKind>([
  'profile',
  'personal_episode',
]);

const TASK_SUBJECT_KINDS = new Set<MemoryScenarioKnownSubjectKind>(['task']);

const PERSONAL_QUERY_PATTERNS = [
  /\bremember\s+my\b/i,
  /\bmy\s+(?:personal\s+)?(?:morning\s+)?(?:routine|routines|habit|habits|preference|preferences|schedule|daily routine)\b/i,
  /(^|[^\p{L}\p{N}_])내\s*(?:선호|루틴|습관|일상|생활|일정)(?:을|를|이|가|은|는)?(?=$|[^\p{L}\p{N}_])/iu,
  /나의\s*(?:선호|루틴|습관|일상|생활|일정)(?:을|를|이|가|은|는)?/iu,
] as const;

const CODING_QUERY_PATTERNS = [
  /\b(continue|resume|pick up)\b.*\b(task|implementation|implementing|fix|failing test|test|code|repo|repository|branch|pr|pull request|issue|work)\b/i,
  /\b(fix|debug|repair)\b.*\b(failing test|test|bug|issue|code|implementation)\b/i,
  /\b(commit|merge|review|land|update)\b\s+(this\s+)?\b(pr|pull request)\b/i,
  /(이어서|계속).*(구현|수정|작업|테스트|코드)/i,
  /(실패한 테스트|테스트.*수정|구현 작업|코드.*수정)/i,
] as const;

const PROJECT_QUERY_PATTERNS = [
  /\b(project\s+(architecture|design|preferences?|storage|routing|structure)|codebase\s+(architecture|structure|routing)|route selector|retrieval route)\b/i,
  /\bproject\s+architecture\b/i,
  /((프로젝트|시스템).*(아키텍처|구조|설계|검색 라우팅|라우팅)|검색 라우팅|라우팅 구조)/i,
] as const;

const EXPLICIT_KNOWLEDGE_QUERY_PATTERNS = [
  /\b(what do we know about|who is|who are|tell me about)\b/i,
  /(무엇을 알고|알고 있나요|누구)/i,
] as const;

const GENERIC_KNOWLEDGE_QUERY_PATTERNS = [
  /\b(what is|what are|what does\b.*\bmean|explain|how does)\b/i,
  /(무엇|무엇인가|무엇이야|뭐야|무슨 뜻|뜻이 뭐|설명해|알려줘)/i,
] as const;

const GENERIC_CONCEPT_QUERY_PATTERNS = [
  /\bwhat\s+(is|are)\b/i,
  /\bwhat\s+does\b.*\bmean\b/i,
  /\bwhat's\b/i,
  /(무엇인가|무엇이야|뭐야|무슨 뜻|뜻이 뭐)/i,
] as const;

const ACCUMULATION_QUERY_PATTERNS = [
  /\b(durable memory|memory candidates?|accumulate|accumulation|capture|ingest|trace review|review this session)\b/i,
  /(장기 기억|기억 후보|남길 것|누적|축적|수집|검토)/i,
] as const;

export function classifyMemoryScenario(
  input: MemoryScenarioClassifierInput,
): MemoryScenarioClassifierResult {
  const signals = collectSignals(input);
  const materialSignals = suppressKnowledgeWhenCovered(signals);

  if (materialSignals.length > 1) {
    const decomposed_routes = orderSignals(materialSignals).map(toDecomposedRoute);
    return buildResult({
      scenario: 'mixed',
      confidence: 'high',
      reason_codes: uniqueReasonCodes([
        ...decomposed_routes.flatMap((route) => route.reason_codes),
        'multiple_material_scenarios',
      ]),
      decomposed_routes,
      input,
    });
  }

  const selected = materialSignals[0] ?? {
    scenario: 'knowledge_qa' as const,
    confidence: 'low' as const,
    reason_codes: ['fallback_knowledge_qa'],
  };

  return buildResult({
    scenario: selected.scenario,
    confidence: selected.confidence,
    reason_codes: selected.reason_codes,
    decomposed_routes: [],
    input,
  });
}

function collectSignals(input: MemoryScenarioClassifierInput): ScenarioSignal[] {
  const signals: ScenarioSignal[] = [];

  const personal = detectPersonal(input);
  if (personal) signals.push(personal);

  const coding = detectCoding(input);
  if (coding) signals.push(coding);

  const project = detectProject(input);
  if (project) signals.push(project);

  const knowledge = detectKnowledge(input);
  if (knowledge) signals.push(knowledge);

  const accumulation = detectAccumulation(input);
  if (accumulation) signals.push(accumulation);

  return mergeSignals(signals);
}

function detectPersonal(input: MemoryScenarioClassifierInput): ScenarioSignal | null {
  if (hasKnownSubjectKind(input, PERSONAL_SUBJECT_KINDS) || matchesAny(input.query, PERSONAL_QUERY_PATTERNS)) {
    return {
      scenario: 'personal_recall',
      confidence: 'high',
      reason_codes: ['personal_signal'],
    };
  }
  return null;
}

function detectCoding(input: MemoryScenarioClassifierInput): ScenarioSignal | null {
  if (input.task_id) {
    return {
      scenario: 'coding_continuation',
      confidence: 'high',
      reason_codes: ['task_id_present'],
    };
  }
  if (input.repo_path) {
    return {
      scenario: 'coding_continuation',
      confidence: 'high',
      reason_codes: ['repo_path_present'],
    };
  }
  if (hasKnownSubjectKind(input, TASK_SUBJECT_KINDS)) {
    return {
      scenario: 'coding_continuation',
      confidence: 'medium',
      reason_codes: ['task_subject'],
    };
  }
  if (input.source_kind === 'code_event') {
    return {
      scenario: 'coding_continuation',
      confidence: 'medium',
      reason_codes: ['code_event_source_kind'],
    };
  }
  if (isGenericConceptQuestion(input.query)) return null;
  if (matchesAny(input.query, CODING_QUERY_PATTERNS)) {
    return {
      scenario: 'coding_continuation',
      confidence: 'medium',
      reason_codes: ['coding_query_signal'],
    };
  }
  return null;
}

function detectProject(input: MemoryScenarioClassifierInput): ScenarioSignal | null {
  if (hasProjectSubject(input) || hasStructuralProjectSubject(input.known_subjects)) {
    return {
      scenario: 'project_qa',
      confidence: 'medium',
      reason_codes: ['system_or_project_subject'],
    };
  }
  if (isGenericConceptQuestion(input.query)) return null;
  if (matchesAny(input.query, PROJECT_QUERY_PATTERNS)) {
    return {
      scenario: 'project_qa',
      confidence: 'medium',
      reason_codes: ['project_query_signal'],
    };
  }
  return null;
}

function detectKnowledge(input: MemoryScenarioClassifierInput): ScenarioSignal | null {
  if (hasKnownSubjectKind(input, KNOWLEDGE_SUBJECT_KINDS) || matchesAny(input.query, EXPLICIT_KNOWLEDGE_QUERY_PATTERNS)) {
    return {
      scenario: 'knowledge_qa',
      confidence: 'medium',
      reason_codes: ['knowledge_question_signal'],
    };
  }
  if (matchesAny(input.query, GENERIC_KNOWLEDGE_QUERY_PATTERNS)) {
    return {
      scenario: 'knowledge_qa',
      confidence: 'medium',
      reason_codes: ['knowledge_question_signal'],
      suppressible: true,
    };
  }
  return null;
}

function detectAccumulation(input: MemoryScenarioClassifierInput): ScenarioSignal | null {
  if (input.source_kind && ACCUMULATION_SOURCE_KINDS.has(input.source_kind)) {
    return {
      scenario: 'auto_accumulation',
      confidence: 'high',
      reason_codes: ['accumulation_source_kind'],
    };
  }
  if (matchesAny(input.query, ACCUMULATION_QUERY_PATTERNS)) {
    return {
      scenario: 'auto_accumulation',
      confidence: 'medium',
      reason_codes: ['accumulation_query_signal'],
    };
  }
  return null;
}

function buildResult(input: {
  scenario: MemoryScenario;
  confidence: MemoryScenarioConfidence;
  reason_codes: string[];
  decomposed_routes: MemoryScenarioDecomposedRoute[];
  input: MemoryScenarioClassifierInput;
}): MemoryScenarioClassifierResult {
  const hasPersonal = input.scenario === 'personal_recall'
    || input.decomposed_routes.some((route) => route.scenario === 'personal_recall');
  const scope_decision = resolveScopeDecision(input.input, input.scenario, hasPersonal);

  return {
    scenario: input.scenario,
    confidence: input.confidence,
    scope_decision,
    reason_codes: uniqueReasonCodes(input.reason_codes),
    requires_user_clarification: hasPersonal && input.input.requested_scope === 'work',
    decomposed_routes: input.decomposed_routes,
  };
}

function resolveScopeDecision(
  input: MemoryScenarioClassifierInput,
  scenario: MemoryScenario,
  hasPersonal: boolean,
): MemoryScenarioScopeDecision {
  if (hasPersonal && input.requested_scope === 'work') return 'defer';
  if (input.requested_scope) return input.requested_scope;
  if (scenario === 'mixed' && hasPersonal) return 'mixed';
  if (hasPersonal) return 'personal';
  return 'work';
}

function hasProjectSubject(input: MemoryScenarioClassifierInput): boolean {
  return hasKnownSubjectKind(input, PROJECT_SUBJECT_KINDS);
}

function hasKnownSubjectKind(
  input: MemoryScenarioClassifierInput,
  kinds: Set<MemoryScenarioKnownSubjectKind>,
): boolean {
  return (input.known_subjects ?? []).some((subject) => (
    typeof subject !== 'string' && subject.kind !== undefined && kinds.has(subject.kind)
  ));
}

function hasStructuralProjectSubject(
  subjects: Array<string | MemoryScenarioKnownSubject> | undefined,
): boolean {
  return (subjects ?? []).some((subject) => {
    const ref = typeof subject === 'string' ? subject : subject.ref;
    return /(^|\/)(systems|projects|project)\//i.test(ref.trim());
  });
}

function matchesAny(
  value: string | undefined,
  patterns: readonly RegExp[],
): boolean {
  if (!value) return false;
  return patterns.some((pattern) => pattern.test(value));
}

function isGenericConceptQuestion(query: string | undefined): boolean {
  return matchesAny(query, GENERIC_CONCEPT_QUERY_PATTERNS);
}

function suppressKnowledgeWhenCovered(signals: ScenarioSignal[]): ScenarioSignal[] {
  const hasSuppressingScenario = signals.some((signal) => (
    signal.scenario === 'project_qa'
    || signal.scenario === 'coding_continuation'
    || signal.scenario === 'personal_recall'
    || signal.scenario === 'auto_accumulation'
  ));

  if (!hasSuppressingScenario) return signals;
  return signals.filter((signal) => signal.scenario !== 'knowledge_qa' || signal.suppressible !== true);
}

function mergeSignals(signals: ScenarioSignal[]): ScenarioSignal[] {
  const byScenario = new Map<MaterialScenario, ScenarioSignal>();

  for (const signal of signals) {
    const existing = byScenario.get(signal.scenario);
    if (!existing) {
      byScenario.set(signal.scenario, { ...signal });
      continue;
    }

    byScenario.set(signal.scenario, {
      scenario: signal.scenario,
      confidence: higherConfidence(existing.confidence, signal.confidence),
      reason_codes: uniqueReasonCodes([...existing.reason_codes, ...signal.reason_codes]),
      suppressible: existing.suppressible === true && signal.suppressible === true,
    });
  }

  return [...byScenario.values()];
}

function orderSignals(signals: ScenarioSignal[]): ScenarioSignal[] {
  return [...signals].sort((left, right) => (
    MIXED_ROUTE_ORDER.indexOf(left.scenario) - MIXED_ROUTE_ORDER.indexOf(right.scenario)
  ));
}

function toDecomposedRoute(signal: ScenarioSignal): MemoryScenarioDecomposedRoute {
  return {
    scenario: signal.scenario,
    confidence: signal.confidence,
    reason_codes: signal.reason_codes,
  };
}

function higherConfidence(
  left: MemoryScenarioConfidence,
  right: MemoryScenarioConfidence,
): MemoryScenarioConfidence {
  const order: MemoryScenarioConfidence[] = ['low', 'medium', 'high'];
  return order.indexOf(left) >= order.indexOf(right) ? left : right;
}

function uniqueReasonCodes(reasonCodes: string[]): string[] {
  return [...new Set(reasonCodes)];
}
