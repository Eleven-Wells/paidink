function pick(strategy, providers, state, weights) {
    switch (strategy) {
        case 'none':
            return providers[0];

        case 'random':
            return providers[Math.floor(Math.random() * providers.length)];

        case 'round-robin': {
            if (!state) state = { roundRobinIndex: {} };
            const key = providers.join(',');
            if (!state.roundRobinIndex[key]) state.roundRobinIndex[key] = 0;
            const idx = state.roundRobinIndex[key];
            state.roundRobinIndex[key] = (idx + 1) % providers.length;
            return providers[idx];
        }

        case 'weighted': {
            if (!weights) return providers[0];
            const total = Object.values(weights).reduce((a, b) => a + b, 0);
            let rand = Math.random() * total;
            for (const provider of providers) {
                rand -= weights[provider] || 0;
                if (rand <= 0) return provider;
            }
            return providers[providers.length - 1];
        }

        default:
            throw new Error(`Unknown rotation strategy: ${strategy}`);
    }
}

module.exports = { pick };
