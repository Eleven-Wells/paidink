const { loadAdConfig, AD_EVENTS } = require('../../config/ads');
const ProviderFactory = require('./providers/ProviderFactory');
const RotationStrategy = require('./providers/RotationStrategy');
const CacheManager = require('./providers/CacheManager');

const cacheManager = new CacheManager();
const healthCache = new Map();
const FrequencyRule = require('../../models/ads/FrequencyRule');

function isRoleAllowed(user, config) {
    if (!user || !user.role) return true;
    return !config.disableForRoles.includes(user.role);
}

async function isFrequencyCapped(context) {
    if (!context.user || !context.user.id) return false;
    try {
        const rule = await FrequencyRule.findOne({ slot: context.placement, active: true });
        if (!rule) return false;
        const { AdEvent } = require('../../models/ads/AdEvent');
        const since = new Date(Date.now() - (rule.minIntervalSeconds || 30) * 1000);
        const recent = await AdEvent.countDocuments({
            user: context.user.id,
            type: 'impression',
            createdAt: { $gte: since }
        });
        return recent >= (rule.maxPerSession || 10);
    } catch (err) {
        console.error('ProviderService: frequency check error:', err);
        return false;
    }
}

async function getAds(context, eventBus) {
    const config = loadAdConfig();

    if (!config.enabled) return [];

    if (!isRoleAllowed(context.user, config)) return [];

    if (await isFrequencyCapped(context)) return [];

    if (config.cacheEnabled) {
        const cached = cacheManager.get(context);
        if (cached) return cached;
    }

    const providerName = RotationStrategy.pick(
        config.rotation,
        config.providers,
        null,
        config.providerWeights
    );

    const provider = ProviderFactory.create(providerName);

    const healthy = await checkHealth(provider, config, providerName);
    if (!healthy) {
        console.error(`ProviderService: provider "${providerName}" unhealthy, falling back to mock`);
        const fallback = ProviderFactory.create('mock');
        const ads = await callProvider(fallback, context, eventBus);
        if (config.cacheEnabled) cacheManager.set(context, ads);
        return ads;
    }

    const ads = await callProvider(provider, context, eventBus);
    if (config.cacheEnabled) cacheManager.set(context, ads);
    return ads;
}

async function checkHealth(provider, config, providerName) {
    const cached = healthCache.get(providerName);
    if (cached && Date.now() - cached.timestamp < config.healthCheckTTL * 1000) {
        return cached.healthy;
    }
    try {
        const healthy = await provider.healthCheck();
        healthCache.set(providerName, { healthy, timestamp: Date.now() });
        return healthy;
    } catch (err) {
        console.error(`ProviderService: health check failed for "${providerName}":`, err);
        healthCache.set(providerName, { healthy: false, timestamp: Date.now() });
        return false;
    }
}

async function callProvider(provider, context, eventBus) {
    try {
        const ads = await provider.getAds(context);
        if (eventBus) {
            eventBus.emit(AD_EVENTS.SERVED, { ads, context, provider: provider.name });
        }
        return ads;
    } catch (err) {
        console.error(`ProviderService: provider "${provider.name}" failed:`, err);
        if (eventBus) {
            eventBus.emit(AD_EVENTS.PROVIDER_FAILED, { provider: provider.name, error: err.message });
        }
        if (provider.name !== 'mock') {
            console.error('ProviderService: falling back to mock');
            const fallback = ProviderFactory.create('mock');
            return callProvider(fallback, context, eventBus);
        }
        return [];
    }
}

module.exports = { getAds };
