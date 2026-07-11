const registry = {};

function register(name, ProviderClass) {
    registry[name] = ProviderClass;
}

function create(name, options) {
    const ProviderClass = registry[name];
    if (!ProviderClass) {
        throw new Error(`Unknown provider: ${name}`);
    }
    return new ProviderClass(options);
}

function getRegistered() {
    return Object.keys(registry);
}

function clear() {
    Object.keys(registry).forEach(key => delete registry[key]);
}

module.exports = { register, create, getRegistered, clear };
