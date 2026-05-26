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
