const AdsSettings = require('../../models/ads/AdsSettings');

const CACHE_TTL = parseInt(process.env.ADS_SETTINGS_CACHE_TTL, 10) || 60;

let cached = null;
let lastFetch = 0;

function isCacheValid() {
    return cached && (Date.now() - lastFetch) < CACHE_TTL * 1000;
}

function invalidateCache() {
    cached = null;
    lastFetch = 0;
}

async function ensureDefaults() {
    let doc = await AdsSettings.findOne();
    if (!doc) {
        doc = await AdsSettings.create({
            adsEnabled: true,
            activeProviderId: null,
            rotationStrategy: 'none'
        });
    }
    return doc;
}

async function loadSettings() {
    if (isCacheValid()) return cached;
    const doc = await ensureDefaults();
    cached = doc;
    lastFetch = Date.now();
    return cached;
}

async function getSettings() {
    const doc = await loadSettings();
    return {
        adsEnabled: doc.adsEnabled,
        activeProviderId: doc.activeProviderId ? doc.activeProviderId.toString() : null,
        rotationStrategy: doc.rotationStrategy
    };
}

async function updateSettings(updates) {
    let doc = await ensureDefaults();
    if (updates.adsEnabled !== undefined) doc.adsEnabled = updates.adsEnabled;
    if (updates.activeProviderId !== undefined) doc.activeProviderId = updates.activeProviderId || null;
    if (updates.rotationStrategy !== undefined) doc.rotationStrategy = updates.rotationStrategy;
    await doc.save();
    invalidateCache();
    return getSettings();
}

async function getActiveProvider() {
    const settings = await getSettings();
    if (!settings.adsEnabled || !settings.activeProviderId) return null;
    return settings.activeProviderId;
}

async function setActiveProvider(id) {
    return updateSettings({ activeProviderId: id });
}

async function getRotationStrategy() {
    const settings = await getSettings();
    return settings.rotationStrategy;
}

async function updateRotationStrategy(strategy) {
    return updateSettings({ rotationStrategy: strategy });
}

async function getProviderConfig(provider) {
    const ProviderManagementService = require('./ProviderManagementService');
    try {
        const p = await ProviderManagementService.getProvider(provider);
        return p ? { enabled: p.enabled, settings: p.config } : { enabled: false, settings: {} };
    } catch {
        return { enabled: false, settings: {} };
    }
}

async function updateProviderConfig(provider, config) {
    const ProviderManagementService = require('./ProviderManagementService');
    await ProviderManagementService.updateProvider(provider, { config });
    invalidateCache();
    return getSettings();
}

async function enableProvider(provider) {
    const ProviderManagementService = require('./ProviderManagementService');
    await ProviderManagementService.enableProvider(provider);
    invalidateCache();
    return getSettings();
}

async function disableProvider(provider) {
    const ProviderManagementService = require('./ProviderManagementService');
    await ProviderManagementService.disableProvider(provider);
    invalidateCache();
    return getSettings();
}

module.exports = {
    getSettings,
    updateSettings,
    getActiveProvider,
    setActiveProvider,
    getRotationStrategy,
    updateRotationStrategy,
    getProviderConfig,
    updateProviderConfig,
    enableProvider,
    disableProvider,
    invalidateCache
};
