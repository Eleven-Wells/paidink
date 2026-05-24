const LedgerEntry = require('../../models/LedgerEntry');
const AdEvent = require('../../models/ads/AdEvent');
const User = require('../../models/User');
const ReadSession = require('../../models/ReadSession');

const MAX_REWARD = 5;
const MAX_UNFUNDED = 3;

async function getReaderPoolBalance() {
    const result = await LedgerEntry.aggregate([
        { $match: { pool: 'reader_pool', status: 'completed' } },
        { $group: { _id: null, balance: { $sum: '$amount' } } }
    ]);
    return result.length > 0 ? result[0].balance : 0;
}

async function payoutReaderReward(readSession, rewardAmount) {
    const poolBalance = await getReaderPoolBalance();
    if (poolBalance < rewardAmount) {
        return await handleUnfundedRead(readSession);
    }

    const debitEntry = await LedgerEntry.create({
        user: null,
        type: 'reader_reward_payout',
        amount: -rewardAmount,
        balanceBefore: poolBalance,
        balanceAfter: poolBalance - rewardAmount,
        status: 'completed',
        fundedBy: 'reader_pool',
        correlationId: readSession._id,
        correlationModel: 'ReadSession',
        pool: 'reader_pool',
        metadata: {
            readSessionId: readSession._id,
            rewardAmount,
            sweepType: 'immediate'
        }
    });

    return { paid: true, amount: rewardAmount, debitEntry, poolBalanceAfter: poolBalance - rewardAmount };
}

async function handleUnfundedRead(readSession) {
    const updatedUser = await User.findOneAndUpdate(
        { _id: readSession.user, 'wallet.pendingUnfundedReads': { $lt: MAX_UNFUNDED } },
        { $inc: { 'wallet.pendingUnfundedReads': 1 } },
        { new: true, select: 'wallet.pendingUnfundedReads' }
    );

    if (!updatedUser) {
        const user = await User.findById(readSession.user).select('wallet.pendingUnfundedReads');
        const pendingCount = user ? (user.wallet.pendingUnfundedReads || 0) : 0;
        return { paid: false, reason: 'max_unfunded_reached', pendingCount };
    }

    const newCount = updatedUser.wallet.pendingUnfundedReads || 0;

    await ReadSession.updateOne(
        { _id: readSession._id },
        {
            $set: {
                isUnfunded: true,
                userPendingCount: newCount
            }
        }
    );

    return { paid: false, reason: 'insufficient_pool', pendingCount: newCount };
}

async function sweepUnfundedReads() {
    const unfundedSessions = await ReadSession.find({
        completed: true,
        rewardAwarded: false,
        isUnfunded: true
    }).sort({ createdAt: 1 });

    if (unfundedSessions.length === 0) {
        return { swept: 0, totalAmount: 0 };
    }

    const poolBalance = await getReaderPoolBalance();
    if (poolBalance < 5) {
        return { swept: 0, totalAmount: 0, reason: 'insufficient_pool' };
    }

    let swept = 0;
    let totalAmount = 0;
    let remainingBalance = poolBalance;

    for (const session of unfundedSessions) {
        if (remainingBalance < 5) break;

        const rewardAmount = session.calculateReward ? session.calculateReward() : 5;
        if (rewardAmount <= 0) continue;
        if (remainingBalance < rewardAmount) continue;

        const currentUser = await User.findById(session.user).select('wallet.balance wallet.lifetimeEarned');
        if (!currentUser) continue;

        const balanceBefore = currentUser.wallet.balance;
        const balanceAfter = balanceBefore + rewardAmount;

        const userResult = await User.findOneAndUpdate(
            { _id: session.user, 'wallet.balance': balanceBefore, 'wallet.pendingUnfundedReads': { $gt: 0 } },
            {
                $set: {
                    'wallet.balance': balanceAfter,
                    'wallet.lifetimeEarned': currentUser.wallet.lifetimeEarned + rewardAmount
                },
                $inc: { 'wallet.pendingUnfundedReads': -1 }
            },
            { new: true }
        );

        if (!userResult) continue;

        await LedgerEntry.create({
            user: session.user,
            type: 'read_reward',
            amount: rewardAmount,
            balanceBefore,
            balanceAfter,
            referenceId: session._id,
            referenceModel: 'ReadSession',
            status: 'completed',
            fundedBy: 'reader_pool',
            metadata: { postId: session.post, sweepPayout: true }
        });

        await LedgerEntry.create({
            user: null,
            type: 'reader_reward_payout',
            amount: -rewardAmount,
            balanceBefore: remainingBalance,
            balanceAfter: remainingBalance - rewardAmount,
            status: 'completed',
            fundedBy: 'reader_pool',
            correlationId: session._id,
            correlationModel: 'ReadSession',
            pool: 'reader_pool',
            metadata: { readSessionId: session._id, rewardAmount, sweepType: 'daily_sweep' }
        });

        await ReadSession.updateOne(
            { _id: session._id },
            { $set: { rewardAwarded: true, rewardAmount, isUnfunded: false, poolPayoutAt: new Date() } }
        );

        remainingBalance -= rewardAmount;
        swept++;
        totalAmount += rewardAmount;
    }

    return { swept, totalAmount, poolBalanceAfter: remainingBalance };
}

async function getUserUnfundedCount(userId) {
    const user = await User.findById(userId).select('wallet.pendingUnfundedReads').lean();
    return (user && user.wallet.pendingUnfundedReads) || 0;
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

async function dailyReaderRewardSweep() {
    const result = await sweepUnfundedReads();
    return result;
}

module.exports = {
    getReaderPoolBalance,
    payoutReaderReward,
    handleUnfundedRead,
    sweepUnfundedReads,
    getUserUnfundedCount,
    dailyFeedRevenueSweep,
    dailyReaderRewardSweep,
    MAX_REWARD,
    MAX_UNFUNDED
};
