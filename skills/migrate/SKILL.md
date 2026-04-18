# Migrate Skill

Universal migration from any wiki, note tool, or brain system into MBrain.

## Supported Sources

| Source | Format | Strategy |
|--------|--------|----------|
| Obsidian | Markdown + `[[wikilinks]]` | Direct import, convert wikilinks to mbrain links |
| Notion | Exported markdown or CSV | Parse Notion's export structure |
| Logseq | Markdown with `((block refs))` | Convert block refs to page links |
| Plain markdown | Any .md directory | Import directory into mbrain directly |
| CSV | Tabular data | Map columns to frontmatter fields |
| JSON | Structured data | Map keys to page fields |
| Roam | JSON export | Convert block structure to pages |

## General Workflow

1. **Assess the source.** What format? How many files? What structure?
2. **Plan the mapping.** How do source fields map to mbrain fields (type, title, tags, compiled_truth, timeline)?
3. **Test with a sample.** Import 5-10 files, verify by reading them back from mbrain and exporting.
4. **Bulk import.** Import the full directory into mbrain.
5. **Verify.** Check mbrain health and statistics, spot-check pages.
6. **Build links.** Extract cross-references from content and create typed links in mbrain.

## Obsidian Migration

1. Import the vault directory into mbrain (Obsidian vaults are markdown directories)
2. Convert `[[wikilinks]]` to mbrain links:
   - Read each page from mbrain
   - For each `[[Name]]` found, resolve to a slug and create a link in mbrain
   - `[[Name|alias]]` uses the alias for context

Obsidian-specific:
- Tags (`#tag`) become mbrain tags
- Frontmatter properties map to mbrain frontmatter
- Attachments (images, PDFs) are noted but handled separately via file storage

## Notion Migration

1. Export from Notion: Settings > Export > Markdown & CSV
2. Notion exports nested directories with UUIDs in filenames
3. Strip UUIDs from filenames for clean slugs
4. Map Notion's database properties to frontmatter
5. Import the cleaned directory into mbrain

## CSV Migration

For tabular data (e.g., CRM exports, contact lists):
1. For each row in the CSV, create a page with column values as frontmatter
2. Use a designated column as the slug (e.g., name)
3. Use another column as compiled_truth (e.g., notes)
4. Store each page in mbrain

## Verification

After any migration:
1. Check mbrain statistics to verify page count matches source
2. Check mbrain health for orphans and missing embeddings
3. Export pages from mbrain for round-trip verification
4. Spot-check 5-10 pages by reading them from mbrain
5. Test search: search mbrain for "someone you know is in the data"

## Tools Used

- Store/update pages in mbrain (put_page)
- Read pages from mbrain (get_page)
- Link entities in mbrain (add_link)
- Tag pages in mbrain (add_tag)
- Get mbrain statistics (get_stats)
- Check mbrain health (get_health)
- Search mbrain (query)
