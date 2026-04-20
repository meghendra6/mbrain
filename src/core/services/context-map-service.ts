import { createHash } from 'crypto';
import type { BrainEngine } from '../engine.ts';
import type { ContextMapEntry, NoteManifestEntry, NoteSectionEntry } from '../types.ts';
import { buildStructuralGraphSnapshot } from './note-structural-graph-service.ts';
import { DEFAULT_NOTE_MANIFEST_SCOPE_ID } from './note-manifest-service.ts';

export const WORKSPACE_CONTEXT_MAP_KIND = 'workspace';
export const CONTEXT_MAP_BUILD_MODE = 'structural';
export const CONTEXT_MAP_EXTRACTOR_VERSION = 'phase2-context-map-v1';
export const WORKSPACE_CONTEXT_MAP_TITLE = 'Workspace Structural Map';

export function workspaceContextMapId(scopeId: string): string {
  return `context-map:workspace:${scopeId}`;
}

export async function buildStructuralContextMapEntry(
  engine: BrainEngine,
  scopeId = DEFAULT_NOTE_MANIFEST_SCOPE_ID,
): Promise<ContextMapEntry> {
  const [manifests, sections, snapshot] = await Promise.all([
    engine.listNoteManifestEntries({ scope_id: scopeId, limit: 10_000 }),
    engine.listNoteSectionEntries({ scope_id: scopeId, limit: 10_000 }),
    buildStructuralGraphSnapshot(engine, scopeId),
  ]);

  return engine.upsertContextMapEntry({
    id: workspaceContextMapId(scopeId),
    scope_id: scopeId,
    kind: WORKSPACE_CONTEXT_MAP_KIND,
    title: WORKSPACE_CONTEXT_MAP_TITLE,
    build_mode: CONTEXT_MAP_BUILD_MODE,
    status: 'ready',
    source_set_hash: hashSourceSet(manifests, sections),
    extractor_version: CONTEXT_MAP_EXTRACTOR_VERSION,
    node_count: snapshot.nodes.length,
    edge_count: snapshot.edges.length,
    community_count: 0,
    graph_json: {
      scope_id: snapshot.scope_id,
      nodes: snapshot.nodes,
      edges: snapshot.edges,
    },
    stale_reason: null,
  });
}

function hashSourceSet(
  manifests: NoteManifestEntry[],
  sections: NoteSectionEntry[],
): string {
  const payload = {
    manifests: manifests
      .map((entry) => ({
        slug: entry.slug,
        content_hash: entry.content_hash,
      }))
      .sort((left, right) => left.slug.localeCompare(right.slug)),
    sections: sections
      .map((entry) => ({
        section_id: entry.section_id,
        content_hash: entry.content_hash,
      }))
      .sort((left, right) => left.section_id.localeCompare(right.section_id)),
  };

  return createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex');
}
