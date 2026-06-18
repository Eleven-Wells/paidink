const PaystackService = require('../services/PaystackService');
const paymentQueue = require('../queue/paymentQueue');
const { processWebhookEvent } = require('../worker/paymentWorker');

async function webhookRoutes(fastify) {
    fastify.post('/webhook/paystack', {
        config: { rawBody: true },
        schema: {
            body: {
                type: 'object',
                required: ['event', 'data'],
                properties: {
                    event: { type: 'string' },
                    data: {
                        type: 'object',
                        required: ['transfer_code', 'amount', 'status'],
                        properties: {
                            transfer_code: { type: 'string' },
                            amount: { type: 'number' },
                            status: { type: 'string' },
                            createdAt: { type: 'string' }
                        }
                    }
                }
            }
        }
    }, async (req, reply) => {
        try {
            const signature = req.headers['x-paystack-signature'];

            if (!PaystackService.verifyWebhookSignature(req.rawBody || req.body, signature)) {
                return reply.code(401).send({ error: 'Invalid signature' });
            }

            const event = req.body.event;
            const data = req.body.data;

            const eventTime = data.createdAt ? new Date(data.createdAt).getTime() : 0;
            const now = Date.now();
            if (now - eventTime > 5 * 60 * 1000) {
                req.log.warn({ event, eventTime, age: now - eventTime },
                    'Webhook replay detected — event too old');
                return reply.code(401).send({ error: 'Event too old' });
            }

            const job = await paymentQueue.add(event, data);

            if (job && job.skipped) {
                req.log.warn({ event, transferCode: data?.transfer_code },
                    'Payment queue unavailable — processing inline');
                setImmediate(() => processWebhookEvent(event, data));
            }

            return reply.send({ status: 'received' });
        } catch (error) {
            req.log.error({ error: error.message }, 'Webhook processing failed');
            return reply.code(500).send({ error: 'Webhook processing failed' });
        }
    });
}

module.exports = webhookRoutes;
