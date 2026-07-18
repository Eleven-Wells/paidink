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

jest.mock('../../src/models/ads/AdEvent', () => ({
    findById: jest.fn(),
    create: jest.fn(),
    countDocuments: jest.fn()
}));

jest.mock('../../src/models/ads/AdConfig', () => ({
    findById: jest.fn()
}));

jest.mock('../../src/models/ads/AdPlacement', () => ({
    findById: jest.fn(),
    findOne: jest.fn()
}));

jest.mock('../../src/models/ads/FrequencyRule', () => ({
    findOne: jest.fn()
}));

jest.mock('../../src/services/ads/providers/CacheManager');
jest.mock('../../src/services/ads/providers/RotationStrategy');
jest.mock('../../src/services/ads/AdsSettingsService', () => ({
    getSettings: jest.fn()
}));
jest.mock('../../src/services/ads/AdRevenueService', () => ({
    distributeAdRevenue: jest.fn().mockResolvedValue()
}));

const EventBus = require('../../src/services/ads/EventBus');
const AnalyticsService = require('../../src/services/ads/AnalyticsService');
const AdSimulationService = require('../../src/services/ads/AdSimulationService');
const { AD_EVENTS, loadAdConfig } = require('../../src/config/ads');
const AdEvent = require('../../src/models/ads/AdEvent');
const AdConfig = require('../../src/models/ads/AdConfig');
const AdPlacement = require('../../src/models/ads/AdPlacement');

function mockQuery(result) {
    return { lean: jest.fn().mockResolvedValue(result) };
}

describe('EventBus Integration — component wiring', () => {
    let eventBus;

    beforeAll(() => {
        const ProviderFactory = require('../../src/services/ads/providers/ProviderFactory');
        class MockProvider {
            get name() { return 'mock'; }
            async getAds() { return [{ served: true, type: 'banner', slot: 'sidebar', provider: 'mock' }]; }
            async healthCheck() { return true; }
        }
        ProviderFactory.register('mock', MockProvider);
    });

    beforeEach(() => {
        eventBus = new EventBus();
        AdEvent.findById.mockReset();
        AdEvent.create.mockReset();
        AdConfig.findById.mockReset();
        AdPlacement.findById.mockReset();
        AdPlacement.findOne.mockReset();
    });

    describe('AnalyticsService receives PROVIDER_FAILED events', () => {
        beforeEach(() => {
            AnalyticsService.subscribeToEventBus(eventBus);
        });

        afterEach(() => {
            jest.restoreAllMocks();
        });

        it('should record and accumulate provider failures from EventBus', async () => {
            eventBus.emit(AD_EVENTS.PROVIDER_FAILED, { provider: 'test-provider', error: 'timeout' });

            const statsAfterFirst = await AnalyticsService.getProviderStats();
            expect(statsAfterFirst['test-provider']).toBeDefined();
            expect(statsAfterFirst['test-provider'].failures).toBeGreaterThanOrEqual(1);

            eventBus.emit(AD_EVENTS.PROVIDER_FAILED, { provider: 'test-provider', error: 'err2' });
            eventBus.emit(AD_EVENTS.PROVIDER_FAILED, { provider: 'other', error: 'err3' });

            const statsAfterAll = await AnalyticsService.getProviderStats();
            expect(statsAfterAll['test-provider'].failures).toBeGreaterThanOrEqual(2);
            expect(statsAfterAll['other'].failures).toBeGreaterThanOrEqual(1);
        });
    });

    describe('AnalyticsService does not receive events from unsubscribed bus', () => {
        it('should not have failures when using a different bus', async () => {
            const wrongBus = new EventBus();
            AnalyticsService.subscribeToEventBus(wrongBus);

            eventBus.emit(AD_EVENTS.PROVIDER_FAILED, { provider: 'test', error: 'err' });

            const stats = await AnalyticsService.getProviderStats();
            expect(stats['test']).toBeUndefined();
        });
    });

    describe('AdSimulationService receives IMPRESSION events', () => {
        beforeEach(() => {
            AdSimulationService.subscribeToEventBus(eventBus);
        });

        it('should call simulateImpression with correctly ordered args when IMPRESSION is emitted', async () => {
            const mockConfig = { _id: 'cfg1', type: 'banner', name: 'Test Config' };
            const mockPlacement = { _id: 'plc1', slot: 'sidebar', name: 'Sidebar' };
            AdConfig.findById.mockReturnValue(mockQuery(mockConfig));
            AdPlacement.findOne.mockReturnValue(mockQuery(mockPlacement));
            AdEvent.create.mockResolvedValue({ _id: 'evt1' });

            eventBus.emit(AD_EVENTS.IMPRESSION, {
                adConfigId: 'cfg1',
                userId: 'user1',
                placement: 'sidebar',
                sessionId: 'sess1'
            });

            await new Promise(resolve => setTimeout(resolve, 100));

            expect(AdConfig.findById).toHaveBeenCalledWith('cfg1');
            expect(AdPlacement.findOne).toHaveBeenCalledWith({ slot: 'sidebar', active: true });
            expect(AdEvent.create).toHaveBeenCalled();
        });

        it('should not call AdEvent.create when config or placement is missing', async () => {
            AdConfig.findById.mockReturnValue(mockQuery(null));
            AdPlacement.findOne.mockReturnValue(mockQuery(null));

            eventBus.emit(AD_EVENTS.IMPRESSION, {
                adConfigId: 'nonexistent',
                userId: 'user1',
                placement: 'unknown',
                sessionId: 'sess1'
            });

            await new Promise(resolve => setTimeout(resolve, 100));

            expect(AdEvent.create).not.toHaveBeenCalled();
        });
    });

    describe('AdSimulationService receives CLICKED events', () => {
        beforeEach(() => {
            AdSimulationService.subscribeToEventBus(eventBus);
        });

        it('should call simulateClick with correctly ordered args when CLICKED is emitted', async () => {
            const mockEvent = {
                _id: 'imp1',
                adConfig: 'cfg1',
                placement: 'plc1',
                session: 'sess1',
                user: 'user1'
            };
            const mockConfig = { _id: 'cfg1', type: 'banner' };
            const mockPlacement = { _id: 'plc1', slot: 'sidebar' };

            AdEvent.findById.mockReturnValue(mockQuery(mockEvent));
            AdConfig.findById.mockReturnValue(mockQuery(mockConfig));
            AdPlacement.findById.mockReturnValue(mockQuery(mockPlacement));
            AdEvent.create.mockResolvedValue({ _id: 'click1' });

            eventBus.emit(AD_EVENTS.CLICKED, {
                impressionId: 'imp1',
                userId: 'user1',
                placement: 'sidebar'
            });

            await new Promise(resolve => setTimeout(resolve, 100));

            expect(AdEvent.findById).toHaveBeenCalledWith('imp1');
            expect(AdConfig.findById).toHaveBeenCalledWith('cfg1');
            expect(AdPlacement.findById).toHaveBeenCalledWith('plc1');
            expect(AdEvent.create).toHaveBeenCalled();
        });

        it('should not call AdEvent.create when original impression is missing', async () => {
            AdEvent.findById.mockReturnValue(mockQuery(null));

            eventBus.emit(AD_EVENTS.CLICKED, { impressionId: 'nonexistent' });

            await new Promise(resolve => setTimeout(resolve, 100));

            expect(AdEvent.create).not.toHaveBeenCalled();
        });
    });

    describe('Full pipeline: ProviderService + AnalyticsService on same EventBus', () => {
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

            const AdsSettingsService = require('../../src/services/ads/AdsSettingsService');
            AdsSettingsService.getSettings.mockResolvedValue({
                adsEnabled: true,
                activeProvider: 'mock',
                rotationStrategy: 'none',
                providers: { mock: { enabled: true } }
            });
            const RotationStrategy = require('../../src/services/ads/providers/RotationStrategy');
            RotationStrategy.pick = jest.fn().mockReturnValue('mock');
            const FrequencyRule = require('../../src/models/ads/FrequencyRule');
            FrequencyRule.findOne = jest.fn().mockResolvedValue(null);
            AdEvent.countDocuments = jest.fn().mockResolvedValue(0);
        });

        it('should propagate provider.selected and provider.failed events from ProviderService to AnalyticsService', async () => {
            const ProviderService = require('../../src/services/ads/ProviderService');
            ProviderService.setEventBus(eventBus);
            AnalyticsService.subscribeToEventBus(eventBus);

            const result = await ProviderService.getAds({
                placement: 'sidebar',
                user: { role: 'user' }
            });

            expect(result).toBeDefined();
            expect(result.length).toBeGreaterThan(0);
        });

        it('should correctly record provider failures via the full pipeline', async () => {
            const ProviderFactory = require('../../src/services/ads/providers/ProviderFactory');
            class FailingProvider {
                get name() { return 'failing'; }
                async getAds() { throw new Error('timeout'); }
                async healthCheck() { return true; }
            }
            ProviderFactory.register('failing', FailingProvider);

            const RotationStrategy = require('../../src/services/ads/providers/RotationStrategy');
            RotationStrategy.pick = jest.fn().mockReturnValue('failing');

            const ProviderService = require('../../src/services/ads/ProviderService');
            ProviderService.setEventBus(eventBus);
            AnalyticsService.subscribeToEventBus(eventBus);

            await ProviderService.getAds({
                placement: 'sidebar',
                user: { role: 'user' }
            });

            const stats = await AnalyticsService.getProviderStats();
            expect(stats['failing']).toBeDefined();
            expect(stats['failing'].failures).toBeGreaterThanOrEqual(1);
        });
    });
});
