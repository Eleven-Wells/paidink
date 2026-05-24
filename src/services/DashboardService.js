const LedgerEntry = require('../models/LedgerEntry');

async function getDashboardSummary(userId) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fourteenDaysAgo = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [earningsSummary, recentEntries, pendingWithdrawals] = await Promise.all([
        LedgerEntry.aggregate([
            { $match: { user: userId, status: 'completed' } },
            { $group: { _id: null, totalEarned: { $sum: '$amount' } } }
        ]),
        LedgerEntry.find({ user: userId, status: 'completed' })
            .sort({ createdAt: -1 })
            .limit(20)
            .select('type amount balanceAfter createdAt referenceModel')
            .lean(),
        LedgerEntry.find({ user: userId, type: 'withdrawal', status: 'pending' })
            .sort({ createdAt: -1 })
            .lean()
    ]);

    const [earned7dAgg, earnedPrev7dAgg, earned30dAgg, typeBreakdown] = await Promise.all([
        LedgerEntry.aggregate([
            { $match: { user: userId, status: 'completed', createdAt: { $gte: sevenDaysAgo } } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]),
        LedgerEntry.aggregate([
            { $match: { user: userId, status: 'completed', createdAt: { $gte: fourteenDaysAgo, $lt: sevenDaysAgo } } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]),
        LedgerEntry.aggregate([
            { $match: { user: userId, status: 'completed', createdAt: { $gte: thirtyDaysAgo } } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]),
        LedgerEntry.aggregate([
            { $match: { user: userId, status: 'completed' } },
            { $group: { _id: '$type', total: { $sum: '$amount' }, count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ])
    ]);

    const readRewardsAgg = await LedgerEntry.aggregate([
        { $match: { user: userId, type: 'read_reward', status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
    ]);

    const achievementRewardsAgg = await LedgerEntry.aggregate([
        { $match: { user: userId, type: 'achievement', status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
    ]);

    const referralRewardsAgg = await LedgerEntry.aggregate([
        { $match: { user: userId, type: 'referral', status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
    ]);

    const todayStart = new Date(today.getTime());
    const todayEnd = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    const todayEarningsAgg = await LedgerEntry.aggregate([
        {
            $match: {
                user: userId,
                status: 'completed',
                type: 'read_reward',
                createdAt: { $gte: todayStart, $lt: todayEnd }
            }
        },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
    ]);

    const currentBalance = recentEntries.length > 0 ? recentEntries[0].balanceAfter : 0;
    const totalEarned = earningsSummary[0]?.totalEarned || 0;
    const earned7d = earned7dAgg[0]?.total || 0;
    const earnedPrev7d = earnedPrev7dAgg[0]?.total || 0;
    const earned30d = earned30dAgg[0]?.total || 0;
    const todayEarnings = todayEarningsAgg[0]?.total || 0;
    const todayReads = todayEarningsAgg[0]?.count || 0;

    const pctDelta = (current, previous) => {
        if (current === 0 && previous === 0) return 0;
        if (previous === 0) return 100;
        return Math.round(((current - previous) / previous) * 100);
    };

    const readRewardTotal = readRewardsAgg[0]?.total || 0;
    const achievementRewardTotal = achievementRewardsAgg[0]?.total || 0;
    const referralRewardTotal = referralRewardsAgg[0]?.total || 0;
    const totalReadRewardCount = readRewardsAgg[0]?.count || 0;

    return {
        wallet: {
            currentBalance,
            totalEarned,
            pendingWithdrawals: pendingWithdrawals.reduce((sum, w) => sum + Math.abs(w.amount), 0)
        },
        earnings: {
            today: todayEarnings,
            last7Days: earned7d,
            last7DaysPrev: earnedPrev7d,
            last7DaysDelta: pctDelta(earned7d, earnedPrev7d),
            last30Days: earned30d
        },
        reads: {
            today: todayReads,
            total: totalReadRewardCount,
            last7Days: readRewardTotal > 0 ? Math.floor(readRewardTotal / 5) : 0
        },
        breakdown: {
            readRewards: { amount: readRewardTotal, count: totalReadRewardCount },
            achievementRewards: { amount: achievementRewardTotal, count: achievementRewardsAgg[0]?.count || 0 },
            referralRewards: { amount: referralRewardTotal, count: referralRewardsAgg[0]?.count || 0 }
        },
        typeBreakdown: typeBreakdown.map(t => ({ type: t._id, amount: t.total, count: t.count })),
        recentEntries: recentEntries.map(e => ({
            type: e.type,
            amount: e.amount,
            balanceAfter: e.balanceAfter,
            createdAt: e.createdAt,
            source: e.referenceModel
        })),
        pendingWithdrawals: pendingWithdrawals.map(w => ({
            amount: Math.abs(w.amount),
            requestedAt: w.createdAt
        }))
    };
}

module.exports = { getDashboardSummary };