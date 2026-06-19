const LedgerEntry = require('../../models/LedgerEntry');
const User = require('../../models/User');

async function getPublisherBalance(publisherId) {
    const result = await LedgerEntry.aggregate([
        { $match: { pool: 'publisher_pool', user: publisherId, status: 'completed' } },
        { $group: { _id: null, balance: { $sum: '$amount' } } }
    ]);
    return result.length > 0 ? result[0].balance : 0;
}

async function getAllPublisherBalances() {
    const result = await LedgerEntry.aggregate([
        { $match: { pool: 'publisher_pool', status: 'completed' } },
        { $group: { _id: '$user', balance: { $sum: '$amount' } } }
    ]);
    return result.map(r => ({ publisherId: r._id, balance: r.balance }));
}

async function settlePublisherPayout(publisherId, amount) {
    const balance = await getPublisherBalance(publisherId);
    if (balance < amount) {
        throw new Error('Insufficient publisher pool balance');
    }

    const user = await User.findById(publisherId).select('wallet.balance wallet.lifetimeEarned');
    if (!user) {
        throw new Error('Publisher not found');
    }

    const balanceBefore = user.wallet.balance;
    const balanceAfter = balanceBefore + amount;
    const poolBefore = balance;

    const userResult = await User.findOneAndUpdate(
        { _id: publisherId, 'wallet.balance': balanceBefore },
        {
            $set: {
                'wallet.balance': balanceAfter,
                'wallet.lifetimeEarned': user.wallet.lifetimeEarned + amount,
                'wallet.totalPublisherEarnings': (user.wallet.totalPublisherEarnings || 0) + amount
            }
        },
        { new: true }
    );

    if (!userResult) {
        throw new Error('Concurrent balance update detected. Please retry.');
    }

    const debitEntry = await LedgerEntry.create({
        user: publisherId,
        type: 'publisher_settlement',
        amount: -amount,
        balanceBefore: poolBefore,
        balanceAfter: poolBefore - amount,
        status: 'completed',
        fundedBy: 'publisher_pool',
        pool: 'publisher_pool',
        metadata: {
            settlementType: 'publisher_payout',
            settledAmount: amount
        }
    });

    const creditEntry = await LedgerEntry.create({
        user: publisherId,
        type: 'credit_payout',
        amount,
        balanceBefore,
        balanceAfter,
        referenceId: debitEntry._id,
        referenceModel: 'LedgerEntry',
        status: 'completed',
        fundedBy: 'publisher_pool',
        pool: 'user_wallet',
        metadata: {
            settlementType: 'publisher_payout',
            settledFrom: 'publisher_pool'
        }
    });

    return {
        settled: amount,
        poolBalanceAfter: poolBefore - amount,
        userBalanceAfter: balanceAfter,
        debitEntry,
        creditEntry
    };
}

async function getPublisherSettlementHistory(publisherId, limit = 20) {
    return LedgerEntry.find({
        user: publisherId,
        type: 'publisher_settlement',
        status: 'completed'
    })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();
}

async function getPublisherSettlementStatus(publisherId) {
    const balance = await getPublisherBalance(publisherId);
    const lastSettlement = await LedgerEntry.findOne({
        user: publisherId,
        type: 'publisher_settlement',
        status: 'completed'
    })
        .sort({ createdAt: -1 })
        .select('createdAt amount')
        .lean();

    return {
        balance,
        lastSettlement: lastSettlement || null,
        lastSettlementAt: lastSettlement ? lastSettlement.createdAt : null
    };
}

module.exports = {
    getPublisherBalance,
    getAllPublisherBalances,
    settlePublisherPayout,
    getPublisherSettlementHistory,
    getPublisherSettlementStatus
};
