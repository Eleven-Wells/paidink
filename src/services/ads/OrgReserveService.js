const LedgerEntry = require('../../models/LedgerEntry');
const { getReaderPoolBalance } = require('./ReaderRewardService');
const { getAverageDailyReaderPayout } = require('./AdRevenueService');

async function getReserveBalance() {
    const result = await LedgerEntry.aggregate([
        { $match: { pool: 'org_reserve', status: 'completed' } },
        { $group: { _id: null, balance: { $sum: '$amount' } } }
    ]);
    return result.length > 0 ? result[0].balance : 0;
}

async function getTotalReserveDeposited() {
    const result = await LedgerEntry.aggregate([
        { $match: { pool: 'org_reserve', status: 'completed', amount: { $gt: 0 } } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    return result.length > 0 ? result[0].total : 0;
}

async function getTotalReserveUnlocked() {
    const result = await LedgerEntry.aggregate([
        { $match: { type: 'reserve_unlock', status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    return result.length > 0 ? Math.abs(result[0].total) : 0;
}

async function getDailyReserveDeposit() {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const result = await LedgerEntry.aggregate([
        {
            $match: {
                pool: 'org_reserve',
                status: 'completed',
                amount: { $gt: 0 },
                createdAt: { $gte: twentyFourHoursAgo }
            }
        },
        { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    return result.length > 0 ? result[0].total : 0;
}

async function lockRevenue(amount) {
    const reserveBefore = await getReserveBalance();
    const entry = await LedgerEntry.create({
        user: null,
        type: 'ad_revenue_reserve',
        amount,
        balanceBefore: reserveBefore,
        balanceAfter: reserveBefore + amount,
        status: 'completed',
        fundedBy: 'ad_revenue',
        pool: 'org_reserve',
        metadata: {
            lockType: 'feed_ad_revenue',
            timestamp: new Date()
        }
    });
    return entry;
}

async function evaluateUnlockCriteria() {
    const readerPoolBalance = await getReaderPoolBalance();
    const avgDailyPayout = await getAverageDailyReaderPayout();
    const reserveBalance = await getReserveBalance();

    const oneDayTarget = avgDailyPayout > 0 ? avgDailyPayout : 0;
    const thirtyDayTarget = avgDailyPayout > 0 ? avgDailyPayout * 30 : 0;

    let criteriaA = false;
    let criteriaB = false;
    let criteriaC = false;

    if (oneDayTarget > 0) {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const readerPoolEntries = await LedgerEntry.find({
            pool: 'reader_pool',
            status: 'completed',
            type: 'reader_reward_payout',
            createdAt: { $gte: thirtyDaysAgo }
        }).sort({ createdAt: 1 }).lean();

        if (readerPoolEntries.length > 0) {
            const dailyBalances = {};
            for (const entry of readerPoolEntries) {
                const dayKey = entry.createdAt.toISOString().slice(0, 10);
                dailyBalances[dayKey] = (dailyBalances[dayKey] || 0) + Math.abs(entry.amount);
            }

            const daysWithData = Object.keys(dailyBalances).length;
            if (daysWithData >= 30) {
                const allAbove = Object.values(dailyBalances).every(dailyTotal => dailyTotal >= oneDayTarget);
                if (allAbove) {
                    criteriaA = true;
                }
            }
        }

        if (readerPoolBalance >= oneDayTarget) {
            const consecutiveReaderDates = await checkConsecutiveDays(
                'reader_reward_payout',
                30,
                (entry) => Math.abs(entry.amount) >= oneDayTarget
            );
            if (consecutiveReaderDates) {
                criteriaA = true;
            }
        }
    }

    const eightWeeksAgo = new Date(Date.now() - 56 * 24 * 60 * 60 * 1000);
    const publisherSettlements = await LedgerEntry.find({
        type: 'publisher_settlement',
        status: 'completed',
        createdAt: { $gte: eightWeeksAgo }
    }).sort({ createdAt: 1 }).lean();

    if (publisherSettlements.length > 0) {
        const settlementWeeks = {};
        for (const s of publisherSettlements) {
            const d = new Date(s.createdAt);
            const weekStart = new Date(d);
            weekStart.setDate(d.getDate() - d.getDay());
            const weekKey = weekStart.toISOString().slice(0, 10);
            settlementWeeks[weekKey] = (settlementWeeks[weekKey] || 0) + 1;
        }

        const weeksWithSettlements = Object.keys(settlementWeeks).length;
        if (weeksWithSettlements >= 8) {
            criteriaB = true;
        }
    }

    if (thirtyDayTarget > 0 && reserveBalance >= thirtyDayTarget) {
        criteriaC = true;
    }

    const allMet = criteriaA && criteriaB && criteriaC;

    return { criteriaA, criteriaB, criteriaC, allMet, readerPoolBalance, avgDailyPayout, reserveBalance, oneDayTarget, thirtyDayTarget };
}

async function checkConsecutiveDays(type, days, filterFn) {
    const entries = await LedgerEntry.find({
        type,
        status: 'completed'
    })
        .sort({ createdAt: -1 })
        .limit(100)
        .lean();

    if (entries.length === 0) return false;

    const daySet = new Set();
    for (const entry of entries) {
        if (filterFn && !filterFn(entry)) continue;
        const day = entry.createdAt.toISOString().slice(0, 10);
        daySet.add(day);
    }

    const sortedDays = Array.from(daySet).sort().reverse();
    if (sortedDays.length < days) return false;

    const today = new Date().toISOString().slice(0, 10);
    let consecutive = 0;
    let cursor = new Date(today);

    for (let i = 0; i < days; i++) {
        const cursorDay = cursor.toISOString().slice(0, 10);
        if (sortedDays.includes(cursorDay)) {
            consecutive++;
        } else {
            consecutive = 0;
        }
        cursor.setDate(cursor.getDate() - 1);
    }

    return consecutive >= days;
}

async function unlockReserve(percentage) {
    if (percentage > 40) {
        throw new Error('Cannot unlock more than 40% of reserve in a single operation');
    }

    const criteria = await evaluateUnlockCriteria();
    if (!criteria.allMet) {
        throw new Error('Unlock criteria not met');
    }

    const reserveBalance = await getReserveBalance();
    const unlockAmount = Math.round(reserveBalance * (percentage / 100) * 1e6) / 1e6;

    if (unlockAmount <= 0) {
        throw new Error('No balance available to unlock');
    }

    const reserveAfter = reserveBalance - unlockAmount;

    const entry = await LedgerEntry.create({
        user: null,
        type: 'reserve_unlock',
        amount: -unlockAmount,
        balanceBefore: reserveBalance,
        balanceAfter: reserveAfter,
        status: 'completed',
        fundedBy: 'ad_revenue',
        pool: 'org_reserve',
        metadata: {
            unlockPercentage: percentage,
            criteriaSnapshot: {
                criteriaA: criteria.criteriaA,
                criteriaB: criteria.criteriaB,
                criteriaC: criteria.criteriaC
            },
            timestamp: new Date()
        }
    });

    await LedgerEntry.create({
        user: null,
        type: 'ad_revenue_operational',
        amount: unlockAmount,
        balanceBefore: 0,
        balanceAfter: unlockAmount,
        status: 'completed',
        fundedBy: 'ad_revenue',
        pool: 'org_operational',
        metadata: {
            sourceReserveUnlock: entry._id,
            unlockPercentage: percentage,
            timestamp: new Date()
        }
    });

    return { unlocked: unlockAmount, remainingLocked: reserveAfter, entry };
}

async function getReserveStatus() {
    const balance = await getReserveBalance();
    const totalDeposited = await getTotalReserveDeposited();
    const totalUnlocked = await getTotalReserveUnlocked();
    const criteria = await evaluateUnlockCriteria();
    const dailyDeposit = await getDailyReserveDeposit();

    const lastUnlock = await LedgerEntry.findOne({ type: 'reserve_unlock', status: 'completed' })
        .sort({ createdAt: -1 })
        .select('createdAt amount metadata')
        .lean();

    return {
        lockedBalance: balance,
        totalDeposited,
        totalUnlocked,
        netLocked: totalDeposited - totalUnlocked,
        criteria,
        dailyDeposit,
        lastUnlock: lastUnlock || null,
        lastUnlockAt: lastUnlock ? lastUnlock.createdAt : null
    };
}

module.exports = {
    getReserveBalance,
    getTotalReserveDeposited,
    getTotalReserveUnlocked,
    getDailyReserveDeposit,
    lockRevenue,
    evaluateUnlockCriteria,
    unlockReserve,
    getReserveStatus
};
