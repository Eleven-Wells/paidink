jest.mock('../../src/config/ads', () => ({
    loadAdConfig: jest.fn(),
    AD_EVENTS: Object.freeze({
        SERVED: 'ad.served',
        CLICKED: 'ad.clicked',
        IMPRESSION: 'ad.impression',
        PROVIDER_FAILED: 'provider.failed',
        PROVIDER_SELECTED: 'provider.selected'
    })
}));

jest.mock('../../src/services/ads/providers/CacheManager');
jest.mock('../../src/services/ads/providers/RotationStrategy');
jest.mock('../../src/models/ads/FrequencyRule');
jest.mock('../../src/models/ads/AdEvent');

const { loadAdConfig } = require('../../src/config/ads');
const CacheManager = require('../../src/services/ads/providers/CacheManager');
const RotationStrategy = require('../../src/services/ads/providers/RotationStrategy');
const FrequencyRule = require('../../src/models/ads/FrequencyRule');
const AdEvent = require('../../src/models/ads/AdEvent');
const ProviderFactory = require('../../src/services/ads/providers/ProviderFactory');

class EventBusMock {
    constructor() {
        this.emit = jest.fn();
    }
}

describe('ProviderService', () => {
    let ProviderService;
    let eventBus;

    beforeAll(async () => {
        class MockProvider {
            get name() { return 'mock'; }
            async getAds() { return [{ served: true, type: 'banner', slot: 'sidebar', provider: 'mock' }]; }
            async healthCheck() { return true; }
        }
        ProviderFactory.register('mock', MockProvider);
        ProviderService = require('../../src/services/ads/ProviderService');
    });

    beforeEach(() => {
        loadAdConfig.mockReturnValue({
            enabled: true,
            provider: 'mock',
            rotation: 'none',
            providers: ['mock'],
            providerWeights: {},
            healthCheckTTL: 60,
            cacheEnabled: false,
            cacheTTL: 300,
            trackImpressions: true,
            trackClicks: true,
            disableForRoles: ['premium', 'administrator']
        });
        eventBus = new EventBusMock();
        ProviderService.setEventBus(eventBus);
        CacheManager.mockClear();
        RotationStrategy.pick = jest.fn().mockReturnValue('mock');
        FrequencyRule.findOne = jest.fn().mockResolvedValue(null);
        AdEvent.countDocuments = jest.fn().mockResolvedValue(0);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should return empty array when ads are disabled', async () => {
        loadAdConfig.mockReturnValue({ enabled: false });
        const result = await ProviderService.getAds({ placement: 'sidebar' });
        expect(result).toEqual([]);
    });

    it('should return empty array for disabled roles', async () => {
        const result = await ProviderService.getAds({
            placement: 'sidebar',
            user: { role: 'premium' }
        });
        expect(result).toEqual([]);
    });

    it('should return ads for allowed roles', async () => {
        const result = await ProviderService.getAds({
            placement: 'sidebar',
            user: { role: 'user' }
        });
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBeGreaterThan(0);
    });

    it('should emit served event when ads are returned', async () => {
        await ProviderService.getAds({
            placement: 'sidebar',
            user: { role: 'user' }
        });
        expect(eventBus.emit).toHaveBeenCalledWith('ad.served', expect.any(Object));
    });

    it('should fall back to mock on provider failure', async () => {
        class FailingProvider {
            get name() { return 'failing'; }
            async getAds() { throw new Error('Network error'); }
            async healthCheck() { return true; }
        }
        ProviderFactory.register('failing', FailingProvider);
        RotationStrategy.pick = jest.fn().mockReturnValue('failing');

        const result = await ProviderService.getAds({
            placement: 'sidebar',
            user: { role: 'user' }
        });
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBeGreaterThan(0);
        expect(result[0].provider).toBe('mock');
    });

    it('should emit provider.selected event after picking a provider', async () => {
        await ProviderService.getAds({
            placement: 'sidebar',
            user: { role: 'user' }
        });
        expect(eventBus.emit).toHaveBeenCalledWith('provider.selected', expect.objectContaining({
            provider: 'mock',
            strategy: 'none'
        }));
    });
});
