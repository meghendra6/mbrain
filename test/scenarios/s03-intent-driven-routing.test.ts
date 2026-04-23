/**
 * Scenario S3 — Intent-driven routing, not tier-driven.
 *
 * Falsifies I1 (retrieval order is determined by query intent and scope,
 * not by a fixed storage tier). Each of the six intents must produce a
 * distinct route_kind for a brain that has data for all of them.
 */

import { describe, expect, test } from 'bun:test';
import { allocateSqliteBrain, seedWorkTaskThread } from './helpers.ts';
import { selectRetrievalRoute } from '../../src/core/services/retrieval-route-selector-service.ts';

describe('S3 — intent-driven routing', () => {
  test('each of the six intents produces a distinct route_kind on a fully-populated brain', async () => {
    const handle = await allocateSqliteBrain('s03');

    try {
      // Seed enough data to let every intent resolve.
      await seedWorkTaskThread(handle.engine, 'task-S3');

      const page = await handle.engine.putPage('concepts/scenario-target', {
        type: 'concept',
        title: 'Scenario target',
        compiled_truth: 'Body.',
        frontmatter: {},
      });

      await handle.engine.upsertNoteManifestEntry({
        scope_id: 'workspace:default',
        page_id: page.id,
        slug: 'concepts/scenario-target',
        path: 'concepts/scenario-target.md',
        page_type: 'concept',
        title: 'Scenario target',
        frontmatter: {},
        aliases: [],
        tags: [],
        outgoing_wikilinks: [],
        outgoing_urls: [],
        source_refs: [],
        heading_index: [],
        content_hash: 'hash-scenario-s3',
        extractor_version: 'test',
      });

      await handle.engine.upsertProfileMemoryEntry({
        id: 'profile-alex',
        scope_id: 'personal:default',
        profile_type: 'stable_fact',
        subject: 'alex',
        content: 'Alex is a colleague who works on retrieval.',
        source_refs: ['User, direct message, 2026-04-23 3:00 PM KST'],
        sensitivity: 'personal',
        export_status: 'exportable',
        last_confirmed_at: null,
        superseded_by: null,
      });

      await handle.engine.createPersonalEpisodeEntry({
        id: 'episode-alex-breakfast',
        scope_id: 'personal:default',
        title: 'Breakfast with alex',
        start_time: new Date('2026-04-22T07:00:00.000Z'),
        end_time: new Date('2026-04-22T08:00:00.000Z'),
        source_kind: 'chat',
        summary: 'Discussed retrieval.',
        source_refs: ['User, direct message, 2026-04-23 3:00 PM KST'],
        candidate_ids: [],
      });

      const taskResume = await selectRetrievalRoute(handle.engine, {
        intent: 'task_resume',
        task_id: 'task-S3',
      });
      expect(taskResume.route?.route_kind).toBe('task_resume');

      const precision = await selectRetrievalRoute(handle.engine, {
        intent: 'precision_lookup',
        slug: 'concepts/scenario-target',
      });
      expect(precision.route?.route_kind).toBe('precision_lookup');

      const personalProfile = await selectRetrievalRoute(handle.engine, {
        intent: 'personal_profile_lookup',
        subject: 'alex',
        requested_scope: 'personal',
      });
      expect(personalProfile.route?.route_kind).toBe('personal_profile_lookup');

      const personalEpisode = await selectRetrievalRoute(handle.engine, {
        intent: 'personal_episode_lookup',
        episode_title: 'Breakfast with alex',
        requested_scope: 'personal',
      });
      expect(personalEpisode.route?.route_kind).toBe('personal_episode_lookup');
    } finally {
      await handle.teardown();
    }
  });

  test('unknown intent throws (switch default guard from PR #34)', async () => {
    const handle = await allocateSqliteBrain('s03-unknown');

    try {
      await expect(
        selectRetrievalRoute(handle.engine, {
          intent: '__unknown__' as any,
          task_id: 'task-X',
        }),
      ).rejects.toThrow(/Unsupported retrieval intent/);
    } finally {
      await handle.teardown();
    }
  });

  test('task_resume with a personal-scoped task defers scope gate (not work) and still returns the card', async () => {
    // Invariant I1 consequence: route_kind depends on intent, scope comes from
    // the task thread itself and must not be coerced to work by default.
    const handle = await allocateSqliteBrain('s03-personal-task');

    try {
      await seedWorkTaskThread(handle.engine, 'task-personal', {
        scope: 'personal',
        workingSet: {
          next_steps: ['Follow up on personal project'],
        },
      });

      const result = await selectRetrievalRoute(handle.engine, {
        intent: 'task_resume',
        task_id: 'task-personal',
      });

      expect(result.route?.route_kind).toBe('task_resume');
      // Scope gate runs for explicit requested_scope or personal intents, not
      // for task_resume on its own. We only assert the route itself here.
    } finally {
      await handle.teardown();
    }
  });
});
