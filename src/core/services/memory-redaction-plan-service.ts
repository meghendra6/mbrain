import { createHash, randomUUID } from 'crypto';
import type { BrainEngine } from '../engine.ts';
import { buildPageChunks } from '../import-file.ts';
import type {
  MemoryCandidateEntry,
  MemoryRedactionPlan,
  MemoryRedactionPlanInput,
  MemoryRedactionPlanItem,
  Page,
  PageInput,
  PersonalEpisodeEntry,
  ProfileMemoryEntry,
  RetrievalTrace,
} from '../types.ts';
import { importContentHash } from '../utils.ts';
import { recordMemoryMutationEvent } from './memory-mutation-ledger-service.ts';
import {
  buildNoteManifestEntry,
  DEFAULT_NOTE_MANIFEST_SCOPE_ID,
} from './note-manifest-service.ts';
import { buildNoteSectionEntries } from './note-section-service.ts';
import { hashCanonicalJson } from './target-snapshot-hash-service.ts';

export interface CreateMemoryRedactionPlanServiceInput {
  id?: string;
  scope_id: string;
  query: string;
  replacement_text?: string;
  requested_by?: string | null;
  source_refs?: string[];
}

export interface ReviewMemoryRedactionPlanServiceInput {
  id: string;
  review_reason?: string | null;
}

export interface ApplyMemoryRedactionPlanServiceInput {
  id: string;
  actor?: string;
  source_refs?: string[];
}

const DEFAULT_REPLACEMENT_TEXT = '[REDACTED]';
const DEFAULT_CREATE_SOURCE_REFS = ['Source: mbrain create_memory_redaction_plan operation'];
const DEFAULT_APPLY_SOURCE_REFS = ['Source: mbrain apply_memory_redaction_plan operation'];
const DEFAULT_ACTOR = 'mbrain:redaction_plan_service';
const PAGE_TEXT_FIELDS = ['compiled_truth', 'timeline'] as const;
const PAGE_VERSION_TEXT_FIELDS = ['compiled_truth', 'frontmatter'] as const;

type PageTextField = typeof PAGE_TEXT_FIELDS[number];

interface PageApplyResult {
  originalPage: Page;
  nextPage: Pick<PageInput, 'type' | 'title' | 'compiled_truth' | 'timeline' | 'frontmatter'>;
  beforeContentHash: string;
  afterContentHash: string;
  tags: string[];
  itemResults: Array<{
    id: string;
    field_path: string;
    before_hash: string;
    after_hash: string;
  }>;
}

export async function createMemoryRedactionPlan(
  engine: BrainEngine,
  input: CreateMemoryRedactionPlanServiceInput,
): Promise<MemoryRedactionPlan> {
  const planInput = redactionPlanInput(input);
  const sourceRefs = normalizeSourceRefs(input.source_refs, DEFAULT_CREATE_SOURCE_REFS);

  return engine.transaction(async (tx) => {
    const plan = await tx.createMemoryRedactionPlan(planInput);
    const items = await createPlanItems(tx, plan);
    await recordMemoryMutationEvent(tx, {
      session_id: plan.id,
      realm_id: plan.scope_id,
      actor: plan.requested_by ?? DEFAULT_ACTOR,
      operation: 'create_redaction_plan',
      target_kind: 'ledger_event',
      target_id: plan.id,
      scope_id: plan.scope_id,
      source_refs: sourceRefs,
      expected_target_snapshot_hash: null,
      current_target_snapshot_hash: hashCanonicalJson(redactionPlanSnapshot(plan, items)),
      result: 'staged_for_review',
      metadata: {
        plan_id: plan.id,
        query: plan.query,
        replacement_text: plan.replacement_text,
        item_count: items.length,
      },
    });
    return plan;
  });
}

export async function approveMemoryRedactionPlan(
  engine: BrainEngine,
  input: ReviewMemoryRedactionPlanServiceInput,
): Promise<MemoryRedactionPlan> {
  const plan = await requireDraftPlan(engine, input.id);
  const reviewedAt = new Date();
  const updated = await engine.updateMemoryRedactionPlanStatus(plan.id, {
    status: 'approved',
    expected_current_status: 'draft',
    review_reason: input.review_reason ?? null,
    reviewed_at: reviewedAt,
  });
  if (!updated) {
    throw new Error(`memory redaction plan was not approved: ${plan.id}`);
  }
  return updated;
}

export async function rejectMemoryRedactionPlan(
  engine: BrainEngine,
  input: ReviewMemoryRedactionPlanServiceInput,
): Promise<MemoryRedactionPlan> {
  const plan = await requireDraftPlan(engine, input.id);
  const reviewedAt = new Date();
  const updated = await engine.updateMemoryRedactionPlanStatus(plan.id, {
    status: 'rejected',
    expected_current_status: 'draft',
    review_reason: input.review_reason ?? null,
    reviewed_at: reviewedAt,
  });
  if (!updated) {
    throw new Error(`memory redaction plan was not rejected: ${plan.id}`);
  }
  return updated;
}

export async function applyMemoryRedactionPlan(
  engine: BrainEngine,
  input: ApplyMemoryRedactionPlanServiceInput,
): Promise<MemoryRedactionPlan> {
  const sourceRefs = normalizeSourceRefs(input.source_refs, DEFAULT_APPLY_SOURCE_REFS);

  return engine.transaction(async (tx) => {
    const plan = await tx.getMemoryRedactionPlan(input.id);
    if (!plan) {
      throw new Error(`memory redaction plan not found: ${input.id}`);
    }
    if (plan.status !== 'approved') {
      throw new Error(`memory redaction plan must be approved before apply: ${plan.id}`);
    }

    const items = await tx.listMemoryRedactionPlanItems({ plan_id: plan.id, limit: 10_000 });
    assertSupportedApplyItems(items);
    const plannedItems = items.filter((item) => item.status === 'planned');
    const itemsByPage = groupPageItems(plannedItems);
    const pageIds = [...itemsByPage.keys()].sort();
    const pageResults: PageApplyResult[] = [];

    for (const pageId of pageIds) {
      const page = await tx.getPageForUpdate(pageId);
      if (!page) {
        throw new Error(`memory redaction page target not found: ${pageId}`);
      }
      pageResults.push(await planPageApplyResult(tx, page, plan, itemsByPage.get(pageId) ?? []));
    }

    const actor = input.actor ?? plan.requested_by ?? DEFAULT_ACTOR;
    for (const pageResult of pageResults) {
      const storedPage = await writeRedactedPage(tx, pageResult);
      const appliedItemIds: string[] = [];
      for (const itemResult of pageResult.itemResults) {
        const updatedItem = await tx.updateMemoryRedactionPlanItemStatus(itemResult.id, {
          status: 'applied',
          expected_current_status: 'planned',
          after_hash: itemResult.after_hash,
          updated_at: new Date(),
        });
        if (!updatedItem) {
          throw new Error(`memory redaction plan item was not applied: ${itemResult.id}`);
        }
        appliedItemIds.push(updatedItem.id);
      }
      await recordMemoryMutationEvent(tx, {
        session_id: plan.id,
        realm_id: plan.scope_id,
        actor,
        operation: 'execute_redaction_plan',
        target_kind: 'page',
        target_id: storedPage.slug,
        scope_id: plan.scope_id,
        source_refs: sourceRefs,
        expected_target_snapshot_hash: pageResult.beforeContentHash,
        current_target_snapshot_hash: pageResult.afterContentHash,
        result: 'redacted',
        metadata: {
          plan_id: plan.id,
          query: plan.query,
          replacement_text: plan.replacement_text,
          page_slug: storedPage.slug,
          item_count: pageResult.itemResults.length,
          item_ids: appliedItemIds,
          item_results: pageResult.itemResults.map((item) => ({
            item_id: item.id,
            field_path: item.field_path,
            before_hash: item.before_hash,
            after_hash: item.after_hash,
          })),
        },
        redaction_visibility: 'partially_redacted',
      });
    }

    const appliedAt = new Date();
    const applied = await tx.updateMemoryRedactionPlanStatus(plan.id, {
      status: 'applied',
      expected_current_status: 'approved',
      applied_at: appliedAt,
    });
    if (!applied) {
      throw new Error(`memory redaction plan was not marked applied: ${plan.id}`);
    }

    return applied;
  });
}

function redactionPlanInput(input: CreateMemoryRedactionPlanServiceInput): MemoryRedactionPlanInput {
  const scopeId = requiredString('scope_id', input.scope_id);
  const query = requiredString('query', input.query);
  if (input.replacement_text !== undefined && typeof input.replacement_text !== 'string') {
    throw new Error('memory redaction replacement_text must be a string');
  }
  const replacementText = input.replacement_text ?? DEFAULT_REPLACEMENT_TEXT;
  if (replacementText.includes(query)) {
    throw new Error('memory redaction replacement_text must not contain the query');
  }
  return {
    id: input.id ? requiredString('id', input.id) : `redaction-plan:${randomUUID()}`,
    scope_id: scopeId,
    query,
    replacement_text: replacementText,
    status: 'draft',
    requested_by: input.requested_by ?? null,
    review_reason: null,
    reviewed_at: null,
    applied_at: null,
  };
}

async function requireDraftPlan(engine: BrainEngine, id: string): Promise<MemoryRedactionPlan> {
  const planId = requiredString('id', id);
  const plan = await engine.getMemoryRedactionPlan(planId);
  if (!plan) {
    throw new Error(`memory redaction plan not found: ${planId}`);
  }
  if (plan.status !== 'draft') {
    throw new Error(`memory redaction plan must be draft for review: ${plan.id}`);
  }
  return plan;
}

async function createPlanItems(
  engine: BrainEngine,
  plan: MemoryRedactionPlan,
): Promise<MemoryRedactionPlanItem[]> {
  const items: MemoryRedactionPlanItem[] = [];
  const pages = await listAllPages(engine);
  for (const page of pages.sort((left, right) => left.slug.localeCompare(right.slug))) {
    for (const field of PAGE_TEXT_FIELDS) {
      const text = page[field] ?? '';
      if (!text.includes(plan.query)) continue;
      items.push(await createPlanItem(engine, plan, {
        target_object_type: 'page',
        target_object_id: page.slug,
        field_path: field,
        text,
        status: 'planned',
      }));
    }

    const versions = await engine.getVersions(page.slug);
    for (const version of versions.sort((left, right) => left.id - right.id)) {
      for (const field of PAGE_VERSION_TEXT_FIELDS) {
        const text = field === 'compiled_truth'
          ? version.compiled_truth
          : JSON.stringify(version.frontmatter ?? {});
        if (!text.includes(plan.query)) continue;
        items.push(await createPlanItem(engine, plan, {
          target_object_type: 'page_version',
          target_object_id: String(version.id),
          field_path: field,
          text,
          status: 'unsupported',
        }));
      }
    }
  }
  items.push(...await createProfileMemoryUnsupportedItems(engine, plan));
  items.push(...await createPersonalEpisodeUnsupportedItems(engine, plan));
  items.push(...await createMemoryCandidateUnsupportedItems(engine, plan));
  items.push(...await createRetrievalTraceUnsupportedItems(engine, plan));
  return items;
}

async function createPlanItem(
  engine: BrainEngine,
  plan: MemoryRedactionPlan,
  input: {
    target_object_type: MemoryRedactionPlanItem['target_object_type'];
    target_object_id: string;
    field_path: string;
    text: string;
    status: MemoryRedactionPlanItem['status'];
  },
): Promise<MemoryRedactionPlanItem> {
  return engine.createMemoryRedactionPlanItem({
    id: redactionItemId(plan.id, input.target_object_type, input.target_object_id, input.field_path),
    plan_id: plan.id,
    target_object_type: input.target_object_type,
    target_object_id: input.target_object_id,
    field_path: input.field_path,
    before_hash: hashText(input.text),
    after_hash: null,
    status: input.status,
    preview_text: previewText(input.text, plan.query),
  });
}

async function createProfileMemoryUnsupportedItems(
  engine: BrainEngine,
  plan: MemoryRedactionPlan,
): Promise<MemoryRedactionPlanItem[]> {
  const items: MemoryRedactionPlanItem[] = [];
  for (const entry of (await listAllProfileMemoryEntries(engine, plan.scope_id)).sort(byId)) {
    for (const field of profileMemoryTextFields(entry)) {
      if (!field.text.includes(plan.query)) continue;
      items.push(await createPlanItem(engine, plan, {
        target_object_type: 'profile_memory',
        target_object_id: entry.id,
        field_path: field.path,
        text: field.text,
        status: 'unsupported',
      }));
    }
  }
  return items;
}

async function createPersonalEpisodeUnsupportedItems(
  engine: BrainEngine,
  plan: MemoryRedactionPlan,
): Promise<MemoryRedactionPlanItem[]> {
  const items: MemoryRedactionPlanItem[] = [];
  for (const entry of (await listAllPersonalEpisodeEntries(engine, plan.scope_id)).sort(byId)) {
    for (const field of personalEpisodeTextFields(entry)) {
      if (!field.text.includes(plan.query)) continue;
      items.push(await createPlanItem(engine, plan, {
        target_object_type: 'personal_episode',
        target_object_id: entry.id,
        field_path: field.path,
        text: field.text,
        status: 'unsupported',
      }));
    }
  }
  return items;
}

async function createMemoryCandidateUnsupportedItems(
  engine: BrainEngine,
  plan: MemoryRedactionPlan,
): Promise<MemoryRedactionPlanItem[]> {
  const items: MemoryRedactionPlanItem[] = [];
  for (const entry of (await listAllMemoryCandidateEntries(engine, plan.scope_id)).sort(byId)) {
    for (const field of memoryCandidateTextFields(entry)) {
      if (!field.text.includes(plan.query)) continue;
      items.push(await createPlanItem(engine, plan, {
        target_object_type: 'memory_candidate',
        target_object_id: entry.id,
        field_path: field.path,
        text: field.text,
        status: 'unsupported',
      }));
    }
  }
  return items;
}

async function createRetrievalTraceUnsupportedItems(
  engine: BrainEngine,
  plan: MemoryRedactionPlan,
): Promise<MemoryRedactionPlanItem[]> {
  const items: MemoryRedactionPlanItem[] = [];
  for (const entry of (await listAllRetrievalTraces(engine)).sort(byId)) {
    for (const field of retrievalTraceTextFields(entry)) {
      if (!field.text.includes(plan.query)) continue;
      items.push(await createPlanItem(engine, plan, {
        target_object_type: 'retrieval_trace',
        target_object_id: entry.id,
        field_path: field.path,
        text: field.text,
        status: 'unsupported',
      }));
    }
  }
  return items;
}

async function listAllPages(engine: BrainEngine): Promise<Page[]> {
  const pages: Page[] = [];
  for (let offset = 0; ; offset += 500) {
    const batch = await engine.listPages({ limit: 500, offset });
    pages.push(...batch);
    if (batch.length < 500) return pages;
  }
}

async function listAllProfileMemoryEntries(
  engine: BrainEngine,
  scopeId: string,
): Promise<ProfileMemoryEntry[]> {
  const entries: ProfileMemoryEntry[] = [];
  for (let offset = 0; ; offset += 500) {
    const batch = await engine.listProfileMemoryEntries({ scope_id: scopeId, limit: 500, offset });
    entries.push(...batch);
    if (batch.length < 500) return entries;
  }
}

async function listAllPersonalEpisodeEntries(
  engine: BrainEngine,
  scopeId: string,
): Promise<PersonalEpisodeEntry[]> {
  const entries: PersonalEpisodeEntry[] = [];
  for (let offset = 0; ; offset += 500) {
    const batch = await engine.listPersonalEpisodeEntries({ scope_id: scopeId, limit: 500, offset });
    entries.push(...batch);
    if (batch.length < 500) return entries;
  }
}

async function listAllMemoryCandidateEntries(
  engine: BrainEngine,
  scopeId: string,
): Promise<MemoryCandidateEntry[]> {
  const entries: MemoryCandidateEntry[] = [];
  for (let offset = 0; ; offset += 500) {
    const batch = await engine.listMemoryCandidateEntries({ scope_id: scopeId, limit: 500, offset });
    entries.push(...batch);
    if (batch.length < 500) return entries;
  }
}

async function listAllRetrievalTraces(engine: BrainEngine): Promise<RetrievalTrace[]> {
  const traces: RetrievalTrace[] = [];
  const since = new Date(0);
  const until = new Date('9999-12-31T23:59:59.999Z');
  for (let offset = 0; ; offset += 500) {
    const batch = await engine.listRetrievalTracesByWindow({ since, until, limit: 500, offset });
    traces.push(...batch);
    if (batch.length < 500) return traces;
  }
}

function assertSupportedApplyItems(items: MemoryRedactionPlanItem[]): void {
  const unsupported = items.find((item) => item.status === 'unsupported');
  if (unsupported) {
    throw new Error(`memory redaction plan contains unsupported item: ${unsupported.id}`);
  }
  const unsupportedPlanned = items.find((item) => item.status === 'planned' && item.target_object_type !== 'page');
  if (unsupportedPlanned) {
    throw new Error(`memory redaction plan item target is unsupported for apply: ${unsupportedPlanned.target_object_type}`);
  }
  const unsupportedField = items.find(
    (item) => item.status === 'planned'
      && item.target_object_type === 'page'
      && !PAGE_TEXT_FIELDS.includes(item.field_path as PageTextField),
  );
  if (unsupportedField) {
    throw new Error(`memory redaction plan item field is unsupported for apply: ${unsupportedField.field_path}`);
  }
}

function groupPageItems(items: MemoryRedactionPlanItem[]): Map<string, MemoryRedactionPlanItem[]> {
  const grouped = new Map<string, MemoryRedactionPlanItem[]>();
  for (const item of items) {
    const existing = grouped.get(item.target_object_id) ?? [];
    existing.push(item);
    grouped.set(item.target_object_id, existing);
  }
  for (const pageItems of grouped.values()) {
    pageItems.sort((left, right) => left.field_path.localeCompare(right.field_path));
  }
  return grouped;
}

async function planPageApplyResult(
  engine: BrainEngine,
  page: Page,
  plan: MemoryRedactionPlan,
  items: MemoryRedactionPlanItem[],
): Promise<PageApplyResult> {
  assertPageItemCas(page, items);
  const tags = await engine.getTags(page.slug);
  const next = applyPageItems(page, plan, items);
  const beforeContentHash = page.content_hash ?? importContentHash({
    title: page.title,
    type: page.type,
    compiled_truth: page.compiled_truth,
    timeline: page.timeline,
    frontmatter: page.frontmatter,
    tags,
  });
  const afterContentHash = importContentHash({
    title: page.title,
    type: page.type,
    compiled_truth: next.compiled_truth,
    timeline: next.timeline,
    frontmatter: page.frontmatter,
    tags,
  });
  return {
    originalPage: page,
    nextPage: {
      type: page.type,
      title: page.title,
      compiled_truth: next.compiled_truth,
      timeline: next.timeline,
      frontmatter: page.frontmatter,
    },
    beforeContentHash,
    afterContentHash,
    tags,
    itemResults: next.itemResults,
  };
}

function assertPageItemCas(page: Page, items: MemoryRedactionPlanItem[]): void {
  for (const item of items) {
    const field = item.field_path as PageTextField;
    const currentText = pageTextField(page, field);
    if (!item.before_hash) {
      throw new Error(`memory redaction plan item is missing before_hash: ${item.id}`);
    }
    if (hashText(currentText) !== item.before_hash) {
      throw new Error(`memory redaction plan item target changed since review: ${item.id}`);
    }
  }
}

function applyPageItems(
  page: Page,
  plan: MemoryRedactionPlan,
  items: MemoryRedactionPlanItem[],
): {
  compiled_truth: string;
  timeline: string;
  itemResults: Array<{ id: string; field_path: string; before_hash: string; after_hash: string }>;
} {
  let compiledTruth = page.compiled_truth;
  let timeline = page.timeline;
  const itemResults: Array<{ id: string; field_path: string; before_hash: string; after_hash: string }> = [];

  for (const item of items) {
    const field = item.field_path as PageTextField;
    const beforeText = field === 'compiled_truth' ? compiledTruth : timeline;
    const afterText = replaceAllLiteral(beforeText, plan.query, plan.replacement_text);
    if (field === 'compiled_truth') {
      compiledTruth = afterText;
    } else {
      timeline = afterText;
    }
    itemResults.push({
      id: item.id,
      field_path: field,
      before_hash: item.before_hash ?? hashText(beforeText),
      after_hash: hashText(afterText),
    });
  }

  return {
    compiled_truth: compiledTruth,
    timeline,
    itemResults,
  };
}

async function writeRedactedPage(engine: BrainEngine, result: PageApplyResult): Promise<Page> {
  const storedPage = await engine.putPage(result.originalPage.slug, {
    ...result.nextPage,
    content_hash: result.afterContentHash,
  });

  const newTags = new Set(result.tags);
  for (const old of await engine.getTags(storedPage.slug)) {
    if (!newTags.has(old)) await engine.removeTag(storedPage.slug, old);
  }
  for (const tag of result.tags) {
    await engine.addTag(storedPage.slug, tag);
  }

  await engine.deleteChunks(storedPage.slug);
  await engine.upsertChunks(
    storedPage.slug,
    buildPageChunks(storedPage.compiled_truth, storedPage.timeline, storedPage.frontmatter),
  );

  const existingManifest = await engine.getNoteManifestEntry(
    DEFAULT_NOTE_MANIFEST_SCOPE_ID,
    storedPage.slug,
  );
  const manifest = await engine.upsertNoteManifestEntry(buildNoteManifestEntry({
    scope_id: existingManifest?.scope_id ?? DEFAULT_NOTE_MANIFEST_SCOPE_ID,
    page_id: storedPage.id,
    slug: storedPage.slug,
    path: existingManifest?.path ?? `${storedPage.slug}.md`,
    tags: result.tags,
    content_hash: result.afterContentHash,
    page: {
      type: storedPage.type,
      title: storedPage.title,
      compiled_truth: storedPage.compiled_truth,
      timeline: storedPage.timeline,
      frontmatter: storedPage.frontmatter,
      content_hash: storedPage.content_hash,
    },
  }));
  await engine.replaceNoteSectionEntries(
    manifest.scope_id,
    manifest.slug,
    buildNoteSectionEntries({
      scope_id: manifest.scope_id,
      page_id: storedPage.id,
      page_slug: storedPage.slug,
      page_path: manifest.path,
      page: {
        type: storedPage.type,
        title: storedPage.title,
        compiled_truth: storedPage.compiled_truth,
        timeline: storedPage.timeline,
        frontmatter: storedPage.frontmatter,
        content_hash: storedPage.content_hash,
      },
      manifest,
    }),
  );

  return storedPage;
}

function redactionPlanSnapshot(
  plan: MemoryRedactionPlan,
  items: MemoryRedactionPlanItem[],
): Record<string, unknown> {
  return {
    id: plan.id,
    scope_id: plan.scope_id,
    query: plan.query,
    replacement_text: plan.replacement_text,
    status: plan.status,
    requested_by: plan.requested_by,
    review_reason: plan.review_reason,
    reviewed_at: plan.reviewed_at,
    applied_at: plan.applied_at,
    item_ids: items.map((item) => item.id).sort(),
    item_statuses: Object.fromEntries(items.map((item) => [item.id, item.status]).sort()),
  };
}

function redactionItemId(planId: string, targetType: string, targetId: string, field: string): string {
  return `redaction-item:${hashText(`${planId}\0${targetType}\0${targetId}\0${field}`).slice(0, 32)}`;
}

function pageTextField(page: Page, field: PageTextField): string {
  return field === 'compiled_truth' ? page.compiled_truth : page.timeline;
}

function profileMemoryTextFields(entry: ProfileMemoryEntry): Array<{ path: string; text: string }> {
  return [
    { path: 'subject', text: entry.subject },
    { path: 'content', text: entry.content },
    { path: 'source_refs', text: entry.source_refs.join('\n') },
  ];
}

function personalEpisodeTextFields(entry: PersonalEpisodeEntry): Array<{ path: string; text: string }> {
  return [
    { path: 'title', text: entry.title },
    { path: 'summary', text: entry.summary },
    { path: 'source_refs', text: entry.source_refs.join('\n') },
  ];
}

function memoryCandidateTextFields(entry: MemoryCandidateEntry): Array<{ path: string; text: string }> {
  return [
    { path: 'proposed_content', text: entry.proposed_content },
    { path: 'source_refs', text: entry.source_refs.join('\n') },
    { path: 'review_reason', text: entry.review_reason ?? '' },
    { path: 'patch_provenance_summary', text: entry.patch_provenance_summary ?? '' },
  ];
}

function retrievalTraceTextFields(entry: RetrievalTrace): Array<{ path: string; text: string }> {
  return [
    { path: 'route', text: entry.route.join('\n') },
    { path: 'source_refs', text: entry.source_refs.join('\n') },
    { path: 'derived_consulted', text: entry.derived_consulted.join('\n') },
    { path: 'verification', text: entry.verification.join('\n') },
    { path: 'scope_gate_reason', text: entry.scope_gate_reason ?? '' },
    { path: 'outcome', text: entry.outcome },
  ];
}

function byId(left: { id: string }, right: { id: string }): number {
  return left.id.localeCompare(right.id);
}

function previewText(text: string, query: string): string {
  const index = text.indexOf(query);
  if (index < 0) return '';
  const start = Math.max(0, index - 40);
  const end = Math.min(text.length, index + query.length + 40);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

function replaceAllLiteral(text: string, query: string, replacement: string): string {
  return text.split(query).join(replacement);
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function requiredString(field: string, value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`memory redaction plan ${field} must be a non-empty string`);
  }
  return value.trim();
}

function normalizeSourceRefs(input: string[] | undefined, defaultValue: string[]): string[] {
  if (input === undefined) return [...defaultValue];
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error('memory redaction source_refs must contain at least one provenance reference');
  }
  return input.map((sourceRef, index) => {
    if (typeof sourceRef !== 'string' || sourceRef.trim().length === 0) {
      throw new Error(`memory redaction source_refs[${index}] must be a non-empty string`);
    }
    return sourceRef.trim();
  });
}
