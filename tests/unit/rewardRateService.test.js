const { calculateRate, getCurrentRate, refreshRate } = require('../../src/services/RewardRateService');

jest.mock('../../src/models/LedgerEntry');
jest.mock('../../src/models/ReadSession');
jest.mock('../../src/models/SystemConfig');

const LedgerEntry = require('../../src/models/LedgerEntry');
const ReadSession = require('../../src/models/ReadSession');
const SystemConfig = require('../../src/models/SystemConfig');

describe('RewardRateService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('calculateRate', () => {
        it('returns rate = revenue / reads when both are positive', async () => {
            LedgerEntry.aggregate.mockResolvedValue([{ total: 50000 }]);
            ReadSession.countDocuments.mockResolvedValue(100);
            const rate = await calculateRate();
            expect(rate).toBe(500);
        });

        it('returns floor (10) when revenue < reads', async () => {
            LedgerEntry.aggregate.mockResolvedValue([{ total: 100 }]);
            ReadSession.countDocuments.mockResolvedValue(1000);
            const rate = await calculateRate();
            expect(rate).toBe(10);
        });

        it('returns ceiling (2000) when revenue >> reads', async () => {
            LedgerEntry.aggregate.mockResolvedValue([{ total: 500000 }]);
            ReadSession.countDocuments.mockResolvedValue(10);
            const rate = await calculateRate();
            expect(rate).toBe(2000);
        });

        it('returns floor when no reads in period', async () => {
            LedgerEntry.aggregate.mockResolvedValue([{ total: 50000 }]);
            ReadSession.countDocuments.mockResolvedValue(0);
            const rate = await calculateRate();
            expect(rate).toBe(10);
        });

        it('returns floor when no revenue in period', async () => {
            LedgerEntry.aggregate.mockResolvedValue([{ total: 0 }]);
            ReadSession.countDocuments.mockResolvedValue(100);
            const rate = await calculateRate();
            expect(rate).toBe(10);
        });

        it('queries last 7 days for revenue', async () => {
            const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            LedgerEntry.aggregate.mockResolvedValue([{ total: 50000 }]);
            ReadSession.countDocuments.mockResolvedValue(100);
            await calculateRate();
            expect(LedgerEntry.aggregate).toHaveBeenCalled();
            const matchStage = LedgerEntry.aggregate.mock.calls[0][0][0].$match;
            expect(matchStage.createdAt.$gte.getTime()).toBeCloseTo(sevenDaysAgo.getTime(), -3);
        });

        it('queries last 7 days for reads', async () => {
            LedgerEntry.aggregate.mockResolvedValue([{ total: 50000 }]);
            ReadSession.countDocuments.mockResolvedValue(100);
            await calculateRate();
            expect(ReadSession.countDocuments).toHaveBeenCalled();
            const query = ReadSession.countDocuments.mock.calls[0][0];
            expect(query.rewardAwarded).toBe(true);
            expect(query.createdAt.$gte).toBeDefined();
        });
    });

    describe('getCurrentRate', () => {
        it('returns cached rate from SystemConfig', async () => {
            SystemConfig.findOne.mockResolvedValue({ key: 'dynamic_read_rate_kobo', value: 350 });
            const rate = await getCurrentRate();
            expect(rate).toBe(350);
        });

        it('calls refreshRate and returns result when no cache exists', async () => {
            SystemConfig.findOne.mockResolvedValue(null);
            LedgerEntry.aggregate.mockResolvedValue([{ total: 50000 }]);
            ReadSession.countDocuments.mockResolvedValue(100);
            SystemConfig.findOneAndUpdate.mockResolvedValue({ key: 'dynamic_read_rate_kobo', value: 500 });
            const rate = await getCurrentRate();
            expect(rate).toBe(500);
        });
    });

    describe('refreshRate', () => {
        it('calculates and stores new rate in SystemConfig', async () => {
            LedgerEntry.aggregate.mockResolvedValue([{ total: 50000 }]);
            ReadSession.countDocuments.mockResolvedValue(100);
            SystemConfig.findOneAndUpdate.mockResolvedValue({ key: 'dynamic_read_rate_kobo', value: 500 });
            const rate = await refreshRate();
            expect(rate).toBe(500);
            expect(SystemConfig.findOneAndUpdate).toHaveBeenCalledWith(
                { key: 'dynamic_read_rate_kobo' },
                { key: 'dynamic_read_rate_kobo', value: 500 },
                { upsert: true, new: true }
            );
        });
    });
});
