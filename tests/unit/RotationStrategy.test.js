const { pick } = require('../../src/services/ads/providers/RotationStrategy');

describe('RotationStrategy', () => {
    it('should return the only provider for "none" strategy', () => {
        const result = pick('none', ['mock']);
        expect(result).toBe('mock');
    });

    it('should return a provider from the list for "random" strategy', () => {
        const result = pick('random', ['mock', 'monetag']);
        expect(['mock', 'monetag']).toContain(result);
    });

    it('should cycle through providers for "round-robin" strategy', () => {
        const state = { roundRobinIndex: {} };
        const providers = ['mock', 'monetag', 'medianet'];
        const results = [];
        for (let i = 0; i < 6; i++) {
            results.push(pick('round-robin', providers, state));
        }
        expect(results).toEqual(['mock', 'monetag', 'medianet', 'mock', 'monetag', 'medianet']);
    });

    it('should respect weights for "weighted" strategy', () => {
        const weights = { mock: 70, monetag: 30 };
        const counts = { mock: 0, monetag: 0 };
        const iterations = 1000;
        for (let i = 0; i < iterations; i++) {
            const result = pick('weighted', ['mock', 'monetag'], null, weights);
            counts[result]++;
        }
        const mockRatio = counts.mock / iterations;
        expect(mockRatio).toBeGreaterThan(0.5);
        expect(mockRatio).toBeLessThan(0.9);
    });

    it('should throw for unknown strategy', () => {
        expect(() => pick('unknown', ['mock'])).toThrow('Unknown rotation strategy');
    });
});
