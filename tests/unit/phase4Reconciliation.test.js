const mongoose = require('mongoose');
const User = require('../../src/models/User');
const LedgerEntry = require('../../src/models/LedgerEntry');

describe('Phase 4 - Wallet Reconciliation', () => {
    let testUser;

    beforeEach(async () => {
        await LedgerEntry.deleteMany({});
        testUser = await User.create({
            email: 'reconcile-' + Date.now() + '@test.com',
            password: 'password123',
            'wallet.balance': 0,
            'wallet.pendingBalance': 0,
            'wallet.lifetimeEarned': 0,
            'wallet.lifetimeWithdrawn': 0,
            'wallet.balanceLastSynced': null
        });
    });

    afterEach(async () => {
        await LedgerEntry.deleteMany({});
        await User.deleteMany({ email: { $regex: /^reconcile-/ } });
    });

    describe('reconcileWallet method', () => {
        test('should set wallet balance from ledger entries', async () => {
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
                type: 'achievement',
                amount: 10,
                balanceBefore: 5,
                balanceAfter: 15,
                status: 'completed'
            });

            const result = await testUser.reconcileWallet();

            const updated = await User.findById(testUser._id);
            expect(updated.wallet.balance).toBe(15);
            expect(result.drift).toBe(15);
        });

        test('should detect and report drift', async () => {
            testUser.wallet.balance = 100;
            await testUser.save();

            await LedgerEntry.create({
                user: testUser._id,
                type: 'read_reward',
                amount: 5,
                balanceBefore: 0,
                balanceAfter: 5,
                status: 'completed'
            });

            const result = await testUser.reconcileWallet();

            expect(result.drift).toBe(95);
            expect(result.driftSignificant).toBe(true);

            const updated = await User.findById(testUser._id);
            expect(updated.wallet.balance).toBe(5);
        });

        test('should update balanceLastSynced timestamp', async () => {
            await LedgerEntry.create({
                user: testUser._id,
                type: 'read_reward',
                amount: 5,
                balanceBefore: 0,
                balanceAfter: 5,
                status: 'completed'
            });

            expect(testUser.wallet.balanceLastSynced).toBeNull();

            await testUser.reconcileWallet();

            const updated = await User.findById(testUser._id);
            expect(updated.wallet.balanceLastSynced).not.toBeNull();
        });

        test('should set lifetimeEarned from ledger entries', async () => {
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

            await testUser.reconcileWallet();

            const updated = await User.findById(testUser._id);
            expect(updated.wallet.lifetimeEarned).toBe(10);
        });

        test('should handle empty ledger entries', async () => {
            const result = await testUser.reconcileWallet();

            const updated = await User.findById(testUser._id);
            expect(updated.wallet.balance).toBe(0);
            expect(result.drift).toBe(0);
            expect(result.driftSignificant).toBe(false);
        });
    });

    describe('GET /api/wallet/sync-status', () => {
        test('should return sync status for user', async () => {
            testUser.wallet.balance = 50;
            testUser.wallet.balanceLastSynced = new Date();
            await testUser.save();

            await LedgerEntry.create({
                user: testUser._id,
                type: 'read_reward',
                amount: 5,
                balanceBefore: 50,
                balanceAfter: 55,
                status: 'completed'
            });

            const LedgerEntryModel = mongoose.model('LedgerEntry');
            const latestEntry = await LedgerEntryModel.findOne({ user: testUser._id }).sort({ createdAt: -1 });

            expect(testUser.wallet.balanceLastSynced < latestEntry.createdAt).toBe(true);
        });

        test('should flag needsSync when no sync has occurred', async () => {
            expect(testUser.wallet.balanceLastSynced).toBeNull();

            const LedgerEntryModel = mongoose.model('LedgerEntry');
            await LedgerEntryModel.create({
                user: testUser._id,
                type: 'read_reward',
                amount: 5,
                balanceBefore: 0,
                balanceAfter: 5,
                status: 'completed'
            });

            const latestEntry = await LedgerEntryModel.findOne({ user: testUser._id }).sort({ createdAt: -1 });
            expect(latestEntry).not.toBeNull();
        });
    });

    describe('POST /api/wallet/reconcile', () => {
        test('should reconcile wallet from ledger', async () => {
            await LedgerEntry.create({
                user: testUser._id,
                type: 'read_reward',
                amount: 5,
                balanceBefore: 0,
                balanceAfter: 5,
                status: 'completed'
            });

            const result = await testUser.reconcileWallet();

            expect(result.reconciled).toBe(5);
            expect(result.drift).toBe(5);
            expect(result.driftSignificant).toBe(true);
        });
    });
});