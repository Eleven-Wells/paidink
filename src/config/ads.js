const AD_EVENTS = Object.freeze({
    SERVED: 'ad.served',
    CLICKED: 'ad.clicked',
    IMPRESSION: 'ad.impression',
    PROVIDER_FAILED: 'provider.failed',
    PROVIDER_SELECTED: 'provider.selected'
});

const PLACEMENTS = Object.freeze({
    HOME_FEED_TOP: 'home_feed_top',
    HOME_FEED_INLINE: 'home_feed_inline',
    HOME_FEED_BOTTOM: 'home_feed_bottom',
    ARTICLE_HEADER: 'article_header',
    ARTICLE_MIDDLE: 'article_middle',
    ARTICLE_END: 'article_end',
    SIDEBAR: 'sidebar',
    PROFILE: 'profile',
    SEARCH: 'search',
    TRENDING: 'trending'
});

function safeInt(value, fallback) {
    const parsed = parseInt(value, 10);
    return Number.isNaN(parsed) ? fallback : parsed;
}

function loadAdConfig() {
    return Object.freeze({
        enabled: process.env.ADS_ENABLED !== 'false',
        provider: process.env.ADS_PROVIDER || 'mock',
        rotation: process.env.ADS_ROTATION || 'none',
        providers: (process.env.ADS_PROVIDERS || 'mock').split(',').map(s => s.trim()),
        providerWeights: parseWeights(process.env.ADS_PROVIDER_WEIGHTS || ''),
        healthCheckTTL: safeInt(process.env.ADS_HEALTH_CHECK_TTL, 60),
        cacheEnabled: process.env.ADS_CACHE_ENABLED === 'true',
        cacheTTL: safeInt(process.env.ADS_CACHE_TTL, 300),
        trackImpressions: process.env.ADS_TRACK_IMPRESSIONS !== 'false',
        trackClicks: process.env.ADS_TRACK_CLICKS !== 'false',
        disableForRoles: (process.env.ADS_DISABLE_FOR_ROLES || 'premium,administrator').split(',').map(s => s.trim())
    });
}

function parseWeights(raw) {
    if (!raw) return {};
    const weights = {};
    raw.split(',').forEach(pair => {
        const [name, weight] = pair.split('=').map(s => s.trim());
        if (name && weight) {
            weights[name] = safeInt(weight, 0);
        }
    });
    return weights;
}

module.exports = { AD_EVENTS, PLACEMENTS, loadAdConfig };
