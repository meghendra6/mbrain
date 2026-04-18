# Briefing Skill

Compile a daily briefing from brain context.

> **Filing rule:** When the briefing creates or updates brain pages,
> follow `skills/_brain-filing-rules.md`.

## Workflow

1. **Today's meetings.** For each meeting on the calendar:
   - Search mbrain for each participant by name
   - Read their pages from mbrain for compiled_truth context
   - Summarize: who they are, recent timeline, relationship to you
2. **Active deals.** List deal pages in mbrain filtered to active status:
   - Deadlines approaching in the next 7 days
   - Recent timeline entries (last 7 days)
3. **Time-sensitive threads.** Open items from timeline entries:
   - Items with deadlines in the next 48 hours
   - Follow-ups that are overdue
4. **Recent changes.** Pages updated in the last 24 hours:
   - What changed and why (read timeline entries from mbrain)
5. **People in play.** List person pages in mbrain sorted by recency:
   - Updated in last 7 days
   - Have high activity (many recent timeline entries)
6. **Stale alerts.** From mbrain health check:
   - Pages flagged as stale that are relevant to today's meetings

## MBrain-Native Context Loading

Before generating any briefing, load context from mbrain systematically.

### Before a meeting

For every attendee on the calendar invite:
- `mbrain search "<attendee name>"` -- find their brain page
- `mbrain get <slug>` -- load compiled truth, recent timeline, relationship context
- If no page exists, note the gap ("No brain page for Sarah Chen -- consider enrichment")

### Before an email reply

Before drafting or triaging any email:
- `mbrain search "<sender name>"` -- load sender context
- Read their compiled truth to understand who they are, what they care about, and
  your relationship history. This turns a cold reply into an informed one.

### Daily briefing queries

Run these queries to populate the briefing sections:
- `mbrain query "active deals status"` -- deal pipeline snapshot
- `mbrain query "meetings this week"` -- recent meeting pages with insights
- `mbrain query "pending commitments follow-ups"` -- open threads and action items
- `mbrain search --type person --sort updated --limit 10` -- people in play

## Output Format

```
DAILY BRIEFING -- [date]
========================

MEETINGS TODAY
- [time] [meeting name]
  Participants: [name] (slug: people/name, [key context])

ACTIVE DEALS
- [deal name] -- [status], deadline: [date]
  Recent: [latest timeline entry]

ACTION ITEMS
- [item] -- due [date], related to [slug]

RECENT CHANGES (24h)
- [slug] -- [what changed]

PEOPLE IN PLAY
- [name] -- [why they're active]
```

## Back-Linking During Briefing

If the briefing creates or updates any brain pages (e.g., new meeting prep
pages, updated entity pages), the back-linking iron law applies: every entity
mentioned must have a back-link from their page. See `skills/_brain-filing-rules.md`.

## Citation in Briefings

When presenting facts from brain pages, include inline citations:
- "Jane is CTO of Acme [Source: people/jane-doe, updated 2026-04-01]"
- This lets the user trace any claim back to the brain page and assess freshness

## Tools Used

- Search mbrain by name (query)
- Read a page from mbrain (get_page)
- List pages in mbrain by type (list_pages)
- Check mbrain health (get_health)
- View timeline entries in mbrain (get_timeline)
