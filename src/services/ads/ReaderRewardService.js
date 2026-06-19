const LedgerEntry = require('../../models/LedgerEntry');
const AdEvent = require('../../models/ads/AdEvent');
const User = require('../../models/User');
const RewardRateService = require('../RewardRateService');

const MAX_REWARD = 500;

async function getReaderPoolBalance() {
    const result = await LedgerEntry.aggregate([
        { $match: { pool: 'reader_pool', status: 'completed' } },
        { $group: { _id: null, balance: { $sum: '$amount' } } }
    ]);
    return result.length > 0 ? result[0].balance : 0;
}

async function processReadCompletion(user, session) {
    const rate = await RewardRateService.getCurrentRate();
    const balance = await user.addReward(rate, 'read_reward', 'Reward for reading');

    const poolBalance = await getReaderPoolBalance();
    await LedgerEntry.create({
        user: null,
        type: 'reader_reward_payout',
        amount: -rate,
        balanceBefore: poolBalance,
        balanceAfter: poolBalance - rate,
        status: 'completed',
        fundedBy: 'reader_pool',
        correlationId: session._id,
        correlationModel: 'ReadSession',
        pool: 'reader_pool',
        metadata: {
            readSessionId: session._id,
            rewardAmount: rate,
            userId: user._id,
            sweepType: 'immediate'
        }
    });

    return { paid: true, amount: rate, balance };
}

async function getLastSweepTime() {
    const lastSweep = await LedgerEntry.findOne({
        type: 'ad_revenue_reader_pool',
        'metadata.sweepType': 'daily_feed_sweep',
        status: 'completed'
    }).sort({ createdAt: -1 }).select('createdAt').lean();

    return lastSweep ? lastSweep.createdAt : new Date(Date.now() - 24 * 60 * 60 * 1000);
}

async function dailyFeedRevenueSweep() {
    const since = await getLastSweepTime();

    const feedAdRevenue = await AdEvent.aggregate([
        {
            $match: {
                'metadata.pageType': 'feed',
                createdAt: { $gte: since }
            }
        },
        { $group: { _id: null, total: { $sum: '$revenue' } } }
    ]);

    const totalFeedRevenue = feedAdRevenue.length > 0 ? feedAdRevenue[0].total : 0;
    if (totalFeedRevenue <= 0) {
        return { swept: 0, note: 'no_feed_revenue' };
    }

    const readerPoolShare = Math.round(totalFeedRevenue * 0.30 * 1e6) / 1e6;
    if (readerPoolShare <= 0) {
        return { swept: 0, note: 'amount_too_small' };
    }

    const poolBefore = await getReaderPoolBalance();

    const entry = await LedgerEntry.create({
        user: null,
        type: 'ad_revenue_reader_pool',
        amount: readerPoolShare,
        balanceBefore: poolBefore,
        balanceAfter: poolBefore + readerPoolShare,
        status: 'completed',
        fundedBy: 'ad_revenue',
        correlationModel: null,
        pool: 'reader_pool',
        metadata: {
            sweepType: 'daily_feed_sweep',
            totalFeedRevenue,
            sourcePeriod: { from: since, to: new Date() }
        }
    });

    return { swept: readerPoolShare, entry, poolBalanceAfter: poolBefore + readerPoolShare };
}

module.exports = {
    getReaderPoolBalance,
    processReadCompletion,
    dailyFeedRevenueSweep,
    MAX_REWARD
};
