const crypto = require('crypto');
const { getBullMQConnection, isUpstashEnabled } = require('../config/redis');
const { isFeatureEnabled } = require('../config/features');

let queueInstance = null;

function isQueueEnabled() {
    return isFeatureEnabled('content', 'aiGeneration');
}

function createNoopQueue() {
    return {
        add: async () => {
            return { id: 'skipped', skipped: true };
        },
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

    // Lazy-require BullMQ so the module can be imported when AI is disabled
    // without loading BullMQ or attempting Redis connections.
    const { Queue } = require('bullmq');

    if (!redisConnection) {
        throw new Error('[Queue] Cannot initialize - BullMQ requires a persistent redis:// connection for queue processing when UPSTASH_REDIS_REST_URL is enabled. Set BULLMQ_REDIS_URL or REDIS_URL.');
    }

    const queue = new Queue('content-generation', {
        connection: redisConnection,
        defaultJobOptions: {
            attempts: 3,
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
        console.error('[Queue] Error:', error.message);
    });

    return queue;
}

function getQueue() {
    if (!isQueueEnabled()) {
        return createNoopQueue();
    }

    if (!queueInstance) {
        if (isUpstashEnabled() && !getBullMQConnection()) {
            console.warn('[BullMQ][Warning] Upstash REST Redis detected. BullMQ requires a Redis server with persistent connections and pub/sub support. Provide a redis:// endpoint via BULLMQ_REDIS_URL or REDIS_URL for queue processing.');
        }
        queueInstance = createQueue();
    }

    return queueInstance;
}

function generateIdempotencyKey(data) {
    const keyData = `${data.sourceUrl || ''}-${data.category || ''}-${data.title || ''}`;
    return crypto.createHash('sha256').update(keyData).digest('hex').substr(0, 16);
}

async function addContentJob(data, options = {}) {
    const { skipDuplicateCheck = false } = options;

    if (!isQueueEnabled()) {
        console.log('[Queue] AI generation disabled, skipping job for:', data.title || data.sourceUrl);
        return { id: 'skipped', skipped: true };
    }

    const queue = getQueue();

    const jobId = data.title
        ? `post-${data.title.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now()}`
        : `job-${Date.now()}-${generateIdempotencyKey(data)}`;

    const jobOptions = {
        jobId,
        ...options.jobOptions
    };

    if (skipDuplicateCheck) {
        return await queue.add('generate-post', data, jobOptions);
    }

    const existingJob = await queue.getJob(jobId);
    if (existingJob) {
        const state = await existingJob.getState();
        if (state === 'completed' || state === 'active' || state === 'waiting') {
            console.log(`[Queue] Job ${jobId} already exists with state: ${state}`);
            return existingJob;
        }
    }

    return await queue.add('generate-post', data, jobOptions);
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

    return {
        waiting,
        active,
        completed,
        failed,
        delayed,
        total: waiting + active + completed + failed + delayed
    };
}

async function cleanupQueue(options = {}) {
    const { completedAge = 24 * 60 * 60 * 1000, failedAge = 7 * 24 * 60 * 60 * 1000 } = options;

    const now = Date.now();
    const completedCutoff = now - completedAge;
    const failedCutoff = now - failedAge;
    const queue = getQueue();

    const [cleanedCompleted, cleanedFailed] = await Promise.all([
        queue.clean(completedCutoff, 1000, 'completed'),
        queue.clean(failedCutoff, 1000, 'failed')
    ]);

    return {
        cleanedCompleted: cleanedCompleted.length,
        cleanedFailed: cleanedFailed.length
    };
}

const contentQueue = {
    add: addContentJob,
    getJob: async (id) => getQueue().getJob(id),
    getWaitingCount: async () => getQueue().getWaitingCount(),
    getActiveCount: async () => getQueue().getActiveCount(),
    getCompletedCount: async () => getQueue().getCompletedCount(),
    getFailedCount: async () => getQueue().getFailedCount(),
    getDelayedCount: async () => getQueue().getDelayedCount(),
    clean: async (timestamp, limit, type) => getQueue().clean(timestamp, limit, type),
    close: async () => getQueue().close()
};

module.exports = contentQueue;
module.exports.addContentJob = addContentJob;
module.exports.generateIdempotencyKey = generateIdempotencyKey;
module.exports.getQueueStats = getQueueStats;
module.exports.cleanupQueue = cleanupQueue;
