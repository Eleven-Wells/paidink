const fp = require('fastify-plugin');
const { getRedisConnection } = require('../config/redis');

function createCachePlugin(fastify) {
    let redis = null;
    let cacheEnabled = false;

    try {
        redis = getRedisConnection();
        cacheEnabled = redis && redis.status === 'ready';
    } catch (error) {
        console.warn('[Cache] Redis not available, caching disabled');
    }

    async function get(key) {
        if (!cacheEnabled || !redis) return null;

        try {
            const data = await redis.get(key);
            if (data) {
                return JSON.parse(data);
            }
        } catch (error) {
            console.error('[Cache] Get error:', error.message);
        }
        return null;
    }

    async function set(key, value, ttlSeconds = 300) {
        if (!cacheEnabled || !redis) return false;

        try {
            await redis.setex(key, ttlSeconds, JSON.stringify(value));
            return true;
        } catch (error) {
            console.error('[Cache] Set error:', error.message);
            return false;
        }
    }

    async function del(key) {
        if (!cacheEnabled || !redis) return false;

        try {
            await redis.del(key);
            return true;
        } catch (error) {
            console.error('[Cache] Del error:', error.message);
            return false;
        }
    }

    async function delPattern(pattern) {
        if (!cacheEnabled || !redis) return false;

        try {
            const keys = await redis.keys(pattern);
            if (keys.length > 0) {
                await redis.del(...keys);
            }
            return keys.length;
        } catch (error) {
            console.error('[Cache] DelPattern error:', error.message);
            return 0;
        }
    }

    async function getOrSet(key, ttlSeconds, fetchFn) {
        const cached = await get(key);
        if (cached !== null) {
            return cached;
        }

        const data = await fetchFn();
        if (data !== null) {
            await set(key, data, ttlSeconds);
        }
        return data;
    }

    function generateKey(prefix, params) {
        const hash = require('crypto')
            .createHash('md5')
            .update(JSON.stringify(params))
            .digest('hex')
            .substring(0, 8);
        return `cache:${prefix}:${hash}`;
    }

    fastify.decorate('redisCache', {
        get,
        set,
        del,
        delPattern,
        getOrSet,
        generateKey,
        isEnabled: () => cacheEnabled
    });
}

const cachePlugin = fp(async (fastify) => {
    createCachePlugin(fastify);
}, {
    name: 'redis-cache'
});

module.exports = cachePlugin;
module.exports.createCachePlugin = createCachePlugin;
module.exports.getCacheKey = (prefix, params) => {
    const crypto = require('crypto');
    const hash = crypto
        .createHash('md5')
        .update(JSON.stringify(params))
        .digest('hex')
        .substring(0, 8);
    return `cache:${prefix}:${hash}`;
};
