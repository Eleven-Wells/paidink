jest.mock('../../src/services/ads/AdSimulationService', () => ({
    triggerAdForUser: jest.fn()
}));

const MockProvider = require('../../src/services/ads/providers/MockProvider');
const { triggerAdForUser } = require('../../src/services/ads/AdSimulationService');

describe('MockProvider', () => {
    let provider;

    beforeEach(() => {
        provider = new MockProvider();
        jest.clearAllMocks();
    });

    it('should have name "mock"', () => {
        expect(provider.name).toBe('mock');
    });

    it('should return demo ad when simulation returns not served', async () => {
        triggerAdForUser.mockResolvedValue({ served: false });
        const context = { placement: 'sidebar', user: { role: 'user' }, session: null };
        const ads = await provider.getAds(context);
        expect(ads.length).toBe(1);
        expect(ads[0].served).toBe(true);
        expect(ads[0].provider).toBe('mock');
        expect(ads[0].slot).toBe('sidebar');
    });

    it('should return served simulated ad when simulation succeeds', async () => {
        triggerAdForUser.mockResolvedValue({
            served: true,
            adConfig: { type: 'banner', _id: 'config123' },
            impression: { _id: 'imp456' }
        });
        const context = { placement: 'sidebar', user: { id: 'user1', role: 'user' }, session: { id: 'sess1' } };
        const ads = await provider.getAds(context);
        expect(ads.length).toBe(1);
        expect(ads[0].served).toBe(true);
        expect(ads[0].impressionId).toBe('imp456');
        expect(ads[0].type).toBe('banner');
    });

    it('should request count ads when count > 1', async () => {
        triggerAdForUser.mockResolvedValue({ served: false });
        const context = { placement: 'sidebar', user: { role: 'user' }, session: null, count: 3 };
        const ads = await provider.getAds(context);
        expect(ads.length).toBe(3);
        expect(triggerAdForUser).toHaveBeenCalledTimes(6);
    });

    it('should be healthy', async () => {
        const healthy = await provider.healthCheck();
        expect(healthy).toBe(true);
    });

    it('should not throw on recordImpression', async () => {
        await expect(provider.recordImpression({ adId: 'test' })).resolves.not.toThrow();
    });

    it('should not throw on recordClick', async () => {
        await expect(provider.recordClick({ adId: 'test' })).resolves.not.toThrow();
    });
});
