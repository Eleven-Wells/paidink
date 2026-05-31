# Explore Pills Interactivity & Category Enum Revamp

## Summary

Make the explore page (`/browse`) category filter pills functional by wiring them to the backend, revamping the Post category enum from a tech-focused set to a generalized content set, updating all related forms/services/tests, and adding a data migration script.

---

## Motivation

The explore page pills are non-interactive (no click handler, no backend filtering). The category system is also inconsistent — the Post model enum (`backend`, `javascript`, `performance`, `ai-tools`, `devops`, `career`) doesn't match the config `CATEGORY_ENUM` (`tech`, `news`, `sports`, `entertainment`, `politics`, `business`, `health`, `lifestyle`), which means publisher-posted content with config-based categories fails Mongoose validation.

The platform has evolved from tech-only to general-interest, so both enums should be unified and expanded.

---

## Scope

1. Revamp Post model `category` enum + config `CATEGORY_ENUM` to `['development', 'business', 'health', 'lifestyle', 'news', 'sports', 'entertainment', 'politics']`
2. Update `CATEGORY_NAMES` display names
3. Update admin create-post form (hardcoded `<option>` list)
4. Update `ContentService.CATEGORY_MAP` for AI-generated content
5. Update `scripts/seed.js`
6. Update `tests/unit/validation.test.js`
7. Create `scripts/migrate-categories.js` to remap existing posts
8. Split explore-top-nav into two zones (view pills fixed left, category pills scrollable right)
9. Wire pills to backend filtering in `/browse` route
10. Update `browse.ejs` fallback to use config variable

---

## Data Model

### New Post model enum

```js
enum: ['development', 'business', 'health', 'lifestyle', 'news', 'sports', 'entertainment', 'politics']
```

### New CATEGORY_ENUM

```js
['development', 'business', 'health', 'lifestyle', 'news', 'sports', 'entertainment', 'politics']
```

### New CATEGORY_NAMES

```js
en: {
    development: 'Development',
    business: 'Business',
    health: 'Health',
    lifestyle: 'Lifestyle',
    news: 'News',
    sports: 'Sports',
    entertainment: 'Entertainment',
    politics: 'Politics'
}
```

### Migration Mapping

| Old Value | New Value |
|-----------|-----------|
| backend | development |
| javascript | development |
| performance | development |
| ai-tools | development |
| devops | development |
| career | lifestyle |

---

## Files to Change

| File | Change |
|------|--------|
| `src/models/Post.js:30` | Update `enum` array |
| `src/config/index.js:4-27` | Update `CATEGORY_ENUM` + `CATEGORY_NAMES` |
| `src/views/admin/pages/create-post.ejs:56-69` | Replace `<option>` values + labels |
| `src/services/ContentService.js:44-51,166-168` | Update `CATEGORY_MAP`, change `mapCategory` default |
| `scripts/seed.js:24,55,87,118,150,180` | Update sample post categories |
| `tests/unit/validation.test.js:76-89` | Update expected categories + count |
| `src/views/pages/browse.ejs:1-20` | Remove hardcoded fallback array |
| `src/views/partials/explore-top-nav.ejs` | Two-zone layout |
| `src/routes/pages.js:1024-1028` | Add category filtering by `tab` param |

### New File

| File | Purpose |
|------|---------|
| `scripts/migrate-categories.js` | One-time migration: remaps old category values to new ones |

---

## Explore Pills Layout

```
[ Explore* | FOR YOU | TRENDING | LATEST ] | [ Development | Business | Health | Lifestyle | News | Sports | Entertainment | Politics ]
    ^-- view pills (fixed left, uppercase/muted)     ^-- category pills (scrollable right, maroon border)
```

- **View pills**: `flex-shrink: 0`, uppercase, gray border, muted text
- **Divider**: 1px vertical line
- **Category pills**: `overflow-x: auto`, maroon border, normal casing
- **Active pill**: filled maroon background + white text (existing behavior)
- **View-only pills** (`For you`, `Trending`, `Latest`): change sort/query but no category filter
- **Category pills**: `<a href="/browse?tab=<slug>">` for server-side navigation

---

## Backend Behavior for `/browse?tab=...`

| `tab` Value | Behavior |
|-------------|----------|
| `explore` (default) | All posts, sorted by `publishedAt` desc, limit 5 |
| `for-you` | All posts (placeholder — no personalization yet) |
| `trending` | All posts, sorted by `stats.views` desc, limit 5 |
| `latest` | All posts, sorted by `publishedAt` desc, limit 5 (same as explore) |
| `development`/`business`/etc. | Filter `Post.find({ category })`, sorted by `publishedAt` desc, limit 5 |

---

## Migration Script

```js
// scripts/migrate-categories.js
// Maps old tech categories to new generalized ones
const CATEGORY_MAP = {
    backend: 'development',
    javascript: 'development',
    performance: 'development',
    'ai-tools': 'development',
    devops: 'development',
    career: 'lifestyle'
};
```

- Run via `node scripts/migrate-categories.js`
- No undo — run against a backup first

---

## Test Updates

`tests/unit/validation.test.js`:
- Expect all 8 new categories
- Update count from 6 to 8

---

## Exclusions / Future Work

- "For you" personalization is not implemented — currently returns all posts
- The Post model enum change does not add MongoDB schema validation (just Mongoose); a future migration could add `$jsonSchema` if needed
- Post creation UX (publisher form styling) is not part of this scope
