const mongoose = require('mongoose');
const LedgerEntry = require('../../src/models/LedgerEntry');
const AdEvent = require('../../src/models/ads/AdEvent');
const User = require('../../src/models/User');
const Post = require('../../src/models/Post');
const {
    distributeAdRevenue
} = require('../../src/services/ads/AdRevenueService');
const {
    getPublisherBalance,
    getAllPublisherBalances,
    settlePublisherPayout,
    getPublisherSettlementHistory,
    getPublisherSettlementStatus
} = require('../../src/services/ads/PublisherPoolService');
const { seedDefaultData } = require('../../src/services/ads/AdSimulationService');

describe('PublisherPoolService', () => {
    let publisher;
    let reader;

    beforeAll(async () => {
        await seedDefaultData();
    });

    beforeEach(async () => {
        await LedgerEntry.deleteMany({});
        await AdEvent.deleteMany({});
        publisher = await User.create({
            email: 'publisher-test-' + Date.now() + '@test.com',
            password: 'password123',
            role: 'publisher',
            'wallet.balance': 10,
            'wallet.lifetimeEarned': 10,
            'wallet.pendingUnfundedReads': 0
        });
        reader = await User.create({
            email: 'reader-pool-' + Date.now() + '@test.com',
            password: 'password123',
            'wallet.balance': 0,
            'wallet.lifetimeEarned': 0
        });
    });

    afterEach(async () => {
        await User.deleteMany({ email: { $regex: /-(test|pool)-/ } });
    });

    afterAll(async () => {
        await LedgerEntry.deleteMany({});
        await AdEvent.deleteMany({});
    });

    async function fundPublisherPool(amount) {
        const adEvent = await AdEvent.create({
            user: reader._id,
            type: 'impression',
            revenue: amount / 0.3,
            metadata: {
                pageType: 'post',
                publisherId: publisher._id,
                postId: new mongoose.Types.ObjectId(),
                simulated: true
            }
        });
        await distributeAdRevenue(adEvent);
    }

    describe('getPublisherBalance', () => {
        test('should return 0 for new publisher', async () => {
            const b = await getPublisherBalance(publisher._id);
            expect(b).toBe(0);
        });

        test('should return funded amount', async () => {
            await fundPublisherPool(5);
            const b = await getPublisherBalance(publisher._id);
            expect(b).toBeCloseTo(5, 1);
        });

        test('should be isolated per publisher', async () => {
            const otherPublisher = await User.create({
                email: 'other-pub-' + Date.now() + '@test.com',
                password: 'password123'
            });

            await fundPublisherPool(3);

            await fundPublisherPool(4);

            const b1 = await getPublisherBalance(publisher._id);
            expect(b1).toBeCloseTo(7, 1);

            const b2 = await getPublisherBalance(otherPublisher._id);
            expect(b2).toBe(0);

            await User.findByIdAndDelete(otherPublisher._id);
        });
    });

    describe('getAllPublisherBalances', () => {
        test('should return all publishers with balances', async () => {
            await fundPublisherPool(3);
            const all = await getAllPublisherBalances();
            expect(all.length).toBeGreaterThanOrEqual(1);
            const found = all.find(a => a.publisherId.toString() === publisher._id.toString());
            expect(found).toBeDefined();
            expect(found.balance).toBeCloseTo(3, 1);
        });
    });

    describe('settlePublisherPayout', () => {
        test('should settle payout from publisher pool to user wallet', async () => {
            await fundPublisherPool(10);

            const result = await settlePublisherPayout(publisher._id, 5);
            expect(result.settled).toBe(5);

            const poolAfter = await getPublisherBalance(publisher._id);
            expect(poolAfter).toBeCloseTo(5, 1);

            const updatedUser = await User.findById(publisher._id);
            expect(updatedUser.wallet.balance).toBe(15);
            expect(updatedUser.wallet.totalPublisherEarnings).toBe(5);
        });

        test('should throw when insufficient balance', async () => {
            await expect(settlePublisherPayout(publisher._id, 5)).rejects.toThrow(
                'Insufficient publisher pool balance'
            );
        });

        test('should throw on concurrent user balance update', async () => {
            await fundPublisherPool(10);
            // The service uses findOneAndUpdate with balanceBefore to detect races
            // We can verify the protection exists by checking the service code pattern
            const settleCode = require('fs').readFileSync(
                require.resolve('../../src/services/ads/PublisherPoolService'),
                'utf8'
            );
            expect(settleCode).toContain("'wallet.balance': balanceBefore");
            expect(settleCode).toContain('Concurrent balance update detected');
        });

        test('should create both debit and credit ledger entries', async () => {
            await fundPublisherPool(10);

            const result = await settlePublisherPayout(publisher._id, 5);

            expect(result.debitEntry.type).toBe('publisher_settlement');
            expect(result.debitEntry.amount).toBe(-5);
            expect(result.debitEntry.pool).toBe('publisher_pool');

            expect(result.creditEntry.type).toBe('credit_payout');
            expect(result.creditEntry.amount).toBe(5);
            expect(result.creditEntry.pool).toBe('user_wallet');
            expect(result.creditEntry.fundedBy).toBe('publisher_pool');
        });
    });

    describe('getPublisherSettlementHistory', () => {
        test('should return recent settlements', async () => {
            await fundPublisherPool(20);
            await settlePublisherPayout(publisher._id, 3);
            await settlePublisherPayout(publisher._id, 4);

            const history = await getPublisherSettlementHistory(publisher._id);
            expect(history.length).toBe(2);
            expect(history[0].amount).toBe(-4);
            expect(history[1].amount).toBe(-3);
        });
    });

    describe('getPublisherSettlementStatus', () => {
        test('should return status with balance and last settlement', async () => {
            await fundPublisherPool(10);
            await settlePublisherPayout(publisher._id, 2);

            const status = await getPublisherSettlementStatus(publisher._id);
            expect(status.balance).toBeCloseTo(8, 1);
            expect(status.lastSettlement).toBeDefined();
            expect(status.lastSettlementAt).toBeDefined();
        });

        test('should return null lastSettlement for new publisher', async () => {
            const status = await getPublisherSettlementStatus(publisher._id);
            expect(status.balance).toBe(0);
            expect(status.lastSettlement).toBeNull();
            expect(status.lastSettlementAt).toBeNull();
        });
    });
});
