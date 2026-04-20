import type { BrainEngine } from '../engine.ts';
import type { ContextAtlasEntry, ContextAtlasFilters, ContextMapEntry } from '../types.ts';
import {
  buildStructuralContextMapEntry,
  getStructuralContextMapEntry,
  WORKSPACE_CONTEXT_MAP_KIND,
  workspaceContextMapId,
} from './context-map-service.ts';
import { DEFAULT_NOTE_MANIFEST_SCOPE_ID } from './note-manifest-service.ts';

export const ATLAS_WORKSPACE_KIND = 'workspace';
export const ATLAS_ENTRYPOINT_LIMIT = 5;
export const ATLAS_DEFAULT_BUDGET_HINT = 6;

export function workspaceContextAtlasId(scopeId: string): string {
  return `context-atlas:workspace:${scopeId}`;
}

export async function buildStructuralContextAtlasEntry(
  engine: BrainEngine,
  scopeId = DEFAULT_NOTE_MANIFEST_SCOPE_ID,
): Promise<ContextAtlasEntry> {
  const mapId = workspaceContextMapId(scopeId);
  let mapEntry = await getStructuralContextMapEntry(engine, mapId);
  if (!mapEntry) {
    await buildStructuralContextMapEntry(engine, scopeId);
    mapEntry = await getStructuralContextMapEntry(engine, mapId);
  }
  if (!mapEntry) {
    throw new Error(`Context map entry not found for atlas build: ${mapId}`);
  }

  return engine.upsertContextAtlasEntry({
    id: workspaceContextAtlasId(scopeId),
    map_id: mapEntry.id,
    scope_id: scopeId,
    kind: ATLAS_WORKSPACE_KIND,
    title: 'Workspace Atlas',
    freshness: toAtlasFreshness(mapEntry),
    entrypoints: deriveEntryPoints(mapEntry),
    budget_hint: ATLAS_DEFAULT_BUDGET_HINT,
  });
}

export async function getStructuralContextAtlasEntry(
  engine: BrainEngine,
  id: string,
): Promise<ContextAtlasEntry | null> {
  const entry = await engine.getContextAtlasEntry(id);
  if (!entry) return null;
  return annotateAtlasFreshness(engine, entry);
}

export async function listStructuralContextAtlasEntries(
  engine: BrainEngine,
  filters?: ContextAtlasFilters,
): Promise<ContextAtlasEntry[]> {
  const entries = await engine.listContextAtlasEntries(filters);
  return Promise.all(entries.map((entry) => annotateAtlasFreshness(engine, entry)));
}

async function annotateAtlasFreshness(
  engine: BrainEngine,
  entry: ContextAtlasEntry,
): Promise<ContextAtlasEntry> {
  const mapEntry = await getStructuralContextMapEntry(engine, entry.map_id);
  if (!mapEntry) {
    return {
      ...entry,
      freshness: 'stale',
    };
  }

  return {
    ...entry,
    freshness: toAtlasFreshness(mapEntry),
  };
}

function toAtlasFreshness(entry: ContextMapEntry): string {
  return entry.status === 'ready' ? 'fresh' : 'stale';
}

function deriveEntryPoints(entry: ContextMapEntry): string[] {
  const graph = entry.graph_json as { nodes?: Array<{ node_id?: string; node_kind?: string }> };
  const nodes = graph.nodes ?? [];
  const pages = nodes
    .filter((node) => node.node_kind === 'page' && typeof node.node_id === 'string')
    .map((node) => String(node.node_id))
    .sort((left, right) => left.localeCompare(right))
    .slice(0, ATLAS_ENTRYPOINT_LIMIT);

  if (pages.length > 0) {
    return pages;
  }

  return nodes
    .filter((node) => typeof node.node_id === 'string')
    .map((node) => String(node.node_id))
    .sort((left, right) => left.localeCompare(right))
    .slice(0, ATLAS_ENTRYPOINT_LIMIT);
}
