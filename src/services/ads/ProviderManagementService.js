const AdProvider = require('../../models/ads/AdProvider');
const AdsSettings = require('../../models/ads/AdsSettings');

function parseImportSnippet(type, raw) {
    const config = {};
    const scriptMatch = raw.match(/<script[^>]*src=["']([^"']+)["'][^>]*>/i);
    if (scriptMatch) config.scriptSrc = scriptMatch[1];
    const zoneMatch = raw.match(/data-zone["']?\s*[:=]\s*["']?(\d+)/i);
    if (zoneMatch) config.zoneId = zoneMatch[1];
    const dataAttrs = {};
    const attrRegex = /data-(\w+)=["']([^"']+)["']/g;
    let m;
    while ((m = attrRegex.exec(raw)) !== null) {
        dataAttrs[m[1]] = m[2];
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
    const ProviderRegistry = require('./providers/ProviderRegistry');
    let healthy = false;
    try {
        const instance = ProviderRegistry.create(provider.type, provider.config);
        if (instance && typeof instance.healthCheck === 'function') {
            healthy = await instance.healthCheck();
        } else {
            healthy = true;
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
