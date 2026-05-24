const Redis = require('ioredis');
const { Redis: UpstashRedis } = require('@upstash/redis');
const dotenv = require('dotenv');
dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';

const redisConfig = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || (isProduction ? 12427 : 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    connectTimeout: 10000,
    maxRetriesPerRequest: null,
    retryStrategy: (times) => {
        if (times > 3) {
            return null;
        }
        return Math.min(times * 200, 2000);
    },
    retryDelayOnFailover: 100,
    lazyConnect: false
};

let redisConnection = null;
let connectionPromise = null;

function createRedisConnection(options = {}) {
    const config = { ...redisConfig, ...options };
    const connection = new Redis(config);

    connection.on('error', (err) => {
        console.error('[Redis] Connection error:', err.message);
    });

    connection.on('connect', () => {
        console.log('[Redis] Connected successfully');
    });

    connection.on('ready', () => {
        console.log('[Redis] Ready to accept commands');
    });

    connection.on('close', () => {
        console.log('[Redis] Connection closed');
    });

    connection.on('reconnecting', () => {
        console.log('[Redis] Reconnecting...');
    });

    return connection;
}

function getRedisConnection() {
    if (!redisConnection) {
        redisConnection = createRedisConnection();
    }
    return redisConnection;
}

async function connectRedis() {
    if (!connectionPromise) {
        const connection = getRedisConnection();
        connectionPromise = connection.connect().then(() => connection).catch((err) => {
            console.error('[Redis] Initial connection failed:', err.message);
            connectionPromise = null;
            throw err;
        });
    }
    return connectionPromise;
}

async function disconnectRedis() {
    if (redisConnection) {
        await redisConnection.quit();
        redisConnection = null;
        connectionPromise = null;
    }
}

function isRedisConnected() {
    return redisConnection && redisConnection.status === 'ready';
}

let upstashClient = null;

function getUpstashClient() {
    if (!upstashClient && process.env.UPSTASH_REDIS_REST_URL) {
        upstashClient = new UpstashRedis({
            url: process.env.UPSTASH_REDIS_REST_URL,
            token: process.env.UPSTASH_REDIS_REST_TOKEN,
        });
    }
    return upstashClient;
}

function isUpstashEnabled() {
    return !!process.env.UPSTASH_REDIS_REST_URL;
}

function getCacheClient() {
    if (isUpstashEnabled()) {
        return getUpstashClient();
    }
    const redis = getRedisConnection();
    if (!redis || redis.status !== 'ready') return null;
    return redis;
}

module.exports = {
    getRedisConnection,
    connectRedis,
    disconnectRedis,
    isRedisConnected,
    createRedisConnection,
    getCacheClient,
    getUpstashClient,
    isUpstashEnabled
};
