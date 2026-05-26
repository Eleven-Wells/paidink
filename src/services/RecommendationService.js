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

            const authorId = candidate.author ? candidate.author._id?.toString() || candidate.author.toString() : null;
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
