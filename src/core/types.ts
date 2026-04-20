// Page types
export type PageType =
  | 'person'
  | 'company'
  | 'deal'
  | 'yc'
  | 'civic'
  | 'project'
  | 'concept'
  | 'source'
  | 'media'
  | 'system';

export type ChunkSource = 'compiled_truth' | 'timeline' | 'frontmatter';

export interface CodemapPointer {
  path: string;
  symbol?: string;
  role: string;
  verified_at?: string;
  stale?: boolean;
}

export interface CodemapEntry {
  system: string;
  pointers: CodemapPointer[];
  vocabulary?: string;
}

export interface SystemEntryPoint {
  name: string;
  path: string;
  purpose: string;
}

export interface SystemFrontmatter {
  repo?: string;
  language?: string[];
  build_command?: string;
  test_command?: string;
  key_entry_points?: SystemEntryPoint[];
}

export interface Page {
  id: number;
  slug: string;
  type: PageType;
  title: string;
  compiled_truth: string;
  timeline: string;
  frontmatter: Record<string, unknown>;
  content_hash?: string;
  created_at: Date;
  updated_at: Date;
}

export interface PageInput {
  type: PageType;
  title: string;
  compiled_truth: string;
  timeline?: string;
  frontmatter?: Record<string, unknown>;
  content_hash?: string;
}

export interface PageFilters {
  type?: PageType;
  tag?: string;
  limit?: number;
  offset?: number;
}

export interface NoteManifestHeading {
  slug: string;
  text: string;
  depth: number;
  line_start: number;
}

export interface NoteManifestEntry {
  scope_id: string;
  page_id: number;
  slug: string;
  path: string;
  page_type: PageType;
  title: string;
  frontmatter: Record<string, unknown>;
  aliases: string[];
  tags: string[];
  outgoing_wikilinks: string[];
  outgoing_urls: string[];
  source_refs: string[];
  heading_index: NoteManifestHeading[];
  content_hash: string;
  extractor_version: string;
  last_indexed_at: Date;
}

export interface NoteManifestEntryInput {
  scope_id: string;
  page_id: number;
  slug: string;
  path: string;
  page_type: PageType;
  title: string;
  frontmatter: Record<string, unknown>;
  aliases: string[];
  tags: string[];
  outgoing_wikilinks: string[];
  outgoing_urls: string[];
  source_refs: string[];
  heading_index: NoteManifestHeading[];
  content_hash: string;
  extractor_version: string;
}

export interface NoteManifestFilters {
  scope_id?: string;
  slug?: string;
  limit?: number;
  offset?: number;
}

export interface NoteSectionEntry {
  scope_id: string;
  page_id: number;
  page_slug: string;
  page_path: string;
  section_id: string;
  parent_section_id: string | null;
  heading_slug: string;
  heading_path: string[];
  heading_text: string;
  depth: number;
  line_start: number;
  line_end: number;
  section_text: string;
  outgoing_wikilinks: string[];
  outgoing_urls: string[];
  source_refs: string[];
  content_hash: string;
  extractor_version: string;
  last_indexed_at: Date;
}

export interface NoteSectionEntryInput {
  scope_id: string;
  page_id: number;
  page_slug: string;
  page_path: string;
  section_id: string;
  parent_section_id: string | null;
  heading_slug: string;
  heading_path: string[];
  heading_text: string;
  depth: number;
  line_start: number;
  line_end: number;
  section_text: string;
  outgoing_wikilinks: string[];
  outgoing_urls: string[];
  source_refs: string[];
  content_hash: string;
  extractor_version: string;
}

export interface NoteSectionFilters {
  scope_id?: string;
  page_slug?: string;
  section_id?: string;
  limit?: number;
  offset?: number;
}

export interface ContextMapEntry {
  id: string;
  scope_id: string;
  kind: string;
  title: string;
  build_mode: string;
  status: string;
  source_set_hash: string;
  extractor_version: string;
  node_count: number;
  edge_count: number;
  community_count: number;
  graph_json: Record<string, unknown>;
  generated_at: Date;
  stale_reason: string | null;
}

export interface ContextMapEntryInput {
  id: string;
  scope_id: string;
  kind: string;
  title: string;
  build_mode: string;
  status: string;
  source_set_hash: string;
  extractor_version: string;
  node_count: number;
  edge_count: number;
  community_count?: number;
  graph_json: Record<string, unknown>;
  stale_reason?: string | null;
}

export interface ContextMapFilters {
  scope_id?: string;
  kind?: string;
  limit?: number;
}

export interface ContextAtlasEntry {
  id: string;
  map_id: string;
  scope_id: string;
  kind: string;
  title: string;
  freshness: string;
  entrypoints: string[];
  budget_hint: number;
  generated_at: Date;
}

export interface ContextAtlasEntryInput {
  id: string;
  map_id: string;
  scope_id: string;
  kind: string;
  title: string;
  freshness: string;
  entrypoints: string[];
  budget_hint: number;
}

export interface ContextAtlasFilters {
  scope_id?: string;
  kind?: string;
  limit?: number;
}

export interface ContextAtlasSelectionInput {
  scope_id?: string;
  kind?: string;
  max_budget_hint?: number;
  allow_stale?: boolean;
}

export interface ContextAtlasSelection {
  entry: ContextAtlasEntry | null;
  reason: string;
  candidate_count: number;
}

export interface ContextAtlasOverviewInput extends ContextAtlasSelectionInput {
  atlas_id?: string;
}

export interface ContextAtlasOverviewRead {
  node_id: string;
  node_kind: 'page' | 'section';
  label: string;
  page_slug: string;
  path: string;
  section_id?: string;
}

export interface ContextAtlasOverviewArtifact {
  overview_kind: 'structural';
  entry: ContextAtlasEntry;
  recommended_reads: ContextAtlasOverviewRead[];
}

export interface ContextAtlasOverviewResult {
  selection_reason: string;
  candidate_count: number;
  overview: ContextAtlasOverviewArtifact | null;
}

export interface ContextAtlasReport {
  report_kind: 'structural';
  title: string;
  entry_id: string;
  freshness: string;
  summary_lines: string[];
  recommended_reads: ContextAtlasOverviewRead[];
}

export interface ContextAtlasReportResult {
  selection_reason: string;
  candidate_count: number;
  report: ContextAtlasReport | null;
}

export interface ContextMapReportRead {
  node_id: string;
  node_kind: 'page' | 'section';
  label: string;
  page_slug: string;
  path: string;
  section_id?: string;
}

export interface ContextMapReport {
  report_kind: 'structural';
  title: string;
  map_id: string;
  status: string;
  summary_lines: string[];
  recommended_reads: ContextMapReportRead[];
}

export interface ContextMapReportInput {
  map_id?: string;
  scope_id?: string;
  kind?: string;
}

export interface ContextMapReportResult {
  selection_reason: string;
  candidate_count: number;
  report: ContextMapReport | null;
}

export interface WorkspaceSystemCard {
  card_kind: 'workspace_system';
  system_slug: string;
  title: string;
  repo?: string;
  build_command?: string;
  test_command?: string;
  entry_points: SystemEntryPoint[];
  summary_lines: string[];
}

export interface WorkspaceSystemCardInput {
  map_id?: string;
  scope_id?: string;
  kind?: string;
}

export interface WorkspaceSystemCardResult {
  selection_reason: string;
  candidate_count: number;
  card: WorkspaceSystemCard | null;
}

export interface WorkspaceProjectCard {
  card_kind: 'workspace_project';
  project_slug: string;
  title: string;
  path: string;
  repo?: string;
  status?: string;
  related_systems: string[];
  summary_lines: string[];
}

export interface WorkspaceProjectCardInput {
  map_id?: string;
  scope_id?: string;
  kind?: string;
}

export interface WorkspaceProjectCardResult {
  selection_reason: string;
  candidate_count: number;
  card: WorkspaceProjectCard | null;
}

// Chunks
export interface Chunk {
  id: number;
  page_id: number;
  chunk_index: number;
  chunk_text: string;
  chunk_source: ChunkSource;
  embedding: Float32Array | null;
  model: string;
  token_count: number | null;
  embedded_at: Date | null;
}

export interface ChunkInput {
  chunk_index: number;
  chunk_text: string;
  chunk_source: ChunkSource;
  embedding?: Float32Array;
  model?: string;
  token_count?: number;
}

// Search
export interface SearchResult {
  slug: string;
  page_id: number;
  title: string;
  type: PageType;
  chunk_text: string;
  chunk_source: ChunkSource;
  score: number;
  stale: boolean;
}

export interface SearchOpts {
  limit?: number;
  type?: PageType;
  exclude_slugs?: string[];
}

// Links
export interface Link {
  from_slug: string;
  to_slug: string;
  link_type: string;
  context: string;
}

export interface GraphNode {
  slug: string;
  title: string;
  type: PageType;
  depth: number;
  links: { to_slug: string; link_type: string }[];
}

// Timeline
export interface TimelineEntry {
  id: number;
  page_id: number;
  date: string;
  source: string;
  summary: string;
  detail: string;
  created_at: Date;
}

export interface TimelineInput {
  date: string;
  source?: string;
  summary: string;
  detail?: string;
}

export interface TimelineOpts {
  limit?: number;
  after?: string;
  before?: string;
}

// Raw data
export interface RawData {
  source: string;
  data: Record<string, unknown>;
  fetched_at: Date;
}

// Versions
export interface PageVersion {
  id: number;
  page_id: number;
  compiled_truth: string;
  frontmatter: Record<string, unknown>;
  snapshot_at: Date;
}

// Stats + Health
export interface BrainStats {
  page_count: number;
  chunk_count: number;
  embedded_count: number;
  link_count: number;
  tag_count: number;
  timeline_entry_count: number;
  pages_by_type: Record<string, number>;
}

export interface BrainHealth {
  page_count: number;
  embed_coverage: number;
  stale_pages: number;
  orphan_pages: number;
  dead_links: number;
  missing_embeddings: number;
}

// Ingest log
export interface IngestLogEntry {
  id: number;
  source_type: string;
  source_ref: string;
  pages_updated: string[];
  summary: string;
  created_at: Date;
}

export interface IngestLogInput {
  source_type: string;
  source_ref: string;
  pages_updated: string[];
  summary: string;
}

// Config
export interface EngineConfig {
  database_url?: string;
  database_path?: string;
  engine?: 'postgres' | 'sqlite' | 'pglite';
  poolSize?: number;
}

// Operational memory
export type TaskScope = 'work' | 'personal' | 'mixed';
export type TaskStatus = 'active' | 'paused' | 'blocked' | 'completed' | 'abandoned';
export type AttemptOutcome = 'failed' | 'partial' | 'succeeded' | 'abandoned';

export interface TaskThread {
  id: string;
  scope: TaskScope;
  title: string;
  goal: string;
  status: TaskStatus;
  repo_path: string | null;
  branch_name: string | null;
  current_summary: string;
  created_at: Date;
  updated_at: Date;
}

export interface TaskThreadInput {
  id: string;
  scope: TaskScope;
  title: string;
  goal?: string;
  status: TaskStatus;
  repo_path?: string | null;
  branch_name?: string | null;
  current_summary?: string;
}

export interface TaskThreadPatch {
  scope?: TaskScope;
  title?: string;
  goal?: string;
  status?: TaskStatus;
  repo_path?: string | null;
  branch_name?: string | null;
  current_summary?: string;
}

export interface TaskThreadFilters {
  scope?: TaskScope;
  status?: TaskStatus;
  limit?: number;
}

export interface TaskWorkingSet {
  task_id: string;
  active_paths: string[];
  active_symbols: string[];
  blockers: string[];
  open_questions: string[];
  next_steps: string[];
  verification_notes: string[];
  last_verified_at: Date | null;
  updated_at: Date;
}

export interface TaskWorkingSetInput {
  task_id: string;
  active_paths: string[];
  active_symbols: string[];
  blockers: string[];
  open_questions: string[];
  next_steps: string[];
  verification_notes: string[];
  last_verified_at?: Date | string | null;
}

export interface TaskAttempt {
  id: string;
  task_id: string;
  summary: string;
  outcome: AttemptOutcome;
  applicability_context: Record<string, unknown>;
  evidence: string[];
  created_at: Date;
}

export interface TaskAttemptInput {
  id: string;
  task_id: string;
  summary: string;
  outcome: AttemptOutcome;
  applicability_context?: Record<string, unknown>;
  evidence?: string[];
}

export interface TaskDecision {
  id: string;
  task_id: string;
  summary: string;
  rationale: string;
  consequences: string[];
  validity_context: Record<string, unknown>;
  created_at: Date;
}

export interface TaskDecisionInput {
  id: string;
  task_id: string;
  summary: string;
  rationale: string;
  consequences?: string[];
  validity_context?: Record<string, unknown>;
}

export interface RetrievalTrace {
  id: string;
  task_id: string | null;
  scope: TaskScope;
  route: string[];
  source_refs: string[];
  verification: string[];
  outcome: string;
  created_at: Date;
}

export interface RetrievalTraceInput {
  id: string;
  task_id?: string | null;
  scope: TaskScope;
  route?: string[];
  source_refs?: string[];
  verification?: string[];
  outcome: string;
}

// Errors
export class MBrainError extends Error {
  constructor(
    public problem: string,
    public cause_description: string,
    public fix: string,
    public docs_url?: string,
  ) {
    super(`${problem}: ${cause_description}. Fix: ${fix}`);
    this.name = 'MBrainError';
  }
}
