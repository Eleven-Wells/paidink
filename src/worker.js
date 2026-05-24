const { Worker, QueueEvents } = require('bullmq');
const JobLog = require('./models/JobLog');
const { getRedisConnection } = require('./config/redis');
const { AppError } = require('./errors/errors');
const { captureError, captureMessage } = require('./plugins/sentry');
const dotenv = require('dotenv');
dotenv.config();

let worker = null;
let queueEvents = null;
let isInitialized = false;

function createJobLogger(job) {
    const jobId = job.id || job.data?.jobId || 'unknown';
    const startTime = Date.now();

    return {
        debug: (message, context = {}) => {
            const ctx = { jobId, component: 'worker', processingTime: Date.now() - startTime, ...context };
            console.debug(`[Job:${jobId}] [DEBUG] ${message}`, ctx);
        },
        info: (message, context = {}) => {
            const ctx = { jobId, component: 'worker', processingTime: Date.now() - startTime, ...context };
            console.info(`[Job:${jobId}] [INFO] ${message}`, ctx);
        },
        warn: (message, context = {}) => {
            const ctx = { jobId, component: 'worker', processingTime: Date.now() - startTime, ...context };
            console.warn(`[Job:${jobId}] [WARN] ${message}`, ctx);
        },
        error: (message, context = {}) => {
            const ctx = { jobId, component: 'worker', processingTime: Date.now() - startTime, ...context };
            console.error(`[Job:${jobId}] [ERROR] ${message}`, ctx);
            if (context.error) {
                captureError(context.error, { jobId, component: 'worker', jobData: job.data });
            }
        },
        progress: (percent) => {
            job.updateProgress(percent);
            console.info(`[Job:${jobId}] [INFO] Progress: ${percent}%`);
        }
    };
}

async function initializeWorker(options = {}) {
    const { concurrency = 1, limiter = { max: 1, duration: 60000 } } = options;
    const redisConnection = getRedisConnection();

    if (!redisConnection) {
        throw new Error('[Worker] Cannot initialize - Redis not connected');
    }

    if (redisConnection.status !== 'ready') {
        console.log('[Worker] Waiting for Redis to be ready...');
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('[Worker] Redis connection timeout'));
            }, 30000);

            const checkReady = () => {
                if (redisConnection.status === 'ready') {
                    clearTimeout(timeout);
                    resolve();
                } else if (redisConnection.status === 'end' || redisConnection.status === 'close') {
                    clearTimeout(timeout);
                    reject(new Error('[Worker] Redis connection lost'));
                }
            };

            redisConnection.on('ready', () => {
                clearTimeout(timeout);
                resolve();
            });
            redisConnection.on('error', (err) => {
                clearTimeout(timeout);
                reject(err);
            });

            if (redisConnection.status === 'ready') {
                resolve();
            }
        });
        console.log('[Worker] Redis ready, starting...');
    }

    const contentService = require('./services/ContentService');
    const { isFeatureEnabled } = require('./config/features');

    worker = new Worker('content-generation', async (job) => {
        if (!isFeatureEnabled('content', 'aiGeneration')) {
            console.log('[Worker] AI generation disabled, skipping job:', job.id);
            return { success: false, skipped: true, reason: 'AI generation disabled' };
        }
        
        const logger = createJobLogger(job);
        logger.info('Processing job started', { sourceUrl: job.data.sourceUrl });

        const jobData = { ...job.data, jobId: job.id };

        try {
            const result = await contentService.processContentJob(jobData, (progress) => {
                job.updateProgress(progress);
            });

            logger.info('Post saved', {
                postId: result.postId,
                title: job.data.title,
                duplicate: result.duplicate
            });

            return result;
        } catch (error) {
            logger.error('Job processing failed', {
                error: error.message,
                sourceUrl: job.data.sourceUrl
            });

            await contentService.logJobFailure(job.id, error, job.data.sourceUrl);

            throw new AppError(
                { code: 'WORK_001', message: 'Job processing failed', httpStatus: 500 },
                error.message,
                { sourceUrl: job.data.sourceUrl, jobId: job.id }
            );
        }
    }, {
        connection: redisConnection,
        concurrency,
        limiter
    });

    worker.on('completed', (job) => {
        console.info(`[Worker] Job ${job.id} completed successfully`);
    });

    worker.on('failed', async (job, err) => {
        console.error(`[Worker] Job ${job?.id} failed:`, err.message);

        if (job?.id) {
            try {
                await JobLog.create({
                    jobId: job.id,
                    status: 'failure',
                    error: err.message,
                    sourceUrl: job.data?.sourceUrl
                });
            } catch (logError) {
                console.error('[Worker] Failed to log job failure:', logError.message);
            }
        }

        captureError(err, { jobId: job?.id, component: 'worker', jobData: job?.data });
    });

    worker.on('error', (err) => {
        console.error('[Worker] Worker error:', err.message);
        captureError(err, { component: 'worker' });
    });

    worker.on('stalled', (jobId) => {
        console.warn(`[Worker] Job ${jobId} stalled`);
        captureMessage('Job stalled', 'warning', { jobId });
    });

    isInitialized = true;
    console.info('[Worker] Initialization complete');

    return worker;
}

async function initializeQueueEvents() {
    const redisConnection = getRedisConnection();

    queueEvents = new QueueEvents('content-generation', {
        connection: redisConnection
    });

    queueEvents.on('waiting', ({ jobId }) => console.debug(`[Queue] Job ${jobId} waiting`));
    queueEvents.on('active', ({ jobId }) => console.info(`[Queue] Job ${jobId} became active`));
    queueEvents.on('completed', ({ jobId }) => console.info(`[Queue] Job ${jobId} completed`));
    queueEvents.on('failed', ({ jobId, failedReason }) => {
        console.error(`[Queue] Job ${jobId} failed: ${failedReason}`);
        captureMessage('Job failed via queue events', 'error', { jobId, failedReason });
    });
    queueEvents.on('stalled', ({ jobId }) => console.warn(`[Queue] Job ${jobId} stalled`));
    queueEvents.on('progress', ({ jobId, data }) => console.debug(`[Queue] Job ${jobId} progress: ${data}`));
    queueEvents.on('error', (err) => {
        console.error('[Queue] Queue events error:', err.message);
        captureError(err, { component: 'queue-events' });
    });

    return queueEvents;
}

async function start(options = {}) {
    const { isFeatureEnabled } = require('./config/features');
    
    if (!isFeatureEnabled('content', 'aiGeneration')) {
        console.log('[Worker] AI generation disabled, worker not starting');
        
        // Clear any existing queue so old jobs don't linger
        try {
            const { Queue } = require('bullmq');
            const { getRedisConnection } = require('./config/redis');
            const redisConnection = getRedisConnection();
            if (redisConnection && redisConnection.status === 'ready') {
                const queue = new Queue('content-generation', { connection: redisConnection });
                await queue.pause();
                await queue.obliterate({ force: true });
                await queue.close();
                console.log('[Worker] Existing queue cleared');
            }
        } catch (err) {
            console.log('[Worker] Queue cleanup skipped:', err.message);
        }
        
        return { isInitialized: false, isRunning: false, status: 'disabled', queueEventsActive: false };
    }
    
    if (isInitialized) {
        console.warn('[Worker] Already initialized, skipping');
        return getWorkerStatus();
    }

    try {
        await initializeWorker(options);
        await initializeQueueEvents();
        return getWorkerStatus();
    } catch (error) {
        console.error('[Worker] Failed to start:', error.message);
        captureError(error, { component: 'worker-init' });
        throw error;
    }
}

function getWorkerStatus() {
    return {
        isInitialized,
        isRunning: worker !== null,
        status: worker ? 'active' : 'inactive',
        queueEventsActive: queueEvents !== null
    };
}

async function closeWorker() {
    if (worker) {
        await worker.close();
        worker = null;
        console.info('[Worker] Worker closed');
    }

    if (queueEvents) {
        await queueEvents.close();
        queueEvents = null;
        console.info('[Queue] Queue events closed');
    }

    isInitialized = false;
}

function createJobLoggerFactory() {
    return createJobLogger;
}

module.exports = {
    start,
    closeWorker,
    getWorkerStatus,
    initializeWorker,
    initializeQueueEvents,
    createJobLogger: createJobLoggerFactory
};
