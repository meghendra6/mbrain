/**
 * Scenario S4 — Personal route denies work scope at service layer.
 *
 * Falsifies invariant I5 from docs/architecture/redesign/00-principles-and-invariants.md:
 * "Work memory and personal memory remain isolated by default. Cross-scope
 *  retrieval or write behavior requires an explicit scope decision."
 *
 * And the service-layer enforcement claim from PR #34:
 * the scope gate is enforced inside personal-lookup services, not only at the
 * dispatcher. Any direct caller bypassing the selector must still be denied.
 */

import { describe, expect, test } from 'bun:test';
import { allocateSqliteBrain } from './helpers.ts';
import { getPersonalProfileLookupRoute } from '../../src/core/services/personal-profile-lookup-route-service.ts';
import { getPersonalEpisodeLookupRoute } from '../../src/core/services/personal-episode-lookup-route-service.ts';

describe('S4 — personal route denies work scope at service layer', () => {
  test('getPersonalProfileLookupRoute refuses requested_scope=work and never reads profile memory', async () => {
    const handle = await allocateSqliteBrain('s04-profile');

    try {
      await handle.engine.upsertProfileMemoryEntry({
        id: 'profile-should-not-be-read',
        scope_id: 'personal:default',
        profile_type: 'routine',
        subject: 'daily-exercise',
        content: 'Thirty minutes of cardio before breakfast.',
        source_refs: ['User, direct message, 2026-04-23 2:00 PM KST'],
        sensitivity: 'personal',
        export_status: 'exportable',
        last_confirmed_at: null,
        superseded_by: null,
      });

      const denied = await getPersonalProfileLookupRoute(handle.engine, {
        subject: 'daily-exercise',
        requested_scope: 'work',
      });

      // Contract: scope gate denies the request.
      expect(denied.selection_reason).toBe('unsupported_scope_intent');
      expect(denied.candidate_count).toBe(0);
      expect(denied.route).toBeNull();
    } finally {
      await handle.teardown();
    }
  });

  test('getPersonalEpisodeLookupRoute refuses requested_scope=work and never reads episodes', async () => {
    const handle = await allocateSqliteBrain('s04-episode');

    try {
      await handle.engine.createPersonalEpisodeEntry({
        id: 'episode-should-not-be-read',
        scope_id: 'personal:default',
        title: 'Morning reset',
        start_time: new Date('2026-04-23T06:00:00.000Z'),
        end_time: new Date('2026-04-23T06:30:00.000Z'),
        source_kind: 'chat',
        summary: 'Sensitive personal reflection that must not leak into work.',
        source_refs: ['User, direct message, 2026-04-23 2:05 PM KST'],
        candidate_ids: [],
      });

      const denied = await getPersonalEpisodeLookupRoute(handle.engine, {
        title: 'Morning reset',
        requested_scope: 'work',
      });

      expect(denied.selection_reason).toBe('unsupported_scope_intent');
      expect(denied.candidate_count).toBe(0);
      expect(denied.route).toBeNull();
    } finally {
      await handle.teardown();
    }
  });

  test('getPersonalProfileLookupRoute with requested_scope=personal does allow the happy path', async () => {
    // Positive control: make sure the deny path above is specific, not universal.
    const handle = await allocateSqliteBrain('s04-profile-allow');

    try {
      await handle.engine.upsertProfileMemoryEntry({
        id: 'profile-visible',
        scope_id: 'personal:default',
        profile_type: 'routine',
        subject: 'daily-exercise',
        content: 'Thirty minutes of cardio before breakfast.',
        source_refs: ['User, direct message, 2026-04-23 2:00 PM KST'],
        sensitivity: 'personal',
        export_status: 'exportable',
        last_confirmed_at: null,
        superseded_by: null,
      });

      const allowed = await getPersonalProfileLookupRoute(handle.engine, {
        subject: 'daily-exercise',
        requested_scope: 'personal',
      });

      expect(allowed.selection_reason).toBe('direct_subject_match');
      expect(allowed.candidate_count).toBe(1);
      expect(allowed.route).not.toBeNull();
      expect(allowed.route!.route_kind).toBe('personal_profile_lookup');
    } finally {
      await handle.teardown();
    }
  });
});
