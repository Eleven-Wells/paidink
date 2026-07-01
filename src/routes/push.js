const PushSubscription = require('../models/PushSubscription');
const { ensureVapidKeys } = require('../services/PushService');

async function subscribeRoutes(fastify, opts) {
    fastify.addHook('preHandler', fastify.authenticate);

    fastify.post('/subscribe', async (request, reply) => {
        const { endpoint, keys, userAgent } = request.body;

        if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
            return reply.status(400).send({ error: 'Missing subscription fields' });
        }

        const existing = await PushSubscription.findOne({ endpoint });
        if (existing) {
            if (existing.userId.toString() !== request.user._id.toString()) {
                existing.userId = request.user._id;
                await existing.save();
            }
            return reply.send({ status: 'ok' });
        }

        await PushSubscription.create({
            userId: request.user._id,
            endpoint,
            keys: { p256dh: keys.p256dh, auth: keys.auth },
            userAgent: userAgent || ''
        });

        return reply.status(201).send({ status: 'ok' });
    });

    fastify.post('/unsubscribe', async (request, reply) => {
        const { endpoint } = request.body;

        if (!endpoint) {
            return reply.status(400).send({ error: 'Missing endpoint' });
        }

        await PushSubscription.deleteOne({
            endpoint,
            userId: request.user._id
        });

        return reply.send({ status: 'ok' });
    });

    fastify.get('/vapid-public-key', async (request, reply) => {
        await ensureVapidKeys();
        const webpush = require('web-push');
        return reply.send({ publicKey: webpush.getVapidKeys().publicKey });
    });
}

module.exports = subscribeRoutes;
