const { loadAdConfig, AD_EVENTS } = require('../../config/ads');
const ProviderFactory = require('./providers/ProviderFactory');
const RotationStrategy = require('./providers/RotationStrategy');
const CacheManager = require('./providers/CacheManager');

const cacheManager = new CacheManager();
const healthCache = new Map();
const FrequencyRule = require('../../models/ads/FrequencyRule');

let eventBus = null;

function setEventBus(bus) {
    eventBus = bus;
}

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

async function getAds(context) {
    const config = loadAdConfig();

    if (!config.enabled) return [];

    if (!isRoleAllowed(context.user, config)) return [];

    if (await isFrequencyCapped(context)) return [];

    const providerName = pickProvider(config);

    const cacheContext = { ...context, provider: providerName };
    if (config.cacheEnabled) {
        const cached = cacheManager.get(cacheContext);
        if (cached) return cached;
    }

    const provider = ProviderFactory.create(providerName);

    const healthy = await checkHealth(provider, config, providerName);
    if (!healthy) {
        console.error(`ProviderService: provider "${providerName}" unhealthy, falling back to mock`);
        const fallback = ProviderFactory.create('mock');
        const ads = await callProvider(fallback, cacheContext);
        if (config.cacheEnabled) cacheManager.set(cacheContext, ads);
        return ads;
    }

    const ads = await callProvider(provider, cacheContext);
    if (config.cacheEnabled) cacheManager.set(cacheContext, ads);
    return ads;
}

function pickProvider(config) {
    const name = RotationStrategy.pick(
        config.rotation,
        config.providers,
        null,
        config.providerWeights
    );
    if (eventBus) {
        eventBus.emit(AD_EVENTS.PROVIDER_SELECTED, { provider: name, strategy: config.rotation });
    }
    return name;
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

async function callProvider(provider, context) {
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
            return callProvider(fallback, context);
        }
        return [];
    }
}

module.exports = { getAds, setEventBus };
