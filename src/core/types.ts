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
