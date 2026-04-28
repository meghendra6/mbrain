import { describe, expect, test } from 'bun:test';
import { classifyMemoryScenario } from '../src/core/services/memory-scenario-classifier-service.ts';

function resultScenarios(result: ReturnType<typeof classifyMemoryScenario>): string[] {
  return [
    result.scenario,
    ...result.decomposed_routes.map((route) => route.scenario),
  ];
}

describe('memory scenario classifier', () => {
  test('classifies explicit task context as coding continuation', () => {
    const result = classifyMemoryScenario({
      query: 'Continue the failing test fix',
      task_id: 'task-123',
      repo_path: '/repo/mbrain',
      source_kind: 'chat',
    });

    expect(result.scenario).toBe('coding_continuation');
    expect(result.confidence).toBe('high');
    expect(result.scope_decision).toBe('work');
    expect(result.reason_codes).toContain('task_id_present');
    expect(result.requires_user_clarification).toBe(false);
  });

  test('classifies project architecture questions as project QA', () => {
    const result = classifyMemoryScenario({
      query: 'How does the mbrain retrieval route selector work?',
      known_subjects: ['systems/mbrain'],
    });

    expect(result.scenario).toBe('project_qa');
    expect(result.confidence).toBe('medium');
    expect(result.scope_decision).toBe('work');
    expect(result.reason_codes).toContain('system_or_project_subject');
  });

  test('classifies people and company questions as knowledge QA', () => {
    const result = classifyMemoryScenario({
      query: 'What do we know about Pedro and Brex?',
    });

    expect(result.scenario).toBe('knowledge_qa');
    expect(result.confidence).toBe('medium');
    expect(result.scope_decision).toBe('work');
    expect(result.reason_codes).toContain('knowledge_question_signal');
  });

  test('does not treat ambient repo path as coding continuation for knowledge QA', () => {
    const result = classifyMemoryScenario({
      query: 'What do we know about Pedro?',
      repo_path: '/repo/mbrain',
    });

    expect(result.scenario).toBe('knowledge_qa');
    expect(resultScenarios(result)).not.toContain('coding_continuation');
    expect(result.reason_codes).toContain('knowledge_question_signal');
  });

  test('classifies PR review work on a branch as coding continuation', () => {
    const result = classifyMemoryScenario({
      query: 'Review mbrain PR #70 on branch codex/scenario-memory-orchestration-phase-a',
    });

    expect(result.scenario).toBe('coding_continuation');
    expect(result.reason_codes).toContain('coding_query_signal');
  });

  test('classifies generic code review work as coding continuation', () => {
    const result = classifyMemoryScenario({
      query: 'Review this code',
    });

    expect(result.scenario).toBe('coding_continuation');
    expect(result.reason_codes).toContain('coding_query_signal');
  });

  test('classifies file-path questions as coding continuation', () => {
    const result = classifyMemoryScenario({
      query: 'Why does src/core/operations.ts reject this parameter?',
    });

    expect(result.scenario).toBe('coding_continuation');
    expect(result.reason_codes).toContain('code_artifact_subject');
  });

  test('classifies typed file subjects as coding continuation', () => {
    const result = classifyMemoryScenario({
      query: 'Why does this reject the parameter?',
      known_subjects: [{ ref: 'src/core/operations.ts', kind: 'file' }],
    });

    expect(result.scenario).toBe('coding_continuation');
    expect(result.reason_codes).toContain('code_artifact_subject');
  });

  test('classifies string file subjects as coding continuation', () => {
    const result = classifyMemoryScenario({
      query: 'Explain the rejection behavior',
      known_subjects: ['src/core/operations.ts'],
    });

    expect(result.scenario).toBe('coding_continuation');
    expect(result.reason_codes).toContain('code_artifact_subject');
  });

  test('keeps typed symbol explanation requests as coding continuation', () => {
    const result = classifyMemoryScenario({
      query: 'Explain this symbol',
      known_subjects: [{ ref: 'classifyMemoryScenario', kind: 'symbol' }],
    });

    expect(result.scenario).toBe('coding_continuation');
    expect(result.decomposed_routes).toEqual([]);
    expect(result.reason_codes).toContain('code_artifact_subject');
  });

  test('does not treat conversational English knowledge requests as personal recall', () => {
    const result = classifyMemoryScenario({
      query: 'Tell me about Pedro',
    });

    expect(result.scenario).toBe('knowledge_qa');
    expect(result.decomposed_routes.map((route) => route.scenario)).not.toContain('personal_recall');
    expect(result.reason_codes).not.toContain('personal_signal');
  });

  test('does not treat Korean knowledge requests containing 내용 as personal recall', () => {
    const result = classifyMemoryScenario({
      query: 'Pedro에 대한 내용을 알려줘',
    });

    expect(result.scenario).toBe('knowledge_qa');
    expect(result.decomposed_routes.map((route) => route.scenario)).not.toContain('personal_recall');
    expect(result.reason_codes).not.toContain('personal_signal');
  });

  test('does not treat daily project operations phrasing as personal recall', () => {
    const result = classifyMemoryScenario({
      query: 'Explain the daily cron job',
    });

    expect(['knowledge_qa', 'project_qa']).toContain(result.scenario);
    expect(result.decomposed_routes.map((route) => route.scenario)).not.toContain('personal_recall');
    expect(result.reason_codes).not.toContain('personal_signal');
  });

  test('does not treat routine maintenance knowledge phrasing as personal recall', () => {
    const result = classifyMemoryScenario({
      query: 'What is a routine maintenance window?',
    });

    expect(result.scenario).toBe('knowledge_qa');
    expect(result.decomposed_routes.map((route) => route.scenario)).not.toContain('personal_recall');
    expect(result.reason_codes).not.toContain('personal_signal');
  });

  test('does not treat project preferences storage as personal recall', () => {
    const result = classifyMemoryScenario({
      query: 'How does project preferences storage work?',
    });

    expect(result.scenario).toBe('project_qa');
    expect(result.decomposed_routes.map((route) => route.scenario)).not.toContain('personal_recall');
    expect(result.reason_codes).not.toContain('personal_signal');
  });

  test('does not treat issue tracker concept questions as coding continuation', () => {
    const result = classifyMemoryScenario({
      query: 'What is an issue tracker?',
    });

    expect(result.scenario).toBe('knowledge_qa');
    expect(resultScenarios(result)).not.toContain('coding_continuation');
  });

  test('does not treat system design concept questions as project QA', () => {
    const result = classifyMemoryScenario({
      query: 'What is system design?',
    });

    expect(result.scenario).toBe('knowledge_qa');
    expect(resultScenarios(result)).not.toContain('project_qa');
  });

  test('does not treat pull request concept questions as coding continuation', () => {
    const result = classifyMemoryScenario({
      query: 'What is a pull request?',
    });

    expect(result.scenario).toBe('knowledge_qa');
    expect(resultScenarios(result)).not.toContain('coding_continuation');
    expect(resultScenarios(result)).not.toContain('project_qa');
  });

  test('does not treat repository concept questions as coding continuation', () => {
    const result = classifyMemoryScenario({
      query: 'What is a repository?',
    });

    expect(result.scenario).toBe('knowledge_qa');
    expect(resultScenarios(result)).not.toContain('coding_continuation');
    expect(resultScenarios(result)).not.toContain('project_qa');
  });

  test('does not treat branch concept questions as coding continuation', () => {
    const result = classifyMemoryScenario({
      query: 'What is a branch?',
    });

    expect(result.scenario).toBe('knowledge_qa');
    expect(resultScenarios(result)).not.toContain('coding_continuation');
    expect(resultScenarios(result)).not.toContain('project_qa');
  });

  test('does not treat Korean repository concept questions as coding continuation', () => {
    const result = classifyMemoryScenario({
      query: '저장소가 뭐야?',
    });

    expect(result.scenario).toBe('knowledge_qa');
    expect(resultScenarios(result)).not.toContain('coding_continuation');
    expect(resultScenarios(result)).not.toContain('project_qa');
  });

  test('does not treat Korean branch concept questions as coding continuation', () => {
    const result = classifyMemoryScenario({
      query: '브랜치가 뭐야?',
    });

    expect(result.scenario).toBe('knowledge_qa');
    expect(resultScenarios(result)).not.toContain('coding_continuation');
    expect(resultScenarios(result)).not.toContain('project_qa');
  });

  test('does not treat Korean repo concept questions as coding continuation', () => {
    const result = classifyMemoryScenario({
      query: '리포가 뭐야?',
    });

    expect(result.scenario).toBe('knowledge_qa');
    expect(resultScenarios(result)).not.toContain('coding_continuation');
    expect(resultScenarios(result)).not.toContain('project_qa');
  });

  test('does not treat codebase concept questions as project QA', () => {
    const result = classifyMemoryScenario({
      query: 'What is a codebase?',
    });

    expect(result.scenario).toBe('knowledge_qa');
    expect(resultScenarios(result)).not.toContain('coding_continuation');
    expect(resultScenarios(result)).not.toContain('project_qa');
  });

  test('does not treat durable memory concept questions as accumulation', () => {
    const result = classifyMemoryScenario({
      query: 'What is durable memory?',
    });

    expect(result.scenario).toBe('knowledge_qa');
    expect(resultScenarios(result)).not.toContain('auto_accumulation');
  });

  test('does not treat memory candidate concept questions as accumulation', () => {
    const result = classifyMemoryScenario({
      query: 'What are memory candidates?',
    });

    expect(result.scenario).toBe('knowledge_qa');
    expect(resultScenarios(result)).not.toContain('auto_accumulation');
  });

  test('does not treat generic capture requests as accumulation', () => {
    const result = classifyMemoryScenario({
      query: 'Capture a screenshot',
    });

    expect(resultScenarios(result)).not.toContain('auto_accumulation');
  });

  test('does not treat generic Korean review requests as accumulation', () => {
    const result = classifyMemoryScenario({
      query: 'PR을 검토해줘',
    });

    expect(resultScenarios(result)).not.toContain('auto_accumulation');
  });

  test('classifies trace review as automatic accumulation', () => {
    const result = classifyMemoryScenario({
      query: 'Review this session for durable memory candidates',
      source_kind: 'session_end',
    });

    expect(result.scenario).toBe('auto_accumulation');
    expect(result.confidence).toBe('high');
    expect(result.scope_decision).toBe('work');
    expect(result.reason_codes).toContain('accumulation_source_kind');
  });

  test('classifies personal recall and defers work-scoped personal access', () => {
    const result = classifyMemoryScenario({
      query: 'Remember my morning routine before the work sync',
      requested_scope: 'work',
    });

    expect(result.scenario).toBe('personal_recall');
    expect(result.confidence).toBe('high');
    expect(result.scope_decision).toBe('defer');
    expect(result.requires_user_clarification).toBe(true);
    expect(result.reason_codes).toContain('personal_signal');
  });

  test('decomposes mixed task plus project question', () => {
    const result = classifyMemoryScenario({
      query: 'Continue task-123 and explain the project architecture',
      task_id: 'task-123',
      known_subjects: ['systems/mbrain'],
    });

    expect(result.scenario).toBe('mixed');
    expect(result.confidence).toBe('high');
    expect(result.decomposed_routes.map((route) => route.scenario)).toEqual([
      'coding_continuation',
      'project_qa',
    ]);
    expect(result.reason_codes).toContain('multiple_material_scenarios');
  });

  test('decomposes task plus project architecture without known subjects', () => {
    const result = classifyMemoryScenario({
      query: 'Continue the task and explain the mbrain project architecture',
      task_id: 'task-123',
    });

    expect(result.scenario).toBe('mixed');
    expect(result.decomposed_routes.map((route) => route.scenario)).toEqual([
      'coding_continuation',
      'project_qa',
    ]);
  });

  test('decomposes task plus system architecture without known subjects', () => {
    const result = classifyMemoryScenario({
      query: 'Continue the task and explain the mbrain system architecture',
      task_id: 'task-123',
    });

    expect(result.scenario).toBe('mixed');
    expect(result.decomposed_routes.map((route) => route.scenario)).toEqual([
      'coding_continuation',
      'project_qa',
    ]);
  });

  test('decomposes task plus explicit external concept explanation', () => {
    const result = classifyMemoryScenario({
      query: 'Continue the task and explain vector clocks',
      task_id: 'task-123',
    });

    expect(result.scenario).toBe('mixed');
    expect(result.decomposed_routes.map((route) => route.scenario)).toEqual([
      'coding_continuation',
      'knowledge_qa',
    ]);
  });

  test('decomposes resume implementation plus explicit external concept explanation', () => {
    const result = classifyMemoryScenario({
      query: 'Resume implementation and explain dependency injection',
      task_id: 'task-123',
    });

    expect(result.scenario).toBe('mixed');
    expect(result.decomposed_routes.map((route) => route.scenario)).toEqual([
      'coding_continuation',
      'knowledge_qa',
    ]);
  });

  test('keeps task-local explanation requests as coding continuation', () => {
    const result = classifyMemoryScenario({
      query: 'Continue implementation and explain failing tests',
      task_id: 'task-123',
      repo_path: '/repo/mbrain',
    });

    expect(result.scenario).toBe('coding_continuation');
    expect(result.decomposed_routes).toEqual([]);
  });

  test('keeps repeated task-local route test explanations as coding continuation', () => {
    const result = classifyMemoryScenario({
      query: 'Continue fixing failing route tests and explain failing route tests',
      task_id: 'task-123',
      repo_path: '/repo/mbrain',
    });

    expect(result.scenario).toBe('coding_continuation');
    expect(result.decomposed_routes).toEqual([]);
  });

  test('decomposes mixed coding plus explicit knowledge query', () => {
    const result = classifyMemoryScenario({
      query: 'What do we know about Pedro, and continue task-123?',
      task_id: 'task-123',
    });

    expect(result.scenario).toBe('mixed');
    expect(result.decomposed_routes.map((route) => route.scenario)).toEqual([
      'coding_continuation',
      'knowledge_qa',
    ]);
    expect(result.reason_codes).toContain('multiple_material_scenarios');
  });

  test('decomposes knowledge plus accumulation requests', () => {
    const result = classifyMemoryScenario({
      query: 'What do we know about Pedro? Capture durable memory candidates from this session.',
    });

    expect(result.scenario).toBe('mixed');
    expect(result.decomposed_routes.map((route) => route.scenario)).toEqual([
      'knowledge_qa',
      'auto_accumulation',
    ]);
    expect(result.reason_codes).toContain('multiple_material_scenarios');
  });

  test('returns low-confidence knowledge QA for generic ambiguous text', () => {
    const result = classifyMemoryScenario({
      query: 'What about this?',
    });

    expect(result.scenario).toBe('knowledge_qa');
    expect(result.confidence).toBe('low');
    expect(result.scope_decision).toBe('work');
    expect(result.reason_codes).toContain('fallback_knowledge_qa');
  });

  test('classifies Korean coding continuation phrasing', () => {
    const result = classifyMemoryScenario({
      query: '이어서 실패한 테스트 수정을 진행하세요',
      repo_path: '/repo/mbrain',
    });

    expect(result.scenario).toBe('coding_continuation');
    expect(result.confidence).toBe('high');
    expect(result.reason_codes).toContain('repo_path_present');
  });

  test('classifies Korean project architecture questions', () => {
    const result = classifyMemoryScenario({
      query: 'mbrain의 검색 라우팅 구조를 설명해 주세요',
      known_subjects: [{ ref: 'systems/mbrain', kind: 'system' }],
    });

    expect(result.scenario).toBe('project_qa');
    expect(result.scope_decision).toBe('work');
    expect(result.reason_codes).toContain('system_or_project_subject');
  });

  test('classifies Korean knowledge questions without project hints', () => {
    const result = classifyMemoryScenario({
      query: 'Pedro에 대해 무엇을 알고 있나요?',
    });

    expect(result.scenario).toBe('knowledge_qa');
    expect(result.reason_codes).toContain('knowledge_question_signal');
  });

  test('classifies Korean accumulation requests', () => {
    const result = classifyMemoryScenario({
      query: '이 세션에서 장기 기억 후보로 남길 것을 검토하세요',
      source_kind: 'chat',
    });

    expect(result.scenario).toBe('auto_accumulation');
    expect(result.reason_codes).toContain('accumulation_query_signal');
  });

  test('uses typed known subjects instead of project-specific slug heuristics', () => {
    const result = classifyMemoryScenario({
      query: '이 시스템의 설계 방향을 설명하세요',
      known_subjects: [{ ref: 'personal/mbrain/usage-priorities', kind: 'system' }],
    });

    expect(result.scenario).toBe('project_qa');
    expect(result.reason_codes).toContain('system_or_project_subject');
  });

  test('decomposes personal plus work requests and defers work-scoped personal access', () => {
    const result = classifyMemoryScenario({
      query: '내 선호를 참고해서 mbrain 구현 작업을 이어가세요',
      requested_scope: 'work',
      repo_path: '/repo/mbrain',
    });

    expect(result.scenario).toBe('mixed');
    expect(result.scope_decision).toBe('defer');
    expect(result.requires_user_clarification).toBe(true);
    expect(result.decomposed_routes.map((route) => route.scenario)).toEqual([
      'personal_recall',
      'coding_continuation',
    ]);
  });
});
