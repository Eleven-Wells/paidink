const fp = require('fastify-plugin');
const crypto = require('crypto');
const { getCacheClient, isUpstashEnabled } = require('../config/redis');

const SESSION_PREFIX = 'admin_session:';
const SESSION_TTL = 60 * 60 * 24;

const sessionSet = async (client, key, value, ttl) => {
    if (isUpstashEnabled()) {
        return client.set(key, value, { ex: ttl });
    }
    return client.setex(key, ttl, value);
};

function createSessionPlugin(fastify) {
    fastify.decorateRequest('session', null);
    fastify.decorateRequest('sessionId', null);

    fastify.decorate('adminSessions', {
        create: async (userId, userData) => {
            const redis = getCacheClient();
            if (!redis) {
                throw new Error('Cache not available');
            }
            if (!isUpstashEnabled() && redis.status !== 'ready') {
                throw new Error('Cache not ready');
            }

            const sessionId = crypto.randomBytes(32).toString('hex');
            const sessionData = {
                id: sessionId,
                userId,
                ...userData,
                createdAt: new Date().toISOString(),
                lastActive: new Date().toISOString()
            };

            await sessionSet(
                redis,
                `${SESSION_PREFIX}${sessionId}`,
                JSON.stringify(sessionData),
                SESSION_TTL
            );

            return sessionId;
        },

        get: async (sessionId) => {
            const redis = getCacheClient();
            if (!redis) {
                return null;
            }
            if (!isUpstashEnabled() && redis.status !== 'ready') {
                return null;
            }

            const data = await redis.get(`${SESSION_PREFIX}${sessionId}`);
            if (!data) return null;

            const session = JSON.parse(data);
            session.lastActive = new Date().toISOString();
            await sessionSet(
                redis,
                `${SESSION_PREFIX}${sessionId}`,
                JSON.stringify(session),
                SESSION_TTL
            );

            return session;
        },

        destroy: async (sessionId) => {
            const redis = getCacheClient();
            if (!redis) {
                return false;
            }
            if (!isUpstashEnabled() && redis.status !== 'ready') {
                return false;
            }

            await redis.del(`${SESSION_PREFIX}${sessionId}`);
            return true;
        },

        validate: async (sessionId) => {
            const session = await fastify.adminSessions.get(sessionId);
            return session && session.userId ? session : null;
        }
    });

    fastify.decorate('verifyAdminPassword', (inputPassword) => {
        const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
        return inputPassword === adminPassword;
    });
}

const sessionPlugin = fp(async (fastify) => {
    createSessionPlugin(fastify);
}, {
    name: 'admin-session'
});

module.exports = sessionPlugin;
