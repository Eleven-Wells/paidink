const mongoose = require('mongoose');
const User = require('../../src/models/User');
const LedgerEntry = require('../../src/models/LedgerEntry');
const Transaction = require('../../src/models/Transaction');
const WalletService = require('../../src/services/WalletService');

describe('WalletService', () => {
    let testUser;

    beforeEach(async () => {
        await LedgerEntry.deleteMany({});
        await Transaction.deleteMany({});
        testUser = await User.create({
            email: 'wallet-svc-' + Date.now() + '@test.com',
            password: 'password123',
            'wallet.balance': 100,
            'wallet.pendingBalance': 0,
            'wallet.lifetimeEarned': 100,
            'wallet.lifetimeWithdrawn': 0,
            'wallet.balanceLastSynced': null,
            'stats.lastReadDate': null,
            'stats.streak': 0,
            'stats.longestStreak': 0,
            'stats.totalReads': 0
        });
    });

    afterEach(async () => {
        await LedgerEntry.deleteMany({});
        await Transaction.deleteMany({});
        await User.deleteMany({ email: { $regex: /^wallet-svc-/ } });
    });

    describe('addReward', () => {
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

        test('should update user.wallet.balance to correct value', async () => {
            const initialBalance = testUser.wallet.balance;

            await WalletService.addReward(testUser, 25, 'achievement', 'Achievement reward');

            const updatedUser = await User.findById(testUser._id);
            expect(updatedUser.wallet.balance).toBe(initialBalance + 25);
            expect(updatedUser.wallet.lifetimeEarned).toBe(125);
        });

        test('should create a completed ledger entry with metadata description', async () => {
            await WalletService.addReward(testUser, 5, 'read_reward', 'Reward for reading');

            const ledgerEntry = await LedgerEntry.findOne({ user: testUser._id, type: 'read_reward' });
            expect(ledgerEntry.status).toBe('completed');
            expect(ledgerEntry.metadata.description).toBe('Reward for reading');
        });

        test('should return the updated wallet balance', async () => {
            const balance = await WalletService.addReward(testUser, 5, 'achievement', 'Test');
            expect(balance).toBe(105);
        });

        test('should mutate the passed user document wallet in memory', async () => {
            await WalletService.addReward(testUser, 5, 'achievement', 'Test');
            expect(testUser.wallet.balance).toBe(105);
            expect(testUser.wallet.lifetimeEarned).toBe(105);
        });

        test('should throw concurrent balance update error on CAS failure', async () => {
            await User.findOneAndUpdate(
                { _id: testUser._id },
                { 'wallet.balance': 9999 }
            );

            jest.spyOn(User, 'findById').mockImplementation(() => ({
                select: () => Promise.resolve({
                    _id: testUser._id,
                    wallet: { balance: 100, lifetimeEarned: 100 }
                })
            }));

            await expect(
                WalletService.addReward(testUser, 5, 'achievement', 'Test')
            ).rejects.toThrow('Concurrent balance update detected. Please retry.');
        });

        test('should throw user not found when user no longer exists', async () => {
            await User.deleteOne({ _id: testUser._id });

            await expect(
                WalletService.addReward(testUser, 5, 'achievement', 'Test')
            ).rejects.toThrow('User not found');
        });
    });

    describe('requestWithdrawal', () => {
        test('should deduct balance and add to pendingBalance', async () => {
            const result = await WalletService.requestWithdrawal(testUser, 30);

            expect(result.newBalance).toBe(70);
            expect(result.pendingBalance).toBe(30);
            expect(result.ledgerEntryId).toBeTruthy();

            const updatedUser = await User.findById(testUser._id);
            expect(updatedUser.wallet.balance).toBe(70);
            expect(updatedUser.wallet.pendingBalance).toBe(30);
        });

        test('should create a pending withdrawal ledger entry', async () => {
            const result = await WalletService.requestWithdrawal(testUser, 30);

            const ledgerEntry = await LedgerEntry.findById(result.ledgerEntryId);
            expect(ledgerEntry).not.toBeNull();
            expect(ledgerEntry.type).toBe('withdrawal');
            expect(ledgerEntry.amount).toBe(-30);
            expect(ledgerEntry.status).toBe('pending');
            expect(ledgerEntry.balanceBefore).toBe(100);
            expect(ledgerEntry.balanceAfter).toBe(70);
            expect(ledgerEntry.metadata.description).toBe('Withdrawal requested');
        });

        test('should throw insufficient balance error', async () => {
            await expect(
                WalletService.requestWithdrawal(testUser, 1000)
            ).rejects.toThrow('Insufficient balance');

            const updatedUser = await User.findById(testUser._id);
            expect(updatedUser.wallet.balance).toBe(100);
            expect(updatedUser.wallet.pendingBalance).toBe(0);
        });

        test('should throw concurrent balance update error on CAS failure', async () => {
            await User.findOneAndUpdate(
                { _id: testUser._id },
                { 'wallet.balance': 9999 }
            );

            jest.spyOn(User, 'findById').mockImplementation(() => ({
                select: () => Promise.resolve({
                    _id: testUser._id,
                    wallet: { balance: 100, pendingBalance: 0 }
                })
            }));

            await expect(
                WalletService.requestWithdrawal(testUser, 30)
            ).rejects.toThrow('Concurrent balance update detected. Please retry.');
        });

        test('should mutate the passed user document wallet in memory', async () => {
            await WalletService.requestWithdrawal(testUser, 30);
            expect(testUser.wallet.balance).toBe(70);
            expect(testUser.wallet.pendingBalance).toBe(30);
        });
    });

    describe('completeWithdrawal', () => {
        beforeEach(async () => {
            await WalletService.requestWithdrawal(testUser, 30);
        });

        test('should reduce pendingBalance and increase lifetimeWithdrawn', async () => {
            const result = await WalletService.completeWithdrawal(testUser, 30, 'TRF_testcode');

            expect(result.pendingBalance).toBe(0);
            expect(result.lifetimeWithdrawn).toBe(30);

            const updatedUser = await User.findById(testUser._id);
            expect(updatedUser.wallet.pendingBalance).toBe(0);
            expect(updatedUser.wallet.lifetimeWithdrawn).toBe(30);
        });

        test('should mark matching transaction completed by paystackTransferCode', async () => {
            const transferCode = 'TRF_complete_' + Date.now();
            await Transaction.create({
                user: testUser._id,
                type: 'withdrawal',
                amount: -30,
                balanceBefore: 100,
                balanceAfter: 70,
                status: 'pending',
                reference: transferCode,
                description: 'Bank withdrawal (****1234)',
                metadata: { paystackTransferCode: transferCode, method: 'bank' }
            });

            await WalletService.completeWithdrawal(testUser, 30, transferCode);

            const tx = await Transaction.findOne({ 'metadata.paystackTransferCode': transferCode });
            expect(tx.status).toBe('completed');
        });

        test('should throw insufficient pending balance error', async () => {
            await expect(
                WalletService.completeWithdrawal(testUser, 1000, 'TRF_x')
            ).rejects.toThrow('Insufficient pending balance');
        });

        test('should throw concurrent withdrawal completion error on CAS failure', async () => {
            await User.findOneAndUpdate(
                { _id: testUser._id },
                { 'wallet.pendingBalance': 9999 }
            );

            jest.spyOn(User, 'findById').mockImplementation(() => ({
                select: () => Promise.resolve({
                    _id: testUser._id,
                    wallet: { pendingBalance: 30, lifetimeWithdrawn: 0 }
                })
            }));

            await expect(
                WalletService.completeWithdrawal(testUser, 30, 'TRF_x')
            ).rejects.toThrow('Concurrent withdrawal completion detected. Please retry.');
        });
    });

    describe('failWithdrawal', () => {
        beforeEach(async () => {
            await WalletService.requestWithdrawal(testUser, 30);
        });

        test('should reverse: restore balance and reduce pendingBalance', async () => {
            const result = await WalletService.failWithdrawal(testUser, 30, 'TRF_fail');

            expect(result.balance).toBe(100);
            expect(result.pendingBalance).toBe(0);

            const updatedUser = await User.findById(testUser._id);
            expect(updatedUser.wallet.balance).toBe(100);
            expect(updatedUser.wallet.pendingBalance).toBe(0);
        });

        test('should mark matching transaction failed by paystackTransferCode', async () => {
            const transferCode = 'TRF_fail_' + Date.now();
            await Transaction.create({
                user: testUser._id,
                type: 'withdrawal',
                amount: -30,
                balanceBefore: 100,
                balanceAfter: 70,
                status: 'pending',
                reference: transferCode,
                description: 'Bank withdrawal (****1234)',
                metadata: { paystackTransferCode: transferCode, method: 'bank' }
            });

            await WalletService.failWithdrawal(testUser, 30, transferCode);

            const tx = await Transaction.findOne({ 'metadata.paystackTransferCode': transferCode });
            expect(tx.status).toBe('failed');
        });

        test('should throw insufficient pending balance to reverse error', async () => {
            await expect(
                WalletService.failWithdrawal(testUser, 1000, 'TRF_x')
            ).rejects.toThrow('Insufficient pending balance to reverse');
        });

        test('should throw concurrent withdrawal failure error on CAS failure', async () => {
            await User.findOneAndUpdate(
                { _id: testUser._id },
                { 'wallet.pendingBalance': 9999 }
            );

            jest.spyOn(User, 'findById').mockImplementation(() => ({
                select: () => Promise.resolve({
                    _id: testUser._id,
                    wallet: { balance: 70, pendingBalance: 30 }
                })
            }));

            await expect(
                WalletService.failWithdrawal(testUser, 30, 'TRF_x')
            ).rejects.toThrow('Concurrent withdrawal failure detected. Please retry.');
        });
    });

    describe('reconcileWallet', () => {
        test('should set wallet balance from ledger entries', async () => {
            await LedgerEntry.create({
                user: testUser._id,
                type: 'read_reward',
                amount: 5,
                balanceBefore: 100,
                balanceAfter: 105,
                status: 'completed'
            });
            await LedgerEntry.create({
                user: testUser._id,
                type: 'achievement',
                amount: 10,
                balanceBefore: 105,
                balanceAfter: 115,
                status: 'completed'
            });

            const result = await WalletService.reconcileWallet(testUser);

            const updated = await User.findById(testUser._id);
            expect(updated.wallet.balance).toBe(115);
            expect(result.drift).toBe(15);
        });

        test('should detect and report drift', async () => {
            testUser.wallet.balance = 1000;
            await testUser.save();

            await LedgerEntry.create({
                user: testUser._id,
                type: 'read_reward',
                amount: 5,
                balanceBefore: 100,
                balanceAfter: 105,
                status: 'completed'
            });

            const result = await WalletService.reconcileWallet(testUser);

            expect(result.drift).toBe(895);
            expect(result.driftSignificant).toBe(true);

            const updated = await User.findById(testUser._id);
            expect(updated.wallet.balance).toBe(105);
        });

        test('should update balanceLastSynced timestamp', async () => {
            await LedgerEntry.create({
                user: testUser._id,
                type: 'read_reward',
                amount: 5,
                balanceBefore: 100,
                balanceAfter: 105,
                status: 'completed'
            });

            await WalletService.reconcileWallet(testUser);

            const updated = await User.findById(testUser._id);
            expect(updated.wallet.balanceLastSynced).not.toBeNull();
        });

        test('should set lifetimeEarned from ledger entries', async () => {
            await LedgerEntry.create({
                user: testUser._id,
                type: 'read_reward',
                amount: 5,
                balanceBefore: 100,
                balanceAfter: 105,
                status: 'completed'
            });
            await LedgerEntry.create({
                user: testUser._id,
                type: 'read_reward',
                amount: 5,
                balanceBefore: 105,
                balanceAfter: 110,
                status: 'completed'
            });

            await WalletService.reconcileWallet(testUser);

            const updated = await User.findById(testUser._id);
            expect(updated.wallet.lifetimeEarned).toBe(110);
        });

        test('should handle empty ledger entries', async () => {
            testUser.wallet.balance = 0;
            await testUser.save();

            const result = await WalletService.reconcileWallet(testUser);

            const updated = await User.findById(testUser._id);
            expect(updated.wallet.balance).toBe(0);
            expect(result.drift).toBe(0);
            expect(result.driftSignificant).toBe(false);
        });

        test('should not include failed ledger entries in computed balance', async () => {
            await LedgerEntry.create({
                user: testUser._id,
                type: 'read_reward',
                amount: 5,
                balanceBefore: 100,
                balanceAfter: 105,
                status: 'completed'
            });
            await LedgerEntry.create({
                user: testUser._id,
                type: 'read_reward',
                amount: 5,
                balanceBefore: 105,
                balanceAfter: 105,
                status: 'failed'
            });

            const result = await WalletService.reconcileWallet(testUser);
            expect(result.reconciled).toBe(105);
        });
    });
});
