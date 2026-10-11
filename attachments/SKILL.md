---
name: universal-article-reader
description: Extract full article text plus image and embedded media URLs from any webpage. Trigger when user provides a URL and asks to read, summarize, extract, or get the full content of a page. Works on any domain.
version: 1.2.0
---

# Universal Article Reader & Content Extractor

Extract the complete readable article text and all image / embedded media URLs from any given webpage when the direct fetch returns incomplete, limited, or inaccessible content.

This skill treats every URL the same. There are no domain-specific branches.

## When to Use This Skill

Trigger immediately when:
- User pastes a URL and asks to "read", "get full text", "extract article", "summarize this", or similar
- A normal page fetch returns limited, incomplete, truncated, or inaccessible content
- User mentions they cannot access the full article
- User wants images or embedded content (videos, posts, iframes, etc.) from a page

Do **not** use for:
- Local files already in the workspace
- Pure API endpoints or non-HTML resources
- Pages that require login credentials the user does not possess

## Core Workflow

Follow these steps in order. Stop as soon as you have clean full article text.

### Step 1: Direct Fetch (Fast Path)

1. Attempt a normal fetch of the original URL using available tools (`open_page`, `web_fetch`, or equivalent).
2. Inspect the response:
   - If full article body is present → extract text + media and return.
   - If the content is limited, truncated, incomplete, or blocked → proceed to Step 2.

### Step 2: Archive & Mirror Cascade

Try these transformed URLs in order. Use the first one that returns usable full text.

| Priority | Service                  | URL Pattern                                                                 | Notes                                      |
|----------|--------------------------|-----------------------------------------------------------------------------|--------------------------------------------|
| 1        | Archive.today latest     | `https://archive.today/latest/{original_url}`                               | Strong general-purpose archive             |
| 2        | Archive.ph               | `https://archive.ph/{original_url}`                                         | Same network                               |
| 3        | Archive.is               | `https://archive.is/{original_url}`                                         | Mirror                                     |
| 4        | Archive.fo               | `https://archive.fo/{original_url}`                                         | Mirror                                     |
| 5        | Archive.li               | `https://archive.li/{original_url}`                                         | Mirror                                     |
| 6        | Archive.md               | `https://archive.md/{original_url}`                                         | Mirror                                     |
| 7        | Freedium                 | `https://freedium.cfd/{url_encoded_original_url}`                           | Effective on many modern sites             |
| 8        | Freedium Mirror          | `https://freedium-mirror.cfd/{url_encoded_original_url}`                    | Backup                                     |
| 9        | RemovePaywalls           | `https://removepaywalls.com/{original_url}`                                 | Multi-method aggregator                    |
| 10       | RemovePaywall            | `https://removepaywall.com/{original_url}`                                  | Alternative domain                         |
| 11       | RemovePaywall.co         | `https://removepaywall.co/{original_url}`                                   | Archive-oriented variant                   |
| 12       | Smry.ai                  | `https://smry.ai/{original_url}`                                            | AI-assisted extraction + archive fallback  |
| 13       | Content Reader           | `https://www.bypasspaywallreader.com/search.html?url={original_url}`        | Multi-source aggregator                    |
| 14       | Archive Searcher         | `https://paywallskipper.com/` (paste URL)                                   | Multi-archive searcher                     |
| 15       | Ghost Archive            | `https://ghostarchive.org/search?term={original_url}`                       | Independent archive                        |
| 16       | Wayback Machine          | `https://web.archive.org/web/{original_url}`                                | Historical snapshots                       |
| 17       | Wayback Machine (id_)    | `https://web.archive.org/web/id_/{original_url}`                            | Identity/latest useful capture             |

**Implementation notes:**
- Prefer tools that can handle JavaScript-rendered content when available.
- If a service returns only a wrapper, interface page, challenge, or empty result, treat it as failure and immediately move to the next.
- For Archive.today family you may also try `/oldest/` if `/latest/` fails.
- URL-encode the original URL when the service requires it (especially Freedium-style endpoints).
- Try multiple archive mirrors before moving to other services.

### Step 3: Alternative Client Identity

If the archive/mirror cascade returns nothing useful:
- Re-fetch the original URL using a common search-engine client identity:
  - `Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)`
  - or `Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)`
- Add `Referer: https://www.google.com/` when the tool allows custom headers.
- Some sites return fuller content to known indexing clients.

### Step 4: Structured Data & Alternate Version Extraction

If page HTML is obtainable but the main article text is hidden or truncated:
1. Look for `<script type="application/ld+json">` containing `articleBody`.
2. Check for an alternate version via `<link rel="amphtml" href="...">` and fetch that URL.
3. Check for `__NEXT_DATA__`, `__INITIAL_STATE__`, or similar hydration payloads that embed the full text.
4. Extract any JSON-LD, OpenGraph, or schema.org article data.

### Step 5: Content Extraction Rules

Once you have a usable page:

**Article Text**
- Prefer the main article body. Strip navigation, ads, related articles, comments, footers, and promotional overlays.
- Preserve headings, paragraphs, lists, and blockquotes.
- Keep title, author, and publish date when available.
- If the text is truncated, note it clearly and continue to the next method.

**Images**
- Collect every meaningful content image (ignore tracking pixels, icons, logos, sprites).
- Return the absolute URL of each image.
- Prefer the highest-resolution version when multiple sizes exist (`srcset`, `data-src`, `data-lazy-src`, etc.).
- Include alt text when present.

**Embedded / Rich Content**
- Collect URLs or embed sources for:
  - Video players
  - Social posts
  - iframes of interactive content
  - Audio players
  - Data visualizations or interactive graphics
- Prefer the canonical source URL when available.

### Step 6: Output Format

Always structure the final response as:

```markdown
## Article

**Title:** ...
**Author:** ...
**Published:** ...
**Original URL:** ...

[Full clean article text here]

---

## Images

- ![alt text](https://full-image-url-1)
- ![alt text](https://full-image-url-2)
...

## Embedded Content

- Video: https://...
- Post: https://...
- Other: https://... or embed snippet
```

If only partial content was recovered, clearly state which method succeeded and what is missing.

## Error Handling & Fallbacks

If **all** methods fail:

1. Report which major services were tried.
2. Offer the user these options:
   - Paste the article text manually
   - Provide a screenshot or PDF
   - Share the article title so you can search for alternative coverage
3. Never invent or hallucinate article content.

## Success Criteria

The skill succeeds when:
- Full (or near-full) article body text is recovered
- Key images are listed with absolute URLs
- Embedded media URLs are captured
- Output is clean and readable
- The method used is transparent

## Quick Reference – Recommended Order

1. Direct fetch
2. Archive.today / archive.ph / archive.is / archive.fo / archive.li / archive.md
3. Freedium / Freedium Mirror
4. RemovePaywalls / RemovePaywall / RemovePaywall.co
5. Smry.ai
6. Content Reader / Archive Searcher
7. Ghost Archive
8. Wayback Machine
9. Alternative client identity
10. Structured data / alternate version extraction
11. Ask user for manual paste
