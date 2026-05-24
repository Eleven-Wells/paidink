const dotenv = require('dotenv');
dotenv.config();

const { CronJob } = require('cron');
const { connectDB, closeDB } = require('../src/db');
const { getRedisConnection, disconnectRedis } = require('../src/config/redis');
const { loadConfig } = require('../src/config');
const queueWorker = require('../src/worker');
const cronJobs = require('../src/cron');

async function start() {
    const config = loadConfig();
    console.log('[Worker] Starting worker service...');

    const redisConnected = await connectRedis();
    if (!redisConnected) {
        console.error('[Worker] Redis connection failed, exiting');
        process.exit(1);
    }

    const dbConnected = await connectDB();
    if (!dbConnected) {
        console.error('[Worker] MongoDB connection failed, exiting');
        process.exit(1);
    }

    const workerStatus = await queueWorker.start();
    console.log('[Worker] BullMQ worker status:', workerStatus);

    startCronJobs(config);

    console.log('[Worker] Worker service fully initialized');
}

async function connectRedis() {
    try {
        const redis = getRedisConnection();
        await redis.ping();
        console.log('[Worker] Redis connected successfully');
        return true;
    } catch (err) {
        console.error('[Worker] Redis connection failed:', err.message);
        return false;
    }
}

function startCronJobs(config) {
    const jobs = [
        { name: 'tools-update', schedule: config.TOOLS_UPDATE_SCHEDULE, fn: cronJobs.toolsUpdate },
        { name: 'content-ingestion', schedule: config.CONTENT_INGESTION_SCHEDULE, fn: cronJobs.contentIngestion },
        { name: 'feed-update', schedule: config.FEED_UPDATE_SCHEDULE, fn: cronJobs.feedUpdate },
        { name: 'seo-update', schedule: config.SEO_UPDATE_SCHEDULE, fn: cronJobs.seoUpdate },
        { name: 'content-cleanup', schedule: config.CLEANUP_SCHEDULE, fn: cronJobs.contentCleanup },
        { name: 'reader-pool-sweep', schedule: config.READER_POOL_SWEEP_SCHEDULE, fn: cronJobs.readerPoolSweep },
        { name: 'unfunded-reads-sweep', schedule: config.UNFUNDED_READS_SWEEP_SCHEDULE, fn: cronJobs.unfundedReadsSweep },
    ];

    for (const job of jobs) {
        if (!job.schedule) {
            console.log('[Worker] No schedule for %s, skipping', job.name);
            continue;
        }
        const cronJob = new CronJob(
            job.schedule,
            () => {
                console.log('[Worker] Cron %s triggered', job.name);
                job.fn().catch((err) => {
                    console.error('[Worker] Cron %s failed: %s', job.name, err.message);
                });
            },
            null,
            true
        );
        console.log('[Worker] Cron %s scheduled: %s', job.name, job.schedule);
    }

    console.log('[Worker] All cron jobs scheduled');
}

async function shutdown() {
    console.log('[Worker] Shutting down gracefully...');
    await queueWorker.closeWorker();
    await closeDB();
    await disconnectRedis();
    console.log('[Worker] Shutdown complete');
    process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

process.on('uncaughtException', (err) => {
    console.error('[Worker] Uncaught exception:', err.message, err.stack);
    shutdown();
});

process.on('unhandledRejection', (reason) => {
    console.error('[Worker] Unhandled rejection:', String(reason));
    shutdown();
});

start().catch((err) => {
    console.error('[Worker] Startup failed:', err.message, err.stack);
    process.exit(1);
});
