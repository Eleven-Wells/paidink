const { loadConfig, getContentSources } = require('../config');
const { isFeatureEnabled } = require('../config/features');
const { updateSEOFiles } = require('../seo/seoManager');
const { fetchLatestBlog } = require('../tools/fetchTools');
const { addContentJob } = require('../queue/contentQueue');
const JobLog = require('../models/JobLog');
const { dailyFeedRevenueSweep } = require('../services/ads/ReaderRewardService');

const logger = {
    info: (msg, data) => console.log(`[Cron] ${msg}`, data || ''),
    warn: (msg, data) => console.warn(`[Cron] ${msg}`, data || ''),
    error: (msg, data) => console.error(`[Cron] ${msg}`, data || '')
};

async function toolsUpdate() {
    if (!isFeatureEnabled('content', 'aiGeneration')) {
        logger.info('AI generation disabled, skipping tools update');
        return;
    }
    logger.info('Starting tools update');
    try {
        const result = await fetchLatestBlog();
        logger.info('Tools update completed', result);
    } catch (error) {
        logger.error('Tools update failed: ' + error.message);
    }
}

async function contentIngestion() {
    if (!isFeatureEnabled('content', 'aiGeneration')) {
        logger.info('AI generation disabled, skipping content ingestion');
        return;
    }
    const config = loadConfig();
    logger.info('Starting content ingestion');
    try {
        const contentSources = getContentSources();
        for (const source of contentSources) {
            if (source.requiresAuth && !config.NEWS_API_KEY) {
                logger.info('Skipping ' + source.url + ' - requires NEWS_API_KEY');
                continue;
            }
            await addContentJob({
                sourceUrl: source.url,
                category: source.category,
                type: source.type
            });
        }
        logger.info('Content ingestion: jobs queued');
    } catch (error) {
        logger.error('Content ingestion failed: ' + error.message);
    }
}

async function feedUpdate() {
    if (!isFeatureEnabled('content', 'aiGeneration')) {
        logger.info('AI generation disabled, skipping feed update');
        return;
    }
    const config = loadConfig();
    logger.info('Starting feed update');
    try {
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
        logger.info('Feed update: ' + jobsAdded + ' jobs added');
    } catch (error) {
        logger.error('Feed update failed: ' + error.message);
    }
}

async function seoUpdate() {
    logger.info('Starting SEO update');
    try {
        const result = await updateSEOFiles();
        logger.info('SEO update completed', result);
    } catch (error) {
        logger.error('SEO update failed: ' + error.message);
    }
}

async function contentCleanup() {
    logger.info('Starting content cleanup');
    try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const result = await JobLog.deleteMany({
            createdAt: { $lt: thirtyDaysAgo }
        });
        logger.info('Cleaned up ' + result.deletedCount + ' old job logs');
    } catch (error) {
        logger.error('Content cleanup failed: ' + error.message);
    }
}

async function readerPoolSweep() {
    logger.info('Starting daily feed revenue sweep to reader pool');
    try {
        const result = await dailyFeedRevenueSweep();
        logger.info('Feed revenue sweep completed', result);
    } catch (error) {
        logger.error('Feed revenue sweep failed: ' + error.message);
    }
}

module.exports = {
    toolsUpdate,
    contentIngestion,
    feedUpdate,
    seoUpdate,
    contentCleanup,
    readerPoolSweep
};
