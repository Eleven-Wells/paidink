const mongoose = require('mongoose');

jest.mock('../../src/services/ads/AdsSettingsService', () => ({
    getSettings: jest.fn()
}));
jest.mock('../../src/models/ads/FrequencyRule', () => ({
    findOne: jest.fn()
}));
jest.mock('../../src/models/ads/AdPlacement', () => ({
    find: jest.fn()
}));
jest.mock('../../src/models/ads/ABTest', () => ({
    findOne: jest.fn()
}));
jest.mock('../../src/models/ads/AdConfig', () => ({
    find: jest.fn()
}));
jest.mock('../../src/models/ads/AdEvent', () => ({
    aggregate: jest.fn(),
    countDocuments: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn()
}));
jest.mock('../../src/services/ads/AdRevenueService', () => ({
    distributeAdRevenue: jest.fn()
}));

const AdsSettingsService = require('../../src/services/ads/AdsSettingsService');
const FrequencyRule = require('../../src/models/ads/FrequencyRule');
const AdPlacement = require('../../src/models/ads/AdPlacement');
const ABTest = require('../../src/models/ads/ABTest');
const AdConfig = require('../../src/models/ads/AdConfig');
const AdEvent = require('../../src/models/ads/AdEvent');
const ProviderFactory = require('../../src/services/ads/providers/ProviderFactory');
const MockProvider = require('../../src/services/ads/providers/MockProvider');
const adRequestContext = require('../../src/services/ads/AdRequestContext');

const ProviderService = require('../../src/services/ads/ProviderService');
const { triggerAdForUser } = require('../../src/services/ads/AdSimulationService');

describe('Ad pipeline request-local dedup', () => {
    beforeAll(() => {
        ProviderFactory.register('mock', MockProvider);
    });

    beforeEach(() => {
        jest.clearAllMocks();
        AdsSettingsService.getSettings.mockResolvedValue({
            adsEnabled: true,
            activeProviderId: null,
            rotationStrategy: 'none'
        });
        FrequencyRule.findOne.mockImplementation((query) => ({
            lean: async () => ({
                slot: query.slot,
                maxPerSession: 10,
                minIntervalSeconds: 30,
                excludeAfterRewardClaim: false
            })
        }));
        ABTest.findOne.mockImplementation(() => ({
            lean: async () => ({
                status: 'running',
                name: 'ad_placement_test_v1',
                variants: [
                    { name: 'control', trafficPercentage: 50 },
                    { name: 'variant_a', trafficPercentage: 50 }
                ]
            })
        }));
        AdConfig.find.mockImplementation(() => ({
            lean: async () => [{ _id: 'c1', type: 'banner', weight: 1, network: 'simulated', active: true }]
        }));
        AdPlacement.find.mockImplementation(({ slot }) => ({
            sort: () => ({
                lean: async () => slot === 'feed_native'
                    ? []
                    : [{ _id: new mongoose.Types.ObjectId(), slot, name: slot + '_default', position: 1, active: true }]
            })
        }));
        AdEvent.aggregate.mockResolvedValue([]);
        AdEvent.countDocuments.mockResolvedValue(0);
        AdEvent.findOne.mockResolvedValue(null);
        AdEvent.create.mockImplementation(async (data) => ({ _id: new mongoose.Types.ObjectId(), ...data }));
    });

    it('fetches shared static config once across feed and sidebar placements within one request', async () => {
        await adRequestContext.run(new Map(), async () => {
            await ProviderService.getAds({ placement: 'feed_native', user: { id: 'u1', role: 'user' }, session: null, count: 1 });
            await ProviderService.getAds({ placement: 'sidebar', user: { id: 'u1', role: 'user' }, session: null });
        });

        expect(ABTest.findOne).toHaveBeenCalledTimes(1);
        expect(AdConfig.find).toHaveBeenCalledTimes(1);
        expect(FrequencyRule.findOne).toHaveBeenCalledTimes(3);
        expect(FrequencyRule.findOne).toHaveBeenCalledWith({ slot: 'feed_native', active: true });
        expect(FrequencyRule.findOne).toHaveBeenCalledWith({ slot: 'feed', active: true });
        expect(FrequencyRule.findOne).toHaveBeenCalledWith({ slot: 'sidebar', active: true });
        expect(AdPlacement.find).toHaveBeenCalledTimes(3);
    });

    it('shares reads when placements are executed concurrently within one request', async () => {
        await adRequestContext.run(new Map(), async () => {
            const [feedAds, sidebarAds] = await Promise.all([
                ProviderService.getAds({ placement: 'feed_native', user: { id: 'u1', role: 'user' }, session: null }),
                ProviderService.getAds({ placement: 'sidebar', user: { id: 'u1', role: 'user' }, session: null })
            ]);

            expect(Array.isArray(feedAds)).toBe(true);
            expect(Array.isArray(sidebarAds)).toBe(true);
        });

        expect(ABTest.findOne).toHaveBeenCalledTimes(1);
        expect(AdConfig.find).toHaveBeenCalledTimes(1);
        expect(FrequencyRule.findOne).toHaveBeenCalledTimes(3);
    });

    it('does not leak dedup between separate requests', async () => {
        await Promise.all([
            adRequestContext.run(new Map(), () => ProviderService.getAds({ placement: 'sidebar', user: { id: 'u1', role: 'user' }, session: null })),
            adRequestContext.run(new Map(), () => ProviderService.getAds({ placement: 'sidebar', user: { id: 'u2', role: 'user' }, session: null }))
        ]);

        expect(ABTest.findOne).toHaveBeenCalledTimes(2);
    });

    it('preserves ad selection behavior (returns a served ad)', async () => {
        const ads = await adRequestContext.run(new Map(), () =>
            ProviderService.getAds({ placement: 'sidebar', user: { id: 'u1', role: 'user' }, session: null }));

        expect(Array.isArray(ads)).toBe(true);
        expect(ads.length).toBe(1);
        expect(ads[0].served).toBe(true);
        expect(ads[0].provider).toBe('mock');
    });

    it('preserves frequency-cap checks per placement (user-specific reads not deduped)', async () => {
        await adRequestContext.run(new Map(), async () => {
            await ProviderService.getAds({ placement: 'sidebar', user: { id: 'u1', role: 'user' }, session: null });
            await ProviderService.getAds({ placement: 'sidebar', user: { id: 'u1', role: 'user' }, session: null });
        });

        expect(AdEvent.countDocuments).toHaveBeenCalledTimes(2);
        expect(AdEvent.aggregate).toHaveBeenCalled();
    });

    it('dedupes within a single triggerAdForUser call chain for repeated slots', async () => {
        await adRequestContext.run(new Map(), async () => {
            await triggerAdForUser('u1', 'feed', null);
            await triggerAdForUser('u1', 'feed', null);
        });

        expect(ABTest.findOne).toHaveBeenCalledTimes(1);
        expect(FrequencyRule.findOne).toHaveBeenCalledTimes(1);
        expect(AdPlacement.find).toHaveBeenCalledTimes(1);
    });
});
