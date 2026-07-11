const AdEvent = require('../../models/ads/AdEvent');
const { AD_EVENTS } = require('../../config/ads');

const providerFailures = {};
const providerLatencies = {};
let cacheHits = 0;
let cacheMisses = 0;

function subscribeToEventBus(eventBus) {
    eventBus.on(AD_EVENTS.PROVIDER_FAILED, ({ provider, error }) => {
        if (!providerFailures[provider]) providerFailures[provider] = [];
        providerFailures[provider].push({ timestamp: new Date(), error });
    });
}

async function getDailyImpressions(from, to) {
    return AdEvent.countDocuments({
        type: 'impression',
        createdAt: { $gte: from, $lte: to }
    });
}

async function getDailyClicks(from, to) {
    return AdEvent.countDocuments({
        type: 'click',
        createdAt: { $gte: from, $lte: to }
    });
}

async function getCTR(from, to) {
    const [impressions, clicks] = await Promise.all([
        getDailyImpressions(from, to),
        getDailyClicks(from, to)
    ]);
    return impressions > 0 ? (clicks / impressions) * 100 : 0;
}

async function getTopAds(limit = 10) {
    return AdEvent.aggregate([
        { $match: { type: 'click' } },
        { $group: { _id: '$adConfig', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: limit }
    ]);
}

async function getWorstAds(limit = 10) {
    return AdEvent.aggregate([
        { $match: { type: 'impression' } },
        { $group: { _id: '$adConfig', count: { $sum: 1 } } },
        { $sort: { count: 1 } },
        { $limit: limit }
    ]);
}

async function getProviderStats() {
    const stats = {};
    for (const [name, failures] of Object.entries(providerFailures)) {
        stats[name] = { failures: failures.length, recentFailures: failures.slice(-10) };
    }
    for (const [name, latencies] of Object.entries(providerLatencies)) {
        if (!stats[name]) stats[name] = {};
        const sum = latencies.reduce((a, b) => a + b, 0);
        stats[name].avgLatencyMs = Math.round(sum / latencies.length);
        stats[name].maxLatencyMs = Math.max(...latencies);
    }
    return stats;
}

async function getPlacementStats() {
    return AdEvent.aggregate([
        { $group: { _id: '$placement', impressions: { $sum: 1 } } },
        { $sort: { impressions: -1 } }
    ]);
}

function recordProviderFailure(providerName, error) {
    if (!providerFailures[providerName]) providerFailures[providerName] = [];
    providerFailures[providerName].push({ timestamp: new Date(), error });
}

function recordProviderLatency(providerName, durationMs) {
    if (!providerLatencies[providerName]) providerLatencies[providerName] = [];
    providerLatencies[providerName].push(durationMs);
    if (providerLatencies[providerName].length > 1000) {
        providerLatencies[providerName] = providerLatencies[providerName].slice(-500);
    }
}

function recordCacheHit() {
    cacheHits++;
}

function recordCacheMiss() {
    cacheMisses++;
}

function getCacheStats() {
    const total = cacheHits + cacheMisses;
    return { hits: cacheHits, misses: cacheMisses, ratio: total > 0 ? cacheHits / total : 0 };
}

module.exports = {
    subscribeToEventBus,
    getDailyImpressions,
    getDailyClicks,
    getCTR,
    getTopAds,
    getWorstAds,
    getProviderStats,
    getPlacementStats,
    recordProviderFailure,
    recordProviderLatency,
    recordCacheHit,
    recordCacheMiss,
    getCacheStats
};
