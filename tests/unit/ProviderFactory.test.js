const ProviderFactory = require('../../src/services/ads/providers/ProviderFactory');

describe('ProviderFactory', () => {
    afterEach(() => {
        ProviderFactory.clear();
    });

    it('should register and create a provider', () => {
        class MockProvider { get name() { return 'mock'; } }
        ProviderFactory.register('mock', MockProvider);
        const instance = ProviderFactory.create('mock');
        expect(instance.name).toBe('mock');
    });

    it('should throw for unknown provider', () => {
        expect(() => ProviderFactory.create('unknown')).toThrow('Unknown provider');
    });

    it('should return registered provider names', () => {
        class MockProvider { get name() { return 'mock'; } }
        ProviderFactory.register('mock', MockProvider);
        expect(ProviderFactory.getRegistered()).toEqual(['mock']);
    });
});
