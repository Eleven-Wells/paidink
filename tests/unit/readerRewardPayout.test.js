const mongoose = require('mongoose');
const User = require('../../src/models/User');
const LedgerEntry = require('../../src/models/LedgerEntry');
const Transaction = require('../../src/models/Transaction');
const ReadSession = require('../../src/models/ReadSession');
const Post = require('../../src/models/Post');
const AdEvent = require('../../src/models/ads/AdEvent');
const {
    distributeAdRevenue
} = require('../../src/services/ads/AdRevenueService');
const {
    getReaderPoolBalance,
    payoutReaderReward,
    handleUnfundedRead,
    sweepUnfundedReads,
    getUserUnfundedCount,
    MAX_REWARD,
    MAX_UNFUNDED
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
        testUser = await User.create({
            email: 'reader-test-' + Date.now() + '@test.com',
            password: 'password123',
            'wallet.balance': 0,
            'wallet.lifetimeEarned': 0,
            'wallet.pendingUnfundedReads': 0,
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
            category: 'javascript',
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

    describe('payoutReaderReward', () => {
        test('should pay when pool has sufficient balance', async () => {
            await fundReaderPool(10);

            const session = await ReadSession.create({
                user: testUser._id,
                post: testPost._id,
                startedAt: new Date(Date.now() - 60000),
                completed: true,
                timeSpentSeconds: 60
            });

            const result = await payoutReaderReward(session, 5);
            expect(result.paid).toBe(true);
            expect(result.amount).toBe(5);

            const poolBalance = await getReaderPoolBalance();
            expect(poolBalance).toBeCloseTo(5, 1);

            const debitEntries = await LedgerEntry.find({ type: 'reader_reward_payout' });
            expect(debitEntries.length).toBe(1);
            expect(debitEntries[0].amount).toBe(-5);
            expect(debitEntries[0].pool).toBe('reader_pool');
        });

        test('should handleUnfundedRead when pool is empty', async () => {
            const session = await ReadSession.create({
                user: testUser._id,
                post: testPost._id,
                startedAt: new Date(Date.now() - 60000),
                completed: true,
                timeSpentSeconds: 60
            });

            const result = await payoutReaderReward(session, 5);
            expect(result.paid).toBe(false);
            expect(result.reason).toBe('insufficient_pool');

            const pCount = await getUserUnfundedCount(testUser._id);
            expect(pCount).toBe(1);
        });

        test('should reject when max unfunded reached', async () => {
            const sessions = [];
            for (let i = 0; i < 4; i++) {
                const s = await ReadSession.create({
                    user: testUser._id,
                    post: testPost._id,
                    startedAt: new Date(Date.now() - 60000 * (i + 1)),
                    completed: true,
                    timeSpentSeconds: 60
                });
                sessions.push(s);
            }

            for (let i = 0; i < 3; i++) {
                const r = await payoutReaderReward(sessions[i], 5);
                expect(r.paid).toBe(false);
                expect(r.reason).toBe('insufficient_pool');
            }

            const r4 = await payoutReaderReward(sessions[3], 5);
            expect(r4.paid).toBe(false);
            expect(r4.reason).toBe('max_unfunded_reached');
        });
    });

    describe('handleUnfundedRead', () => {
        test('should increment user pending count', async () => {
            const session = await ReadSession.create({
                user: testUser._id,
                post: testPost._id
            });

            const r = await handleUnfundedRead(session);
            expect(r.paid).toBe(false);
            expect(r.pendingCount).toBe(1);

            const pCount = await getUserUnfundedCount(testUser._id);
            expect(pCount).toBe(1);

            const updated = await ReadSession.findById(session._id);
            expect(updated.isUnfunded).toBe(true);
            expect(updated.userPendingCount).toBe(1);
        });

        test('should reject when at max', async () => {
            await User.updateOne(
                { _id: testUser._id },
                { $set: { 'wallet.pendingUnfundedReads': 3 } }
            );

            const session = await ReadSession.create({
                user: testUser._id,
                post: testPost._id
            });

            const r = await handleUnfundedRead(session);
            expect(r.paid).toBe(false);
            expect(r.reason).toBe('max_unfunded_reached');
            expect(r.pendingCount).toBe(3);
        });
    });

    describe('sweepUnfundedReads', () => {
        test('should skip when pool is empty', async () => {
            const session = await ReadSession.create({
                user: testUser._id,
                post: testPost._id,
                completed: true,
                rewardAwarded: false,
                isUnfunded: true
            });

            const r = await sweepUnfundedReads();
            expect(r.swept).toBe(0);
        });

        test('should pay unfunded reads when pool is funded', async () => {
            await User.updateOne(
                { _id: testUser._id },
                { $set: { 'wallet.pendingUnfundedReads': 1 } }
            );

            const session = await ReadSession.create({
                user: testUser._id,
                post: testPost._id,
                startedAt: new Date(Date.now() - 60000),
                completed: true,
                rewardAwarded: false,
                isUnfunded: true,
                timeSpentSeconds: 60
            });

            await fundReaderPool(10);

            const r = await sweepUnfundedReads();
            expect(r.swept).toBe(1);
            expect(r.totalAmount).toBe(5);
            expect(r.poolBalanceAfter).toBeCloseTo(5, 1);

            const updatedSession = await ReadSession.findById(session._id);
            expect(updatedSession.rewardAwarded).toBe(true);
            expect(updatedSession.rewardAmount).toBe(5);
            expect(updatedSession.isUnfunded).toBe(false);

            const userAfter = await User.findById(testUser._id);
            expect(userAfter.wallet.balance).toBe(5);
            expect(userAfter.wallet.pendingUnfundedReads).toBe(0);
        });

        test('should pay up to pool balance', async () => {
            await User.updateOne(
                { _id: testUser._id },
                { $set: { 'wallet.pendingUnfundedReads': 3 } }
            );

            const sessions = [];
            for (let i = 0; i < 3; i++) {
                const s = await ReadSession.create({
                    user: testUser._id,
                    post: testPost._id,
                    startedAt: new Date(Date.now() - 60000 * (i + 1)),
                    completed: true,
                    rewardAwarded: false,
                    isUnfunded: true,
                    timeSpentSeconds: 60
                });
                sessions.push(s);
            }

            await fundReaderPool(7);

            const r = await sweepUnfundedReads();
            expect(r.swept).toBe(1);
            expect(r.totalAmount).toBe(5);
        });
    });

    describe('ReadSession.markCompleted integration', () => {
        test('should complete normally when pool is funded', async () => {
            await fundReaderPool(10);

            const session = await ReadSession.create({
                user: testUser._id,
                post: testPost._id,
                startedAt: new Date(Date.now() - 60000)
            });
            session.timeSpentSeconds = 60;

            const reward = await session.markCompleted();
            expect(reward).toBe(5);

            const updatedUser = await User.findById(testUser._id);
            expect(updatedUser.wallet.balance).toBe(5);

            const poolBal = await getReaderPoolBalance();
            expect(poolBal).toBeCloseTo(5, 1);
        });

        test('should mark unfunded when pool is empty', async () => {
            const session = await ReadSession.create({
                user: testUser._id,
                post: testPost._id,
                startedAt: new Date(Date.now() - 60000)
            });
            session.timeSpentSeconds = 60;

            const reward = await session.markCompleted();
            expect(reward).toBe(0);

            const updatedUser = await User.findById(testUser._id);
            expect(updatedUser.wallet.balance).toBe(0);
            expect(updatedUser.wallet.pendingUnfundedReads).toBe(1);
        });
    });
});
