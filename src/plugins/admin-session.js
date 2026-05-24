const fp = require('fastify-plugin');
const crypto = require('crypto');
const { getRedisConnection } = require('../config/redis');

const SESSION_PREFIX = 'admin_session:';
const SESSION_TTL = 60 * 60 * 24;

function createSessionPlugin(fastify) {
    fastify.decorateRequest('session', null);
    fastify.decorateRequest('sessionId', null);

    fastify.decorate('adminSessions', {
        create: async (userId, userData) => {
            const redis = getRedisConnection();
            if (!redis || redis.status !== 'ready') {
                throw new Error('Redis not available');
            }

            const sessionId = crypto.randomBytes(32).toString('hex');
            const sessionData = {
                id: sessionId,
                userId,
                ...userData,
                createdAt: new Date().toISOString(),
                lastActive: new Date().toISOString()
            };

            await redis.setex(
                `${SESSION_PREFIX}${sessionId}`,
                SESSION_TTL,
                JSON.stringify(sessionData)
            );

            return sessionId;
        },

        get: async (sessionId) => {
            const redis = getRedisConnection();
            if (!redis || redis.status !== 'ready') {
                return null;
            }

            const data = await redis.get(`${SESSION_PREFIX}${sessionId}`);
            if (!data) return null;

            const session = JSON.parse(data);
            session.lastActive = new Date().toISOString();
            await redis.setex(
                `${SESSION_PREFIX}${sessionId}`,
                SESSION_TTL,
                JSON.stringify(session)
            );

            return session;
        },

        destroy: async (sessionId) => {
            const redis = getRedisConnection();
            if (!redis || redis.status !== 'ready') {
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
