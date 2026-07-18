const ProviderFactory = require('./ProviderFactory');

class ProviderRegistry {
    register(name, ProviderClass) {
        ProviderFactory.register(name, ProviderClass);
    }

    create(name, options) {
        if (!ProviderFactory.getRegistered().includes(name)) {
            return ProviderFactory.create('mock');
        }
        return ProviderFactory.create(name, options);
    }

    exists(name) {
        return ProviderFactory.getRegistered().includes(name);
    }

    list() {
        return ProviderFactory.getRegistered();
    }
}

module.exports = new ProviderRegistry();
