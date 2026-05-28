# Recommendation Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a hybrid vector + collaborative recommendation engine that personalizes the feed, upgrades related posts, and adds a "for you" widget — all to increase publisher engagement through better content discovery.

**Architecture:** Two offline pipelines (Atlas autoEmbed for content vectors + BullMQ nightly co-read mining) feed into an on-demand scoring service that fuses vector similarity, user interest affinity, collaborative signals, publisher diversity, and recency at query time.

**Tech Stack:** Fastify, MongoDB/Mongoose, Redis, BullMQ, MongoDB Atlas Search ($vectorSearch with autoEmbed)

**Spec:** `docs/superpowers/specs/2025-05-25-recommendation-engine-design.md`

---

### File Structure

**New files:**
- `src/models/UserInterestProfile.js` — Mongoose schema for persistent user interest profile
- `src/services/RecommendationService.js` — Core recommendation logic: `getFeed()`, `getRelated()`, `getForYou()`
- `src/services/InterestProfileService.js` — Read/update/cache user interest profiles
- `src/services/CoreadService.js` — Read/write co-read relationships in Redis
- `src/routes/recommendations.js` — Fastify routes: `GET /api/recommendations/related/:postId`
- `src/queue/jobs/co-read-mining.js` — BullMQ worker: nightly co-read matrix computation
- `scripts/create-vector-index.js` — One-time script to create Atlas Search index

**Modified files:**
- `src/config/features.js` — Add `recommendationEngine` feature flag
- `src/services/PostService.js` — Replace `getRelatedPosts()` with `RecommendationService.getRelated()`
- `src/routes/pages.js` — Replace feed sort with personalized scoring, upgrade related posts block
- `src/routes/reads.js` — Wire interest profile update on read completion
- `src/app.js` — Register recommendations route

---

### Task 1: Feature Flag + UserInterestProfile Model

**Files:**
- Create: `src/models/UserInterestProfile.js`
- Modify: `src/config/features.js`

- [ ] **Step 1: Add recommendation engine feature flag**

Modify `src/config/features.js` — add to the `content` category:

```js
recommendationEngine: {
    enabled: process.env.FEATURE_RECOMMENDATION_ENGINE !== 'false',
    description: 'Enable personalized recommendation engine',
    envVar: 'FEATURE_RECOMMENDATION_ENGINE'
}
```

- [ ] **Step 2: Create UserInterestProfile model**

Create `src/models/UserInterestProfile.js`:

```js
const mongoose = require('mongoose');

const userInterestProfileSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true,
        index: true
    },
    categoryAffinity: {
        type: Map,
        of: Number,
        default: {}
    },
    tagAffinity: {
        type: Map,
        of: Number,
        default: {}
    },
    publisherAffinity: {
        type: Map,
        of: Number,
        default: {}
    },
    totalReads: {
        type: Number,
        default: 0
    },
    lastReadAt: {
        type: Date,
        default: null
    }
}, {
    timestamps: true
});

const UserInterestProfile = mongoose.model('UserInterestProfile', userInterestProfileSchema);
module.exports = UserInterestProfile;
```

- [ ] **Step 3: Commit**

```bash
git add src/config/features.js src/models/UserInterestProfile.js
git commit -m "feat: add UserInterestProfile model and recommendation feature flag"
```

---

### Task 2: InterestProfileService — Read, Update, Cache

**Files:**
- Create: `src/services/InterestProfileService.js`

- [ ] **Step 1: Write InterestProfileService**

Create `src/services/InterestProfileService.js`:

```js
const UserInterestProfile = require('../models/UserInterestProfile');
const ReadSession = require('../models/ReadSession');
const { getRedisConnection } = require('../config/redis');

const CACHE_TTL_SECONDS = 3600; // 1 hour

class InterestProfileService {
    _redis() {
        try { return getRedisConnection(); } catch { return null; }
    }

    async getProfile(userId) {
        const redis = this._redis();
        const cacheKey = `profile:${userId}`;

        if (redis) {
            const cached = await redis.get(cacheKey);
            if (cached) {
                return JSON.parse(cached);
            }
        }

        let profile = await UserInterestProfile.findOne({ user: userId });

        if (!profile) {
            profile = await this._buildDefault(userId);
        } else {
            const actualCount = await ReadSession.countDocuments({ user: userId, completed: true });
            if (profile.totalReads < actualCount) {
                profile = await this._rebuildFromSessions(userId);
            }
        }

        if (redis) {
            await redis.set(cacheKey, JSON.stringify(profile), 'EX', CACHE_TTL_SECONDS);
        }

        return profile;
    }

    async updateOnReadCompletion(userId, post, timeSpentSeconds, completed) {
        const signal = (timeSpentSeconds / 60) * (completed ? 1 : 0.5);
        const ALPHA = 0.1;

        let profile = await UserInterestProfile.findOne({ user: userId });
        if (!profile) {
            profile = new UserInterestProfile({ user: userId });
        }

        const category = post.category;
        const currentCategoryAffinity = profile.categoryAffinity.get(category) || 0;
        profile.categoryAffinity.set(category, currentCategoryAffinity * (1 - ALPHA) + signal * ALPHA);

        if (post.tags && Array.isArray(post.tags)) {
            for (const tag of post.tags) {
                const currentTagAffinity = profile.tagAffinity.get(tag) || 0;
                profile.tagAffinity.set(tag, currentTagAffinity * (1 - ALPHA) + signal * ALPHA);
            }
        }

        if (post.author) {
            const authorId = post.author.toString();
            const currentPublisherAffinity = profile.publisherAffinity.get(authorId) || 0;
            profile.publisherAffinity.set(authorId, currentPublisherAffinity * (1 - ALPHA) + signal * ALPHA);
        }

        profile.totalReads += 1;
        profile.lastReadAt = new Date();
        await profile.save();

        const redis = this._redis();
        const cacheKey = `profile:${userId}`;
        if (redis) {
            await redis.del(cacheKey);
        }

        return profile;
    }

    async _buildDefault(userId) {
        const profile = new UserInterestProfile({ user: userId });
        await profile.save();
        return profile;
    }

    async _rebuildFromSessions(userId) {
        const sessions = await ReadSession.aggregate([
            { $match: { user: userId, completed: true } },
            { $lookup: { from: 'posts', localField: 'post', foreignField: '_id', as: 'post' } },
            { $unwind: { path: '$post', preserveNullAndEmptyArrays: true } },
            { $match: { 'post.category': { $exists: true } } },
            { $group: {
                _id: null,
                totalReads: { $sum: 1 },
                categories: { $push: '$post.category' },
                tags: { $push: '$post.tags' },
                publishers: { $push: '$post.author' },
                timeSpents: { $push: '$timeSpentSeconds' },
                completions: { $push: '$completed' }
            }}
        ]);

        if (!sessions.length) {
            return this._buildDefault(userId);
        }

        const data = sessions[0];
        const profile = new UserInterestProfile({ user: userId });

        const categoryCounts = {};
        const tagCounts = {};
        const publisherCounts = {};

        for (let i = 0; i < data.categories.length; i++) {
            const cat = data.categories[i];
            categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;

            if (data.tags[i]) {
                for (const tag of data.tags[i]) {
                    tagCounts[tag] = (tagCounts[tag] || 0) + 1;
                }
            }

            if (data.publishers[i]) {
                const pubId = data.publishers[i].toString();
                publisherCounts[pubId] = (publisherCounts[pubId] || 0) + 1;
            }
        }

        const total = data.totalReads;
        for (const [cat, count] of Object.entries(categoryCounts)) {
            profile.categoryAffinity.set(cat, count / total);
        }
        for (const [tag, count] of Object.entries(tagCounts)) {
            profile.tagAffinity.set(tag, count / total);
        }
        for (const [pubId, count] of Object.entries(publisherCounts)) {
            profile.publisherAffinity.set(pubId, count / total);
        }

        profile.totalReads = data.totalReads;
        await profile.save();
        return profile;
    }
}

module.exports = new InterestProfileService();
```

- [ ] **Step 2: Commit**

```bash
git add src/services/InterestProfileService.js
git commit -m "feat: add InterestProfileService with incremental EMA updates and self-healing rebuild"
```

---

### Task 3: CoreadService — Redis Co-Read Matrix

**Files:**
- Create: `src/services/CoreadService.js`

- [ ] **Step 1: Write CoreadService**

Create `src/services/CoreadService.js`:

```js
const { getRedisConnection } = require('../config/redis');

const CO_READ_KEY_PREFIX = 'co-read:';
const CACHE_TTL_SECONDS = 86400; // 24 hours

class CoreadService {
    _redis() {
        try { return getRedisConnection(); } catch { return null; }
    }

    async getTopRelated(postId, limit = 10) {
        const redis = this._redis();
        if (!redis) return [];

        const key = `${CO_READ_KEY_PREFIX}${postId}`;
        const results = await redis.zrevrange(key, 0, limit - 1, 'WITHSCORES');
        const posts = [];
        for (let i = 0; i < results.length; i += 2) {
            posts.push({
                postId: results[i],
                score: parseFloat(results[i + 1])
            });
        }
        return posts;
    }

    async getBulkTopRelated(postIds, limit = 5) {
        const redis = this._redis();
        if (!redis || !postIds.length) return {};

        const pipeline = redis.pipeline();
        for (const id of postIds) {
            pipeline.zrevrange(`${CO_READ_KEY_PREFIX}${id}`, 0, limit - 1, 'WITHSCORES');
        }
        const results = await pipeline.exec();

        const map = {};
        for (let i = 0; i < postIds.length; i++) {
            const key = postIds[i].toString();
            const raw = results[i][1] || [];
            const posts = [];
            for (let j = 0; j < raw.length; j += 2) {
                posts.push({
                    postId: raw[j],
                    score: parseFloat(raw[j + 1])
                });
            }
            map[key] = posts;
        }
        return map;
    }

    async setRelated(postId, relatedPostId, weight) {
        const redis = this._redis();
        if (!redis) return;

        const key = `${CO_READ_KEY_PREFIX}${postId}`;
        await redis.zincrby(key, weight, relatedPostId.toString());
        await redis.expire(key, CACHE_TTL_SECONDS);
    }
}

module.exports = new CoreadService();
```

- [ ] **Step 2: Commit**

```bash
git add src/services/CoreadService.js
git commit -m "feat: add CoreadService for Redis co-read matrix operations"
```

---

### Task 4: RecommendationService — Core Scoring Logic

**Files:**
- Create: `src/services/RecommendationService.js`

- [ ] **Step 1: Write RecommendationService**

Create `src/services/RecommendationService.js`:

```js
const Post = require('../models/Post');
const interestProfileService = require('./InterestProfileService');
const coreadService = require('./CoreadService');

const VECTOR_INDEX_NAME = process.env.VECTOR_SEARCH_INDEX || 'auto-embedding-index';
const RECENCY_DAYS = 30;
const DEFAULT_CO_READ_SCORE = 0.5;
const DEFAULT_GLOBAL_ENGAGEMENT = 0.3;
const MAX_SAME_PUBLISHER = 2;

class RecommendationService {

    async getRelated(postId, limit = 5) {
        const post = await Post.findById(postId).lean();
        if (!post) return [];

        const candidates = await this._vectorSearch(
            `${post.category} ${(post.tags || []).join(' ')}`,
            limit * 3
        );

        const filtered = candidates.filter(c => c._id.toString() !== postId.toString());
        const coReadMap = await coreadService.getBulkTopRelated(
            filtered.map(c => c._id),
            3
        );

        const scored = filtered.map(candidate => {
            const vectorScore = candidate.score || 0;
            const coReads = coReadMap[candidate._id.toString()] || [];
            const coReadScore = coReads.length
                ? coReads.reduce((sum, r) => sum + r.score, 0) / coReads.length
                : DEFAULT_CO_READ_SCORE;

            return {
                ...candidate,
                _score: vectorScore * 0.6 + coReadScore * 0.4
            };
        });

        return scored
            .sort((a, b) => b._score - a._score)
            .slice(0, limit)
            .map(({ _score, ...rest }) => rest);
    }

    async getFeed(userId, { limit = 10 } = {}) {
        if (!userId) {
            return this._getAnonymousFeed(limit);
        }

        const profile = await interestProfileService.getProfile(userId);

        const topCategory = this._getTopCategory(profile);
        const topTags = this._getTopTags(profile);

        const queryText = [topCategory, ...topTags.slice(0, 3)].filter(Boolean).join(' ');
        const candidates = await this._vectorSearch(queryText, limit * 5);

        const coReadMap = await coreadService.getBulkTopRelated(
            candidates.map(c => c._id),
            3
        );

        const recentPublisherIds = await this._getRecentPublisherIds(userId, 5);

        const scored = candidates.map(candidate => {
            const vectorScore = candidate.score || 0;
            const categoryAffinity = profile.categoryAffinity.get(candidate.category) || 0.5;
            const categoryMultiplier = 0.5 + categoryAffinity * 1.5;

            const coReads = coReadMap[candidate._id.toString()] || [];
            const coReadScore = coReads.length
                ? coReads.reduce((sum, r) => sum + r.score, 0) / coReads.length
                : DEFAULT_CO_READ_SCORE;

            const authorId = candidate.author ? candidate.author.toString() : null;
            const diversityBonus = authorId && !recentPublisherIds.includes(authorId) ? 1.0 : 0;

            const daysOld = candidate.publishedAt
                ? (Date.now() - new Date(candidate.publishedAt).getTime()) / (1000 * 86400)
                : RECENCY_DAYS;
            const recencyBoost = Math.max(0, 1 - daysOld / RECENCY_DAYS);

            const globalEngagement = candidate.stats && candidate.stats.views > 0
                ? ((candidate.stats.reads || 0) / candidate.stats.views)
                : DEFAULT_GLOBAL_ENGAGEMENT;

            const score = vectorScore * categoryMultiplier * 0.35
                       + coReadScore * 0.25
                       + diversityBonus * 0.15
                       + recencyBoost * 0.15
                       + Math.min(globalEngagement, 1) * 0.10;

            return { ...candidate, _score: score };
        });

        return this._applyDiversity(scored, limit);
    }

    async getForYou(userId, { limit = 5 } = {}) {
        const profile = await interestProfileService.getProfile(userId);
        const topTags = this._getTopTags(profile);
        const queryText = topTags.slice(0, 5).join(' ');

        if (!queryText) {
            return this._getAnonymousFeed(limit);
        }

        const candidates = await this._vectorSearch(queryText, limit * 3);

        const recentPostIds = await this._getRecentReadPostIds(userId, 10);

        const filtered = candidates.filter(
            c => !recentPostIds.includes(c._id.toString())
        );

        return filtered.slice(0, limit);
    }

    async _vectorSearch(queryText, limit) {
        if (!queryText) {
            return Post.find()
                .sort({ 'stats.views': -1 })
                .limit(limit)
                .populate('author', 'displayName avatar role')
                .lean();
        }

        try {
            const results = await Post.aggregate([
                {
                    $vectorSearch: {
                        index: VECTOR_INDEX_NAME,
                        queryText,
                        path: 'embedding',
                        limit,
                        numCandidates: limit * 2
                    }
                },
                {
                    $lookup: {
                        from: 'users',
                        localField: 'author',
                        foreignField: '_id',
                        as: 'author'
                    }
                },
                { $unwind: { path: '$author', preserveNullAndEmptyArrays: true } },
                { $project: { 'author.password': 0, 'author.email': 0 } }
            ]);
            return results;
        } catch (err) {
            console.error('Vector search failed, falling back to default sort:', err.message);
            return Post.find()
                .sort({ publishedAt: -1 })
                .limit(limit)
                .populate('author', 'displayName avatar role')
                .lean();
        }
    }

    async _getAnonymousFeed(limit) {
        return Post.find()
            .sort({ 'stats.views': -1 })
            .limit(limit)
            .populate('author', 'displayName avatar role')
            .lean();
    }

    async _getRecentPublisherIds(userId, count) {
        const sessions = await require('../models/ReadSession').find(
            { user: userId, completed: true },
            { _id: 0 }
        ).sort({ endedAt: -1 }).limit(count).populate({
            path: 'post',
            select: 'author'
        }).lean();

        const ids = [];
        for (const session of sessions) {
            if (session.post && session.post.author) {
                ids.push(session.post.author.toString());
            }
        }
        return ids;
    }

    async _getRecentReadPostIds(userId, count) {
        const sessions = await require('../models/ReadSession').find(
            { user: userId, completed: true },
            { post: 1, _id: 0 }
        ).sort({ endedAt: -1 }).limit(count).lean();

        return sessions.map(s => s.post?.toString()).filter(Boolean);
    }

    _getTopCategory(profile) {
        let topCat = null;
        let topVal = 0;
        for (const [cat, val] of profile.categoryAffinity) {
            if (val > topVal) {
                topVal = val;
                topCat = cat;
            }
        }
        return topCat || '';
    }

    _getTopTags(profile, count = 5) {
        const entries = [];
        for (const [tag, val] of profile.tagAffinity) {
            entries.push({ tag, val });
        }
        return entries
            .sort((a, b) => b.val - a.val)
            .slice(0, count)
            .map(e => e.tag);
    }

    _applyDiversity(posts, limit) {
        const publisherCounts = {};
        const result = [];

        const sorted = [...posts].sort((a, b) => b._score - a._score);

        for (const post of sorted) {
            const authorId = post.author ? post.author._id?.toString() || post.author.toString() : null;
            if (authorId && (publisherCounts[authorId] || 0) >= MAX_SAME_PUBLISHER) {
                continue;
            }
            if (authorId) {
                publisherCounts[authorId] = (publisherCounts[authorId] || 0) + 1;
            }
            result.push(post);
            if (result.length >= limit) break;
        }

        // If not enough after dedup, fill with remaining
        if (result.length < limit) {
            for (const post of sorted) {
                if (!result.find(r => r._id.toString() === post._id.toString())) {
                    result.push(post);
                    if (result.length >= limit) break;
                }
            }
        }

        return result.map(({ _score, ...rest }) => rest);
    }
}

module.exports = new RecommendationService();
```

- [ ] **Step 2: Commit**

```bash
git add src/services/RecommendationService.js
git commit -m "feat: add RecommendationService with scoring, vector search, and diversity enforcement"
```

---

### Task 5: Wire Profile Update on Read Completion

**Files:**
- Modify: `src/routes/reads.js`

- [ ] **Step 1: Add profile update after read completion**

In `src/routes/reads.js`, add at the top:

```js
const interestProfileService = require('../services/InterestProfileService');
const Post = require('../models/Post');
```

Then inside the `/complete` handler, after `await session.markCompleted()` (at line 197), add:

```js
try {
    const readPost = await Post.findById(session.post).lean();
    if (readPost) {
        await interestProfileService.updateOnReadCompletion(
            userId,
            readPost,
            session.timeSpentSeconds,
            session.completed
        );
    }
} catch (err) {
    req.log.error({ error: err.message }, 'Failed to update interest profile');
}
```<｜end▁of▁thinking｜>

- [ ] **Step 2: Commit**

```bash
git add src/routes/reads.js
git commit -m "feat: wire interest profile update on read completion"
```

---

### Task 6: Co-Read Mining BullMQ Job

**Files:**
- Create: `src/queue/jobs/co-read-mining.js`

- [ ] **Step 1: Write co-read mining job**

Create `src/queue/jobs/co-read-mining.js`:

```js
const ReadSession = require('../../models/ReadSession');
const coreadService = require('../../services/CoreadService');

async function runCoReadMining() {
    console.log('[CoReadMining] Starting co-read matrix computation...');

    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);

    const sessions = await ReadSession.find({
        completed: true,
        endedAt: { $gte: thirtyDaysAgo }
    })
    .populate('post', '_id')
    .sort({ user: 1, endedAt: 1 })
    .lean();

    const userReads = {};
    for (const session of sessions) {
        if (!session.post) continue;
        const userId = session.user.toString();
        const postId = session.post._id.toString();

        if (!userReads[userId]) userReads[userId] = [];
        userReads[userId].push({
            postId,
            weight: (session.timeSpentSeconds / 60) * (session.completed ? 1 : 0.5)
        });
    }

    let pairsProcessed = 0;
    for (const reads of Object.values(userReads)) {
        if (reads.length < 2) continue;

        for (let i = 0; i < reads.length; i++) {
            for (let j = i + 1; j < reads.length; j++) {
                const weight = (reads[i].weight + reads[j].weight) / 2;
                await coreadService.setRelated(reads[i].postId, reads[j].postId, weight);
                await coreadService.setRelated(reads[j].postId, reads[i].postId, weight);
                pairsProcessed++;
            }
        }
    }

    console.log(`[CoReadMining] Done. Processed ${pairsProcessed} co-read pairs across ${Object.keys(userReads).length} users.`);
}

module.exports = { runCoReadMining };
```

- [ ] **Step 2: Commit**

```bash
git add src/queue/jobs/co-read-mining.js
git commit -m "feat: add co-read mining BullMQ job for collaborative signals"
```

---

### Task 7: Vector Index Creation Script

**Files:**
- Create: `scripts/create-vector-index.js`

- [ ] **Step 1: Write index creation script**

Create `scripts/create-vector-index.js`:

```js
// One-time script to create the Atlas Vector Search index for autoEmbed.
// Run via: node scripts/create-vector-index.js
// Requires MONGODB_URI env var and an Atlas cluster (M0+).

const mongoose = require('mongoose');
require('dotenv').config();

async function createVectorIndex() {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        console.error('MONGODB_URI environment variable is required');
        process.exit(1);
    }

    await mongoose.connect(uri);
    const db = mongoose.connection.db;

    const indexName = process.env.VECTOR_SEARCH_INDEX || 'auto-embedding-index';

    try {
        const result = await db.collection('posts').createSearchIndex({
            name: indexName,
            type: 'autoEmbed',
            definition: {
                fields: [
                    {
                        type: 'autoEmbedding',
                        path: 'embedding',
                        embedding: {
                            model: 'voyage-4'
                        },
                        fieldMappings: [
                            { path: 'title' },
                            { path: 'summary' },
                            { path: 'tags' },
                            { path: 'category' }
                        ]
                    }
                ]
            }
        });
        console.log('Vector search index created:', result);
    } catch (err) {
        if (err.code === 68) {
            console.log('Index already exists (code 68), skipping creation.');
        } else {
            console.error('Failed to create index:', err);
            process.exit(1);
        }
    }

    await mongoose.disconnect();
}

createVectorIndex();
```

- [ ] **Step 2: Commit**

```bash
git add scripts/create-vector-index.js
git commit -m "feat: add Atlas Vector Search index creation script for autoEmbed"
```

---

### Task 8: Recommendations Route + App Registration

**Files:**
- Create: `src/routes/recommendations.js`
- Modify: `src/app.js`

- [ ] **Step 1: Create recommendations route**

Create `src/routes/recommendations.js`:

```js
const recommendationService = require('../services/RecommendationService');

module.exports = async function recommendationsRoutes(fastify) {
    fastify.get('/api/recommendations/related/:postId', async (req, reply) => {
        try {
            const { postId } = req.params;
            const limit = Math.min(parseInt(req.query.limit) || 5, 20);

            const posts = await recommendationService.getRelated(postId, limit);
            return reply.send({ success: true, data: posts });
        } catch (err) {
            req.log.error({ error: err.message }, 'Failed to get related recommendations');
            return reply.code(500).send({ success: false, error: 'Failed to get recommendations' });
        }
    });

    fastify.get('/api/recommendations/feed', async (req, reply) => {
        try {
            const limit = Math.min(parseInt(req.query.limit) || 10, 50);
            const userId = req.isLoggedIn ? req.currentUser?.id : null;

            const posts = await recommendationService.getFeed(userId, { limit });
            return reply.send({
                success: true,
                data: posts,
                source: userId ? 'personalized' : 'trending'
            });
        } catch (err) {
            req.log.error({ error: err.message }, 'Failed to get feed recommendations');
            return reply.code(500).send({ success: false, error: 'Failed to get feed' });
        }
    });

    fastify.get('/api/recommendations/for-you', async (req, reply) => {
        if (!req.isLoggedIn || !req.currentUser) {
            return reply.code(401).send({ success: false, error: 'Authentication required' });
        }

        try {
            const limit = Math.min(parseInt(req.query.limit) || 5, 20);
            const posts = await recommendationService.getForYou(req.currentUser.id, { limit });
            return reply.send({ success: true, data: posts });
        } catch (err) {
            req.log.error({ error: err.message }, 'Failed to get for-you recommendations');
            return reply.code(500).send({ success: false, error: 'Failed to get recommendations' });
        }
    });
};
```

- [ ] **Step 2: Register route in app.js**

In `src/app.js`, around line 216 (before `await fastify.after()`), add:

```js
fastify.register(require('./routes/recommendations'));
```

- [ ] **Step 3: Commit**

```bash
git add src/routes/recommendations.js src/app.js
git commit -m "feat: add recommendations API routes and register in app"
```

---

### Task 9: Integrate Personalized Feed into Homepage

**Files:**
- Modify: `src/routes/pages.js`

- [ ] **Step 1: Replace homepage feed sort**

At the top of `src/routes/pages.js`, add:

```js
const recommendationService = require('../services/RecommendationService');
const { isFeatureEnabled } = require('../config/features');
```

In the homepage handler (`fastify.get('/', ...)`, around line 869), replace:

```js
// Before:
const posts = await Post.find()
    .sort({ publishedAt: -1 })
    .limit(5)
    .populate('author', 'displayName avatar role')
    .lean();

// After:
const posts = isFeatureEnabled('content', 'recommendationEngine')
    ? await recommendationService.getFeed(currentUserId, { limit: 5 })
    : await Post.find()
        .sort({ publishedAt: -1 })
        .limit(5)
        .populate('author', 'displayName avatar role')
        .lean();
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/pages.js
git commit -m "feat: integrate personalized feed into logged-in homepage"
```

---

### Task 10: Upgrade Related Posts

**Files:**
- Modify: `src/services/PostService.js`
- Modify: `src/routes/pages.js`

- [ ] **Step 1: Replace related posts in PostService.getPostBySlug**

In `src/services/PostService.js`, add at the top:

```js
const recommendationService = require('./RecommendationService');
```

Replace lines 107-108:

```js
// Old:
const relatedPosts = await getRelatedPosts(post._id, post.tags, post.category, 3);
const enhancedContent = addInternalLinks(post.content, relatedPosts);

// New:
const relatedPosts = await recommendationService.getRelated(post._id, 3);
const enhancedContent = addInternalLinks(post.content, relatedPosts);
```

- [ ] **Step 2: Upgrade related posts in single post view**

In `src/routes/pages.js`, around line 1288-1299, replace:

```js
// Old:
const { generateRelatedPostsHtml, getRelatedPosts, addInternalLinks } = require('../seo/internalLinking');
const relatedPosts = await getRelatedPosts(post._id, post.tags || [], post.category, 5);

// New:
const { generateRelatedPostsHtml, addInternalLinks } = require('../seo/internalLinking');
const relatedPosts = await recommendationService.getRelated(post._id, 5);
```

- [ ] **Step 3: Commit**

```bash
git add src/services/PostService.js src/routes/pages.js
git commit -m "feat: upgrade related posts to use recommendation engine"
```

---

### Task 11: Self-Review

- [ ] **Verify all files created:**
  - `src/models/UserInterestProfile.js`
  - `src/services/InterestProfileService.js`
  - `src/services/CoreadService.js`
  - `src/services/RecommendationService.js`
  - `src/routes/recommendations.js`
  - `src/queue/jobs/co-read-mining.js`
  - `scripts/create-vector-index.js`

- [ ] **Verify all integration points:**
  - `src/config/features.js` — has `recommendationEngine` flag
  - `src/routes/reads.js` — wires `interestProfileService.updateOnReadCompletion()` after `markCompleted()`
  - `src/routes/pages.js` — uses `recommendationService.getFeed()` for homepage; uses `recommendationService.getRelated()` for post view
  - `src/services/PostService.js` — uses `recommendationService.getRelated()` in `getPostBySlug()`
  - `src/app.js` — registers `routes/recommendations`

- [ ] **Verify no breaking changes:**
  - Feature flag means old behavior is preserved when flag is off
  - Co-read mining is async (BullMQ) — won't block requests
  - Vector search has a fallback to `publishedAt` sort on error
  - Profile update on read completion is wrapped in try/catch — won't break reward flow

- [ ] **Run syntax checks:**

```bash
node -c src/models/UserInterestProfile.js && \
node -c src/services/InterestProfileService.js && \
node -c src/services/CoreadService.js && \
node -c src/services/RecommendationService.js && \
node -c src/routes/recommendations.js && \
node -c src/queue/jobs/co-read-mining.js
```

- [ ] **Final commit:**

```bash
git add -A && git commit -m "chore: self-review fixes for recommendation engine"
```
