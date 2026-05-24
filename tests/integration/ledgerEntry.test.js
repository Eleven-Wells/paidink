const mongoose = require('mongoose');
const LedgerEntry = require('../../src/models/LedgerEntry');

describe('LedgerEntry Integration', () => {
    describe('Ledger entry creation via reward path', () => {
        let cleanupIds = [];

        afterEach(async () => {
            if (cleanupIds.length > 0) {
                await LedgerEntry.deleteMany({ _id: { $in: cleanupIds } });
                cleanupIds = [];
            }
        });

        test('should create ledger entry for read_reward', async () => {
            const entry = await LedgerEntry.create({
                user: new mongoose.Types.ObjectId(),
                type: 'read_reward',
                amount: 5,
                balanceBefore: 0,
                balanceAfter: 5,
                referenceId: new mongoose.Types.ObjectId(),
                referenceModel: 'ReadSession',
                status: 'completed',
                metadata: { postId: 'abc123', timeSpentSeconds: 45 }
            });
            cleanupIds.push(entry._id);

            expect(entry._id).toBeDefined();
            expect(entry.type).toBe('read_reward');
            expect(entry.amount).toBe(5);
            expect(entry.referenceModel).toBe('ReadSession');
            expect(entry.metadata.postId).toBe('abc123');
        });

        test('should create ledger entry for withdrawal', async () => {
            const entry = await LedgerEntry.create({
                user: new mongoose.Types.ObjectId(),
                type: 'withdrawal',
                amount: -200,
                balanceBefore: 500,
                balanceAfter: 300,
                status: 'pending',
                metadata: { description: 'Withdrawal requested' }
            });
            cleanupIds.push(entry._id);

            expect(entry.type).toBe('withdrawal');
            expect(entry.amount).toBe(-200);
            expect(entry.status).toBe('pending');
        });

        test('should create ledger entry for achievement', async () => {
            const entry = await LedgerEntry.create({
                user: new mongoose.Types.ObjectId(),
                type: 'achievement',
                amount: 25,
                balanceBefore: 50,
                balanceAfter: 75,
                referenceId: new mongoose.Types.ObjectId(),
                referenceModel: 'UserAchievement',
                status: 'completed',
                metadata: { achievementName: 'Bookworm' }
            });
            cleanupIds.push(entry._id);

            expect(entry.type).toBe('achievement');
            expect(entry.amount).toBe(25);
            expect(entry.referenceModel).toBe('UserAchievement');
        });
    });

    describe('Ledger queries', () => {
        const testUserId = new mongoose.Types.ObjectId();
        let entryIds = [];

        beforeEach(async () => {
            await LedgerEntry.deleteMany({});
            const entries = await LedgerEntry.create([
                { user: testUserId, type: 'read_reward', amount: 5, balanceBefore: 0, balanceAfter: 5, status: 'completed' },
                { user: testUserId, type: 'read_reward', amount: 5, balanceBefore: 5, balanceAfter: 10, status: 'completed' },
                { user: testUserId, type: 'achievement', amount: 25, balanceBefore: 10, balanceAfter: 35, status: 'completed' },
                { user: testUserId, type: 'withdrawal', amount: -200, balanceBefore: 35, balanceAfter: -165, status: 'pending' }
            ]);
            entryIds = entries.map(e => e._id);
            await new Promise(r => setTimeout(r, 100));
        });

        afterEach(async () => {
            await LedgerEntry.deleteMany({ _id: { $in: entryIds } });
            entryIds = [];
        });

        test('should find all entries for a user', async () => {
            const entries = await LedgerEntry.find({ user: testUserId });
            expect(entries.length).toBe(4);
        });

        test('should filter by type', async () => {
            const entries = await LedgerEntry.find({ user: testUserId, type: 'read_reward' });
            expect(entries.length).toBe(2);
            entries.forEach(e => expect(e.type).toBe('read_reward'));
        });

        test('should filter by status', async () => {
            const entries = await LedgerEntry.find({ user: testUserId, status: 'pending' });
            expect(entries.length).toBe(1);
            expect(entries[0].type).toBe('withdrawal');
        });

        test('should aggregate total earnings by type', async () => {
            const result = await LedgerEntry.aggregate([
                { $match: { user: testUserId, status: 'completed' } },
                { $group: { _id: '$type', total: { $sum: '$amount' } } }
            ]);

            const readTotal = result.find(r => r._id === 'read_reward');
            const achievementTotal = result.find(r => r._id === 'achievement');

            expect(readTotal.total).toBe(10);
            expect(achievementTotal.total).toBe(25);
        });

        test('should verify balanceAfter matches running sum', async () => {
            const completedEntries = await LedgerEntry.find({
                user: testUserId,
                status: 'completed'
            }).sort({ balanceAfter: 1 });

            expect(completedEntries.length).toBe(3);

            let runningBalance = 0;
            for (const entry of completedEntries) {
                runningBalance += entry.amount;
                expect(entry.balanceAfter).toBe(runningBalance);
            }
        });
    });

    describe('Ledger consistency', () => {
        let entryIds = [];

        beforeEach(async () => {
            await LedgerEntry.deleteMany({});
            const testUserId = new mongoose.Types.ObjectId();
            const entries = await LedgerEntry.create([
                { user: testUserId, type: 'read_reward', amount: 5, balanceBefore: 0, balanceAfter: 5, status: 'completed' },
                { user: testUserId, type: 'read_reward', amount: 5, balanceBefore: 5, balanceAfter: 10, status: 'completed' },
                { user: testUserId, type: 'read_reward', amount: 5, balanceBefore: 10, balanceAfter: 15, status: 'completed' }
            ]);
            entryIds = entries.map(e => e._id);
            await new Promise(r => setTimeout(r, 100));
        });

        afterEach(async () => {
            await LedgerEntry.deleteMany({ _id: { $in: entryIds } });
            entryIds = [];
        });

        test('should detect balance mismatch', async () => {
            const testUserId = new mongoose.Types.ObjectId();
            await LedgerEntry.deleteMany({});
            const entries = await LedgerEntry.create([
                { user: testUserId, type: 'read_reward', amount: 5, balanceBefore: 0, balanceAfter: 5, status: 'completed' },
                { user: testUserId, type: 'read_reward', amount: 5, balanceBefore: 5, balanceAfter: 10, status: 'completed' },
                { user: testUserId, type: 'read_reward', amount: 5, balanceBefore: 10, balanceAfter: 15, status: 'completed' }
            ]);
            entryIds = entries.map(e => e._id);
            await new Promise(r => setTimeout(r, 100));

            const fetched = await LedgerEntry.find({ user: testUserId, status: 'completed' }).sort({ createdAt: 1 });
            const lastEntry = fetched[fetched.length - 1];
            const computedBalance = fetched.reduce((sum, e) => sum + e.amount, 0);

            expect(fetched.length).toBe(3);
            expect(lastEntry.balanceAfter).toBe(computedBalance);
        });
    });
});
