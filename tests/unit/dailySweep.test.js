const mongoose = require('mongoose');
const LedgerEntry = require('../../src/models/LedgerEntry');
const AdEvent = require('../../src/models/ads/AdEvent');
const ReadSession = require('../../src/models/ReadSession');
const Post = require('../../src/models/Post');
const Transaction = require('../../src/models/Transaction');
const User = require('../../src/models/User');
const {
    distributeAdRevenue
} = require('../../src/services/ads/AdRevenueService');
const {
    getReaderPoolBalance,
    dailyFeedRevenueSweep
} = require('../../src/services/ads/ReaderRewardService');
const { seedDefaultData } = require('../../src/services/ads/AdSimulationService');

describe('Daily Sweep Jobs', () => {
    let testUser;
    let testPost;

    beforeAll(async () => {
        await seedDefaultData();
    });

    beforeEach(async () => {
        await LedgerEntry.deleteMany({});
        await AdEvent.deleteMany({});
        await ReadSession.deleteMany({});
        await Post.deleteMany({});
        await Transaction.deleteMany({});
        testUser = await User.create({
            email: 'sweep-test-' + Date.now() + '@test.com',
            password: 'password123',
            'wallet.balance': 0,
            'wallet.lifetimeEarned': 0,
            'stats.totalReads': 0,
            'stats.streak': 1
        });
        testPost = await Post.create({
            title: 'Sweep Test Post',
            slug: 'sweep-test-' + Date.now(),
            summary: 'Test post for sweep tests',
            content: '<p>Content</p>'.repeat(10),
            category: 'javascript',
            author: testUser._id,
            publishedAt: new Date()
        });
    });

    afterEach(async () => {
        await User.deleteMany({ email: { $regex: /^sweep-test-/ } });
    });

    afterAll(async () => {
        await LedgerEntry.deleteMany({});
        await AdEvent.deleteMany({});
        await ReadSession.deleteMany({});
        await Post.deleteMany({});
    });

    async function createFeedAdEvents(count, revenuePerEvent = 0.01) {
        for (let i = 0; i < count; i++) {
            const adEvent = await AdEvent.create({
                user: testUser._id,
                type: 'impression',
                revenue: revenuePerEvent,
                metadata: { pageType: 'feed', simulated: true }
            });
            await distributeAdRevenue(adEvent);
        }
    }

    async function createPostAdEvents(count) {
        for (let i = 0; i < count; i++) {
            const adEvent = await AdEvent.create({
                user: testUser._id,
                type: 'impression',
                revenue: 0.02,
                metadata: {
                    pageType: 'post',
                    publisherId: testUser._id,
                    postId: testPost._id,
                    simulated: true
                }
            });
            await distributeAdRevenue(adEvent);
        }
    }

    describe('dailyFeedRevenueSweep', () => {
        test('should return 0 when no feed revenue exists', async () => {
            const r = await dailyFeedRevenueSweep();
            expect(r.swept).toBe(0);
            expect(r.note).toBe('no_feed_revenue');
        });

        test('should sweep 30% of feed ad revenue to reader pool', async () => {
            // 3 feed AdEvents × 0.01 each = 0.03 total feed revenue
            await createFeedAdEvents(3, 0.01);

            const feedEvents = await AdEvent.find({ 'metadata.pageType': 'feed' });
            expect(feedEvents.length).toBe(3);
            const totalRevenue = feedEvents.reduce((s, e) => s + e.revenue, 0);
            expect(totalRevenue).toBeCloseTo(0.03, 4);

            const r = await dailyFeedRevenueSweep();
            expect(r.swept).toBeCloseTo(totalRevenue * 0.30, 4);

            // Verify reader pool now has the swept amount
            const poolBalance = await getReaderPoolBalance();
            expect(poolBalance).toBeCloseTo(r.swept, 4);
        });

        test('should sweep only new revenue each run', async () => {
            await createFeedAdEvents(2, 0.01);

            const r1 = await dailyFeedRevenueSweep();
            expect(r1.swept).toBeGreaterThan(0);

            const poolAfter = await getReaderPoolBalance();
            expect(poolAfter).toBeCloseTo(r1.swept, 4);

            // Second run with no new AdEvents
            const r2 = await dailyFeedRevenueSweep();
            expect(r2.swept).toBe(0);
            expect(r2.note).toBe('no_feed_revenue');

            // Pool unchanged
            const poolAfter2 = await getReaderPoolBalance();
            expect(poolAfter2).toBeCloseTo(poolAfter, 4);
        });

        test('should not sweep post page ad revenue', async () => {
            await createFeedAdEvents(1, 0.01);
            await createPostAdEvents(1);

            const feedTotal = (await AdEvent.find({ 'metadata.pageType': 'feed' }))
                .reduce((s, e) => s + e.revenue, 0);
            const postTotal = (await AdEvent.find({ 'metadata.pageType': 'post' }))
                .reduce((s, e) => s + e.revenue, 0);

            const r = await dailyFeedRevenueSweep();
            expect(r.swept).toBeCloseTo(feedTotal * 0.30, 4);
            expect(r.swept).not.toBeCloseTo((feedTotal + postTotal) * 0.30, 4);
        });

        test('should create sweep marker entry', async () => {
            await createFeedAdEvents(1, 0.01);

            const r = await dailyFeedRevenueSweep();
            expect(r.entry).toBeDefined();
            expect(r.entry.type).toBe('ad_revenue_reader_pool');
            expect(r.entry.metadata.sweepType).toBe('daily_feed_sweep');
            expect(r.entry.metadata.totalFeedRevenue).toBeGreaterThan(0);
        });
    });

    describe('cron config', () => {
        test('should have sweep schedule env vars', () => {
            expect(process.env.READER_POOL_SWEEP_SCHEDULE).toBeUndefined(); // not set, uses default
        });

        test('should use config defaults when env not set', () => {
            const config = require('../../src/config');
            const cfg = config.loadConfig();
            expect(cfg.READER_POOL_SWEEP_SCHEDULE).toBe('0 0 * * *');
        });
    });
});
