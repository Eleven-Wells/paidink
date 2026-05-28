const { getRedisConnection } = require('../config/redis');

const CO_READ_KEY_PREFIX = 'co-read:';
const CACHE_TTL_SECONDS = 86400; // 24 hours

class CoreadService {
    _redis() {
        try { return getRedisConnection(); } catch (err) {
            console.error('[CoreadService] Redis unavailable:', err.message);
            return null;
        }
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
