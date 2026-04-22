import type { Operation } from './operations.ts';
import { advanceMemoryCandidateStatus, MemoryInboxServiceError } from './services/memory-inbox-service.ts';

type OperationErrorCtor = new (
  code: 'memory_candidate_not_found' | 'invalid_params',
  message: string,
  suggestion?: string,
  docs?: string,
) => Error;

export function createMemoryInboxOperations(
  deps: {
    defaultScopeId: string;
    OperationError: OperationErrorCtor;
  },
): Operation[] {
  const get_memory_candidate_entry: Operation = {
    name: 'get_memory_candidate_entry',
    description: 'Get one canonical memory-inbox candidate by id.',
    params: {
      id: { type: 'string', required: true, description: 'Memory candidate entry id' },
    },
    handler: async (ctx, p) => {
      return ctx.engine.getMemoryCandidateEntry(String(p.id));
    },
    cliHints: { name: 'get-memory-candidate' },
  };

  const list_memory_candidate_entries: Operation = {
    name: 'list_memory_candidate_entries',
    description: 'List canonical memory-inbox candidates.',
    params: {
      scope_id: { type: 'string', description: `Memory candidate scope id (default: ${deps.defaultScopeId})` },
      status: {
        type: 'string',
        description: 'Optional candidate status filter',
        enum: ['captured', 'candidate', 'staged_for_review', 'promoted', 'rejected', 'superseded'],
      },
      candidate_type: {
        type: 'string',
        description: 'Optional candidate type filter',
        enum: ['fact', 'relationship', 'note_update', 'procedure', 'profile_update', 'open_question', 'rationale'],
      },
      target_object_type: {
        type: 'string',
        description: 'Optional target object type filter',
        enum: ['curated_note', 'procedure', 'profile_memory', 'personal_episode', 'other'],
      },
      limit: { type: 'number', description: 'Max results (default 20)' },
      offset: { type: 'number', description: 'Offset for pagination (default 0)' },
    },
    handler: async (ctx, p) => {
      return ctx.engine.listMemoryCandidateEntries({
        scope_id: String(p.scope_id ?? deps.defaultScopeId),
        status: typeof p.status === 'string' ? p.status as any : undefined,
        candidate_type: typeof p.candidate_type === 'string' ? p.candidate_type as any : undefined,
        target_object_type: typeof p.target_object_type === 'string' ? p.target_object_type as any : undefined,
        limit: typeof p.limit === 'number' ? p.limit : 20,
        offset: typeof p.offset === 'number' ? p.offset : 0,
      });
    },
    cliHints: { name: 'list-memory-candidates', aliases: { n: 'limit' } },
  };

  const create_memory_candidate_entry: Operation = {
    name: 'create_memory_candidate_entry',
    description: 'Create one canonical memory-inbox candidate in captured state by default.',
    params: {
      id: { type: 'string', description: 'Optional memory candidate id (generated when omitted)' },
      scope_id: { type: 'string', description: `Memory candidate scope id (default: ${deps.defaultScopeId})` },
      candidate_type: {
        type: 'string',
        required: true,
        description: 'Memory candidate type',
        enum: ['fact', 'relationship', 'note_update', 'procedure', 'profile_update', 'open_question', 'rationale'],
      },
      proposed_content: { type: 'string', required: true, description: 'Candidate claim or proposed change content' },
      source_ref: { type: 'string', description: 'Optional single provenance string' },
      generated_by: {
        type: 'string',
        description: 'Candidate generation source',
        enum: ['agent', 'map_analysis', 'dream_cycle', 'manual', 'import'],
      },
      extraction_kind: {
        type: 'string',
        description: 'Candidate extraction kind',
        enum: ['extracted', 'inferred', 'ambiguous', 'manual'],
      },
      confidence_score: { type: 'number', description: 'Confidence score (default 0.5)' },
      importance_score: { type: 'number', description: 'Importance score (default 0.5)' },
      recurrence_score: { type: 'number', description: 'Recurrence score (default 0)' },
      sensitivity: {
        type: 'string',
        description: 'Candidate sensitivity',
        enum: ['public', 'work', 'personal', 'secret', 'unknown'],
      },
      status: {
        type: 'string',
        description: 'Initial candidate status (default captured)',
        enum: ['captured', 'candidate', 'staged_for_review', 'promoted', 'rejected', 'superseded'],
      },
      target_object_type: {
        type: 'string',
        description: 'Optional target object type',
        enum: ['curated_note', 'procedure', 'profile_memory', 'personal_episode', 'other'],
      },
      target_object_id: { type: 'string', description: 'Optional target object id' },
      reviewed_at: { type: 'string', description: 'Optional ISO timestamp for review metadata' },
      review_reason: { type: 'string', description: 'Optional review reason or audit note' },
    },
    mutating: true,
    handler: async (ctx, p) => {
      const id = typeof p.id === 'string' ? p.id : crypto.randomUUID();
      const scopeId = String(p.scope_id ?? deps.defaultScopeId);
      const status = String(p.status ?? 'captured');
      if (ctx.dryRun) {
        return {
          dry_run: true,
          action: 'create_memory_candidate_entry',
          id,
          scope_id: scopeId,
          candidate_type: p.candidate_type,
          status,
        };
      }

      return ctx.engine.createMemoryCandidateEntry({
        id,
        scope_id: scopeId,
        candidate_type: String(p.candidate_type) as any,
        proposed_content: String(p.proposed_content),
        source_refs: typeof p.source_ref === 'string' ? [p.source_ref] : [],
        generated_by: String(p.generated_by ?? 'manual') as any,
        extraction_kind: String(p.extraction_kind ?? 'manual') as any,
        confidence_score: typeof p.confidence_score === 'number' ? p.confidence_score : 0.5,
        importance_score: typeof p.importance_score === 'number' ? p.importance_score : 0.5,
        recurrence_score: typeof p.recurrence_score === 'number' ? p.recurrence_score : 0,
        sensitivity: String(p.sensitivity ?? 'work') as any,
        status: status as any,
        target_object_type: typeof p.target_object_type === 'string' ? p.target_object_type as any : null,
        target_object_id: typeof p.target_object_id === 'string' ? p.target_object_id : null,
        reviewed_at: typeof p.reviewed_at === 'string' ? p.reviewed_at : null,
        review_reason: typeof p.review_reason === 'string' ? p.review_reason : null,
      });
    },
    cliHints: { name: 'create-memory-candidate' },
  };

  const advance_memory_candidate_status: Operation = {
    name: 'advance_memory_candidate_status',
    description: 'Advance one memory-inbox candidate through the bounded early review lifecycle.',
    params: {
      id: { type: 'string', required: true, description: 'Memory candidate id' },
      next_status: {
        type: 'string',
        required: true,
        description: 'Next allowed candidate status',
        enum: ['candidate', 'staged_for_review'],
      },
      reviewed_at: { type: 'string', description: 'Optional ISO timestamp for review metadata' },
      review_reason: { type: 'string', description: 'Optional review reason or audit note' },
    },
    mutating: true,
    handler: async (ctx, p) => {
      if (ctx.dryRun) {
        return {
          dry_run: true,
          action: 'advance_memory_candidate_status',
          id: p.id,
          next_status: p.next_status,
        };
      }

      try {
        return await advanceMemoryCandidateStatus(ctx.engine, {
          id: String(p.id),
          next_status: String(p.next_status) as any,
          reviewed_at: typeof p.reviewed_at === 'string' ? p.reviewed_at : undefined,
          review_reason: typeof p.review_reason === 'string' ? p.review_reason : undefined,
        });
      } catch (error) {
        if (error instanceof MemoryInboxServiceError) {
          if (error.code === 'memory_candidate_not_found') {
            throw new deps.OperationError('memory_candidate_not_found', error.message);
          }
          throw new deps.OperationError('invalid_params', error.message);
        }
        throw error;
      }
    },
    cliHints: { name: 'advance-memory-candidate-status' },
  };

  return [
    get_memory_candidate_entry,
    list_memory_candidate_entries,
    create_memory_candidate_entry,
    advance_memory_candidate_status,
  ];
}
