# Query Skill

Answer questions using the brain's knowledge with 3-layer search and synthesis.

## Workflow

1. **Decompose the question** into search strategies:
   - Keyword search for specific names, dates, terms
   - Semantic query for conceptual questions
   - Structured queries (list by type, backlinks) for relational questions
2. **Execute searches:**
   - Keyword search mbrain for FTS matches (search)
   - Hybrid search mbrain for semantic+keyword with expansion (query)
   - List pages in mbrain by type or check backlinks for structural queries
3. **Read top results.** Read the top 3-5 pages from mbrain to get full context.
4. **Synthesize answer** with citations. Every claim traces back to a specific page slug.
5. **Flag gaps.** If the brain doesn't have info, say "the brain doesn't have information on X" rather than hallucinating.

## Technical Concept Queries

When the user asks about architecture, mechanisms, implementation details, or
cross-system technical concepts:

1. Search brain first:
   - `mbrain search "<concept or system name>"`
   - `mbrain query "what do we know about <concept or system name>"`
2. If a concept page has `codemap`:
   - read compiled truth for orientation
   - use the listed pointers for targeted code navigation
   - verify central pointers if `verified_at` is older than 30 days
3. If a concept page exists without `codemap`:
   - use the compiled truth as starting context
   - after code exploration, write back the missing pointers
4. If no concept/system page exists:
   - explore the codebase normally
   - create a `system` page and/or concept page with `codemap` before ending the task

The map is not a replacement for grep. It is the "map before territory" layer
that tells the agent which files are worth reading.

## Quality Rules

- Never hallucinate. Only answer from brain content.
- Cite sources: "According to concepts/do-things-that-dont-scale..."
- Flag stale results: if a search result shows [STALE], note that the info may be outdated
- For "who" questions, use backlinks and typed links to find connections
- For "what happened" questions, use timeline entries
- For "what do we know" questions, read compiled_truth directly

## Token-Budget Awareness

Search returns **chunks**, not full pages. Read the excerpts first before deciding
whether to load a full page.

- `mbrain search` / `mbrain query` return ranked chunks with context snippets.
  These are often enough to answer the question directly.
- Only use `mbrain get <slug>` to load the full page when a chunk confirms the
  page is relevant and you need more context (e.g., compiled truth, timeline).
- **"Tell me about X"** -- get the full page (the user wants the complete picture).
- **"Did anyone mention Y?"** -- search results are enough (the user wants a yes/no with evidence).

### Source precedence

When multiple sources provide conflicting information, follow this precedence:

1. **User's direct statements** (highest authority -- what the user told you directly)
2. **Compiled truth** (the brain's synthesized, cited understanding)
3. **Timeline entries** (raw evidence, reverse-chronological)
4. **External sources** (web search, API enrichment -- lowest authority)

When sources conflict, note the contradiction with both citations. Don't silently
pick one.

## Citation in Answers

When referencing brain pages in your answer, propagate inline citations:
- Cite the page: "According to [Source: people/jane-doe, compiled truth]..."
- When brain pages have inline `[Source: ...]` citations, propagate them so
  the user can trace facts to their origin
- When you synthesize across multiple pages, cite all sources

## Search Quality Awareness

If search results seem off (wrong results, missing known pages, irrelevant hits):
- Run `mbrain doctor --json` to check index health
- Check embedding coverage -- partial embeddings degrade hybrid search
- Compare keyword search (`mbrain search`) vs hybrid search (`mbrain query`)
  for the same query to isolate whether the issue is embedding-related
- Report search quality issues in the maintain workflow (see maintain skill)

## Tools Used

- Keyword search mbrain (search)
- Hybrid search mbrain (query)
- Read a page from mbrain (get_page)
- List pages in mbrain with filters (list_pages)
- Check backlinks in mbrain (get_backlinks)
- Traverse the link graph in mbrain (traverse_graph)
- View timeline entries in mbrain (get_timeline)
