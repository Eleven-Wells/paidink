const LedgerEntry = require('../models/LedgerEntry');
const ReadSession = require('../models/ReadSession');
const SystemConfig = require('../models/SystemConfig');

const RATE_FLOOR = 10;
const RATE_CEILING = 2000;
const WINDOW_DAYS = 7;

async function calculateRate() {
    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const revenueResult = await LedgerEntry.aggregate([
        {
            $match: {
                pool: 'reader_pool',
                amount: { $gt: 0 },
                status: 'completed',
                createdAt: { $gte: since }
            }
        },
        { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);

    const totalRevenue = revenueResult.length > 0 ? revenueResult[0].total : 0;

    const totalReads = await ReadSession.countDocuments({
        rewardAwarded: true,
        createdAt: { $gte: since }
    });

    if (totalReads === 0 || totalRevenue === 0) {
        return RATE_FLOOR;
    }

    const rate = Math.round(totalRevenue / totalReads);
    return Math.min(Math.max(rate, RATE_FLOOR), RATE_CEILING);
}

async function getCurrentRate() {
    const cached = await SystemConfig.findOne({ key: 'dynamic_read_rate_kobo' });
    if (cached !== null && cached.value !== undefined) {
        return cached.value;
    }
    return await refreshRate();
}

async function refreshRate() {
    const rate = await calculateRate();
    await SystemConfig.findOneAndUpdate(
        { key: 'dynamic_read_rate_kobo' },
        { key: 'dynamic_read_rate_kobo', value: rate },
        { upsert: true, new: true }
    );
    return rate;
}

module.exports = { calculateRate, getCurrentRate, refreshRate, RATE_FLOOR, RATE_CEILING, WINDOW_DAYS };
