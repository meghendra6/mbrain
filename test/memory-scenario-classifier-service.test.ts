import { describe, expect, test } from 'bun:test';
import { classifyMemoryScenario } from '../src/core/services/memory-scenario-classifier-service.ts';

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
