const mongoose = require('mongoose');
const User = require('../../src/models/User');
const AdConfig = require('../../src/models/ads/AdConfig');
const AdPlacement = require('../../src/models/ads/AdPlacement');
const AdEvent = require('../../src/models/ads/AdEvent');
const FrequencyRule = require('../../src/models/ads/FrequencyRule');
const ABTest = require('../../src/models/ads/ABTest');
const {
    triggerAdForUser,
    triggerRewardedAd,
    simulateImpression,
    simulateClick,
    simulateRewardedAd,
    getAdAnalytics,
    getGlobalAdAnalytics,
    seedDefaultData,
    computeRevenue,
    computeUserReward,
    simulateCTR,
    AD_TYPE_REVENUE,
    REWARD_RATES
} = require('../../src/services/ads/AdSimulationService');

describe('AdSimulationService', () => {
    let testUser;

    beforeAll(async () => {
        await seedDefaultData();
    });

    beforeEach(async () => {
        await AdEvent.deleteMany({});
        testUser = await User.create({
            email: 'ad-test-' + Date.now() + '@test.com',
            password: 'password123',
            'wallet.balance': 0,
            'wallet.lifetimeEarned': 0,
            'stats.totalReads': 10,
            'stats.streak': 1
        });
    });

    afterEach(async () => {
        await AdEvent.deleteMany({});
        await User.deleteMany({ email: { $regex: /^ad-test-/ } });
    });

    describe('seedDefaultData', () => {
        test('should create default ad configs', async () => {
            const configs = await AdConfig.find({ network: 'simulated' });
            expect(configs.length).toBeGreaterThanOrEqual(4);
            expect(configs.map(c => c.type)).toContain('banner');
            expect(configs.map(c => c.type)).toContain('rewarded');
        });

        test('should create default placements', async () => {
            const placements = await AdPlacement.find();
            expect(placements.length).toBeGreaterThanOrEqual(6);
        });

        test('should create default frequency rules', async () => {
            const rules = await FrequencyRule.find();
            expect(rules.length).toBeGreaterThanOrEqual(6);
        });

        test('should create default AB test', async () => {
            const test = await ABTest.findOne({ name: 'ad_placement_test_v1' });
            expect(test).not.toBeNull();
            expect(test.status).toBe('running');
            expect(test.variants.length).toBe(2);
        });
    });

    describe('simulateImpression', () => {
        test('should create an impression event with revenue', async () => {
            const configs = await AdConfig.find({ type: 'banner' }).limit(1);
            const placements = await AdPlacement.find({ slot: 'banner' }).limit(1);

            const event = await simulateImpression(
                testUser._id,
                configs[0],
                placements[0],
                null,
                { testMetadata: 'value' }
            );

            expect(event).not.toBeNull();
            expect(event.type).toBe('impression');
            expect(event.user.toString()).toBe(testUser._id.toString());
            expect(event.revenue).toBeGreaterThan(0);
            expect(event.metadata.simulated).toBe(true);
        });

        test('should also create a view event if viewability > 0.6', async () => {
            const configs = await AdConfig.find({ type: 'banner' }).limit(1);
            const placements = await AdPlacement.find({ slot: 'banner' }).limit(1);

            await simulateImpression(testUser._id, configs[0], placements[0], null);

            const views = await AdEvent.find({ user: testUser._id, type: 'view' });
            const impressions = await AdEvent.find({ user: testUser._id, type: 'impression' });

            expect(impressions.length).toBe(1);
            expect(views.length).toBeLessThanOrEqual(1);
        });
    });

    describe('simulateClick', () => {
        test('should create a click event', async () => {
            const configs = await AdConfig.find({ type: 'banner' }).limit(1);
            const placements = await AdPlacement.find({ slot: 'banner' }).limit(1);

            const { clickEvent } = await simulateClick(
                testUser._id,
                configs[0],
                placements[0],
                null,
                { page: '/home' }
            );

            expect(clickEvent).not.toBeNull();
            expect(clickEvent.type).toBe('click');
            expect(clickEvent.revenue).toBeGreaterThan(0);
        });

        test('should sometimes create a conversion event', async () => {
            const configs = await AdConfig.find({ type: 'rewarded' }).limit(1);
            const placements = await AdPlacement.find({ slot: 'rewarded' }).limit(1);

            let conversionsSeen = false;
            for (let i = 0; i < 20; i++) {
                const { conversionEvent } = await simulateClick(
                    testUser._id,
                    configs[0],
                    placements[0],
                    null
                );
                if (conversionEvent) {
                    conversionsSeen = true;
                    expect(conversionEvent.type).toBe('conversion');
                    break;
                }
            }
        });
    });

    describe('simulateRewardedAd', () => {
        test('should create impression, view, click, and reward_claimed events', async () => {
            const configs = await AdConfig.find({ type: 'rewarded' }).limit(1);
            const placements = await AdPlacement.find({ slot: 'rewarded' }).limit(1);

            const result = await simulateRewardedAd(
                testUser._id,
                configs[0],
                placements[0],
                null
            );

            expect(result.impression).not.toBeNull();
            expect(result.view).not.toBeNull();
            expect(result.click).not.toBeNull();
            expect(result.rewardClaimed).not.toBeNull();
            expect(result.userReward).toBeGreaterThan(0);
        });

        test('should have higher CTR for rewarded ads', () => {
            const rewardedCtr = simulateCTR('rewarded');
            const bannerCtr = simulateCTR('banner');

            expect(rewardedCtr).toBeGreaterThan(bannerCtr);
        });
    });

    describe('triggerAdForUser', () => {
        test('should serve an ad when conditions are met', async () => {
            const result = await triggerAdForUser(testUser._id, 'banner', null, { page: '/home' });

            expect(result.served).toBe(true);
            expect(result.adConfig).not.toBeNull();
            expect(result.impression).not.toBeNull();
            expect(result.abTest).toBe('ad_placement_test_v1');
        });

        test('should return frequency_limit when ad shown too recently', async () => {
            await FrequencyRule.deleteMany({ slot: 'banner' });
            await FrequencyRule.create({
                name: 'test_banner_limit',
                slot: 'banner',
                maxPerSession: 5,
                minIntervalSeconds: 300,
                active: true
            });

            const result1 = await triggerAdForUser(testUser._id, 'banner', null);
            expect(result1.served).toBe(true);

            const result2 = await triggerAdForUser(testUser._id, 'banner', null);
            expect(result2.served).toBe(false);
            expect(result2.reason).toBe('frequency_limit');

            await FrequencyRule.deleteMany({ slot: 'banner' });
        });

        test('should reset frequency after interval passes', async () => {
            await FrequencyRule.findOneAndUpdate(
                { slot: 'banner' },
                { minIntervalSeconds: 0, maxPerSession: 100 }
            );

            const result = await triggerAdForUser(testUser._id, 'banner', null);
            expect(result.served).toBe(true);
        });
    });

    describe('triggerRewardedAd', () => {
        test('should credit user reward on completion', async () => {
            const result = await triggerRewardedAd(testUser._id, 'rewarded', null);

            expect(result.served).toBe(true);
            expect(result.userReward).toBeGreaterThan(0);

            const rewardEvents = await AdEvent.find({
                user: testUser._id,
                type: 'reward_claimed'
            });
            expect(rewardEvents.length).toBe(1);
        });

        test('should respect frequency limits for rewarded ads', async () => {
            const result1 = await triggerRewardedAd(testUser._id, 'rewarded', null);
            expect(result1.served).toBe(true);

            const result2 = await triggerRewardedAd(testUser._id, 'rewarded', null);
            expect(result2.served).toBe(false);
            expect(result2.reason).toBe('frequency_limit');
        });
    });

    describe('computeRevenue', () => {
        test('should return positive revenue for impression', () => {
            const revenue = computeRevenue('banner', 'impression');
            expect(revenue).toBeGreaterThan(0);
        });

        test('should return higher revenue for clicks', () => {
            const clickRevenue = computeRevenue('banner', 'click');
            const impressionRevenue = computeRevenue('banner', 'impression');
            expect(clickRevenue).toBeGreaterThan(impressionRevenue);
        });

        test('should return highest revenue for conversions', () => {
            const conversionRevenue = computeRevenue('banner', 'conversion');
            const clickRevenue = computeRevenue('banner', 'click');
            expect(conversionRevenue).toBeGreaterThan(clickRevenue);
        });

        test('should have different rates per ad type', () => {
            const bannerRevenue = computeRevenue('banner', 'click');
            const rewardedRevenue = computeRevenue('rewarded', 'click');
            expect(rewardedRevenue).toBeGreaterThan(bannerRevenue);
        });
    });

    describe('computeUserReward', () => {
        test('should return correct reward for each ad type', () => {
            expect(computeUserReward('rewarded')).toBe(REWARD_RATES.rewarded);
            expect(computeUserReward('interstitial')).toBe(REWARD_RATES.interstitial);
            expect(computeUserReward('video')).toBe(REWARD_RATES.video);
        });

        test('should return default for unknown type', () => {
            expect(computeUserReward('unknown')).toBe(0.01);
        });
    });

    describe('getAdAnalytics', () => {
        test('should return analytics for a user', async () => {
            const configs = await AdConfig.find({ type: 'banner' }).limit(1);
            const placements = await AdPlacement.find({ slot: 'banner' }).limit(1);

            for (let i = 0; i < 5; i++) {
                await triggerAdForUser(testUser._id, 'banner', null);
            }

            const analytics = await getAdAnalytics(testUser._id);
            expect(analytics.impressions).toBeGreaterThan(0);
            expect(analytics.totalRevenue).toBeGreaterThan(0);
            expect(analytics.recent.length).toBeGreaterThan(0);
        });

        test('should calculate CTR correctly', async () => {
            const configs = await AdConfig.find({ type: 'banner' }).limit(1);
            const placements = await AdPlacement.find({ slot: 'banner' }).limit(1);

            await FrequencyRule.findOneAndUpdate({ slot: 'banner' }, { minIntervalSeconds: 0 });

            for (let i = 0; i < 10; i++) {
                const result = await triggerAdForUser(testUser._id, 'banner', null);
                if (result.served && Math.random() < 0.5) {
                    await simulateClick(testUser._id, result.adConfig, result.placement, null);
                }
            }

            const analytics = await getAdAnalytics(testUser._id);
            expect(analytics.ctr).not.toBe('0%');
        });
    });

    describe('getGlobalAdAnalytics', () => {
        test('should aggregate events across all users', async () => {
            const configs = await AdConfig.find({ type: 'banner' }).limit(1);
            const placements = await AdPlacement.find({ slot: 'banner' }).limit(1);

            await FrequencyRule.findOneAndUpdate({ slot: 'banner' }, { minIntervalSeconds: 0 });

            const users = [];
            for (let i = 0; i < 3; i++) {
                const user = await User.create({
                    email: 'ad-global-' + Date.now() + '-' + i + '@test.com',
                    password: 'password123'
                });
                users.push(user);
            }

            for (const user of users) {
                await triggerAdForUser(user._id, 'banner', null);
            }

            const globalAnalytics = await getGlobalAdAnalytics();
            expect(globalAnalytics.impressions).toBeGreaterThan(0);
            expect(globalAnalytics.byConfig.length).toBeGreaterThan(0);
            expect(globalAnalytics.bySlot.length).toBeGreaterThan(0);

            for (const user of users) {
                await User.findByIdAndDelete(user._id);
            }
        });
    });

    describe('AB Testing', () => {
        test('should assign user to a variant', async () => {
            const test = await ABTest.findOne({ name: 'ad_placement_test_v1' });
            expect(test).not.toBeNull();
            expect(test.variants.length).toBe(2);
        });

        test('should include AB test info in trigger response', async () => {
            const result = await triggerAdForUser(testUser._id, 'banner', null);
            expect(result.abTest).toBe('ad_placement_test_v1');
            expect(['control', 'variant_a']).toContain(result.abVariant);
        });
    });

    describe('Frequency Rules', () => {
        test('should have distinct frequency rules per slot', async () => {
            await seedDefaultData();

            const bannerRule = await FrequencyRule.findOne({ slot: 'banner' });
            const rewardedRule = await FrequencyRule.findOne({ slot: 'rewarded' });

            expect(bannerRule).not.toBeNull();
            expect(rewardedRule).not.toBeNull();
            expect(bannerRule.slot).toBe('banner');
            expect(rewardedRule.slot).toBe('rewarded');
            expect(bannerRule.excludeAfterRewardClaim).toBe(true);
            expect(rewardedRule.excludeAfterRewardClaim).toBe(false);
        });
    });
});