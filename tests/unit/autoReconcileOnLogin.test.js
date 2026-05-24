const mongoose = require('mongoose');
const User = require('../../src/models/User');
const LedgerEntry = require('../../src/models/LedgerEntry');
const ReadSession = require('../../src/models/ReadSession');
const Post = require('../../src/models/Post');

describe('Auto-reconciliation on Login', () => {
    let testUser;

    beforeEach(async () => {
        await LedgerEntry.deleteMany({});
        testUser = await User.create({
            email: 'login-reconcile-' + Date.now() + '@test.com',
            password: 'password123',
            'wallet.balance': 0,
            'wallet.pendingBalance': 0,
            'wallet.lifetimeEarned': 0,
            'wallet.balanceLastSynced': null,
            'stats.totalReads': 0,
            'stats.streak': 0
        });
    });

    afterEach(async () => {
        await Post.deleteMany({});
        await ReadSession.deleteMany({});
        await LedgerEntry.deleteMany({});
        await User.deleteMany({ email: { $regex: /^login-reconcile-/ } });
    });

    test('should trigger reconciliation if ledger has new entries since last sync', async () => {
        testUser.wallet.balanceLastSynced = new Date(Date.now() - 86400000);
        testUser.wallet.balance = 0;
        await testUser.save();

        await LedgerEntry.create({
            user: testUser._id,
            type: 'read_reward',
            amount: 5,
            balanceBefore: 0,
            balanceAfter: 5,
            status: 'completed'
        });

        const LedgerEntryModel = mongoose.model('LedgerEntry');
        const latestEntry = await LedgerEntryModel.findOne({ user: testUser._id }).sort({ createdAt: -1 });

        expect(latestEntry.createdAt > testUser.wallet.balanceLastSynced).toBe(true);

        await testUser.reconcileWallet();

        const updated = await User.findById(testUser._id);
        expect(updated.wallet.balance).toBe(5);
        expect(updated.wallet.balanceLastSynced).not.toBeNull();
    });

    test('reconcileWallet should compute balance from ledger, overwriting cached value', async () => {
        testUser.wallet.balanceLastSynced = new Date();
        testUser.wallet.balance = 100;
        await testUser.save();

        await testUser.reconcileWallet();

        const updated = await User.findById(testUser._id);
        expect(updated.wallet.balance).toBe(0);
    });

    test('should not trigger reconciliation if never synced before', async () => {
        expect(testUser.wallet.balanceLastSynced).toBeNull();

        await LedgerEntry.create({
            user: testUser._id,
            type: 'read_reward',
            amount: 5,
            balanceBefore: 0,
            balanceAfter: 5,
            status: 'completed'
        });

        const LedgerEntryModel = mongoose.model('LedgerEntry');
        const latestEntry = await LedgerEntryModel.findOne({ user: testUser._id }).sort({ createdAt: -1 });

        expect(latestEntry.createdAt > (testUser.wallet.balanceLastSynced || new Date(0))).toBe(true);
    });

    test('reconcileWallet should be safe to call multiple times', async () => {
        await LedgerEntry.create({
            user: testUser._id,
            type: 'read_reward',
            amount: 5,
            balanceBefore: 0,
            balanceAfter: 5,
            status: 'completed'
        });
        await LedgerEntry.create({
            user: testUser._id,
            type: 'read_reward',
            amount: 5,
            balanceBefore: 5,
            balanceAfter: 10,
            status: 'completed'
        });

        const result1 = await testUser.reconcileWallet();
        expect(result1.reconciled).toBe(10);

        const result2 = await testUser.reconcileWallet();
        expect(result2.reconciled).toBe(10);
        expect(result2.drift).toBe(0);

        const updated = await User.findById(testUser._id);
        expect(updated.wallet.balance).toBe(10);
    });

    test('should handle ledger entries with failed status correctly', async () => {
        await LedgerEntry.create({
            user: testUser._id,
            type: 'read_reward',
            amount: 5,
            balanceBefore: 0,
            balanceAfter: 5,
            status: 'completed'
        });
        await LedgerEntry.create({
            user: testUser._id,
            type: 'read_reward',
            amount: 5,
            balanceBefore: 5,
            balanceAfter: 5,
            status: 'failed'
        });

        const result = await testUser.reconcileWallet();
        expect(result.reconciled).toBe(5);
    });
});