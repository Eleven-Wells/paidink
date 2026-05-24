const mongoose = require('mongoose');
const LedgerEntry = require('../../src/models/LedgerEntry');
const { getDashboardSummary } = require('../../src/services/DashboardService');

describe('DashboardService', () => {
    const testUserId = new mongoose.Types.ObjectId();
    const anotherUserId = new mongoose.Types.ObjectId();

    beforeEach(async () => {
        await LedgerEntry.deleteMany({});
    });

    afterAll(async () => {
        await LedgerEntry.deleteMany({});
    });

    describe('getDashboardSummary', () => {
        test('should return zero values when no ledger entries exist', async () => {
            const summary = await getDashboardSummary(testUserId);

            expect(summary.wallet.currentBalance).toBe(0);
            expect(summary.wallet.totalEarned).toBe(0);
            expect(summary.wallet.pendingWithdrawals).toBe(0);
            expect(summary.earnings.today).toBe(0);
            expect(summary.earnings.last7Days).toBe(0);
            expect(summary.reads.today).toBe(0);
            expect(summary.reads.total).toBe(0);
        });

        test('should calculate current balance from most recent entry', async () => {
            await LedgerEntry.create([
                { user: testUserId, type: 'read_reward', amount: 5, balanceBefore: 0, balanceAfter: 5, status: 'completed' },
                { user: testUserId, type: 'read_reward', amount: 5, balanceBefore: 5, balanceAfter: 10, status: 'completed' }
            ]);

            const summary = await getDashboardSummary(testUserId);
            expect(summary.wallet.currentBalance).toBe(10);
        });

        test('should calculate total earned from all completed entries', async () => {
            await LedgerEntry.create([
                { user: testUserId, type: 'read_reward', amount: 5, balanceBefore: 0, balanceAfter: 5, status: 'completed' },
                { user: testUserId, type: 'achievement', amount: 25, balanceBefore: 5, balanceAfter: 30, status: 'completed' },
                { user: testUserId, type: 'withdrawal', amount: -200, balanceBefore: 30, balanceAfter: -170, status: 'pending' }
            ]);

            const summary = await getDashboardSummary(testUserId);
            expect(summary.wallet.totalEarned).toBe(30);
        });

        test('should aggregate pending withdrawals', async () => {
            await LedgerEntry.create([
                { user: testUserId, type: 'withdrawal', amount: -100, balanceBefore: 500, balanceAfter: 400, status: 'pending' },
                { user: testUserId, type: 'withdrawal', amount: -50, balanceBefore: 400, balanceAfter: 350, status: 'pending' }
            ]);

            const summary = await getDashboardSummary(testUserId);
            expect(summary.wallet.pendingWithdrawals).toBe(150);
        });

        test('should calculate 7-day earnings', async () => {
            const now = new Date();
            const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);

            await LedgerEntry.create([
                { user: testUserId, type: 'read_reward', amount: 5, balanceBefore: 0, balanceAfter: 5, status: 'completed', createdAt: eightDaysAgo },
                { user: testUserId, type: 'read_reward', amount: 5, balanceBefore: 5, balanceAfter: 10, status: 'completed', createdAt: now }
            ]);

            const summary = await getDashboardSummary(testUserId);
            expect(summary.earnings.last7Days).toBe(5);
        });

        test('should calculate percentage delta between weeks', async () => {
            const now = new Date();
            const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

            await LedgerEntry.create([
                { user: testUserId, type: 'read_reward', amount: 10, balanceBefore: 0, balanceAfter: 10, status: 'completed', createdAt: sevenDaysAgo },
                { user: testUserId, type: 'read_reward', amount: 5, balanceBefore: 0, balanceAfter: 5, status: 'completed', createdAt: fourteenDaysAgo }
            ]);

            const summary = await getDashboardSummary(testUserId);
            expect(summary.earnings.last7DaysDelta).toBe(100);
        });

        test('should calculate today earnings', async () => {
            const now = new Date();

            await LedgerEntry.create([
                { user: testUserId, type: 'read_reward', amount: 5, balanceBefore: 0, balanceAfter: 5, status: 'completed', createdAt: now }
            ]);

            const summary = await getDashboardSummary(testUserId);
            expect(summary.earnings.today).toBe(5);
            expect(summary.reads.today).toBe(1);
        });

        test('should calculate read reward breakdown', async () => {
            await LedgerEntry.create([
                { user: testUserId, type: 'read_reward', amount: 5, balanceBefore: 0, balanceAfter: 5, status: 'completed' },
                { user: testUserId, type: 'read_reward', amount: 5, balanceBefore: 5, balanceAfter: 10, status: 'completed' },
                { user: testUserId, type: 'achievement', amount: 25, balanceBefore: 10, balanceAfter: 35, status: 'completed' }
            ]);

            const summary = await getDashboardSummary(testUserId);
            expect(summary.breakdown.readRewards.amount).toBe(10);
            expect(summary.breakdown.readRewards.count).toBe(2);
            expect(summary.breakdown.achievementRewards.amount).toBe(25);
            expect(summary.breakdown.achievementRewards.count).toBe(1);
        });

        test('should return recent entries sorted by createdAt desc', async () => {
            const now = new Date();
            await LedgerEntry.create([
                { user: testUserId, type: 'read_reward', amount: 5, balanceBefore: 0, balanceAfter: 5, status: 'completed', createdAt: new Date(now.getTime() - 1000) },
                { user: testUserId, type: 'achievement', amount: 25, balanceBefore: 5, balanceAfter: 30, status: 'completed', createdAt: now }
            ]);

            const summary = await getDashboardSummary(testUserId);
            expect(summary.recentEntries.length).toBe(2);
            expect(summary.recentEntries[0].type).toBe('achievement');
        });

        test('should only include entries for the specific user', async () => {
            await LedgerEntry.create([
                { user: testUserId, type: 'read_reward', amount: 5, balanceBefore: 0, balanceAfter: 5, status: 'completed' },
                { user: anotherUserId, type: 'read_reward', amount: 10, balanceBefore: 0, balanceAfter: 10, status: 'completed' }
            ]);

            const summary = await getDashboardSummary(testUserId);
            expect(summary.wallet.totalEarned).toBe(5);
            expect(summary.recentEntries.length).toBe(1);
            expect(summary.recentEntries[0].type).toBe('read_reward');
        });

        test('should return type breakdown sorted by count desc', async () => {
            await LedgerEntry.create([
                { user: testUserId, type: 'read_reward', amount: 5, balanceBefore: 0, balanceAfter: 5, status: 'completed' },
                { user: testUserId, type: 'read_reward', amount: 5, balanceBefore: 5, balanceAfter: 10, status: 'completed' },
                { user: testUserId, type: 'read_reward', amount: 5, balanceBefore: 10, balanceAfter: 15, status: 'completed' },
                { user: testUserId, type: 'achievement', amount: 25, balanceBefore: 15, balanceAfter: 40, status: 'completed' }
            ]);

            const summary = await getDashboardSummary(testUserId);
            expect(summary.typeBreakdown[0].type).toBe('read_reward');
            expect(summary.typeBreakdown[0].count).toBe(3);
        });

        test('should exclude pending entries from totalEarned calculation', async () => {
            await LedgerEntry.create([
                { user: testUserId, type: 'read_reward', amount: 5, balanceBefore: 0, balanceAfter: 5, status: 'completed' },
                { user: testUserId, type: 'withdrawal', amount: -200, balanceBefore: 5, balanceAfter: -195, status: 'pending' }
            ]);

            const summary = await getDashboardSummary(testUserId);
            expect(summary.wallet.totalEarned).toBe(5);
        });

        test('should handle percentage delta when previous is zero', async () => {
            const now = new Date();
            const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

            await LedgerEntry.create([
                { user: testUserId, type: 'read_reward', amount: 5, balanceBefore: 0, balanceAfter: 5, status: 'completed', createdAt: sevenDaysAgo }
            ]);

            const summary = await getDashboardSummary(testUserId);
            expect(summary.earnings.last7DaysDelta).toBe(100);
        });

        test('should return empty recentEntries when no data exists', async () => {
            const summary = await getDashboardSummary(testUserId);
            expect(summary.recentEntries).toEqual([]);
        });
    });
});