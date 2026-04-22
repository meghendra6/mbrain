import type { BrainEngine } from '../engine.ts';
import type {
  PersonalEpisodeEntry,
  ProfileMemoryEntry,
  ScopeGateDecisionResult,
  ScopeGateScope,
} from '../types.ts';
import { DEFAULT_PERSONAL_EPISODE_SCOPE_ID } from './personal-episode-lookup-route-service.ts';
import { DEFAULT_PROFILE_MEMORY_SCOPE_ID } from './personal-profile-lookup-route-service.ts';
import { evaluateScopeGate } from './scope-gate-service.ts';

export interface PersonalExportPreviewInput {
  requested_scope?: Exclude<ScopeGateScope, 'unknown'>;
  query?: string;
  scope_id?: string;
}

export interface PersonalExportPreviewResult {
  selection_reason: string;
  scope_gate: ScopeGateDecisionResult;
  profile_memory_entries: ProfileMemoryEntry[];
  personal_episode_entries: PersonalEpisodeEntry[];
}

export async function previewPersonalExport(
  engine: BrainEngine,
  input: PersonalExportPreviewInput,
): Promise<PersonalExportPreviewResult> {
  const scopeGate = await evaluateScopeGate(engine, {
    intent: 'personal_profile_lookup',
    requested_scope: input.requested_scope,
    query: input.query,
  });

  if (scopeGate.policy !== 'allow') {
    return {
      selection_reason: scopeGate.decision_reason,
      scope_gate: scopeGate,
      profile_memory_entries: [],
      personal_episode_entries: [],
    };
  }

  const scopeId = input.scope_id ?? DEFAULT_PROFILE_MEMORY_SCOPE_ID;
  const entries = await listAllProfileMemoryEntries(engine, scopeId);
  const episodes = await listAllPersonalEpisodeEntries(
    engine,
    input.scope_id ?? DEFAULT_PERSONAL_EPISODE_SCOPE_ID,
  );

  return {
    selection_reason: 'direct_personal_export_preview',
    scope_gate: scopeGate,
    profile_memory_entries: entries.filter((entry) => entry.export_status === 'exportable' && entry.superseded_by == null),
    personal_episode_entries: episodes,
  };
}

async function listAllProfileMemoryEntries(
  engine: BrainEngine,
  scopeId: string,
  batchSize = 500,
): Promise<ProfileMemoryEntry[]> {
  const entries: ProfileMemoryEntry[] = [];

  for (let offset = 0; ; offset += batchSize) {
    const batch = await engine.listProfileMemoryEntries({
      scope_id: scopeId,
      limit: batchSize,
      offset,
    });
    entries.push(...batch);
    if (batch.length < batchSize) {
      break;
    }
  }

  return entries;
}

async function listAllPersonalEpisodeEntries(
  engine: BrainEngine,
  scopeId: string,
  batchSize = 500,
): Promise<PersonalEpisodeEntry[]> {
  const entries: PersonalEpisodeEntry[] = [];

  for (let offset = 0; ; offset += batchSize) {
    const batch = await engine.listPersonalEpisodeEntries({
      scope_id: scopeId,
      limit: batchSize,
      offset,
    });
    entries.push(...batch);
    if (batch.length < batchSize) {
      break;
    }
  }

  return entries;
}
