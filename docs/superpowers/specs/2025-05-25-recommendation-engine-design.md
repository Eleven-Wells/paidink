# Recommendation Engine — Design Spec

## Context

Paidink is a reward-based content platform ("Read to Earn") built with Fastify + MongoDB + EJS. The current "recommendation" system is limited to tag/category scoring in `src/seo/internalLinking.js` (primarily for SEO internal linking). Feed is sorted by `publishedAt` DESC with no personalization. Rich engagement data exists via `ReadSession` (time spent, scroll depth, completion), likes, saves, shares, and comments.

**Primary business goal**: Increase publisher engagement — help publishers' content get discovered, incentivizing them to create more.

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                  Recommendation Engine                  │
│                                                        │
│  ┌────────────────┐    ┌────────────────────────┐      │
│  │ Content Pipeline│    │ Collaborative Pipeline  │      │
│  │ (autoEmbed via  │    │ (BullMQ nightly job)    │      │
│  │  Atlas Search)  │    │ Co-Read Matrix Mining   │      │
│  └───────┬────────┘    └───────────┬────────────┘      │
│          │                         │                     │
│          ▼                         ▼                     │
│  ┌──────────────────────────────────────────┐           │
│  │           Storage Layer                    │           │
│  │  MongoDB: Vector Search index +             │
│  │    UserInterestProfile model +              │
│  │    CoreadRelationships collection           │
│  │  Redis: Co-read matrix (hot) +              │
│  │    Interest profile cache (1h TTL)          │
│  └──────────────────┬───────────────────────┘           │
│                     │                                     │
│                     ▼                                     │
│  ┌──────────────────────────────────────────┐           │
│  │         Scoring Service                    │           │
│  │  Blends: vector_sim * category_affinity    │           │
│  │        + co_read + diversity + recency     │           │
│  └──────────────────┬───────────────────────┘           │
│                     │                                     │
│                     ▼                                     │
│  ┌──────────────────────────────────────────┐           │
│  │       API / Route Layer                    │           │
│  │  GET /api/recommendations/feed             │           │
│  │  GET /api/recommendations/related/:postId  │           │
│  │  GET /api/recommendations/for-you          │           │
│  └──────────────────────────────────────────┘           │
└──────────────────────────────────────────────────────────┘
```

**Key principle**: Two offline pipelines compute signals, stored in Mongo/Redis. An on-demand scoring service fuses them at query time. No expensive work in the request path.

## Components

### 1. Content Pipeline (Vector Search)

**What**: Semantic content similarity via MongoDB Atlas Vector Search.

**How**: Create a Vector Search index on the `posts` collection with type `autoEmbed`:
- Fields: `title`, `summary`, `tags`, `category`
- Embedding model: Voyage AI `voyage-4` (managed by Atlas)
- Embeddings auto-generate on document create/update — no BullMQ job needed
- Query via `$vectorSearch` aggregation stage with `queryText`

**Result**: Semantic matching catches thematic relationships that tag/keyword matching misses (e.g., "state management in React" matches "useReducer hooks best practices" even with zero shared tags).

### 2. Collaborative Pipeline (Co-Read Mining)

**What**: Relationships between posts based on shared user reading patterns.

**How**:
- BullMQ nightly job (`co-read-mining`) queries `ReadSession` for past 30 days
- For each pair of posts read by the same user within a session, increment a weighted score
- Weighting: completed reads with high time-spent count more than partial reads
- Store in Redis: `co-read:{postId}` as a sorted set of `{relatedPostId: weight}`
- Query: `ZREVRANGE co-read:{postId} 0 20` for top co-read posts

**Effect**: Surfaces quality content organically — if many readers of post X go on to read post Y, Y gets recommended alongside X regardless of topic overlap.

### 3. User Interest Profiles

**What**: Per-user preference model built from reading history. Persisted in MongoDB, cached in Redis for hot-path performance.

**Mongoose model** (`src/models/UserInterestProfile.js`):
```js
{
  user: ObjectId,            // ref User, unique index, required
  categoryAffinity: {        // Map<String, Number>
    backend: 0.8,
    "ai-tools": 0.3
  },
  tagAffinity: {             // Map<String, Number>
    react: 0.6,
    nodejs: 0.4
  },
  publisherAffinity: {       // Map<String, Number>
    somePublisherId: 0.7
  },
  totalReads: { type: Number, default: 0 },
  lastReadAt: Date,
  updatedAt: Date
}
```

**Update flow** — on read completion (`src/routes/reads.js`):
- Find or create profile for the user (one doc per user)
- Apply incremental exponential moving average:
  ```
  new_affinity = (old_affinity || 0) × 0.9 + signal × 0.1
  ```
  where `signal = timeSpentSeconds / 60 × completed`
- Increment `totalReads`, set `lastReadAt` to now
- `profile.save()` — O(1) write per read completion
- Invalidate Redis cache for this user (or update it)

**Read flow**:
- Request comes in → `InterestProfileService.getProfile(userId)`
- Check Redis → hit? return cached
- Miss → `findOne({ userId })` — single indexed doc lookup, fast
- Validate: if `profile.totalReads < ReadSession.countDocuments({ user })`, rebuild from full `ReadSession` aggregation (self-healing)
- Set in Redis with 1h TTL → return

**Why not just Redis?**
- Profile is **derivable data** (summarized from `ReadSession`), but `ReadSession` is the source of truth
- Redis persists data only as long as memory allows — losing profiles means cold reads for all users until cache warms
- Mongo persistence means profiles survive restarts and redeploys
- Redis on the hot path gives sub-ms reads for the 95% case

**Self-healing**: The validation check (`totalReads` vs actual count) catches data drift from:
- Schema changes (new affinity fields added)
- Formula changes (old affinities computed with different weights)
- Manual corrections or backfills
- Any other sync issues

On mismatch, a full rebuild from `ReadSession` aggregation replaces the stored profile entirely. This can be triggered:
- Lazily on cache miss (as above)
- Via a nightly BullMQ job for all users with mismatches

### 4. Scoring Service

Core logic in `src/services/RecommendationService.js`. Fuses multiple signals into a final score:

```
score = vector_similarity  ×  categoryAffinityMultiplier  ×  0.35
      + co_read_score                                      ×  0.25
      + publisher_diversity_bonus                          ×  0.15
      + recency_boost                                      ×  0.15
      + global_engagement                                  ×  0.10
```

**Signal definitions**:
- `vector_similarity`: 0–1 from `$vectorSearch` score (semantic match between post content and user interests, or between two posts for related)
- `categoryAffinityMultiplier`: 0.5–2.0 based on user's affinity for this post's category (learned from read history). New users default to 1.0 for all categories.
- `co_read_score`: 0–1 from co-read matrix (0 if no co-read data)
- `publisher_diversity_bonus`: 1.0 if user hasn't seen this publisher in last 5 posts in feed, else 0. Prevents single-publisher domination — key for publisher engagement.
- `recency_boost`: 1.0 at publish → linear decay to 0 over 30 days
- `global_engagement`: Normalized completion rate of this post across all users

**Cold-start defaults**:
- New post (no reads): `co_read_score = 0.5` (not zero), `global_engagement = 0.3`
- New user (no history): `categoryAffinityMultiplier = 1.0` for all, fallback to trending for feed
- Anonymous user: Skip interest profile, use global trending + vector popularity

**Anonymous user fallback** (no session):
```
score = vector_popularity  ×  0.5
      + recency_boost      ×  0.3
      + global_engagement  ×  0.2
```

### 5. API / Route Layer

**New files**:

| File | Purpose |
|------|---------|
| `src/models/UserInterestProfile.js` | Mongoose schema for persistent profile storage |
| `src/services/RecommendationService.js` | Core scoring — `getFeed()`, `getRelated()`, `getForYou()` |
| `src/services/InterestProfileService.js` | Read/update/cache user interest profiles |
| `src/services/CoreadService.js` | Read/write co-read matrix in Redis |
| `src/routes/recommendations.js` | New API endpoints |
| `src/queue/jobs/co-read-mining.js` | Nightly BullMQ job |
| `scripts/create-vector-index.js` | One-time Atlas index creation script |

**Endpoints**:

```
GET /api/recommendations/feed
  Query: ?limit=10
  Auth: optional (personalized if logged in, trending if not)
  Response: { posts: [...], source: "personalized" | "trending" }
  Used by: Homepage feed, browse page

GET /api/recommendations/related/:postId
  Query: ?limit=5
  Auth: optional
  Response: { posts: [...] }
  Used by: Single post page (replaces current getRelatedPosts)

GET /api/recommendations/for-you
  Query: ?limit=5
  Auth: required
  Response: { posts: [...] }
  Used by: "Because you read" widget, sidebar
```

**Modified files**:

| File | Change |
|------|--------|
| `src/routes/pages.js` | Replace `sort({ publishedAt: -1 })` with `RecommendationService.getFeed()`; upgrade related posts block |
| `src/services/PostService.js` | `getPostBySlug()` uses `RecommendationService.getRelated()` |
| `src/seo/internalLinking.js` | **Kept as-is** — serves SEO internal linking, not recommendations |
| `src/app.js` | Add `fastify.register(require('./routes/recommendations'), { prefix: '/api/recommendations' })` |

### 6. Data Flow

**Logged-in user opens homepage**:
```
pages.js home handler
  └→ RecommendationService.getFeed(userId, { limit: 10 })
      └→ InterestProfileService.getProfile(userId)
      │    ├→ Redis: get cached profile (1h TTL)
      │    ├→ (miss) Mongo: findOne({ userId })
      │    │    └→ if totalReads < ReadSession.count → full rebuild from aggregation
      │    └→ return profile → set in Redis
      ├→ Post.aggregate([$vectorSearch: queryText from top category/tags, limit: 50])
      ├→ CoreadService.getTopRelated() for each candidate → Redis sorted sets
      ├→ Score each candidate using the scoring formula
      ├→ Sort by score DESC, deduplicate, enforce publisher diversity (max 2/post from same pub)
      └→ Return top 10 → render EJS
```

**Anonymous user opens homepage**:
```
pages.js home handler
  └→ RecommendationService.getFeed(null, { limit: 10 })
      └→ Post.aggregate([$vectorSearch: queryText from "" (global), limit: 50])
      └→ Score: vector_popularity + recency + global_engagement
      └→ Sort, return top 10
```

### 7. Implementation Phases

| Phase | Scope | Files | Estimation |
|-------|-------|-------|------------|
| **1** | Vector Search index + `RecommendationService.getRelated()` | `scripts/create-vector-index.js`, `RecommendationService.js`, modify `PostService.js` and `pages.js` related posts | Quickest win — upgrades related posts from tag-only to semantic |
| **2** | `UserInterestProfile` model + `InterestProfileService` + personalized feed | `UserInterestProfile.js`, `InterestProfileService.js`, `CoreadService.js`, expand `RecommendationService.js` with `getFeed()`, modify pages.js homepage, wire update in reads.js | Core personalization — biggest engagement impact |
| **3** | Co-read mining job + `for-you` endpoint | `src/queue/jobs/co-read-mining.js`, `GET /api/recommendations/for-you` | Enhances recommendations with collaborative signals |
| **4** | Anonymous fallback + `GET /api/recommendations/feed` | Wire anonymous path in `getFeed()`, register route | Covers unauthenticated experience |
| **5** | Cleanup old references | Remove `getRelatedPosts` calls from pages.js where superseded | Only after new system is stable |

## Non-Goals

- No user onboarding "pick your interests" flow (YAGNI — interest profiles learn from behavior)
- No external ML APIs or dedicated vector databases (Atlas Search on M0 is sufficient)
- No A/B testing framework in v1 (feature flag in config is enough)
- No real-time embedding updates (autoEmbed handles on-save; co-read is daily)

## Open Questions (Resolved)

| Question | Decision |
|----------|----------|
| Will this work on M0 free tier? | Yes — `$vectorSearch` + `autoEmbed` supported on free tier (up to 3 indexes, 512MB) |
| How to handle new users? | Fallback to trending; profile builds after first read |
| How to handle new posts? | autoEmbed creates vectors on publish; recency boost + default co-read score |
| Should we keep `internalLinking.js`? | Yes — it serves SEO internal linking, a different concern |
