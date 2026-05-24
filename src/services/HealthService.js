const mongoose = require('mongoose');
const { isRedisConnected, isUpstashEnabled, getUpstashClient } = require('../config/redis');
const { getQueueStats } = require('../queue/contentQueue');

const HEALTH_TIMEOUT = 5000;

async function checkMongoDB() {
    const start = Date.now();
    try {
        if (mongoose.connection.readyState !== 1) {
            return {
                status: 'disconnected',
                latency: null,
                error: 'MongoDB not connected'
            };
        }

        const startTime = Date.now();
        await mongoose.connection.db.admin().ping();
        const latency = Date.now() - startTime;

        return {
            status: 'healthy',
            latency,
            readyState: mongoose.connection.readyState
        };
    } catch (error) {
        return {
            status: 'unhealthy',
            latency: Date.now() - start,
            error: error.message
        };
    }
}

async function checkRedis() {
    const start = Date.now();
    try {
        if (isUpstashEnabled()) {
            const redis = getUpstashClient();
            if (!redis) {
                return { status: 'disconnected', latency: null, error: 'Upstash not configured' };
            }
            const startTime = Date.now();
            await redis.ping();
            const latency = Date.now() - startTime;
            return { status: 'healthy', latency, connected: true };
        }

        if (!isRedisConnected()) {
            return {
                status: 'disconnected',
                latency: null,
                error: 'Redis not connected'
            };
        }

        const { getRedisConnection } = require('../config/redis');
        const redis = getRedisConnection();
        const startTime = Date.now();
        await redis.ping();
        const latency = Date.now() - startTime;

        return {
            status: 'healthy',
            latency,
            connected: redis.status === 'ready'
        };
    } catch (error) {
        return {
            status: 'unhealthy',
            latency: Date.now() - start,
            error: error.message
        };
    }
}

async function checkQueue() {
    const start = Date.now();
    try {
        const stats = await Promise.race([
            getQueueStats(),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Queue check timeout')), HEALTH_TIMEOUT)
            )
        ]);

        return {
            status: 'healthy',
            latency: Date.now() - start,
            stats: {
                waiting: stats.waiting,
                active: stats.active,
                completed: stats.completed,
                failed: stats.failed
            }
        };
    } catch (error) {
        return {
            status: 'unhealthy',
            latency: Date.now() - start,
            error: error.message
        };
    }
}

async function checkExternalAPI(url, name) {
    const start = Date.now();
    try {
        const response = await Promise.race([
            fetch(url, {
                method: 'HEAD',
                timeout: HEALTH_TIMEOUT
            }),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Timeout')), HEALTH_TIMEOUT)
            )
        ]);

        return {
            status: response.ok ? 'healthy' : 'degraded',
            latency: Date.now() - start,
            httpStatus: response.status
        };
    } catch (error) {
        return {
            status: 'unhealthy',
            latency: Date.now() - start,
            error: error.message
        };
    }
}

async function getCompositeHealth(options = {}) {
    const {
        includeExternal = false,
        includeQueue = true,
        detailed = false
    } = options;

    const [mongo, redis] = await Promise.all([
        checkMongoDB(),
        checkRedis()
    ]);

    let queue = null;
    if (includeQueue) {
        queue = await checkQueue();
    }

    const overallHealthy = mongo.status === 'healthy' &&
                          redis.status === 'healthy' &&
                          (!includeQueue || queue?.status === 'healthy');

    const result = {
        status: overallHealthy ? 'healthy' : 'degraded',
        timestamp: new Date().toISOString(),
        uptime: Math.floor(process.uptime()),
        environment: process.env.NODE_ENV || 'development',
        version: process.env.npm_package_version || '1.0.0',
        dependencies: {
            mongodb: mongo,
            redis: redis
        }
    };

    if (includeQueue && queue) {
        result.dependencies.queue = queue;
    }

    if (includeExternal && detailed) {
        const [openai, unsplash] = await Promise.all([
            checkExternalAPI('https://api.openai.com', 'openai'),
            checkExternalAPI('https://api.unsplash.com', 'unsplash')
        ]);

        result.dependencies.external = {
            openai,
            unsplash
        };
    }

    return result;
}

async function getSimpleHealth() {
    const mongo = await checkMongoDB();
    const redis = await checkRedis();

    return {
        status: mongo.status === 'healthy' && redis.status === 'healthy' ? 'ok' : 'degraded',
        database: mongo.status,
        cache: redis.status,
        timestamp: new Date().toISOString(),
        uptime: Math.floor(process.uptime())
    };
}

module.exports = {
    checkMongoDB,
    checkRedis,
    checkQueue,
    checkExternalAPI,
    getCompositeHealth,
    getSimpleHealth,
    HEALTH_TIMEOUT
};
