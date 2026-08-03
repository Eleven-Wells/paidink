const mongoose = require('mongoose');
const User = require('../../src/models/User');
const LedgerEntry = require('../../src/models/LedgerEntry');
const ReadSession = require('../../src/models/ReadSession');
const Post = require('../../src/models/Post');
const Transaction = require('../../src/models/Transaction');
const WalletService = require('../../src/services/WalletService');

describe('Phase 3 - Bug Fixes', () => {
    let testUser;

    beforeEach(async () => {
        await LedgerEntry.deleteMany({});
        await ReadSession.deleteMany({});
        await Post.deleteMany({});
        testUser = await User.create({
            email: 'test@example.com',
            password: 'password123',
            'wallet.balance': 100,
            'wallet.pendingBalance': 0,
            'wallet.lifetimeEarned': 100,
            'stats.lastReadDate': null,
            'stats.streak': 0,
            'stats.longestStreak': 0,
            'stats.totalReads': 0
        });
    });

    afterEach(async () => {
        await User.deleteMany({});
        await LedgerEntry.deleteMany({});
        await ReadSession.deleteMany({});
        await Post.deleteMany({});
    });

    afterAll(async () => {
        await mongoose.disconnect();
    });

    describe('Bug Fix 1: Stale balanceBefore/After in addReward()', () => {
        test('should record correct balanceBefore from fresh DB read', async () => {
            await WalletService.addReward(testUser, 5, 'achievement', 'Test achievement');

            const ledgerEntry = await LedgerEntry.findOne({ user: testUser._id, type: 'achievement' });
            expect(ledgerEntry).not.toBeNull();
            expect(ledgerEntry.balanceBefore).toBe(100);
            expect(ledgerEntry.balanceAfter).toBe(105);
        });

        test('should record correct balanceBefore after multiple rewards', async () => {
            await WalletService.addReward(testUser, 5, 'achievement', 'First achievement');
            await WalletService.addReward(testUser, 10, 'achievement', 'Second achievement');

            const entries = await LedgerEntry.find({ user: testUser._id }).sort({ createdAt: 1 });

            expect(entries[0].balanceBefore).toBe(100);
            expect(entries[0].balanceAfter).toBe(105);
            expect(entries[1].balanceBefore).toBe(105);
            expect(entries[1].balanceAfter).toBe(115);
        });

        test('should update user.wallet.balance to correct value after addReward', async () => {
            const initialBalance = testUser.wallet.balance;

            await WalletService.addReward(testUser, 25, 'achievement', 'Achievement reward');

            const updatedUser = await User.findById(testUser._id);
            expect(updatedUser.wallet.balance).toBe(initialBalance + 25);
            expect(updatedUser.wallet.lifetimeEarned).toBe(125);
        });
    });

    describe('Bug Fix 2: Streak double-count fix in ReadSession', () => {
        test('should not increment streak when reading twice on same day', async () => {
            const today = new Date();
            today.setHours(12, 0, 0, 0);

            const post = await Post.create({
                title: 'Test Post',
                slug: 'test-post-same-day-' + Date.now(),
                content: 'Test content',
                summary: 'Test summary',
                category: 'javascript',
                author: testUser._id
            });

            testUser.stats.lastReadDate = today;
            testUser.stats.streak = 5;
            await testUser.save();

            const session1 = await ReadSession.create({
                user: testUser._id,
                post: post._id,
                completed: true,
                timeSpentSeconds: 45,
                rewardAwarded: false
            });

            await session1.markCompleted();

            const session2 = await ReadSession.create({
                user: testUser._id,
                post: post._id,
                completed: true,
                timeSpentSeconds: 35,
                rewardAwarded: false
            });

            await session2.markCompleted();

            const updatedUser = await User.findById(testUser._id);
            expect(updatedUser.stats.streak).toBe(5);

            await Post.findByIdAndDelete(post._id);
        });

        test('should increment streak when reading on consecutive days', async () => {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            yesterday.setHours(12, 0, 0, 0);

            const post = await Post.create({
                title: 'Test Post Consecutive',
                slug: 'test-post-consec-' + Date.now(),
                content: 'Test content',
                summary: 'Test summary',
                category: 'javascript',
                author: testUser._id
            });

            testUser.stats.lastReadDate = yesterday;
            testUser.stats.streak = 3;
            await testUser.save();

            const session = await ReadSession.create({
                user: testUser._id,
                post: post._id,
                completed: true,
                timeSpentSeconds: 40,
                rewardAwarded: false
            });

            await session.markCompleted();

            const updatedUser = await User.findById(testUser._id);
            expect(updatedUser.stats.streak).toBe(4);

            await Post.findByIdAndDelete(post._id);
        });

        test('should reset streak when missing more than one day', async () => {
            const twoDaysAgo = new Date();
            twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
            twoDaysAgo.setHours(12, 0, 0, 0);

            const post = await Post.create({
                title: 'Test Post Gap',
                slug: 'test-post-gap-' + Date.now(),
                content: 'Test content',
                summary: 'Test summary',
                category: 'javascript',
                author: testUser._id
            });

            testUser.stats.lastReadDate = twoDaysAgo;
            testUser.stats.streak = 10;
            testUser.stats.longestStreak = 10;
            await testUser.save();

            const session = await ReadSession.create({
                user: testUser._id,
                post: post._id,
                completed: true,
                timeSpentSeconds: 40,
                rewardAwarded: false
            });

            await session.markCompleted();

            const updatedUser = await User.findById(testUser._id);
            expect(updatedUser.stats.streak).toBe(1);
            expect(updatedUser.stats.longestStreak).toBe(10);

            await Post.findByIdAndDelete(post._id);
        });

        test('should update longestStreak when new streak exceeds it', async () => {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            yesterday.setHours(12, 0, 0, 0);

            const post = await Post.create({
                title: 'Test Post Longest',
                slug: 'test-post-longest-' + Date.now(),
                content: 'Test content',
                summary: 'Test summary',
                category: 'javascript',
                author: testUser._id
            });

            testUser.stats.lastReadDate = yesterday;
            testUser.stats.streak = 9;
            testUser.stats.longestStreak = 8;
            await testUser.save();

            const session = await ReadSession.create({
                user: testUser._id,
                post: post._id,
                completed: true,
                timeSpentSeconds: 40,
                rewardAwarded: false
            });

            await session.markCompleted();

            const updatedUser = await User.findById(testUser._id);
            expect(updatedUser.stats.streak).toBe(10);
            expect(updatedUser.stats.longestStreak).toBe(10);

            await Post.findByIdAndDelete(post._id);
        });
    });

    describe('Bug Fix 3: Non-atomic balance update in ReadSession', () => {
        test('should fail gracefully when concurrent balance update occurs', async () => {
            const post = await Post.create({
                title: 'Test Post Atomic',
                slug: 'test-post-atomic-' + Date.now(),
                content: 'Test content',
                summary: 'Test summary',
                category: 'javascript',
                author: testUser._id
            });

            const session = await ReadSession.create({
                user: testUser._id,
                post: post._id,
                completed: true,
                timeSpentSeconds: 45,
                rewardAwarded: false
            });

            await User.findOneAndUpdate(
                { _id: testUser._id },
                { 'wallet.balance': 9999 }
            );

            const reward = await session.markCompleted();

            expect(reward).toBe(0);

            const ledgerEntries = await LedgerEntry.find({ user: testUser._id, referenceModel: 'ReadSession' });
            expect(ledgerEntries.length).toBe(0);

            await Post.findByIdAndDelete(post._id);
        });

        test('should record correct ledger entry after atomic update', async () => {
            const post = await Post.create({
                title: 'Test Post Ledger',
                slug: 'test-post-ledger-' + Date.now(),
                content: 'Test content',
                summary: 'Test summary',
                category: 'javascript',
                author: testUser._id
            });

            const session = await ReadSession.create({
                user: testUser._id,
                post: post._id,
                completed: true,
                timeSpentSeconds: 35,
                rewardAwarded: false
            });

            const initialBalance = (await User.findById(testUser._id)).wallet.balance;

            await session.markCompleted();

            const ledgerEntry = await LedgerEntry.findOne({ user: testUser._id, type: 'read_reward', referenceModel: 'ReadSession' });
            expect(ledgerEntry).not.toBeNull();
            expect(ledgerEntry.balanceBefore).toBe(initialBalance);
            expect(ledgerEntry.balanceAfter).toBe(initialBalance + 5);

            await Post.findByIdAndDelete(post._id);
        });

        test('should not double-increment totalReads', async () => {
            const post = await Post.create({
                title: 'Test Post Reads',
                slug: 'test-post-reads-' + Date.now(),
                content: 'Test content',
                summary: 'Test summary',
                category: 'javascript',
                author: testUser._id
            });

            const initialReads = (await User.findById(testUser._id)).stats.totalReads;

            const session = await ReadSession.create({
                user: testUser._id,
                post: post._id,
                completed: true,
                timeSpentSeconds: 40,
                rewardAwarded: false
            });

            await session.markCompleted();

            const afterFirst = (await User.findById(testUser._id)).stats.totalReads;
            expect(afterFirst).toBe(initialReads + 1);

            await Post.findByIdAndDelete(post._id);
        });
    });
});