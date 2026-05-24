const mongoose = require('mongoose');
const LedgerEntry = require('../../src/models/LedgerEntry');
const AdEvent = require('../../src/models/ads/AdEvent');
const AdConfig = require('../../src/models/ads/AdConfig');
const AdPlacement = require('../../src/models/ads/AdPlacement');
const User = require('../../src/models/User');
const {
    distributeAdRevenue,
    generatePoolDistribution,
    getPoolBalance,
    getPoolBalanceByUser,
    getAverageDailyReaderPayout
} = require('../../src/services/ads/AdRevenueService');
const { seedDefaultData, triggerAdForUser } = require('../../src/services/ads/AdSimulationService');

describe('AdRevenueService', () => {
    let testUser;

    beforeAll(async () => {
        await seedDefaultData();
    });

    beforeEach(async () => {
        await LedgerEntry.deleteMany({});
        await AdEvent.deleteMany({});
        testUser = await User.create({
            email: 'revenue-test-' + Date.now() + '@test.com',
            password: 'password123',
            'wallet.balance': 0,
            'wallet.lifetimeEarned': 0,
            'stats.totalReads': 10,
            'stats.streak': 1
        });
    });

    afterEach(async () => {
        await User.deleteMany({ email: { $regex: /^revenue-test-/ } });
    });

    afterAll(async () => {
        await LedgerEntry.deleteMany({});
        await AdEvent.deleteMany({});
    });

    describe('generatePoolDistribution', () => {
        test('should split post page revenue 30/30/40', () => {
            const d = generatePoolDistribution(0.0040, 'post');
            expect(d.reader).toBeCloseTo(0.0012, 4);
            expect(d.publisher).toBeCloseTo(0.0012, 4);
            expect(d.orgOperational).toBeCloseTo(0.0016, 4);
        });

        test('should split feed page revenue 30/70', () => {
            const d = generatePoolDistribution(0.0024, 'feed');
            expect(d.reader).toBeCloseTo(0.00072, 5);
            expect(d.orgReserve).toBeCloseTo(0.00168, 5);
            expect(d.publisher).toBeUndefined();
            expect(d.orgOperational).toBeUndefined();
        });

        test('should default to feed when pageType unknown', () => {
            const d = generatePoolDistribution(0.01, null);
            expect(d.reader).toBeCloseTo(0.003, 4);
            expect(d.orgReserve).toBeCloseTo(0.007, 4);
            expect(d.publisher).toBeUndefined();
            expect(d.orgOperational).toBeUndefined();
        });

        test('should round to 6 decimal places', () => {
            const d = generatePoolDistribution(0.001, 'post');
            expect(Number.isInteger(d.reader * 1e6)).toBe(true);
        });
    });

    describe('distributeAdRevenue', () => {
        test('should create only reserve entry for feed page ad (reader pool via sweep)', async () => {
            const adEvent = await AdEvent.create({
                user: testUser._id,
                type: 'impression',
                revenue: 0.01,
                metadata: { pageType: 'feed', simulated: true }
            });

            const entries = await distributeAdRevenue(adEvent);
            expect(entries.length).toBe(1);

            const reserveEntry = entries[0];
            expect(reserveEntry.type).toBe('ad_revenue_reserve');
            expect(reserveEntry.amount).toBeCloseTo(0.007, 4);
            expect(reserveEntry.pool).toBe('org_reserve');

            const readerEntry = entries.find(e => e.type === 'ad_revenue_reader_pool');
            expect(readerEntry).toBeUndefined();
        });

        test('should create publisher entry for post page ad', async () => {
            const publisher = await User.create({
                email: 'publisher-' + Date.now() + '@test.com',
                password: 'password123'
            });

            const adEvent = await AdEvent.create({
                user: testUser._id,
                type: 'impression',
                revenue: 0.01,
                metadata: {
                    pageType: 'post',
                    publisherId: publisher._id,
                    postId: new mongoose.Types.ObjectId(),
                    slot: 'article_inline',
                    simulated: true
                }
            });

            const entries = await distributeAdRevenue(adEvent);
            expect(entries.length).toBe(3);

            const publisherEntry = entries.find(e => e.type === 'ad_revenue_publisher');
            expect(publisherEntry).toBeDefined();
            expect(publisherEntry.amount).toBeCloseTo(0.003, 4);
            expect(publisherEntry.pool).toBe('publisher_pool');
            expect(publisherEntry.user.toString()).toBe(publisher._id.toString());

            const operationalEntry = entries.find(e => e.type === 'ad_revenue_operational');
            expect(operationalEntry).toBeDefined();
            expect(operationalEntry.amount).toBeCloseTo(0.004, 4);
            expect(operationalEntry.pool).toBe('org_operational');

            await User.findByIdAndDelete(publisher._id);
        });

        test('should create entry without publisher when no publisherId set', async () => {
            const adEvent = await AdEvent.create({
                user: testUser._id,
                type: 'impression',
                revenue: 0.01,
                metadata: { pageType: 'post', simulated: true }
            });

            const entries = await distributeAdRevenue(adEvent);
            expect(entries.length).toBe(2);
            expect(entries.find(e => e.type === 'ad_revenue_publisher')).toBeUndefined();
        });

        test('should link entries to adEvent via correlationId', async () => {
            const adEvent = await AdEvent.create({
                user: testUser._id,
                type: 'impression',
                revenue: 0.005,
                metadata: { pageType: 'post', simulated: true }
            });

            const entries = await distributeAdRevenue(adEvent);
            entries.forEach(e => {
                expect(e.correlationId.toString()).toBe(adEvent._id.toString());
                expect(e.correlationModel).toBe('AdEvent');
            });
        });

        test('should update AdEvent metadata with pool distribution', async () => {
            const adEvent = await AdEvent.create({
                user: testUser._id,
                type: 'impression',
                revenue: 0.01,
                metadata: { pageType: 'post', simulated: true }
            });

            await distributeAdRevenue(adEvent);

            const updated = await AdEvent.findById(adEvent._id);
            expect(updated.metadata.poolDistribution).toBeDefined();
            expect(updated.metadata.poolDistribution.reader).toBeCloseTo(0.003, 4);
            expect(updated.metadata.poolDistribution.publisher).toBeCloseTo(0.003, 4);
            expect(updated.metadata.poolDistribution.orgOperational).toBeCloseTo(0.004, 4);
        });

        test('should throw for invalid adEvent', async () => {
            await expect(distributeAdRevenue(null)).rejects.toThrow('Invalid adEvent');
            await expect(distributeAdRevenue({})).rejects.toThrow('Invalid adEvent');
        });
    });

    describe('getPoolBalance', () => {
        test('should return 0 for empty pool', async () => {
            const balance = await getPoolBalance('reader_pool');
            expect(balance).toBe(0);
        });

        test('should aggregate reader pool entries from post page ads', async () => {
            const adEvent = await AdEvent.create({
                user: testUser._id,
                type: 'impression',
                revenue: 0.01,
                metadata: { pageType: 'post', simulated: true }
            });
            await distributeAdRevenue(adEvent);

            const adEvent2 = await AdEvent.create({
                user: testUser._id,
                type: 'click',
                revenue: 0.02,
                metadata: { pageType: 'post', simulated: true }
            });
            await distributeAdRevenue(adEvent2);

            const balance = await getPoolBalance('reader_pool');
            // 0.01*0.30 + 0.02*0.30 = 0.003 + 0.006 = 0.009
            expect(balance).toBeCloseTo(0.009, 4);
        });
    });

    describe('getPoolBalanceByUser', () => {
        test('should return 0 for publisher with no earnings', async () => {
            const balance = await getPoolBalanceByUser('publisher_pool', testUser._id);
            expect(balance).toBe(0);
        });

        test('should aggregate publisher pool for specific user', async () => {
            const publisher = await User.create({
                email: 'publisher2-' + Date.now() + '@test.com',
                password: 'password123'
            });

            const adEvent = await AdEvent.create({
                user: testUser._id,
                type: 'impression',
                revenue: 0.01,
                metadata: {
                    pageType: 'post',
                    publisherId: publisher._id,
                    slot: 'article_inline',
                    simulated: true
                }
            });
            await distributeAdRevenue(adEvent);

            const balance = await getPoolBalanceByUser('publisher_pool', publisher._id);
            expect(balance).toBeCloseTo(0.003, 4);

            const otherBalance = await getPoolBalanceByUser('publisher_pool', testUser._id);
            expect(otherBalance).toBe(0);

            await User.findByIdAndDelete(publisher._id);
        });
    });

    describe('getAverageDailyReaderPayout', () => {
        test('should return 0 when no payouts exist', async () => {
            const avg = await getAverageDailyReaderPayout();
            expect(avg).toBe(0);
        });
    });

    describe('AdSimulation integration', () => {
        test('should create reserve entry for feed page ad (reader pool from sweep)', async () => {
            const result = await triggerAdForUser(testUser._id, 'banner', null, {
                pageType: 'feed'
            });

            expect(result.served).toBe(true);

            const entries = await LedgerEntry.find({
                correlationId: result.impression._id,
                correlationModel: 'AdEvent'
            });
            expect(entries.length).toBe(1);

            const reserveEntry = entries[0];
            expect(reserveEntry.type).toBe('ad_revenue_reserve');

            const readerEntry = entries.find(e => e.type === 'ad_revenue_reader_pool');
            expect(readerEntry).toBeUndefined();
        });

        test('should create publisher + operational entries for post page ad', async () => {
            const publisher = await User.create({
                email: 'publisher-int-' + Date.now() + '@test.com',
                password: 'password123'
            });

            const result = await triggerAdForUser(testUser._id, 'banner', null, {
                pageType: 'post',
                publisherId: publisher._id,
                postId: new mongoose.Types.ObjectId()
            });

            expect(result.served).toBe(true);

            const entries = await LedgerEntry.find({
                correlationId: result.impression._id,
                correlationModel: 'AdEvent'
            });

            expect(entries.find(e => e.type === 'ad_revenue_publisher')).toBeDefined();
            expect(entries.find(e => e.type === 'ad_revenue_operational')).toBeDefined();

            await User.findByIdAndDelete(publisher._id);
        });
    });
});
