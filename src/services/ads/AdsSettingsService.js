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
            activeProvider: 'mock',
            rotationStrategy: 'none',
            providers: new Map(Object.entries({
                mock: { enabled: true },
                direct: { enabled: false, settings: {} }
            }))
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
        activeProvider: doc.activeProvider,
        rotationStrategy: doc.rotationStrategy,
        providers: Object.fromEntries(doc.providers || new Map())
    };
}

async function updateSettings(updates) {
    let doc = await ensureDefaults();
    if (updates.adsEnabled !== undefined) doc.adsEnabled = updates.adsEnabled;
    if (updates.activeProvider !== undefined) doc.activeProvider = updates.activeProvider;
    if (updates.rotationStrategy !== undefined) doc.rotationStrategy = updates.rotationStrategy;
    await doc.save();
    invalidateCache();
    return getSettings();
}

async function getActiveProvider() {
    const settings = await getSettings();
    if (!settings.adsEnabled) return null;
    return settings.activeProvider;
}

async function setActiveProvider(name) {
    return updateSettings({ activeProvider: name });
}

async function getRotationStrategy() {
    const settings = await getSettings();
    return settings.rotationStrategy;
}

async function updateRotationStrategy(strategy) {
    return updateSettings({ rotationStrategy: strategy });
}

async function getProviderConfig(provider) {
    const settings = await getSettings();
    return settings.providers?.[provider] || { enabled: false, settings: {} };
}

async function updateProviderConfig(provider, config) {
    let doc = await ensureDefaults();
    doc.providers.set(provider, config);
    await doc.save();
    invalidateCache();
    return getSettings();
}

async function enableProvider(provider) {
    return updateProviderConfig(provider, { enabled: true, settings: {} });
}

async function disableProvider(provider) {
    return updateProviderConfig(provider, { enabled: false, settings: {} });
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
