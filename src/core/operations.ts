/**
 * Contract-first operation definitions. Single source of truth for CLI, MCP, and tools-json.
 * Each operation defines its schema, handler, and optional CLI hints.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { BrainEngine } from './engine.ts';
import type { MBrainConfig } from './config.ts';
import { importFromContent } from './import-file.ts';
import { serializeMarkdown } from './markdown.ts';
import { hybridSearch } from './search/hybrid.ts';
import { expandQuery } from './search/expansion.ts';
import { buildTaskResumeCard } from './services/task-memory-service.ts';
import * as db from './db.ts';
import { getUnsupportedCapabilityReason } from './offline-profile.ts';

// --- MCP server instructions ---
//
// Returned to MCP clients in the `instructions` field of `InitializeResult`.
// Clients render this near the top of the agent's system prompt, so agents see
// it before they decide which tools to call. See docs/MCP_INSTRUCTIONS.md and
// docs/rfcs/2026-04-16-mcp-server-instructions-rfc.md for the design rationale.
export const MCP_INSTRUCTIONS = [
  'Use this server to look up knowledge about people, companies, technical concepts, internal systems, and organizational context. Prefer this over web search or codebase grep when the question involves a named entity, domain concept, or cross-system architecture. The brain contains compiled truth, relationship history, and technical maps that external search cannot provide.',
  'Do not use for: code editing, git operations, file management, library documentation, or general programming.',
].join('\n\n');

// --- Types ---

export type ErrorCode =
  | 'page_not_found'
  | 'task_not_found'
  | 'invalid_params'
  | 'embedding_failed'
  | 'storage_error'
  | 'bucket_not_found'
  | 'database_error'
  | 'unsupported_capability';

export class OperationError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public suggestion?: string,
    public docs?: string,
  ) {
    super(message);
    this.name = 'OperationError';
  }

  toJSON() {
    return {
      error: this.code,
      message: this.message,
      suggestion: this.suggestion,
      docs: this.docs,
    };
  }
}

export interface ParamDef {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required?: boolean;
  description?: string;
  default?: unknown;
  enum?: string[];
  items?: ParamDef;
}

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export interface OperationContext {
  engine: BrainEngine;
  config: MBrainConfig;
  logger: Logger;
  dryRun: boolean;
}

export interface Operation {
  name: string;
  description: string;
  params: Record<string, ParamDef>;
  handler: (ctx: OperationContext, params: Record<string, unknown>) => Promise<unknown>;
  mutating?: boolean;
  cliHints?: {
    name?: string;
    positional?: string[];
    stdin?: string;
    hidden?: boolean;
    aliases?: Record<string, string>;
  };
}

export interface ParseOpArgsOptions {
  warn?: (msg: string) => void;
  stdin?: {
    isTTY: boolean;
    read: () => string;
  };
}

function splitEquals(raw: string): { token: string; inlineValue?: string } {
  const eq = raw.indexOf('=');
  if (eq === -1) return { token: raw };
  return { token: raw.slice(0, eq), inlineValue: raw.slice(eq + 1) };
}

function coerceNumber(key: string, raw: string): number {
  const n = Number(raw);
  if (Number.isNaN(n)) {
    throw new Error(`Invalid number for --${key.replace(/_/g, '-')}: "${raw}"`);
  }
  return n;
}

export function parseOpArgs(
  op: Pick<Operation, 'params' | 'cliHints'>,
  args: string[],
  options: ParseOpArgsOptions = {},
): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  const positional = op.cliHints?.positional || [];
  const aliases = op.cliHints?.aliases || {};
  const warn = options.warn ?? ((msg: string) => console.error(`Warning: ${msg}`));
  const stdin = options.stdin ?? {
    isTTY: process.stdin.isTTY,
    read: () => readFileSync('/dev/stdin', 'utf-8'),
  };
  let posIdx = 0;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg.startsWith('--') && arg.length > 2) {
      const { token, inlineValue } = splitEquals(arg.slice(2));
      const key = token.replace(/-/g, '_');
      const paramDef = op.params[key];
      if (!paramDef) {
        warn(`unknown flag --${token} (ignored)`);
        if (inlineValue === undefined && i + 1 < args.length && !args[i + 1].startsWith('-')) i++;
        continue;
      }
      if (paramDef.type === 'boolean') {
        params[key] = inlineValue === undefined ? true : inlineValue !== 'false';
        continue;
      }
      let value: string | undefined = inlineValue;
      if (value === undefined) {
        if (i + 1 >= args.length) {
          warn(`--${token} expects a value`);
          continue;
        }
        value = args[++i];
      }
      params[key] = paramDef.type === 'number' ? coerceNumber(key, value) : value;
      continue;
    }

    if (arg.startsWith('-') && arg.length > 1 && arg !== '--') {
      const { token, inlineValue } = splitEquals(arg.slice(1));
      const key = aliases[token];
      if (!key) {
        warn(`unknown flag -${token} (ignored)`);
        if (inlineValue === undefined && i + 1 < args.length && !args[i + 1].startsWith('-')) i++;
        continue;
      }
      const paramDef = op.params[key];
      if (paramDef?.type === 'boolean') {
        params[key] = inlineValue === undefined ? true : inlineValue !== 'false';
        continue;
      }
      let value: string | undefined = inlineValue;
      if (value === undefined) {
        if (i + 1 >= args.length) {
          warn(`-${token} expects a value`);
          continue;
        }
        value = args[++i];
      }
      params[key] = paramDef?.type === 'number' ? coerceNumber(key, value) : value;
      continue;
    }

    if (posIdx < positional.length) {
      const key = positional[posIdx++];
      const paramDef = op.params[key];
      params[key] = paramDef?.type === 'number' ? coerceNumber(key, arg) : arg;
    }
  }

  if (op.cliHints?.stdin && !params[op.cliHints.stdin] && !stdin.isTTY) {
    params[op.cliHints.stdin] = stdin.read();
  }

  return params;
}

export function getMissingRequiredParams(
  op: Pick<Operation, 'params'>,
  params: Record<string, unknown>,
): string[] {
  return Object.entries(op.params)
    .filter(([, def]) => def.required)
    .filter(([key]) => params[key] === undefined)
    .map(([key]) => key);
}

export function formatOpUsage(op: Pick<Operation, 'name' | 'cliHints'>): string {
  const positional = (op.cliHints?.positional || []).map(p => `<${p}>`).join(' ');
  const name = op.cliHints?.name || op.name;
  return `Usage: mbrain ${name}${positional ? ` ${positional}` : ''}`;
}

export function formatOpHelp(op: Pick<Operation, 'name' | 'description' | 'params' | 'cliHints'>): string {
  const lines = [`${formatOpUsage(op)} [options]`, '', op.description, ''];
  const entries = Object.entries(op.params);
  if (entries.length > 0) {
    lines.push('Options:');
    for (const [key, def] of entries) {
      const isPos = op.cliHints?.positional?.includes(key);
      const req = def.required ? ' (required)' : '';
      const prefix = isPos ? `  <${key}>` : `  --${key.replace(/_/g, '-')}`;
      lines.push(`${prefix.padEnd(28)} ${def.description || ''}${req}`.trimEnd());
    }
  }
  return lines.join('\n') + '\n';
}

export function formatResult(
  opName: string,
  result: unknown,
  params: Record<string, unknown> = {},
): string {
  switch (opName) {
    case 'get_page': {
      const r = result as any;
      if (r.error === 'ambiguous_slug') {
        return `Ambiguous slug. Did you mean:\n${r.candidates.map((c: string) => `  ${c}`).join('\n')}\n`;
      }
      return serializeMarkdown(r.frontmatter || {}, r.compiled_truth || '', r.timeline || '', {
        type: r.type, title: r.title, tags: r.tags || [],
      });
    }
    case 'list_pages': {
      const pages = result as any[];
      if (pages.length === 0) return 'No pages found.\n';
      const rows = pages.map(p =>
        `${p.slug}\t${p.type}\t${p.updated_at?.toString().slice(0, 10) || '?'}\t${p.title}`,
      ).join('\n') + '\n';
      const requestedLimit = (params.limit as number) ?? 50;
      if (pages.length >= requestedLimit) {
        return rows + `\n(result may be truncated at ${requestedLimit}; pass --limit N or -n N to change)\n`;
      }
      return rows;
    }
    case 'list_tasks': {
      const tasks = result as any[];
      if (tasks.length === 0) return 'No tasks.\n';
      const rows = tasks.map(task =>
        `${task.id}\t${task.status}\t${task.scope}\t${task.title}`,
      ).join('\n') + '\n';
      const requestedLimit = (params.limit as number) ?? 20;
      if (tasks.length >= requestedLimit) {
        return rows + `\n(result may be truncated at ${requestedLimit}; pass --limit N or -n N to change)\n`;
      }
      return rows;
    }
    case 'list_task_traces': {
      const traces = result as any[];
      if (traces.length === 0) return 'No traces.\n';
      const rows = traces.map(trace =>
        `${trace.id}\t${trace.created_at?.toString().slice(0, 19) || '?'}\t${(trace.route || []).join(' -> ')}\t${trace.outcome}`,
      ).join('\n') + '\n';
      const requestedLimit = (params.limit as number) ?? 10;
      if (traces.length >= requestedLimit) {
        return rows + `\n(result may be truncated at ${requestedLimit}; pass --limit N or -n N to change)\n`;
      }
      return rows;
    }
    case 'list_task_attempts': {
      const attempts = result as any[];
      if (attempts.length === 0) return 'No attempts.\n';
      const rows = attempts.map(attempt =>
        `${attempt.id}\t${attempt.outcome}\t${attempt.created_at?.toString().slice(0, 19) || '?'}\t${attempt.summary}`,
      ).join('\n') + '\n';
      const requestedLimit = (params.limit as number) ?? 10;
      if (attempts.length >= requestedLimit) {
        return rows + `\n(result may be truncated at ${requestedLimit}; pass --limit N or -n N to change)\n`;
      }
      return rows;
    }
    case 'list_task_decisions': {
      const decisions = result as any[];
      if (decisions.length === 0) return 'No decisions.\n';
      const rows = decisions.map(decision =>
        `${decision.id}\t${decision.created_at?.toString().slice(0, 19) || '?'}\t${decision.summary}\t${decision.rationale}`,
      ).join('\n') + '\n';
      const requestedLimit = (params.limit as number) ?? 10;
      if (decisions.length >= requestedLimit) {
        return rows + `\n(result may be truncated at ${requestedLimit}; pass --limit N or -n N to change)\n`;
      }
      return rows;
    }
    case 'search':
    case 'query': {
      const results = result as any[];
      if (results.length === 0) return 'No results.\n';
      return results.map(r =>
        `[${r.score?.toFixed(4) || '?'}] ${r.slug} -- ${r.chunk_text?.slice(0, 100) || ''}${r.stale ? ' (stale)' : ''}`,
      ).join('\n') + '\n';
    }
    case 'get_tags': {
      const tags = result as string[];
      return tags.length > 0 ? tags.join(', ') + '\n' : 'No tags.\n';
    }
    case 'get_stats': {
      const s = result as any;
      const lines = [
        `Pages:     ${s.page_count}`,
        `Chunks:    ${s.chunk_count}`,
        `Embedded:  ${s.embedded_count}`,
        `Links:     ${s.link_count}`,
        `Tags:      ${s.tag_count}`,
        `Timeline:  ${s.timeline_entry_count}`,
      ];
      if (s.pages_by_type) {
        lines.push('', 'By type:');
        for (const [k, v] of Object.entries(s.pages_by_type)) {
          lines.push(`  ${k}: ${v}`);
        }
      }
      return lines.join('\n') + '\n';
    }
    case 'get_health': {
      const h = result as any;
      const score = Math.max(0, 10
        - (h.missing_embeddings > 0 ? 2 : 0)
        - (h.stale_pages > 0 ? 1 : 0)
        - (h.dead_links > 0 ? 1 : 0)
        - (h.orphan_pages > 0 ? 1 : 0));
      return [
        `Health score: ${score}/10`,
        `Embed coverage: ${(h.embed_coverage * 100).toFixed(1)}%`,
        `Missing embeddings: ${h.missing_embeddings}`,
        `Stale pages: ${h.stale_pages}`,
        `Orphan pages: ${h.orphan_pages}`,
        `Dead links: ${h.dead_links}`,
      ].join('\n') + '\n';
    }
    case 'get_timeline': {
      const entries = result as any[];
      if (entries.length === 0) return 'No timeline entries.\n';
      return entries.map(e =>
        `${e.date}  ${e.summary}${e.source ? ` [${e.source}]` : ''}`,
      ).join('\n') + '\n';
    }
    case 'get_versions': {
      const versions = result as any[];
      if (versions.length === 0) return 'No versions.\n';
      return versions.map(v =>
        `#${v.id}  ${v.snapshot_at?.toString().slice(0, 19) || '?'}  ${v.compiled_truth?.slice(0, 60) || ''}...`,
      ).join('\n') + '\n';
    }
    case 'sync_brain': {
      const sync = result as any;
      switch (sync.status) {
        case 'up_to_date':
          return 'Already up to date.\n';
        case 'synced':
          return [
            `Synced ${sync.fromCommit?.slice(0, 8)}..${sync.toCommit.slice(0, 8)}:`,
            `  +${sync.added} added, ~${sync.modified} modified, -${sync.deleted} deleted, R${sync.renamed} renamed`,
            `  ${sync.chunksCreated} chunks created`,
          ].join('\n') + '\n';
        case 'first_sync':
          return `First sync complete. Checkpoint: ${sync.toCommit.slice(0, 8)}\n`;
        case 'dry_run':
          return '';
      }
      return JSON.stringify(result, null, 2) + '\n';
    }
    case 'resume_task': {
      const resume = result as any;
      return [
        `${resume.title} [${resume.status}]`,
        `Goal: ${resume.goal}`,
        `Summary: ${resume.current_summary}`,
        `Active paths: ${(resume.active_paths || []).join(', ') || 'none'}`,
        `Active symbols: ${(resume.active_symbols || []).join(', ') || 'none'}`,
        `Blockers: ${(resume.blockers || []).join(', ') || 'none'}`,
        `Open questions: ${(resume.open_questions || []).join(', ') || 'none'}`,
        `Next steps: ${(resume.next_steps || []).join(', ') || 'none'}`,
        `Failed attempts: ${(resume.failed_attempts || []).join(', ') || 'none'}`,
        `Decisions: ${(resume.active_decisions || []).join(', ') || 'none'}`,
        `Latest trace route: ${(resume.latest_trace_route || []).join(' -> ') || 'none'}`,
        `State: ${resume.stale ? 'stale' : 'fresh'}`,
      ].join('\n') + '\n';
    }
    case 'get_task_working_set': {
      const state = result as any;
      const task = state.thread;
      const workingSet = state.working_set;
      return [
        `${task.title} [${task.status}]`,
        `Scope: ${task.scope}`,
        `Goal: ${task.goal}`,
        `Summary: ${task.current_summary}`,
        `Active paths: ${(workingSet?.active_paths || []).join(', ') || 'none'}`,
        `Active symbols: ${(workingSet?.active_symbols || []).join(', ') || 'none'}`,
        `Blockers: ${(workingSet?.blockers || []).join(', ') || 'none'}`,
        `Open questions: ${(workingSet?.open_questions || []).join(', ') || 'none'}`,
        `Next steps: ${(workingSet?.next_steps || []).join(', ') || 'none'}`,
        `Verification notes: ${(workingSet?.verification_notes || []).join(', ') || 'none'}`,
        `Last verified: ${workingSet?.last_verified_at ? new Date(workingSet.last_verified_at).toISOString() : 'never'}`,
      ].join('\n') + '\n';
    }
    default:
      return JSON.stringify(result, null, 2) + '\n';
  }
}

function parseStringListParam(value: unknown, key: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }
  if (typeof value !== 'string') {
    throw new OperationError('invalid_params', `${key} must be an array or string list.`);
  }

  const trimmed = value.trim();
  if (trimmed === '') return [];

  if (trimmed.startsWith('[')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new OperationError('invalid_params', `${key} must be valid JSON when passed as an array string.`);
    }
    if (!Array.isArray(parsed)) {
      throw new OperationError('invalid_params', `${key} JSON value must be an array.`);
    }
    return parsed.map((item) => String(item));
  }

  return trimmed
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseOptionalDateParam(value: unknown, key: string): Date | undefined {
  if (value === undefined) return undefined;
  if (value instanceof Date) return value;
  if (typeof value !== 'string') {
    throw new OperationError('invalid_params', `${key} must be an ISO datetime string.`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new OperationError('invalid_params', `${key} must be a valid ISO datetime string.`);
  }
  return parsed;
}

async function requireTaskThread(engine: BrainEngine, taskId: string) {
  const thread = await engine.getTaskThread(taskId);
  if (!thread) {
    throw new OperationError('task_not_found', `Task thread not found: ${taskId}`, 'Check the task id or create the task first.');
  }
  return thread;
}

const runtimeImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<any>;

// --- Page CRUD ---

const get_page: Operation = {
  name: 'get_page',
  description: 'Read a specific knowledge page by slug. Use after search or query returns a relevant slug. Pages contain compiled truth (current understanding) and timeline (evidence history).',
  params: {
    slug: { type: 'string', required: true, description: 'Page slug' },
    fuzzy: { type: 'boolean', description: 'Enable fuzzy slug resolution (default: false)' },
  },
  handler: async (ctx, p) => {
    const slug = p.slug as string;
    const fuzzy = (p.fuzzy as boolean) || false;

    let page = await ctx.engine.getPage(slug);
    let resolved_slug: string | undefined;

    if (!page && fuzzy) {
      const candidates = await ctx.engine.resolveSlugs(slug);
      if (candidates.length === 1) {
        page = await ctx.engine.getPage(candidates[0]);
        resolved_slug = candidates[0];
      } else if (candidates.length > 1) {
        return { error: 'ambiguous_slug', candidates };
      }
    }

    if (!page) {
      throw new OperationError('page_not_found', `Page not found: ${slug}`, 'Check the slug or use fuzzy: true');
    }

    const tags = await ctx.engine.getTags(page.slug);
    return { ...page, tags, ...(resolved_slug ? { resolved_slug } : {}) };
  },
  cliHints: { name: 'get', positional: ['slug'] },
};

const put_page: Operation = {
  name: 'put_page',
  description: 'Create or update a knowledge page to record new information about people, companies, concepts, or systems discovered during the conversation. Markdown with YAML frontmatter; content should follow the compiled truth + timeline pattern. Chunks, embeds, and reconciles tags.',
  params: {
    slug: { type: 'string', required: true, description: 'Page slug' },
    content: { type: 'string', required: true, description: 'Full markdown content with YAML frontmatter' },
  },
  mutating: true,
  handler: async (ctx, p) => {
    if (ctx.dryRun) return { dry_run: true, action: 'put_page', slug: p.slug };
    const result = await importFromContent(ctx.engine, p.slug as string, p.content as string);
    return { slug: result.slug, status: result.status === 'imported' ? 'created_or_updated' : result.status, chunks: result.chunks };
  },
  cliHints: { name: 'put', positional: ['slug'], stdin: 'content' },
};

const delete_page: Operation = {
  name: 'delete_page',
  description: 'Delete a page',
  params: {
    slug: { type: 'string', required: true },
  },
  mutating: true,
  handler: async (ctx, p) => {
    if (ctx.dryRun) return { dry_run: true, action: 'delete_page', slug: p.slug };
    await ctx.engine.deletePage(p.slug as string);
    return { status: 'deleted' };
  },
  cliHints: { name: 'delete', positional: ['slug'] },
};

const list_pages: Operation = {
  name: 'list_pages',
  description: 'List pages with optional filters',
  params: {
    type: { type: 'string', description: 'Filter by page type' },
    tag: { type: 'string', description: 'Filter by tag' },
    limit: { type: 'number', description: 'Max results (default 50)' },
  },
  handler: async (ctx, p) => {
    const pages = await ctx.engine.listPages({
      type: p.type as any,
      tag: p.tag as string,
      limit: (p.limit as number) ?? 50,
    });
    return pages.map(pg => ({
      slug: pg.slug,
      type: pg.type,
      title: pg.title,
      updated_at: pg.updated_at,
    }));
  },
  cliHints: { name: 'list', aliases: { n: 'limit' } },
};

// --- Search ---

const search: Operation = {
  name: 'search',
  description: 'Search the knowledge graph for people, companies, concepts, systems, and organizational context by keyword. Use this BEFORE Grep or WebSearch when the question involves a named entity or domain-specific topic. Returns matching pages with relevance scores.',
  params: {
    query: { type: 'string', required: true },
    limit: { type: 'number', description: 'Max results (default 20)' },
  },
  handler: async (ctx, p) => {
    return ctx.engine.searchKeyword(p.query as string, { limit: (p.limit as number) ?? 20 });
  },
  cliHints: { name: 'search', positional: ['query'] },
};

const query: Operation = {
  name: 'query',
  description: 'Semantic search across the knowledge graph. Use when the question is conceptual, cross-cutting, or when keyword search returned no results. Combines vector similarity with keyword matching and multi-query expansion for best recall.',
  params: {
    query: { type: 'string', required: true },
    limit: { type: 'number', description: 'Max results (default 20)' },
    expand: { type: 'boolean', description: 'Enable multi-query expansion (default: true)' },
  },
  handler: async (ctx, p) => {
    const expand = p.expand !== false;
    return hybridSearch(ctx.engine, p.query as string, {
      limit: (p.limit as number) ?? 20,
      expansion: expand,
      expandFn: expand ? (query) => expandQuery(query, { config: ctx.config }) : undefined,
    });
  },
  cliHints: { name: 'query', positional: ['query'] },
};

// --- Tags ---

const add_tag: Operation = {
  name: 'add_tag',
  description: 'Add tag to page',
  params: {
    slug: { type: 'string', required: true },
    tag: { type: 'string', required: true },
  },
  mutating: true,
  handler: async (ctx, p) => {
    if (ctx.dryRun) return { dry_run: true, action: 'add_tag', slug: p.slug, tag: p.tag };
    await ctx.engine.addTag(p.slug as string, p.tag as string);
    return { status: 'ok' };
  },
  cliHints: { name: 'tag', positional: ['slug', 'tag'] },
};

const remove_tag: Operation = {
  name: 'remove_tag',
  description: 'Remove tag from page',
  params: {
    slug: { type: 'string', required: true },
    tag: { type: 'string', required: true },
  },
  mutating: true,
  handler: async (ctx, p) => {
    if (ctx.dryRun) return { dry_run: true, action: 'remove_tag', slug: p.slug, tag: p.tag };
    await ctx.engine.removeTag(p.slug as string, p.tag as string);
    return { status: 'ok' };
  },
  cliHints: { name: 'untag', positional: ['slug', 'tag'] },
};

const get_tags: Operation = {
  name: 'get_tags',
  description: 'List tags for a page',
  params: {
    slug: { type: 'string', required: true },
  },
  handler: async (ctx, p) => {
    return ctx.engine.getTags(p.slug as string);
  },
  cliHints: { name: 'tags', positional: ['slug'] },
};

// --- Links ---

const add_link: Operation = {
  name: 'add_link',
  description: 'Create a typed link between two pages in the knowledge graph. Use to connect entities and technical concepts: people/companies (invested_in, works_at, founded), or systems/concepts (implements, depends_on, extends, contradicts, layer_of, prerequisite_for). Links are bidirectional in traversal and power cross-system navigation.',
  params: {
    from: { type: 'string', required: true },
    to: { type: 'string', required: true },
    link_type: { type: 'string', description: 'Link type. People/deal: invested_in, works_at, founded, mentioned_in. Technical: implements, depends_on, extends, contradicts, layer_of, prerequisite_for. Free-text; no allowlist enforced.' },
    context: { type: 'string', description: 'Context for the link' },
  },
  mutating: true,
  handler: async (ctx, p) => {
    if (ctx.dryRun) return { dry_run: true, action: 'add_link', from: p.from, to: p.to };
    await ctx.engine.addLink(
      p.from as string, p.to as string,
      (p.context as string) || '', (p.link_type as string) || '',
    );
    return { status: 'ok' };
  },
  cliHints: { name: 'link', positional: ['from', 'to'] },
};

const remove_link: Operation = {
  name: 'remove_link',
  description: 'Remove link between pages',
  params: {
    from: { type: 'string', required: true },
    to: { type: 'string', required: true },
  },
  mutating: true,
  handler: async (ctx, p) => {
    if (ctx.dryRun) return { dry_run: true, action: 'remove_link', from: p.from, to: p.to };
    await ctx.engine.removeLink(p.from as string, p.to as string);
    return { status: 'ok' };
  },
  cliHints: { name: 'unlink', positional: ['from', 'to'] },
};

const get_links: Operation = {
  name: 'get_links',
  description: 'List outgoing links from a page',
  params: {
    slug: { type: 'string', required: true },
  },
  handler: async (ctx, p) => {
    return ctx.engine.getLinks(p.slug as string);
  },
};

const get_backlinks: Operation = {
  name: 'get_backlinks',
  description: 'List incoming links to a page',
  params: {
    slug: { type: 'string', required: true },
  },
  handler: async (ctx, p) => {
    return ctx.engine.getBacklinks(p.slug as string);
  },
  cliHints: { name: 'backlinks', positional: ['slug'] },
};

const traverse_graph: Operation = {
  name: 'traverse_graph',
  description: 'Traverse link graph from a page',
  params: {
    slug: { type: 'string', required: true },
    depth: { type: 'number', description: 'Max traversal depth (default 5)' },
  },
  handler: async (ctx, p) => {
    return ctx.engine.traverseGraph(p.slug as string, (p.depth as number) ?? 5);
  },
  cliHints: { name: 'graph', positional: ['slug'] },
};

// --- Timeline ---

const add_timeline_entry: Operation = {
  name: 'add_timeline_entry',
  description: 'Add timeline entry to a page',
  params: {
    slug: { type: 'string', required: true },
    date: { type: 'string', required: true },
    summary: { type: 'string', required: true },
    detail: { type: 'string' },
    source: { type: 'string' },
  },
  mutating: true,
  handler: async (ctx, p) => {
    if (ctx.dryRun) return { dry_run: true, action: 'add_timeline_entry', slug: p.slug };
    await ctx.engine.addTimelineEntry(p.slug as string, {
      date: p.date as string,
      source: (p.source as string) || '',
      summary: p.summary as string,
      detail: (p.detail as string) || '',
    });
    return { status: 'ok' };
  },
  cliHints: { name: 'timeline-add', positional: ['slug', 'date', 'summary'] },
};

const get_timeline: Operation = {
  name: 'get_timeline',
  description: 'Get timeline entries for a page',
  params: {
    slug: { type: 'string', required: true },
  },
  handler: async (ctx, p) => {
    return ctx.engine.getTimeline(p.slug as string);
  },
  cliHints: { name: 'timeline', positional: ['slug'] },
};

// --- Admin ---

const get_stats: Operation = {
  name: 'get_stats',
  description: 'Brain statistics (page count, chunk count, etc.)',
  params: {},
  handler: async (ctx) => {
    return ctx.engine.getStats();
  },
  cliHints: { name: 'stats' },
};

const get_health: Operation = {
  name: 'get_health',
  description: 'Brain health dashboard (embed coverage, stale pages, orphans)',
  params: {},
  handler: async (ctx) => {
    return ctx.engine.getHealth();
  },
  cliHints: { name: 'health' },
};

const get_versions: Operation = {
  name: 'get_versions',
  description: 'Page version history',
  params: {
    slug: { type: 'string', required: true },
  },
  handler: async (ctx, p) => {
    return ctx.engine.getVersions(p.slug as string);
  },
  cliHints: { name: 'history', positional: ['slug'] },
};

const revert_version: Operation = {
  name: 'revert_version',
  description: 'Revert page to a previous version',
  params: {
    slug: { type: 'string', required: true },
    version_id: { type: 'number', required: true },
  },
  mutating: true,
  handler: async (ctx, p) => {
    if (ctx.dryRun) return { dry_run: true, action: 'revert_version', slug: p.slug, version_id: p.version_id };
    await ctx.engine.createVersion(p.slug as string);
    await ctx.engine.revertToVersion(p.slug as string, p.version_id as number);
    return { status: 'reverted' };
  },
  cliHints: { name: 'revert', positional: ['slug', 'version_id'] },
};

// --- Sync ---

const sync_brain: Operation = {
  name: 'sync_brain',
  description: 'Sync git repo to brain (incremental)',
  params: {
    repo: { type: 'string', description: 'Path to git repo (optional if configured)' },
    dry_run: { type: 'boolean', description: 'Preview changes without applying' },
    full: { type: 'boolean', description: 'Full re-sync (ignore checkpoint)' },
    no_pull: { type: 'boolean', description: 'Skip git pull' },
  },
  mutating: true,
  handler: async (ctx, p) => {
    // Keep sync local-only so the remote Edge bundle doesn't pull in CLI/import engine code.
    const { performSync } = await runtimeImport('../commands/sync.ts');
    return performSync(ctx.engine, {
      repoPath: p.repo as string | undefined,
      dryRun: ctx.dryRun || (p.dry_run as boolean) || false,
      noPull: (p.no_pull as boolean) || false,
      full: (p.full as boolean) || false,
    });
  },
  cliHints: { name: 'sync' },
};

// --- Raw Data ---

const put_raw_data: Operation = {
  name: 'put_raw_data',
  description: 'Store raw API response data for a page',
  params: {
    slug: { type: 'string', required: true },
    source: { type: 'string', required: true, description: 'Data source (e.g., crustdata, happenstance)' },
    data: { type: 'object', required: true, description: 'Raw data object' },
  },
  mutating: true,
  handler: async (ctx, p) => {
    if (ctx.dryRun) return { dry_run: true, action: 'put_raw_data', slug: p.slug, source: p.source };
    await ctx.engine.putRawData(p.slug as string, p.source as string, p.data as object);
    return { status: 'ok' };
  },
};

const get_raw_data: Operation = {
  name: 'get_raw_data',
  description: 'Retrieve raw data for a page',
  params: {
    slug: { type: 'string', required: true },
    source: { type: 'string', description: 'Filter by source' },
  },
  handler: async (ctx, p) => {
    return ctx.engine.getRawData(p.slug as string, p.source as string | undefined);
  },
};

// --- Resolution & Chunks ---

const resolve_slugs: Operation = {
  name: 'resolve_slugs',
  description: 'Fuzzy-resolve a partial slug to matching page slugs',
  params: {
    partial: { type: 'string', required: true },
  },
  handler: async (ctx, p) => {
    return ctx.engine.resolveSlugs(p.partial as string);
  },
};

const get_chunks: Operation = {
  name: 'get_chunks',
  description: 'Get content chunks for a page',
  params: {
    slug: { type: 'string', required: true },
  },
  handler: async (ctx, p) => {
    return ctx.engine.getChunks(p.slug as string);
  },
};

// --- Operational Memory ---

const list_tasks: Operation = {
  name: 'list_tasks',
  description: 'List task threads from canonical operational memory.',
  params: {
    scope: { type: 'string', description: 'Filter by task scope', enum: ['work', 'personal', 'mixed'] },
    status: {
      type: 'string',
      description: 'Filter by task status',
      enum: ['active', 'paused', 'blocked', 'completed', 'abandoned'],
    },
    limit: { type: 'number', description: 'Max results (default 20)' },
  },
  handler: async (ctx, p) => {
    return ctx.engine.listTaskThreads({
      scope: p.scope as any,
      status: p.status as any,
      limit: (p.limit as number) ?? 20,
    });
  },
  cliHints: { name: 'task-list', aliases: { n: 'limit' } },
};

const start_task: Operation = {
  name: 'start_task',
  description: 'Create a new operational-memory task thread.',
  params: {
    title: { type: 'string', required: true, description: 'Task title' },
    goal: { type: 'string', description: 'Task goal' },
    scope: { type: 'string', description: 'Task scope', default: 'work', enum: ['work', 'personal', 'mixed'] },
  },
  mutating: true,
  handler: async (ctx, p) => {
    const id = crypto.randomUUID();
    if (ctx.dryRun) {
      return { dry_run: true, action: 'start_task', id, title: p.title, scope: p.scope ?? 'work' };
    }

    return ctx.engine.transaction(async (tx) => {
      await tx.createTaskThread({
        id,
        scope: String(p.scope ?? 'work') as any,
        title: String(p.title),
        goal: String(p.goal ?? ''),
        status: 'active',
        repo_path: process.cwd(),
        branch_name: null,
        current_summary: '',
      });

      await tx.upsertTaskWorkingSet({
        task_id: id,
        active_paths: [],
        active_symbols: [],
        blockers: [],
        open_questions: [],
        next_steps: [],
        verification_notes: [],
        last_verified_at: null,
      });

      return tx.getTaskThread(id);
    });
  },
  cliHints: { name: 'task-start' },
};

const update_task: Operation = {
  name: 'update_task',
  description: 'Update canonical task-thread state for an existing task.',
  params: {
    task_id: { type: 'string', required: true, description: 'Task thread id' },
    title: { type: 'string', description: 'Updated task title' },
    goal: { type: 'string', description: 'Updated task goal' },
    status: {
      type: 'string',
      description: 'Updated task status',
      enum: ['active', 'paused', 'blocked', 'completed', 'abandoned'],
    },
    current_summary: { type: 'string', description: 'Updated task summary' },
  },
  mutating: true,
  handler: async (ctx, p) => {
    const taskId = String(p.task_id);
    const patch = Object.fromEntries(
      Object.entries({
        title: p.title,
        goal: p.goal,
        status: p.status,
        current_summary: p.current_summary,
      }).filter(([, value]) => value !== undefined),
    );

    if (Object.keys(patch).length === 0) {
      throw new OperationError('invalid_params', 'update_task requires at least one patch field.');
    }

    if (ctx.dryRun) {
      return { dry_run: true, action: 'update_task', task_id: taskId, patch };
    }

    await requireTaskThread(ctx.engine, taskId);
    return ctx.engine.updateTaskThread(taskId, patch as any);
  },
  cliHints: { name: 'task-update', positional: ['task_id'] },
};

const resume_task: Operation = {
  name: 'resume_task',
  description: 'Resume an operational-memory task thread from canonical task state.',
  params: {
    task_id: { type: 'string', required: true, description: 'Task thread id' },
  },
  handler: async (ctx, p) => {
    return buildTaskResumeCard(ctx.engine, p.task_id as string);
  },
  cliHints: { name: 'task-resume', positional: ['task_id'] },
};

const get_task_working_set: Operation = {
  name: 'get_task_working_set',
  description: 'Get the canonical task thread and working-set state for one task.',
  params: {
    task_id: { type: 'string', required: true, description: 'Task thread id' },
  },
  handler: async (ctx, p) => {
    const thread = await requireTaskThread(ctx.engine, String(p.task_id));
    const workingSet = await ctx.engine.getTaskWorkingSet(String(p.task_id));
    return {
      thread,
      working_set: workingSet,
    };
  },
  cliHints: { name: 'task-show', positional: ['task_id'] },
};

const record_retrieval_trace: Operation = {
  name: 'record_retrieval_trace',
  description: 'Record a retrieval trace for a task-scoped operational-memory flow.',
  params: {
    task_id: { type: 'string', required: true, description: 'Task thread id' },
    outcome: { type: 'string', required: true, description: 'Trace outcome summary' },
    route: { type: 'array', items: { type: 'string' }, description: 'Ordered retrieval route' },
    source_refs: { type: 'array', items: { type: 'string' }, description: 'Source references consulted' },
    verification: { type: 'array', items: { type: 'string' }, description: 'Verification steps performed' },
  },
  mutating: true,
  handler: async (ctx, p) => {
    const taskId = String(p.task_id);
    const route = parseStringListParam(p.route, 'route') ?? [];
    const sourceRefs = parseStringListParam(p.source_refs, 'source_refs') ?? [];
    const verification = parseStringListParam(p.verification, 'verification') ?? [];

    if (ctx.dryRun) {
      return {
        dry_run: true,
        action: 'record_retrieval_trace',
        task_id: taskId,
        outcome: String(p.outcome),
        route,
        source_refs: sourceRefs,
        verification,
      };
    }

    const thread = await requireTaskThread(ctx.engine, taskId);
    return ctx.engine.putRetrievalTrace({
      id: crypto.randomUUID(),
      task_id: taskId,
      scope: thread.scope,
      route,
      source_refs: sourceRefs,
      verification,
      outcome: String(p.outcome),
    });
  },
  cliHints: { name: 'task-trace', positional: ['task_id'] },
};

const list_task_traces: Operation = {
  name: 'list_task_traces',
  description: 'List retrieval traces for one task thread.',
  params: {
    task_id: { type: 'string', required: true, description: 'Task thread id' },
    limit: { type: 'number', description: 'Max results (default 10)' },
  },
  handler: async (ctx, p) => {
    const taskId = String(p.task_id);
    await requireTaskThread(ctx.engine, taskId);
    return ctx.engine.listRetrievalTraces(taskId, {
      limit: (p.limit as number) ?? 10,
    });
  },
  cliHints: { name: 'task-traces', positional: ['task_id'], aliases: { n: 'limit' } },
};

const list_task_attempts: Operation = {
  name: 'list_task_attempts',
  description: 'List recorded attempts for one task thread.',
  params: {
    task_id: { type: 'string', required: true, description: 'Task thread id' },
    limit: { type: 'number', description: 'Max results (default 10)' },
  },
  handler: async (ctx, p) => {
    const taskId = String(p.task_id);
    await requireTaskThread(ctx.engine, taskId);
    return ctx.engine.listTaskAttempts(taskId, {
      limit: (p.limit as number) ?? 10,
    });
  },
  cliHints: { name: 'task-attempts', positional: ['task_id'], aliases: { n: 'limit' } },
};

const list_task_decisions: Operation = {
  name: 'list_task_decisions',
  description: 'List recorded decisions for one task thread.',
  params: {
    task_id: { type: 'string', required: true, description: 'Task thread id' },
    limit: { type: 'number', description: 'Max results (default 10)' },
  },
  handler: async (ctx, p) => {
    const taskId = String(p.task_id);
    await requireTaskThread(ctx.engine, taskId);
    return ctx.engine.listTaskDecisions(taskId, {
      limit: (p.limit as number) ?? 10,
    });
  },
  cliHints: { name: 'task-decisions', positional: ['task_id'], aliases: { n: 'limit' } },
};

const refresh_task_working_set: Operation = {
  name: 'refresh_task_working_set',
  description: 'Refresh a task working set snapshot and advance its verification timestamp.',
  params: {
    task_id: { type: 'string', required: true, description: 'Task thread id' },
    active_paths: { type: 'array', items: { type: 'string' }, description: 'Active file paths' },
    active_symbols: { type: 'array', items: { type: 'string' }, description: 'Active symbols' },
    blockers: { type: 'array', items: { type: 'string' }, description: 'Current blockers' },
    open_questions: { type: 'array', items: { type: 'string' }, description: 'Open questions' },
    next_steps: { type: 'array', items: { type: 'string' }, description: 'Next steps' },
    verification_notes: { type: 'array', items: { type: 'string' }, description: 'Verification notes' },
    last_verified_at: { type: 'string', description: 'Override verification timestamp (ISO datetime)' },
  },
  mutating: true,
  handler: async (ctx, p) => {
    const taskId = String(p.task_id);
    if (ctx.dryRun) {
      return { dry_run: true, action: 'refresh_task_working_set', task_id: taskId };
    }

    await requireTaskThread(ctx.engine, taskId);
    const existing = await ctx.engine.getTaskWorkingSet(taskId);
    return ctx.engine.upsertTaskWorkingSet({
      task_id: taskId,
      active_paths: parseStringListParam(p.active_paths, 'active_paths') ?? existing?.active_paths ?? [],
      active_symbols: parseStringListParam(p.active_symbols, 'active_symbols') ?? existing?.active_symbols ?? [],
      blockers: parseStringListParam(p.blockers, 'blockers') ?? existing?.blockers ?? [],
      open_questions: parseStringListParam(p.open_questions, 'open_questions') ?? existing?.open_questions ?? [],
      next_steps: parseStringListParam(p.next_steps, 'next_steps') ?? existing?.next_steps ?? [],
      verification_notes: parseStringListParam(p.verification_notes, 'verification_notes') ?? existing?.verification_notes ?? [],
      last_verified_at: parseOptionalDateParam(p.last_verified_at, 'last_verified_at') ?? new Date(),
    });
  },
  cliHints: { name: 'task-working-set', positional: ['task_id'] },
};

const record_attempt: Operation = {
  name: 'record_attempt',
  description: 'Record a task attempt outcome for repeated-work prevention.',
  params: {
    task_id: { type: 'string', required: true, description: 'Task thread id' },
    summary: { type: 'string', required: true, description: 'Attempt summary' },
    outcome: {
      type: 'string',
      required: true,
      description: 'Attempt outcome',
      enum: ['failed', 'partial', 'succeeded', 'abandoned'],
    },
  },
  mutating: true,
  handler: async (ctx, p) => {
    if (ctx.dryRun) {
      return { dry_run: true, action: 'record_attempt', task_id: p.task_id, summary: p.summary };
    }

    await requireTaskThread(ctx.engine, String(p.task_id));
    return ctx.engine.recordTaskAttempt({
      id: crypto.randomUUID(),
      task_id: String(p.task_id),
      summary: String(p.summary),
      outcome: String(p.outcome) as any,
      applicability_context: {},
      evidence: [],
    });
  },
  cliHints: { name: 'task-attempt' },
};

const record_decision: Operation = {
  name: 'record_decision',
  description: 'Record a task decision and rationale.',
  params: {
    task_id: { type: 'string', required: true, description: 'Task thread id' },
    summary: { type: 'string', required: true, description: 'Decision summary' },
    rationale: { type: 'string', required: true, description: 'Decision rationale' },
  },
  mutating: true,
  handler: async (ctx, p) => {
    if (ctx.dryRun) {
      return { dry_run: true, action: 'record_decision', task_id: p.task_id, summary: p.summary };
    }

    await requireTaskThread(ctx.engine, String(p.task_id));
    return ctx.engine.recordTaskDecision({
      id: crypto.randomUUID(),
      task_id: String(p.task_id),
      summary: String(p.summary),
      rationale: String(p.rationale),
      consequences: [],
      validity_context: {},
    });
  },
  cliHints: { name: 'task-decision' },
};

// --- Ingest Log ---

const log_ingest: Operation = {
  name: 'log_ingest',
  description: 'Log an ingestion event',
  params: {
    source_type: { type: 'string', required: true },
    source_ref: { type: 'string', required: true },
    pages_updated: { type: 'array', required: true, items: { type: 'string' } },
    summary: { type: 'string', required: true },
  },
  mutating: true,
  handler: async (ctx, p) => {
    if (ctx.dryRun) return { dry_run: true, action: 'log_ingest' };
    await ctx.engine.logIngest({
      source_type: p.source_type as string,
      source_ref: p.source_ref as string,
      pages_updated: p.pages_updated as string[],
      summary: p.summary as string,
    });
    return { status: 'ok' };
  },
};

const get_ingest_log: Operation = {
  name: 'get_ingest_log',
  description: 'Get recent ingestion log entries',
  params: {
    limit: { type: 'number', description: 'Max entries (default 20)' },
  },
  handler: async (ctx, p) => {
    return ctx.engine.getIngestLog({ limit: (p.limit as number) ?? 20 });
  },
};

// --- File Operations ---

const FILE_LIST_LIMIT = 100;

const file_list: Operation = {
  name: 'file_list',
  description: 'List stored files',
  params: {
    slug: { type: 'string', description: 'Filter by page slug' },
  },
  handler: async (ctx, p) => {
    assertCapabilitySupported(ctx.config, 'files');
    const sql = db.getConnection();
    const slug = p.slug as string | undefined;
    if (slug) {
      return sql`SELECT id, page_slug, filename, storage_path, mime_type, size_bytes, content_hash, created_at FROM files WHERE page_slug = ${slug} ORDER BY filename LIMIT ${FILE_LIST_LIMIT}`;
    }
    return sql`SELECT id, page_slug, filename, storage_path, mime_type, size_bytes, content_hash, created_at FROM files ORDER BY page_slug, filename LIMIT ${FILE_LIST_LIMIT}`;
  },
};

const file_upload: Operation = {
  name: 'file_upload',
  description: 'Upload a file to storage',
  params: {
    path: { type: 'string', required: true, description: 'Local file path' },
    page_slug: { type: 'string', description: 'Associate with page' },
  },
  mutating: true,
  handler: async (ctx, p) => {
    assertCapabilitySupported(ctx.config, 'files');
    if (ctx.dryRun) return { dry_run: true, action: 'file_upload', path: p.path };

    const { readFileSync, statSync } = await import('fs');
    const { basename, extname } = await import('path');
    const { createHash } = await import('crypto');

    const filePath = p.path as string;
    const pageSlug = (p.page_slug as string) || null;
    const stat = statSync(filePath);
    const content = readFileSync(filePath);
    const hash = createHash('sha256').update(content).digest('hex');
    const filename = basename(filePath);
    const storagePath = pageSlug ? `${pageSlug}/${filename}` : `unsorted/${hash.slice(0, 8)}-${filename}`;

    const MIME_TYPES: Record<string, string> = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
      '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
      '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg',
    };
    const mimeType = MIME_TYPES[extname(filePath).toLowerCase()] || null;

    const sql = db.getConnection();
    const existing = await sql`SELECT id FROM files WHERE content_hash = ${hash} AND storage_path = ${storagePath}`;
    if (existing.length > 0) {
      return { status: 'already_exists', storage_path: storagePath };
    }

    // Upload to storage backend if configured
    if (ctx.config.storage) {
      const { createStorage } = await import('./storage.ts');
      const storage = await createStorage(ctx.config.storage as any);
      try {
        await storage.upload(storagePath, content, mimeType || undefined);
      } catch (uploadErr) {
        throw new OperationError('storage_error', `Upload failed: ${uploadErr instanceof Error ? uploadErr.message : String(uploadErr)}`);
      }
    }

    try {
      await sql`
        INSERT INTO files (page_slug, filename, storage_path, mime_type, size_bytes, content_hash, metadata)
        VALUES (${pageSlug}, ${filename}, ${storagePath}, ${mimeType}, ${stat.size}, ${hash}, ${'{}'}::jsonb)
        ON CONFLICT (storage_path) DO UPDATE SET
          content_hash = EXCLUDED.content_hash,
          size_bytes = EXCLUDED.size_bytes,
          mime_type = EXCLUDED.mime_type
      `;
    } catch (dbErr) {
      // Rollback: clean up storage if DB write failed
      if (ctx.config.storage) {
        try {
          const { createStorage } = await import('./storage.ts');
          const storage = await createStorage(ctx.config.storage as any);
          await storage.delete(storagePath);
        } catch { /* best effort cleanup */ }
      }
      throw dbErr;
    }

    return { status: 'uploaded', storage_path: storagePath, size_bytes: stat.size };
  },
};

const file_url: Operation = {
  name: 'file_url',
  description: 'Get a URL for a stored file',
  params: {
    storage_path: { type: 'string', required: true },
  },
  handler: async (ctx, p) => {
    assertCapabilitySupported(ctx.config, 'files');
    const sql = db.getConnection();
    const rows = await sql`SELECT storage_path, mime_type, size_bytes FROM files WHERE storage_path = ${p.storage_path as string}`;
    if (rows.length === 0) {
      throw new OperationError('storage_error', `File not found: ${p.storage_path}`);
    }
    // TODO: generate signed URL from Supabase Storage
    return { storage_path: rows[0].storage_path, url: `mbrain:files/${rows[0].storage_path}` };
  },
};

// --- Skillpack ---

const get_skillpack: Operation = {
  name: 'get_skillpack',
  description: 'Read the MBrain SKILLPACK reference architecture. Returns the full document or a specific section by number/name. Use this to learn detailed patterns for enrichment, meeting ingestion, cron schedules, and more.',
  params: {
    section: { type: 'string', description: 'Section number or keyword (e.g. "5", "enrichment", "meeting", "cron"). Omit to get the compact agent rules.' },
  },
  handler: async (_ctx, p) => {
    const section = p.section as string | undefined;

    // If no section requested, return the compact agent rules
    if (!section) {
      const rulesPath = resolveDocPath('MBRAIN_AGENT_RULES.md');
      if (!rulesPath) {
        return { error: 'not_found', message: 'MBRAIN_AGENT_RULES.md not found in the mbrain package.' };
      }
      return { document: 'MBRAIN_AGENT_RULES.md', content: readFileSync(rulesPath, 'utf-8') };
    }

    // Load full SKILLPACK and extract section
    const skillpackPath = resolveDocPath('MBRAIN_SKILLPACK.md');
    if (!skillpackPath) {
      return { error: 'not_found', message: 'MBRAIN_SKILLPACK.md not found in the mbrain package.' };
    }

    const fullContent = readFileSync(skillpackPath, 'utf-8');

    // Try to find section by number (e.g. "## 5." or "## 5 ")
    const sectionNum = parseInt(section, 10);
    if (!isNaN(sectionNum)) {
      const extracted = extractSection(fullContent, sectionNum);
      if (extracted) {
        return { document: 'MBRAIN_SKILLPACK.md', section: sectionNum, content: extracted };
      }
      return { error: 'section_not_found', message: `Section ${sectionNum} not found.`, available: listSections(fullContent) };
    }

    // Try keyword search in section headers
    const keyword = section.toLowerCase();
    const lines = fullContent.split('\n');
    const matchingSections: Array<{ num: number; title: string }> = [];
    for (const line of lines) {
      const match = parseSkillpackSectionHeader(line);
      if (match && (match.title.toLowerCase().includes(keyword) || line.toLowerCase().includes(keyword))) {
        matchingSections.push(match);
      }
    }

    if (matchingSections.length === 1) {
      const extracted = extractSection(fullContent, matchingSections[0].num);
      return { document: 'MBRAIN_SKILLPACK.md', section: matchingSections[0].num, title: matchingSections[0].title, content: extracted };
    }

    if (matchingSections.length > 1) {
      return { matches: matchingSections, hint: 'Multiple sections match. Specify a section number.' };
    }

    return { error: 'section_not_found', message: `No section matching "${section}".`, available: listSections(fullContent) };
  },
  cliHints: { hidden: true },
};

function resolveDocPath(filename: string): string | null {
  const candidates = [
    join(process.cwd(), 'docs', filename),
    join(__dirname, '..', '..', 'docs', filename),
    join(__dirname, '..', 'docs', filename),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

function extractSection(content: string, sectionNum: number): string | null {
  const lines = content.split('\n');
  let start = -1;
  let end = lines.length;

  for (let i = 0; i < lines.length; i++) {
    const match = parseSkillpackSectionHeader(lines[i]);
    if (match) {
      const num = match.num;
      if (num === sectionNum && start === -1) {
        start = i;
      } else if (start !== -1 && num > sectionNum) {
        end = i;
        break;
      }
    }
  }

  if (start === -1) return null;
  return lines.slice(start, end).join('\n').trim();
}

function listSections(content: string): Array<{ num: number; title: string }> {
  const sections: Array<{ num: number; title: string }> = [];
  for (const line of content.split('\n')) {
    const match = parseSkillpackSectionHeader(line);
    if (match) {
      sections.push({ num: match.num, title: match.title.replace(/\s*--\s*/, ' - ').trim() });
    }
  }
  return sections;
}

function parseSkillpackSectionHeader(line: string): { num: number; title: string } | null {
  const match = line.match(/^## (?:(?:Section )?(\d+)[a-z]?[:.\s]+)(.+)$/i);
  if (!match) return null;
  return { num: parseInt(match[1], 10), title: match[2].trim() };
}

// --- Exports ---

export const operations: Operation[] = [
  // Page CRUD
  get_page, put_page, delete_page, list_pages,
  // Search
  search, query,
  // Tags
  add_tag, remove_tag, get_tags,
  // Links
  add_link, remove_link, get_links, get_backlinks, traverse_graph,
  // Timeline
  add_timeline_entry, get_timeline,
  // Admin
  get_stats, get_health, get_versions, revert_version,
  // Sync
  sync_brain,
  // Raw data
  put_raw_data, get_raw_data,
  // Resolution & chunks
  resolve_slugs, get_chunks,
  // Operational memory
  list_tasks, start_task, update_task, resume_task, get_task_working_set, record_retrieval_trace, list_task_traces, list_task_attempts, list_task_decisions, refresh_task_working_set, record_attempt, record_decision,
  // Ingest log
  log_ingest, get_ingest_log,
  // Files
  file_list, file_upload, file_url,
  // Skillpack
  get_skillpack,
];

function assertCapabilitySupported(
  config: MBrainConfig,
  capability: 'files',
) {
  const reason = getUnsupportedCapabilityReason(config, capability);
  if (reason) {
    throw new OperationError('unsupported_capability', reason);
  }
}

export const operationsByName = Object.fromEntries(
  operations.map(op => [op.name, op]),
) as Record<string, Operation>;
