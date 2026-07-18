const AdProvider = require('../../models/ads/AdProvider');
const AdsSettings = require('../../models/ads/AdsSettings');

function parseImportSnippet(type, raw) {
    const config = {};

    const scriptTagMatch = raw.match(/<script[^>]*src=["']([^"']+)["'][^>]*>/i);
    if (scriptTagMatch) config.scriptSrc = scriptTagMatch[1];

    const jsSrcMatch = raw.match(/\.src\s*=\s*["']([^"']+)["']/);
    if (jsSrcMatch && !config.scriptSrc) config.scriptSrc = jsSrcMatch[1];

    const zoneAttrMatch = raw.match(/data-zone=["'](\d+)["']/i);
    if (zoneAttrMatch) config.zoneId = zoneAttrMatch[1];

    const jsZoneMatch = raw.match(/\.dataset\.zone\s*=\s*["'](\d+)["']/i);
    if (jsZoneMatch && !config.zoneId) config.zoneId = jsZoneMatch[1];

    const jsBracketZoneMatch = raw.match(/\[\s*["']data-zone["']\s*\]\s*=\s*["'](\d+)["']/i);
    if (jsBracketZoneMatch && !config.zoneId) config.zoneId = jsBracketZoneMatch[1];

    const dataAttrs = {};
    const htmlAttrRegex = /data-(\w+)=["']([^"']+)["']/g;
    let m;
    while ((m = htmlAttrRegex.exec(raw)) !== null) {
        dataAttrs[m[1]] = m[2];
    }
    const jsAttrRegex = /\.dataset\.(\w+)\s*=\s*["']([^"']+)["']/g;
    while ((m = jsAttrRegex.exec(raw)) !== null) {
        if (!dataAttrs[m[1]]) dataAttrs[m[1]] = m[2];
    }
    if (Object.keys(dataAttrs).length) config.dataAttributes = dataAttrs;

    const swMatch = raw.match(/data-sw["']?\s*[:=]\s*["']([^"']+)/i);
    if (swMatch) config.serviceWorker = swMatch[1];

    return config;
}

async function createProvider(data) {
    const existing = await AdProvider.findOne({ name: data.name });
    if (existing) throw new Error(`Provider "${data.name}" already exists`);
    const provider = await AdProvider.create({
        name: data.name,
        type: data.type || 'custom',
        enabled: data.enabled !== false,
        config: data.config || {}
    });
    return provider.toObject();
}

async function updateProvider(id, updates) {
    const allowed = ['name', 'type', 'enabled', 'config', 'status'];
    const set = {};
    for (const key of allowed) {
        if (updates[key] !== undefined) set[key] = updates[key];
    }
    const provider = await AdProvider.findByIdAndUpdate(id, { $set: set }, { new: true, runValidators: true });
    if (!provider) throw new Error('Provider not found');
    return provider.toObject();
}

async function deleteProvider(id) {
    const settings = await AdsSettings.findOne();
    if (settings && settings.activeProviderId && settings.activeProviderId.toString() === id) {
        settings.activeProviderId = null;
        await settings.save();
    }
    const provider = await AdProvider.findByIdAndDelete(id);
    if (!provider) throw new Error('Provider not found');
    return { deleted: true };
}

async function getProvider(id) {
    const provider = await AdProvider.findById(id);
    if (!provider) throw new Error('Provider not found');
    return provider.toObject();
}

async function listProviders() {
    const providers = await AdProvider.find().sort({ createdAt: -1 }).lean();
    return providers;
}

async function enableProvider(id) {
    const provider = await AdProvider.findByIdAndUpdate(id, { $set: { enabled: true } }, { new: true });
    if (!provider) throw new Error('Provider not found');
    return provider.toObject();
}

async function disableProvider(id) {
    const settings = await AdsSettings.findOne();
    if (settings && settings.activeProviderId && settings.activeProviderId.toString() === id) {
        settings.activeProviderId = null;
        await settings.save();
    }
    const provider = await AdProvider.findByIdAndUpdate(id, { $set: { enabled: false } }, { new: true });
    if (!provider) throw new Error('Provider not found');
    return provider.toObject();
}

async function duplicateProvider(id) {
    const original = await AdProvider.findById(id);
    if (!original) throw new Error('Provider not found');
    const copy = await AdProvider.create({
        name: `${original.name} (copy)`,
        type: original.type,
        enabled: false,
        config: original.config
    });
    return copy.toObject();
}

function validateProviderConfig(type, config) {
    const errors = [];
    if (!config || typeof config !== 'object') {
        errors.push('Configuration must be an object');
        return { valid: false, errors };
    }
    if (type === 'monetag' || type === 'adsterra') {
        if (!config.scriptSrc && !config.zoneId) {
            errors.push('Script source or zone ID is required');
        }
    }
    if (type === 'direct') {
        if (!config.apiEndpoint) errors.push('API endpoint is required');
        if (!config.apiKey) errors.push('API key is required');
    }
    return { valid: errors.length === 0, errors };
}

async function performHealthCheck(id) {
    const provider = await AdProvider.findById(id);
    if (!provider) throw new Error('Provider not found');
    const ProviderFactory = require('./providers/ProviderFactory');

    if (!ProviderFactory.getRegistered().includes(provider.type)) {
        const status = 'unknown';
        await AdProvider.findByIdAndUpdate(id, {
            $set: { status, lastHealthCheck: new Date() }
        });
        return { healthy: false, status, checkedAt: new Date(), message: `Provider type "${provider.type}" not registered` };
    }

    let healthy = false;
    try {
        const ProviderRegistry = require('./providers/ProviderRegistry');
        const instance = ProviderRegistry.create(provider.type, provider.config);
        if (instance && typeof instance.healthCheck === 'function') {
            healthy = await instance.healthCheck();
        }
    } catch {
        healthy = false;
    }
    const status = healthy ? 'healthy' : 'failed';
    await AdProvider.findByIdAndUpdate(id, {
        $set: { status, lastHealthCheck: new Date() }
    });
    return { healthy, status, checkedAt: new Date() };
}

async function importFromSnippet(type, name, raw) {
    const config = parseImportSnippet(type, raw);
    const validation = validateProviderConfig(type, config);
    if (!validation.valid) {
        return { success: false, errors: validation.errors, detected: config };
    }
    return { success: true, config, detected: config };
}

module.exports = {
    createProvider,
    updateProvider,
    deleteProvider,
    getProvider,
    listProviders,
    enableProvider,
    disableProvider,
    duplicateProvider,
    validateProviderConfig,
    performHealthCheck,
    importFromSnippet
};
