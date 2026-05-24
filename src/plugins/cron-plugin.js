const fp = require('fastify-plugin');
const { loadConfig } = require('../config');
const { updateSEOFiles } = require('../seo/seoManager');
const { fetchLatestBlog } = require('../tools/fetchTools');
const { addContentJob } = require('../queue/contentQueue');
const JobLog = require('../models/JobLog');
const { isFeatureEnabled } = require('../config/features');
const { captureMessage } = require('./sentry');
const { dailyFeedRevenueSweep, dailyReaderRewardSweep } = require('../services/ads/ReaderRewardService');

async function registerCronPlugin(fastify) {
    const config = loadConfig();

    fastify.register(require('fastify-cron'), {
        jobs: [
            {
                name: 'tools-update',
                cronTime: config.TOOLS_UPDATE_SCHEDULE,
                onTick: async (fastifyInstance) => {
                    if (!isFeatureEnabled('content', 'aiGeneration')) {
                        fastifyInstance.log.info('[Cron] AI generation disabled, skipping tools update');
                        return;
                    }
                    fastifyInstance.log.info('[Cron] Starting tools update');
                    try {
                        const result = await fetchLatestBlog();
                        fastifyInstance.log.info({ result }, '[Cron] Tools update completed');
                    } catch (error) {
                        fastifyInstance.log.error({ error: error.message }, '[Cron] Tools update failed');
                    }
                },
                runOnInit: false
            },
            {
                name: 'content-ingestion',
                cronTime: config.CONTENT_INGESTION_SCHEDULE,
                onTick: async (fastifyInstance) => {
                    if (!isFeatureEnabled('content', 'aiGeneration')) {
                        fastifyInstance.log.info('[Cron] AI generation disabled, skipping content ingestion');
                        return;
                    }
                    fastifyInstance.log.info('[Cron] Starting content ingestion');
                    try {
                        const { getContentSources } = require('../config');
                        
                        const contentSources = getContentSources();
                        for (const source of contentSources) {
                            if (source.requiresAuth && !config.NEWS_API_KEY) {
                                fastifyInstance.log.debug(`[Cron] Skipping ${source.url} - requires NEWS_API_KEY`);
                                continue;
                            }
                            
                            await addContentJob({
                                sourceUrl: source.url,
                                category: source.category,
                                type: source.type
                            });
                        }
                        fastifyInstance.log.info('[Cron] Content ingestion: jobs queued');
                    } catch (error) {
                        fastifyInstance.log.error({ error: error.message }, '[Cron] Content ingestion failed');
                    }
                },
                runOnInit: false
            },
            {
                name: 'feed-update',
                cronTime: config.FEED_UPDATE_SCHEDULE,
                onTick: async (fastifyInstance) => {
                    if (!isFeatureEnabled('content', 'aiGeneration')) {
                        fastifyInstance.log.info('[Cron] AI generation disabled, skipping feed update');
                        return;
                    }
                    fastifyInstance.log.info('[Cron] Starting feed update');
                    try {
                        const { getContentSources } = require('../config');
                        
                        const contentSources = getContentSources();
                        let jobsAdded = 0;
                        
                        for (const source of contentSources) {
                            if (source.requiresAuth && !config.NEWS_API_KEY) {
                                continue;
                            }
                            
                            await addContentJob({
                                sourceUrl: source.url,
                                category: source.category,
                                type: source.type
                            });
                            jobsAdded++;
                        }
                        
                        fastifyInstance.log.info(`[Cron] Feed update: ${jobsAdded} jobs added`);
                    } catch (error) {
                        fastifyInstance.log.error({ error: error.message }, '[Cron] Feed update failed');
                    }
                },
                runOnInit: false
            },
            {
                name: 'seo-update',
                cronTime: config.SEO_UPDATE_SCHEDULE,
                onTick: async (fastifyInstance) => {
                    fastifyInstance.log.info('[Cron] Starting SEO update');
                    try {
                        const result = await updateSEOFiles();
                        fastifyInstance.log.info({ result }, '[Cron] SEO update completed');
                    } catch (error) {
                        fastifyInstance.log.error({ error: error.message }, '[Cron] SEO update failed');
                    }
                },
                runOnInit: false
            },
            {
                name: 'content-cleanup',
                cronTime: config.CLEANUP_SCHEDULE,
                onTick: async (fastifyInstance) => {
                    fastifyInstance.log.info('[Cron] Starting content cleanup');
                    try {
                        const thirtyDaysAgo = new Date();
                        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

                        const result = await JobLog.deleteMany({
                            createdAt: { $lt: thirtyDaysAgo }
                        });

                        fastifyInstance.log.info(`[Cron] Cleaned up ${result.deletedCount} old job logs`);
                    } catch (error) {
                        fastifyInstance.log.error({ error: error.message }, '[Cron] Content cleanup failed');
                    }
                },
                runOnInit: false
            },
            {
                name: 'reader-pool-sweep',
                cronTime: config.READER_POOL_SWEEP_SCHEDULE,
                onTick: async (fastifyInstance) => {
                    fastifyInstance.log.info('[Cron] Starting daily feed revenue sweep to reader pool');
                    try {
                        const result = await dailyFeedRevenueSweep();
                        fastifyInstance.log.info({ result }, '[Cron] Feed revenue sweep completed');
                    } catch (error) {
                        fastifyInstance.log.error({ error: error.message }, '[Cron] Feed revenue sweep failed');
                    }
                },
                runOnInit: false
            },
            {
                name: 'unfunded-reads-sweep',
                cronTime: config.UNFUNDED_READS_SWEEP_SCHEDULE,
                onTick: async (fastifyInstance) => {
                    fastifyInstance.log.info('[Cron] Starting unfunded reads sweep');
                    try {
                        const result = await dailyReaderRewardSweep();
                        fastifyInstance.log.info({ result }, '[Cron] Unfunded reads sweep completed');
                    } catch (error) {
                        fastifyInstance.log.error({ error: error.message }, '[Cron] Unfunded reads sweep failed');
                    }
                },
                runOnInit: false
            }
        ]
    });

    fastify.log.info('[Cron] fastify-cron plugin registered with 7 jobs');
}

module.exports = fp(registerCronPlugin, {
    name: 'cron-scheduler'
});
