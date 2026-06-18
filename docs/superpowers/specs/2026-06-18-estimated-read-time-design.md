# Estimated Read Time for Blog Articles

## Summary

Add per-article estimated read time computed from content length, displayed consistently across both the article detail page and feed/list card views.

## Motivation

The codebase currently has ad-hoc, inconsistent read time estimation spread across multiple files:
- Feed/list views (pages.js): `wordCount / 200`
- Post detail template (post.ejs): `content.length / 1000`

This produces different results for the same post and is duplicated inline. A centralized, consistent approach is needed.

## Design

### ReadTimeService

A new utility service `src/services/ReadTimeService.js` with a single exported function:

```
getReadTime(content, options?): { minutes, display }
```

Parameters:
- `content`: the raw markdown string from Post.content
- `options.wpm`: words per minute (default 200, the standard average reading speed)
- `options.countImages`: whether to add time for embedded images (default true)

Implementation:
1. Strip markdown syntax before counting words — removes code blocks, image syntax, links (keeping link text), and formatting characters so rendering artifacts don't inflate the count
2. Count whitespace-delimited words from remaining text
3. Count image markdown patterns (`![alt](url)`)
4. Compute `minutes = wordCount / wpm + imageCount * 12 / 60` (12 seconds per image)
5. Round up via `Math.ceil`. If result < 1, return `{ minutes: 0, display: '< 1 min read' }`

Edge cases:
- Empty content → 0 words → `< 1 min read`
- Very short content (< 200 words) → same, since 199 words at 200 wpm rounds to < 1
- Content with only images → minutes from image time only; `< 1 min read` if under 60s

### Integration Points

| Location | File | Current Behavior | New Behavior |
|----------|------|-----------------|--------------|
| Profile saved posts | pages.js:342 | Inline `split(/\s+/).length / 200` | `getReadTime(post.content).display` |
| Home trending | pages.js:1009 | Inline `split(' ').length / 200` | Same |
| Explore trending | pages.js:1158 | Inline `split(' ').length / 200` | Same |
| Post detail route | pages.js (~line 1390) | Missing (template handles it) | Compute in route, attach to post |
| Post detail template | post.ejs:129 | `Math.ceil(content.length / 1000)` | `post.readTime.display` |
| Related post cards | post.ejs:279 | Inline `content.length / 1000` | `post.readTime.display` |

All feed computations happen in `pages.js` where posts are already iterated — each `post.readTime` assignment is replaced with a single `getReadTime(post.content).display` call.

### Data Flow

```
Post.content (raw markdown)
  → ReadTimeService.getReadTime(content)
    → stripMarkdown (remove formatting noise)
    → wordCount + imageTimeAdjustment
    → { minutes, display: "X min read" | "< 1 min read" }
  → attached to post object as post.readTime
  → consumed in EJS template
```

### No Schema Changes

Read time is computed at render time, not stored. This avoids:
- Data drift (content edits would leave stale stored values)
- Schema migrations for existing posts
- Re-computation hooks on save

## Files Changed

- `src/services/ReadTimeService.js` — new (the utility)
- `src/routes/pages.js` — replace 4 inline computations with service calls
- `src/views/pages/post.ejs` — use `post.readTime.display` instead of inline char calc
