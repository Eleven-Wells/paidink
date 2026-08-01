const mongoose = require('mongoose');
const ReadSession = require('../../src/models/ReadSession');
const Post = require('../../src/models/Post');
const User = require('../../src/models/User');
const LedgerEntry = require('../../src/models/LedgerEntry');
const SystemConfig = require('../../src/models/SystemConfig');
const RewardRateService = require('../../src/services/RewardRateService');
const {
    enforceDailyCap,
    enforcePostCooldown,
    enforceSessionGap,
    enforceReadSpeed
} = require('../../src/services/readPolicies');

describe('Dynamic Reward Rate — Integration', () => {
    let testUser;
    let testPost;

    beforeAll(async () => {
        await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27018/test_nook');
    });

    afterAll(async () => {
        await mongoose.disconnect();
    });

    beforeEach(async () => {
        await LedgerEntry.deleteMany({});
        await ReadSession.deleteMany({});
        await Post.deleteMany({});
        await User.deleteMany({});
        await SystemConfig.deleteMany({});

        testUser = await User.create({
            email: 'rate-int-test@test.com',
            password: 'password123',
            wallet: { balance: 0, lifetimeEarned: 0, totalReaderRewards: 0 },
            stats: { totalReads: 0, streak: 1, longestStreak: 1 }
        });

        testPost = await Post.create({
            title: 'Integration Test Post',
            slug: 'int-test-' + Date.now(),
            summary: 'Test post',
            content: '<p>Content</p>'.repeat(20),
            category: 'development',
            author: testUser._id,
            publishedAt: new Date()
        });
    });

    describe('Rate calculation with real data', () => {
        it('returns floor (10) when no revenue and no reads', async () => {
            const rate = await RewardRateService.calculateRate();
            expect(rate).toBe(10);
        });

        it('returns floor (10) when only reads exist (no revenue)', async () => {
            for (let i = 0; i < 10; i++) {
                await ReadSession.create({
                    user: testUser._id,
                    post: testPost._id,
                    completed: true,
                    rewardAwarded: true,
                    timeSpentSeconds: 60,
                    rewardAmount: 500,
                    startedAt: new Date(Date.now() - i * 60000),
                    createdAt: new Date(Date.now() - i * 60000)
                });
            }
            const rate = await RewardRateService.calculateRate();
            expect(rate).toBe(10);
        });

        it('returns floor (10) when only revenue exists (no reads)', async () => {
            await LedgerEntry.create({
                pool: 'reader_pool',
                amount: 50000,
                type: 'ad_revenue_reader_pool',
                status: 'completed',
                createdAt: new Date()
            });
            const rate = await RewardRateService.calculateRate();
            expect(rate).toBe(10);
        });

        it('calculates rate = revenue / reads when both exist', async () => {
            await LedgerEntry.create({
                pool: 'reader_pool',
                amount: 50000,
                type: 'ad_revenue_reader_pool',
                status: 'completed',
                createdAt: new Date()
            });

            for (let i = 0; i < 100; i++) {
                await ReadSession.create({
                    user: testUser._id,
                    post: testPost._id,
                    completed: true,
                    rewardAwarded: true,
                    timeSpentSeconds: 60,
                    rewardAmount: 500,
                    startedAt: new Date(Date.now() - i * 60000),
                    createdAt: new Date(Date.now() - i * 60000)
                });
            }
            const rate = await RewardRateService.calculateRate();
            expect(rate).toBe(500);
        });

        it('caps at ceiling (2000) when revenue is very high relative to reads', async () => {
            await LedgerEntry.create({
                pool: 'reader_pool',
                amount: 500000,
                type: 'ad_revenue_reader_pool',
                status: 'completed',
                createdAt: new Date()
            });

            for (let i = 0; i < 10; i++) {
                await ReadSession.create({
                    user: testUser._id,
                    post: testPost._id,
                    completed: true,
                    rewardAwarded: true,
                    timeSpentSeconds: 60,
                    rewardAmount: 500,
                    startedAt: new Date(Date.now() - i * 60000),
                    createdAt: new Date(Date.now() - i * 60000)
                });
            }
            const rate = await RewardRateService.calculateRate();
            expect(rate).toBeLessThanOrEqual(2000);
            expect(rate).toBe(2000);
        });

        it('ignores reads older than 7 days', async () => {
            const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
            for (let i = 0; i < 100; i++) {
                await ReadSession.create({
                    user: testUser._id,
                    post: testPost._id,
                    completed: true,
                    rewardAwarded: true,
                    timeSpentSeconds: 60,
                    rewardAmount: 500,
                    startedAt: oldDate,
                    createdAt: oldDate
                });
            }
            await LedgerEntry.create({
                pool: 'reader_pool',
                amount: 1000,
                type: 'ad_revenue_reader_pool',
                status: 'completed',
                createdAt: new Date()
            });
            const rate = await RewardRateService.calculateRate();
            expect(rate).toBe(10);
        });
    });

    describe('getCurrentRate with real DB', () => {
        it('returns floor when no cache and no data', async () => {
            const rate = await RewardRateService.getCurrentRate();
            expect(rate).toBe(10);
        });

        it('caches and returns calculated rate', async () => {
            await LedgerEntry.create({
                pool: 'reader_pool',
                amount: 50000,
                type: 'ad_revenue_reader_pool',
                status: 'completed',
                createdAt: new Date()
            });
            for (let i = 0; i < 100; i++) {
                await ReadSession.create({
                    user: testUser._id,
                    post: testPost._id,
                    completed: true,
                    rewardAwarded: true,
                    timeSpentSeconds: 60,
                    rewardAmount: 500,
                    startedAt: new Date(Date.now() - i * 60000),
                    createdAt: new Date(Date.now() - i * 60000)
                });
            }
            const rate = await RewardRateService.getCurrentRate();
            expect(rate).toBe(500);
            const cached = await SystemConfig.findOne({ key: 'dynamic_read_rate_kobo' });
            expect(cached).not.toBeNull();
            expect(cached.value).toBe(500);
        });
    });

    describe('Anti-gaming with real data', () => {
        beforeEach(async () => {
            await SystemConfig.deleteMany({});
            await SystemConfig.create({ key: 'dynamic_read_rate_kobo', value: 500 });
        });

        it('enforceDailyCap — under cap returns true', async () => {
            const result = await enforceDailyCap(testUser._id, 100);
            expect(result).toBe(true);
        });

        it('enforceDailyCap — at cap returns false', async () => {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            for (let i = 0; i < 100; i++) {
                await ReadSession.create({
                    user: testUser._id,
                    post: testPost._id,
                    completed: true,
                    rewardAwarded: true,
                    timeSpentSeconds: 60,
                    rewardAmount: 500,
                    startedAt: new Date(today.getTime() + i * 1000),
                    createdAt: new Date(today.getTime() + i * 1000)
                });
            }
            const result = await enforceDailyCap(testUser._id, 100);
            expect(result).toBe(false);
        });

        it('enforcePostCooldown — returns true for never-read post', async () => {
            const result = await enforcePostCooldown(testUser._id, new mongoose.Types.ObjectId().toString(), 24);
            expect(result).toBe(true);
        });

        it('enforcePostCooldown — returns false for recently-read post', async () => {
            await ReadSession.create({
                user: testUser._id,
                post: testPost._id,
                completed: true,
                rewardAwarded: true,
                createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000)
            });
            await ReadSession.create({
                user: testUser._id,
                post: testPost._id,
                completed: true,
                rewardAwarded: true,
                createdAt: new Date()
            });
            const result = await enforcePostCooldown(testUser._id, testPost._id.toString(), 24);
            expect(result).toBe(false);
        });

        it('enforcePostCooldown — after cooldown expires returns true', async () => {
            await ReadSession.create({
                user: testUser._id,
                post: testPost._id,
                completed: true,
                rewardAwarded: true,
                createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000)
            });
            const result = await enforcePostCooldown(testUser._id, testPost._id.toString(), 24);
            expect(result).toBe(true);
        });

        it('enforceSessionGap — returns true when no prior session', () => {
            const result = enforceSessionGap(null, 3);
            expect(result).toBe(true);
        });

        it('enforceSessionGap — returns false when gap too small', () => {
            const recent = new Date(Date.now() - 1000);
            const result = enforceSessionGap(recent, 3);
            expect(result).toBe(false);
        });

        it('enforceReadSpeed — returns false for too-fast reads', () => {
            const result = enforceReadSpeed(5, 1000, 200, 0.10);
            expect(result).toBe(false);
        });

        it('enforceReadSpeed — returns true for legitimate reads', () => {
            const result = enforceReadSpeed(60, 1000, 200, 0.10);
            expect(result).toBe(true);
        });
    });
});
