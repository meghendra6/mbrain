export type SlugQualityRule =
  | 'vague-slug'
  | 'numeric-only-slug'
  | 'global-docs-bucket'
  | 'short-slug'
  | 'placeholder-like-slug';

export interface SlugQualityIssue {
  slug: string;
  path: string;
  line: number | undefined;
  rule: SlugQualityRule;
  message: string;
  suggestion: string;
}

const vagueLeaves = new Set(['readme', 'docs', 'document', 'note', 'notes', 'untitled']);
const shortLeafAllowlist = new Set(['ai', 'ml', 'ui', 'ux', 'db', 'ci', 'go', 'js', 'qa', 'os', 'id', 's3']);

export function findSlugQualityIssues(slug: string, path?: string): SlugQualityIssue[] {
  const normalized = normalizeSlug(slug);
  const issuePath = path ?? (slug.match(/\.mdx?$/i) ? slug : `${slug}.md`);
  const segments = normalized.split('/').filter(Boolean);
  const leaf = segments.at(-1) ?? '';
  const issues: SlugQualityIssue[] = [];

  function addIssue(rule: SlugQualityRule, message: string, suggestion: string): void {
    issues.push({ slug: normalized, path: issuePath, line: undefined, rule, message, suggestion });
  }

  const docsBucketIndex = findGlobalDocsBucketIndex(segments);
  if (docsBucketIndex >= 0 && !isProjectScopedDocsPath(segments, docsBucketIndex)) {
    addIssue(
      'global-docs-bucket',
      'Global documentation bucket paths hide the durable identity namespace.',
      'Move the page under a project, system, or concept namespace.'
    );
  }

  if (vagueLeaves.has(leaf) || (leaf === 'overview' && !hasProjectOrSystemParent(segments))) {
    addIssue(
      'vague-slug',
      'The leaf slug is too generic to be a durable identity.',
      'Use a descriptive slug that names the specific subject.'
    );
  }

  if (/^\d+$/.test(leaf)) {
    addIssue(
      'numeric-only-slug',
      'Numeric-only leaf slugs do not describe the page identity.',
      'Add descriptive words to the numeric prefix.'
    );
  }

  if (leaf.length > 0 && leaf.length < 3 && !shortLeafAllowlist.has(leaf)) {
    addIssue(
      'short-slug',
      'Very short leaf slugs are unclear unless they are common acronyms.',
      'Use a longer descriptive slug.'
    );
  }

  const placeholderSegment = segments.find(isPlaceholderLikeSegment);
  if (placeholderSegment) {
    addIssue(
      'placeholder-like-slug',
      `The slug segment "${placeholderSegment}" looks like degraded placeholder text.`,
      'Replace placeholder characters with a readable descriptive slug.'
    );
  }

  return issues;
}

function normalizeSlug(slug: string): string {
  return slug
    .replaceAll('\\', '/')
    .replace(/^\.\//, '')
    .replace(/\.mdx?$/i, '')
    .toLowerCase();
}

function hasProjectOrSystemParent(segments: string[]): boolean {
  return segments.some((segment, index) => (
    (segment === 'projects' || segment === 'systems') &&
    segments.length - index >= 3
  ));
}

function findGlobalDocsBucketIndex(segments: string[]): number {
  return segments.findIndex((segment, index) => segment === 'docs' && segments[index + 1] && segments[index + 2]);
}

function isProjectScopedDocsPath(segments: string[], docsIndex: number): boolean {
  return docsIndex >= 2 && segments[docsIndex - 2] === 'projects' && segments[docsIndex - 1].length > 0;
}

function isPlaceholderLikeSegment(segment: string): boolean {
  return (
    /_{2,}/.test(segment) ||
    /^[_-]+$/.test(segment) ||
    /^_?pro_+$/.test(segment)
  );
}
