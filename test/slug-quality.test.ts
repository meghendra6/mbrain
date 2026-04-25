import { describe, expect, test } from 'bun:test';
import { findSlugQualityIssues } from '../src/core/slug-quality.ts';

function rulesFor(slug: string): string[] {
  return findSlugQualityIssues(slug).map(issue => issue.rule);
}

describe('findSlugQualityIssues', () => {
  test('preserves file-like input paths while normalizing slug', () => {
    const [issue] = findSlugQualityIssues('README.md');

    expect(issue?.slug).toBe('readme');
    expect(issue?.path).toBe('README.md');
  });

  test('flags generic durable identities', () => {
    for (const slug of [
      'readme',
      'docs',
      'projects/mbrain/docs/readme',
      'projects/mbrain/docs/notes',
      'systems/mbrain/docs/document',
    ]) {
      expect(rulesFor(slug)).toContain('vague-slug');
    }
  });

  test('flags overview only when it lacks a project or system parent', () => {
    expect(rulesFor('overview')).toContain('vague-slug');
    expect(rulesFor('docs/overview')).toContain('vague-slug');
    expect(rulesFor('projects/mbrain/overview')).not.toContain('vague-slug');
    expect(rulesFor('systems/mbrain/overview')).not.toContain('vague-slug');
    expect(rulesFor('/tmp/brain/projects/mbrain/overview.md')).not.toContain('vague-slug');
    expect(rulesFor('/tmp/brain/systems/mbrain/overview.md')).not.toContain('vague-slug');
    expect(rulesFor('/tmp/docs/projects/mbrain/overview.md')).not.toContain('vague-slug');
  });

  test('flags numeric-only leaf slugs in any namespace', () => {
    for (const slug of [
      'docs/reference/90',
      'docs/archive/06',
      'projects/mbrain/docs/123',
      'concepts/42',
      'systems/mbrain/7',
    ]) {
      expect(rulesFor(slug)).toContain('numeric-only-slug');
    }
  });

  test('flags global documentation bucket paths regardless of leaf name', () => {
    for (const slug of [
      'docs/reference/sync-pipeline',
      'docs/archive/90',
      'docs/topic-index/project-scoping',
    ]) {
      expect(rulesFor(slug)).toContain('global-docs-bucket');
    }
  });

  test('flags global documentation bucket paths inside absolute file paths', () => {
    expect(rulesFor('/tmp/brain/docs/archive/17.md')).toContain('global-docs-bucket');
    expect(rulesFor('/tmp/brain/projects/mbrain/docs/manual/06-sync-pipeline.md')).not.toContain('global-docs-bucket');
  });

  test('flags placeholder-like degraded slug segments', () => {
    for (const slug of [
      'docs/_pro___',
      'projects/mbrain/docs/___',
      'concepts/---',
    ]) {
      expect(rulesFor(slug)).toContain('placeholder-like-slug');
    }
  });

  test('flags placeholder-like degraded namespace segments', () => {
    expect(rulesFor('projects/_pro___/docs/local-offline-setup')).toContain('placeholder-like-slug');
    expect(rulesFor('/tmp/brain/projects/___/docs/local-offline-setup.md')).toContain('placeholder-like-slug');
  });

  test('flags unclear very short leaf slugs while allowing common acronyms', () => {
    expect(rulesFor('projects/mbrain/docs/x')).toContain('short-slug');
    expect(rulesFor('concepts/q')).toContain('short-slug');
    expect(rulesFor('concepts/ai')).not.toContain('short-slug');
    expect(rulesFor('systems/db')).not.toContain('short-slug');
    expect(rulesFor('concepts/js')).not.toContain('short-slug');
    expect(rulesFor('systems/s3')).not.toContain('short-slug');
  });

  test('allows project-scoped descriptive replacements', () => {
    expect(findSlugQualityIssues('projects/mbrain/docs/reference/90-release-readiness')).toEqual([]);
    expect(findSlugQualityIssues('projects/mbrain/docs/manual/06-sync-pipeline')).toEqual([]);
    expect(findSlugQualityIssues('systems/mbrain')).toEqual([]);
    expect(findSlugQualityIssues('concepts/brain-agent-loop')).toEqual([]);
  });
});
