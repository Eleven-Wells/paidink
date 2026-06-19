const mongoose = require('mongoose');
const User = require('../../src/models/User');
const LedgerEntry = require('../../src/models/LedgerEntry');
const Transaction = require('../../src/models/Transaction');
const ReadSession = require('../../src/models/ReadSession');
const Post = require('../../src/models/Post');
const AdEvent = require('../../src/models/ads/AdEvent');
const SystemConfig = require('../../src/models/SystemConfig');
const {
    distributeAdRevenue
} = require('../../src/services/ads/AdRevenueService');
const {
    getReaderPoolBalance,
    processReadCompletion,
    dailyFeedRevenueSweep,
    MAX_REWARD
} = require('../../src/services/ads/ReaderRewardService');
const { seedDefaultData } = require('../../src/services/ads/AdSimulationService');

describe('ReaderRewardService', () => {
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
        await SystemConfig.deleteMany({});
        testUser = await User.create({
            email: 'reader-test-' + Date.now() + '@test.com',
            password: 'password123',
            'wallet.balance': 0,
            'wallet.lifetimeEarned': 0,
            'wallet.totalReaderRewards': 0,
            'stats.totalReads': 0,
            'stats.streak': 1,
            'stats.lastReadDate': null
        });
        testPost = await Post.create({
            title: 'Test Post',
            slug: 'test-post-' + Date.now(),
            summary: 'A test post for reader reward tests',
            content: '<p>Test content</p>'.repeat(20),
            category: 'development',
            author: testUser._id,
            publishedAt: new Date()
        });
    });

    afterEach(async () => {
        await User.deleteMany({ email: { $regex: /^reader-test-/ } });
    });

    afterAll(async () => {
        await LedgerEntry.deleteMany({});
        await ReadSession.deleteMany({});
        await Post.deleteMany({});
        await SystemConfig.deleteMany({});
    });

    async function fundReaderPool(amount) {
        const adEvent = await AdEvent.create({
            user: testUser._id,
            type: 'impression',
            revenue: amount / 0.3,
            metadata: { pageType: 'post', simulated: true }
        });
        await distributeAdRevenue(adEvent);
    }

    describe('getReaderPoolBalance', () => {
        test('should return 0 for empty pool', async () => {
            const b = await getReaderPoolBalance();
            expect(b).toBe(0);
        });

        test('should return funded amount', async () => {
            await fundReaderPool(5);
            const b = await getReaderPoolBalance();
            expect(b).toBeCloseTo(5, 1);
        });
    });

    describe('processReadCompletion', () => {
        test('should award reward at current rate', async () => {
            const session = await ReadSession.create({
                user: testUser._id,
                post: testPost._id
            });

            const result = await processReadCompletion(testUser, session);
            expect(result.paid).toBe(true);
            expect(result.amount).toBeGreaterThanOrEqual(10);

            const updatedUser = await User.findById(testUser._id);
            expect(updatedUser.wallet.balance).toBe(result.amount);
            expect(updatedUser.wallet.lifetimeEarned).toBe(result.amount);
        });
    });

    describe('ReadSession.markCompleted integration', () => {
        test('should complete and award reward at current rate', async () => {
            const session = await ReadSession.create({
                user: testUser._id,
                post: testPost._id,
                startedAt: new Date(Date.now() - 60000)
            });
            session.timeSpentSeconds = 60;

            const reward = await session.markCompleted();
            expect(reward).toBeGreaterThanOrEqual(10);

            const updatedUser = await User.findById(testUser._id);
            expect(updatedUser.wallet.balance).toBe(reward);

            const ledgerEntries = await LedgerEntry.find({ user: testUser._id, type: 'read_reward' });
            expect(ledgerEntries.length).toBeGreaterThanOrEqual(1);
        });

        test('should not reward for too-short reads', async () => {
            const session = await ReadSession.create({
                user: testUser._id,
                post: testPost._id,
                startedAt: new Date(Date.now() - 5000)
            });
            session.timeSpentSeconds = 5;

            const reward = await session.markCompleted();
            expect(reward).toBe(0);
        });
    });
});
