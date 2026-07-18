const { loadAdConfig, AD_EVENTS } = require('../../config/ads');
const ProviderRegistry = require('./providers/ProviderRegistry');
const RotationStrategy = require('./providers/RotationStrategy');
const CacheManager = require('./providers/CacheManager');
const AdsSettingsService = require('./AdsSettingsService');
const ProviderManagementService = require('./ProviderManagementService');

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

    const adsSettings = await AdsSettingsService.getSettings();
    if (!adsSettings.adsEnabled) return [];

    if (!isRoleAllowed(context.user, config)) return [];

    if (await isFrequencyCapped(context)) return [];

    const providerInfo = await resolveProvider(adsSettings);
    const providerName = providerInfo.type || 'mock';

    const cacheContext = { ...context, provider: providerName };
    if (config.cacheEnabled) {
        const cached = cacheManager.get(cacheContext);
        if (cached) return cached;
    }

    const provider = ProviderRegistry.create(providerName, providerInfo.config || {});

    const healthy = await checkHealth(provider, config, providerName);
    if (!healthy) {
        console.error(`ProviderService: provider "${providerName}" unhealthy, falling back to mock`);
        const fallback = ProviderRegistry.create('mock');
        const ads = await callProvider(fallback, cacheContext);
        if (config.cacheEnabled) cacheManager.set(cacheContext, ads);
        return ads;
    }

    const ads = await callProvider(provider, cacheContext);
    if (config.cacheEnabled) cacheManager.set(cacheContext, ads);
    return ads;
}

async function resolveProvider(adsSettings) {
    const id = adsSettings.activeProviderId;
    let candidates = ['mock'];
    const configs = {};

    if (id) {
        const isObjectId = /^[0-9a-fA-F]{24}$/.test(id);
        if (isObjectId) {
            try {
                const p = await ProviderManagementService.getProvider(id);
                if (p && p.enabled) {
                    candidates = [p.type];
                    configs[p.type] = p.config || {};
                }
            } catch {
                candidates = ['mock'];
            }
        } else {
            candidates = [id];
        }
    }

    const providerName = RotationStrategy.pick(
        adsSettings.rotationStrategy || 'none',
        candidates,
        null,
        {}
    );

    if (eventBus) {
        eventBus.emit(AD_EVENTS.PROVIDER_SELECTED, {
            provider: providerName,
            strategy: adsSettings.rotationStrategy || 'none'
        });
    }

    return { type: providerName, config: configs[providerName] || {} };
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
            const fallback = ProviderRegistry.create('mock');
            return callProvider(fallback, context);
        }
        return [];
    }
}

module.exports = { getAds, setEventBus };
