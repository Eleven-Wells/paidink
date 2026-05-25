# Recommendation Engine — Design Spec

## Context

Nook is a reward-based content platform ("Read to Earn") built with Fastify + MongoDB + EJS. The current "recommendation" system is limited to tag/category scoring in `src/seo/internalLinking.js` (primarily for SEO internal linking). Feed is sorted by `publishedAt` DESC with no personalization. Rich engagement data exists via `ReadSession` (time spent, scroll depth, completion), likes, saves, shares, and comments.

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
│  │  MongoDB: Vector Search index on `posts`   │           │
│  │  Redis: Co-read matrix + Interest profiles │           │
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

**What**: Per-user preference model built from reading history.

**How**:
- Computed on-demand from `ReadSession` aggregation — cached in Redis with 1h TTL
- Structure:
  ```json
  {
    "userId": "...",
    "categoryAffinity": { "backend": 0.8, "ai-tools": 0.3 },
    "tagAffinity": { "react": 0.6, "nodejs": 0.4 },
    "publishersFollowed": ["pub1", "pub2"],
    "lastUpdated": "<ISO timestamp>"
  }
  ```
- Affinity weights: `timeSpentSeconds × completed × recency_multiplier`
- Recent reads weighted higher (linear decay over 30 days)

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
| `src/services/RecommendationService.js` | Core scoring — `getFeed()`, `getRelated()`, `getForYou()` |
| `src/services/InterestProfileService.js` | Build/cache user interest profiles from ReadSessions |
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
      │    ├→ Redis: get cached profile
      │    └→ (miss) Mongo: aggregate ReadSessions → build profile → set in Redis (1h TTL)
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
| **2** | `InterestProfileService` + personalized feed | `InterestProfileService.js`, `CoreadService.js`, expand `RecommendationService.js` with `getFeed()`, modify pages.js homepage | Core personalization — biggest engagement impact |
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
