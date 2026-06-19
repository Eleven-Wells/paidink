const fp = require('fastify-plugin');
const { loadConfig } = require('../config');
const cronJobs = require('../cron');

async function registerCronPlugin(fastify) {
    const config = loadConfig();

    const wrap = (fn) => async (instance) => {
        try {
            await fn();
        } catch (error) {
            instance.log.error({ error: error.message }, '[Cron] Job failed');
        }
    };

    fastify.register(require('fastify-cron'), {
        jobs: [
            {
                name: 'tools-update',
                cronTime: config.TOOLS_UPDATE_SCHEDULE,
                onTick: wrap(cronJobs.toolsUpdate),
                runOnInit: false
            },
            {
                name: 'content-ingestion',
                cronTime: config.CONTENT_INGESTION_SCHEDULE,
                onTick: wrap(cronJobs.contentIngestion),
                runOnInit: false
            },
            {
                name: 'feed-update',
                cronTime: config.FEED_UPDATE_SCHEDULE,
                onTick: wrap(cronJobs.feedUpdate),
                runOnInit: false
            },
            {
                name: 'seo-update',
                cronTime: config.SEO_UPDATE_SCHEDULE,
                onTick: wrap(cronJobs.seoUpdate),
                runOnInit: false
            },
            {
                name: 'content-cleanup',
                cronTime: config.CLEANUP_SCHEDULE,
                onTick: wrap(cronJobs.contentCleanup),
                runOnInit: false
            },
            {
                name: 'reader-pool-sweep',
                cronTime: config.READER_POOL_SWEEP_SCHEDULE,
                onTick: wrap(cronJobs.readerPoolSweep),
                runOnInit: false
            }
        ]
    });

    fastify.log.info('[Cron] fastify-cron plugin registered with 6 jobs');
}

module.exports = fp(registerCronPlugin, {
    name: 'cron-scheduler'
});
