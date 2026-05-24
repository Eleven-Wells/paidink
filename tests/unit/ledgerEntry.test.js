const mongoose = require('mongoose');
const LedgerEntry = require('../../src/models/LedgerEntry');

describe('LedgerEntry Model', () => {
    beforeEach(async () => {
        await LedgerEntry.deleteMany({});
    });

    afterAll(async () => {
        await LedgerEntry.deleteMany({});
    });

    describe('Schema validation', () => {
        test('should require user field', () => {
            const entry = new LedgerEntry({
                type: 'read_reward',
                amount: 5,
                balanceBefore: 0,
                balanceAfter: 5
            });
            return entry.validate().catch((err) => {
                expect(err.errors.user).toBeDefined();
            });
        });

        test('should require type field', () => {
            const entry = new LedgerEntry({
                user: new mongoose.Types.ObjectId(),
                amount: 5,
                balanceBefore: 0,
                balanceAfter: 5
            });
            return entry.validate().catch((err) => {
                expect(err.errors.type).toBeDefined();
            });
        });

        test('should require amount field', () => {
            const entry = new LedgerEntry({
                user: new mongoose.Types.ObjectId(),
                type: 'read_reward',
                balanceBefore: 0,
                balanceAfter: 5
            });
            return entry.validate().catch((err) => {
                expect(err.errors.amount).toBeDefined();
            });
        });

        test('should require balanceBefore field', () => {
            const entry = new LedgerEntry({
                user: new mongoose.Types.ObjectId(),
                type: 'read_reward',
                amount: 5,
                balanceAfter: 5
            });
            return entry.validate().catch((err) => {
                expect(err.errors.balanceBefore).toBeDefined();
            });
        });

        test('should require balanceAfter field', () => {
            const entry = new LedgerEntry({
                user: new mongoose.Types.ObjectId(),
                type: 'read_reward',
                amount: 5,
                balanceBefore: 0
            });
            return entry.validate().catch((err) => {
                expect(err.errors.balanceAfter).toBeDefined();
            });
        });
    });

    describe('Valid types', () => {
        const validTypes = [
            'read_reward',
            'achievement',
            'withdrawal',
            'withdrawal_approved',
            'referral',
            'streak_bonus',
            'signup_bonus',
            'credit_payout',
            'correction'
        ];

        test.each(validTypes)('should accept type: %s', async (type) => {
            const entry = new LedgerEntry({
                user: new mongoose.Types.ObjectId(),
                type,
                amount: 5,
                balanceBefore: 0,
                balanceAfter: 5
            });
            await expect(entry.validate()).resolves.toBeUndefined();
        });

        test('should reject invalid type', () => {
            const entry = new LedgerEntry({
                user: new mongoose.Types.ObjectId(),
                type: 'invalid_type',
                amount: 5,
                balanceBefore: 0,
                balanceAfter: 5
            });
            return entry.validate().catch((err) => {
                expect(err.errors.type).toBeDefined();
            });
        });
    });

    describe('Valid statuses', () => {
        test('should accept completed status', async () => {
            const entry = new LedgerEntry({
                user: new mongoose.Types.ObjectId(),
                type: 'read_reward',
                amount: 5,
                balanceBefore: 0,
                balanceAfter: 5,
                status: 'completed'
            });
            await expect(entry.validate()).resolves.toBeUndefined();
        });

        test('should accept pending status', async () => {
            const entry = new LedgerEntry({
                user: new mongoose.Types.ObjectId(),
                type: 'withdrawal',
                amount: -200,
                balanceBefore: 500,
                balanceAfter: 300,
                status: 'pending'
            });
            await expect(entry.validate()).resolves.toBeUndefined();
        });

        test('should accept failed status', async () => {
            const entry = new LedgerEntry({
                user: new mongoose.Types.ObjectId(),
                type: 'withdrawal',
                amount: -200,
                balanceBefore: 500,
                balanceAfter: 300,
                status: 'failed'
            });
            await expect(entry.validate()).resolves.toBeUndefined();
        });

        test('should reject invalid status', () => {
            const entry = new LedgerEntry({
                user: new mongoose.Types.ObjectId(),
                type: 'withdrawal',
                amount: -200,
                balanceBefore: 500,
                balanceAfter: 300,
                status: 'reversed'
            });
            return entry.validate().catch((err) => {
                expect(err.errors.status).toBeDefined();
            });
        });
    });

    describe('Reference fields', () => {
        test('should allow null referenceId and referenceModel', async () => {
            const entry = new LedgerEntry({
                user: new mongoose.Types.ObjectId(),
                type: 'read_reward',
                amount: 5,
                balanceBefore: 0,
                balanceAfter: 5
            });
            await expect(entry.validate()).resolves.toBeUndefined();
            expect(entry.referenceId).toBeNull();
            expect(entry.referenceModel).toBeNull();
        });

        test('should accept valid referenceId and referenceModel', async () => {
            const entry = new LedgerEntry({
                user: new mongoose.Types.ObjectId(),
                type: 'read_reward',
                amount: 5,
                balanceBefore: 0,
                balanceAfter: 5,
                referenceId: new mongoose.Types.ObjectId(),
                referenceModel: 'ReadSession'
            });
            await expect(entry.validate()).resolves.toBeUndefined();
        });

        test('should reject invalid referenceModel', () => {
            const entry = new LedgerEntry({
                user: new mongoose.Types.ObjectId(),
                type: 'read_reward',
                amount: 5,
                balanceBefore: 0,
                balanceAfter: 5,
                referenceModel: 'InvalidModel'
            });
            return entry.validate().catch((err) => {
                expect(err.errors.referenceModel).toBeDefined();
            });
        });
    });

    describe('Metadata', () => {
        test('should default metadata to empty object', () => {
            const entry = new LedgerEntry({
                user: new mongoose.Types.ObjectId(),
                type: 'read_reward',
                amount: 5,
                balanceBefore: 0,
                balanceAfter: 5
            });
            expect(entry.metadata).toEqual({});
        });

        test('should accept arbitrary metadata', async () => {
            const entry = new LedgerEntry({
                user: new mongoose.Types.ObjectId(),
                type: 'read_reward',
                amount: 5,
                balanceBefore: 0,
                balanceAfter: 5,
                metadata: { postId: 'abc123', readTime: 45 }
            });
            await expect(entry.validate()).resolves.toBeUndefined();
            expect(entry.metadata.postId).toBe('abc123');
            expect(entry.metadata.readTime).toBe(45);
        });
    });

    describe('Indexes', () => {
        test('should have user + createdAt index', async () => {
            const indexes = await LedgerEntry.collection.indexes();
            const indexNames = indexes.map((i) => i.name);
            expect(indexNames).toContain('user_1_createdAt_-1');
        });

        test('should have type index', async () => {
            const indexes = await LedgerEntry.collection.indexes();
            const indexNames = indexes.map((i) => i.name);
            expect(indexNames).toContain('type_1');
        });

        test('should have status index', async () => {
            const indexes = await LedgerEntry.collection.indexes();
            const indexNames = indexes.map((i) => i.name);
            expect(indexNames).toContain('status_1');
        });
    });

    describe('Timestamps', () => {
        test('should auto-set createdAt and updatedAt', async () => {
            const entry = await LedgerEntry.create({
                user: new mongoose.Types.ObjectId(),
                type: 'read_reward',
                amount: 5,
                balanceBefore: 0,
                balanceAfter: 5
            });
            expect(entry.createdAt).toBeDefined();
            expect(entry.updatedAt).toBeDefined();
        });
    });
});
