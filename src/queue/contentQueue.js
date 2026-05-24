const { Queue } = require('bullmq');
const crypto = require('crypto');
const { getRedisConnection } = require('../config/redis');
const { isFeatureEnabled } = require('../config/features');

const redisConnection = getRedisConnection();

function generateIdempotencyKey(data) {
    const keyData = `${data.sourceUrl || ''}-${data.category || ''}-${data.title || ''}`;
    return crypto.createHash('sha256').update(keyData).digest('hex').substr(0, 16);
}

const contentQueue = new Queue('content-generation', {
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

contentQueue.on('error', (error) => {
    console.error('[Queue] Error:', error.message);
});

async function addContentJob(data, options = {}) {
    const { skipDuplicateCheck = false } = options;
    
    if (!isFeatureEnabled('content', 'aiGeneration')) {
        console.log('[Queue] AI generation disabled, skipping job for:', data.title || data.sourceUrl);
        return { id: 'skipped', skipped: true };
    }
    
    const jobId = data.title
        ? `post-${data.title.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now()}`
        : `job-${Date.now()}-${generateIdempotencyKey(data)}`;
    
    const jobOptions = {
        jobId,
        ...options.jobOptions
    };
    
    if (skipDuplicateCheck) {
        return await contentQueue.add('generate-post', data, jobOptions);
    }
    
    const existingJob = await contentQueue.getJob(jobId);
    if (existingJob) {
        const state = await existingJob.getState();
        if (state === 'completed' || state === 'active' || state === 'waiting') {
            console.log(`[Queue] Job ${jobId} already exists with state: ${state}`);
            return existingJob;
        }
    }
    
    return await contentQueue.add('generate-post', data, jobOptions);
}

async function getQueueStats() {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
        contentQueue.getWaitingCount(),
        contentQueue.getActiveCount(),
        contentQueue.getCompletedCount(),
        contentQueue.getFailedCount(),
        contentQueue.getDelayedCount()
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
    
    const [cleanedCompleted, cleanedFailed] = await Promise.all([
        contentQueue.clean(completedCutoff, 1000, 'completed'),
        contentQueue.clean(failedCutoff, 1000, 'failed')
    ]);
    
    return {
        cleanedCompleted: cleanedCompleted.length,
        cleanedFailed: cleanedFailed.length
    };
}

module.exports = contentQueue;
module.exports.addContentJob = addContentJob;
module.exports.generateIdempotencyKey = generateIdempotencyKey;
module.exports.getQueueStats = getQueueStats;
module.exports.cleanupQueue = cleanupQueue;
