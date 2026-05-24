const { loadConfig, getContentSources } = require('../config');
const { isFeatureEnabled } = require('../config/features');
const { updateSEOFiles } = require('../seo/seoManager');
const { fetchLatestBlog } = require('../tools/fetchTools');
const { addContentJob } = require('../queue/contentQueue');
const JobLog = require('../models/JobLog');
const { dailyFeedRevenueSweep, dailyReaderRewardSweep } = require('../services/ads/ReaderRewardService');

async function toolsUpdate() {
    if (!isFeatureEnabled('content', 'aiGeneration')) {
        console.log('[Cron] AI generation disabled, skipping tools update');
        return;
    }
    console.log('[Cron] Starting tools update');
    try {
        const result = await fetchLatestBlog();
        console.log('[Cron] Tools update completed', result);
    } catch (error) {
        console.error('[Cron] Tools update failed:', error.message);
    }
}

async function contentIngestion() {
    if (!isFeatureEnabled('content', 'aiGeneration')) {
        console.log('[Cron] AI generation disabled, skipping content ingestion');
        return;
    }
    const config = loadConfig();
    console.log('[Cron] Starting content ingestion');
    try {
        const contentSources = getContentSources();
        for (const source of contentSources) {
            if (source.requiresAuth && !config.NEWS_API_KEY) {
                console.log('[Cron] Skipping %s - requires NEWS_API_KEY', source.url);
                continue;
            }
            await addContentJob({
                sourceUrl: source.url,
                category: source.category,
                type: source.type
            });
        }
        console.log('[Cron] Content ingestion: jobs queued');
    } catch (error) {
        console.error('[Cron] Content ingestion failed:', error.message);
    }
}

async function feedUpdate() {
    if (!isFeatureEnabled('content', 'aiGeneration')) {
        console.log('[Cron] AI generation disabled, skipping feed update');
        return;
    }
    const config = loadConfig();
    console.log('[Cron] Starting feed update');
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
        console.log('[Cron] Feed update: %d jobs added', jobsAdded);
    } catch (error) {
        console.error('[Cron] Feed update failed:', error.message);
    }
}

async function seoUpdate() {
    console.log('[Cron] Starting SEO update');
    try {
        const result = await updateSEOFiles();
        console.log('[Cron] SEO update completed', result);
    } catch (error) {
        console.error('[Cron] SEO update failed:', error.message);
    }
}

async function contentCleanup() {
    console.log('[Cron] Starting content cleanup');
    try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const result = await JobLog.deleteMany({
            createdAt: { $lt: thirtyDaysAgo }
        });
        console.log('[Cron] Cleaned up %d old job logs', result.deletedCount);
    } catch (error) {
        console.error('[Cron] Content cleanup failed:', error.message);
    }
}

async function readerPoolSweep() {
    console.log('[Cron] Starting daily feed revenue sweep to reader pool');
    try {
        const result = await dailyFeedRevenueSweep();
        console.log('[Cron] Feed revenue sweep completed', result);
    } catch (error) {
        console.error('[Cron] Feed revenue sweep failed:', error.message);
    }
}

async function unfundedReadsSweep() {
    console.log('[Cron] Starting unfunded reads sweep');
    try {
        const result = await dailyReaderRewardSweep();
        console.log('[Cron] Unfunded reads sweep completed', result);
    } catch (error) {
        console.error('[Cron] Unfunded reads sweep failed:', error.message);
    }
}

module.exports = {
    toolsUpdate,
    contentIngestion,
    feedUpdate,
    seoUpdate,
    contentCleanup,
    readerPoolSweep,
    unfundedReadsSweep
};
