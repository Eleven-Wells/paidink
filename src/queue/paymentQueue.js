const { getBullMQConnection, isUpstashEnabled } = require('../config/redis');

let queueInstance = null;

function createNoopQueue() {
    return {
        add: async () => ({ id: 'skipped', skipped: true }),
        getJob: async () => null,
        getWaitingCount: async () => 0,
        getActiveCount: async () => 0,
        getCompletedCount: async () => 0,
        getFailedCount: async () => 0,
        getDelayedCount: async () => 0,
        clean: async () => [],
        close: async () => {},
        pause: async () => {},
        obliterate: async () => {}
    };
}

function createQueue() {
    const redisConnection = getBullMQConnection();

    const { Queue } = require('bullmq');

    if (!redisConnection) {
        throw new Error('[PaymentQueue] Cannot initialize - BullMQ requires a persistent redis:// connection. Set BULLMQ_REDIS_URL or REDIS_URL.');
    }

    const queue = new Queue('payment-webhooks', {
        connection: redisConnection,
        defaultJobOptions: {
            attempts: 5,
            backoff: {
                type: 'exponential',
                delay: 2000
            },
            removeOnComplete: { count: 100 },
            removeOnFail: { count: 500 },
            stackTraces: true
        }
    });

    queue.on('error', (error) => {
        console.error('[PaymentQueue] Error:', error.message);
    });

    return queue;
}

function getQueue() {
    if (!queueInstance) {
        if (isUpstashEnabled() && !getBullMQConnection()) {
            console.warn('[PaymentQueue][Warning] Upstash REST Redis detected. BullMQ requires a persistent redis:// connection for queue processing. Provide a redis:// endpoint via BULLMQ_REDIS_URL or REDIS_URL.');
            return createNoopQueue();
        }
        try {
            queueInstance = createQueue();
        } catch (err) {
            console.error('[PaymentQueue] Failed to create queue:', err.message);
            return createNoopQueue();
        }
    }
    return queueInstance;
}

async function addWebhookJob(event, data) {
    const queue = getQueue();

    const jobId = `pay-webhook-${event}-${data.transfer_code || data.reference || Date.now()}`;

    const existingJob = await queue.getJob(jobId);
    if (existingJob) {
        const state = await existingJob.getState();
        if (state === 'completed' || state === 'active' || state === 'waiting') {
            return existingJob;
        }
    }

    return await queue.add('process-webhook', { event, data }, { jobId });
}

async function getQueueStats() {
    const queue = getQueue();
    const [waiting, active, completed, failed, delayed] = await Promise.all([
        queue.getWaitingCount(),
        queue.getActiveCount(),
        queue.getCompletedCount(),
        queue.getFailedCount(),
        queue.getDelayedCount()
    ]);
    return { waiting, active, completed, failed, delayed, total: waiting + active + completed + failed + delayed };
}

const paymentQueue = {
    add: addWebhookJob,
    getJob: async (id) => getQueue().getJob(id),
    getWaitingCount: async () => getQueue().getWaitingCount(),
    getActiveCount: async () => getQueue().getActiveCount(),
    getCompletedCount: async () => getQueue().getCompletedCount(),
    getFailedCount: async () => getQueue().getFailedCount(),
    getDelayedCount: async () => getQueue().getDelayedCount(),
    clean: async (timestamp, limit, type) => getQueue().clean(timestamp, limit, type),
    close: async () => getQueue().close()
};

module.exports = paymentQueue;
module.exports.getQueueStats = getQueueStats;
module.exports.addWebhookJob = addWebhookJob;
