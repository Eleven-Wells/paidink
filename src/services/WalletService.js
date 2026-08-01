const mongoose = require('mongoose');
const User = require('../models/User');

async function addReward(user, amount, type, description) {
    const currentUser = await User.findById(user._id).select('wallet.balance wallet.lifetimeEarned');
    if (!currentUser) {
        throw new Error('User not found');
    }

    const balanceBefore = currentUser.wallet.balance;
    const balanceAfter = balanceBefore + amount;

    const result = await User.findOneAndUpdate(
        { _id: user._id, 'wallet.balance': balanceBefore },
        {
            $set: {
                'wallet.balance': balanceAfter,
                'wallet.lifetimeEarned': currentUser.wallet.lifetimeEarned + amount
            }
        },
        { new: true }
    );

    if (!result) {
        throw new Error('Concurrent balance update detected. Please retry.');
    }

    const LedgerEntry = mongoose.model('LedgerEntry');
    await LedgerEntry.create({
        user: user._id,
        type,
        amount,
        balanceBefore,
        balanceAfter,
        status: 'completed',
        metadata: { description }
    });

    try {
        const NotificationService = require('./NotificationService');
        await NotificationService.notifyReward(user._id, amount, type);
    } catch (err) {
        console.error('Failed to create notification:', err.message);
    }

    user.wallet.balance = balanceAfter;
    user.wallet.lifetimeEarned += amount;
    return user.wallet.balance;
}

async function requestWithdrawal(user, amount) {
    const currentUser = await User.findById(user._id).select('wallet.balance wallet.pendingBalance');
    if (!currentUser) {
        throw new Error('User not found');
    }

    if (currentUser.wallet.balance < amount) {
        throw new Error('Insufficient balance');
    }

    const balanceBefore = currentUser.wallet.balance;
    const newPendingBalance = (currentUser.wallet.pendingBalance || 0) + amount;

    const result = await User.findOneAndUpdate(
        { _id: user._id, 'wallet.balance': balanceBefore },
        {
            $set: {
                'wallet.balance': balanceBefore - amount,
                'wallet.pendingBalance': newPendingBalance
            }
        },
        { new: true }
    );

    if (!result) {
        throw new Error('Concurrent balance update detected. Please retry.');
    }

    const balanceAfter = balanceBefore - amount;

    user.wallet.balance = balanceAfter;
    user.wallet.pendingBalance = newPendingBalance;

    const LedgerEntry = mongoose.model('LedgerEntry');
    const ledger = await LedgerEntry.create({
        user: user._id,
        type: 'withdrawal',
        amount: -amount,
        balanceBefore,
        balanceAfter,
        status: 'pending',
        metadata: { description: 'Withdrawal requested' }
    });

    return {
        newBalance: balanceAfter,
        pendingBalance: newPendingBalance,
        ledgerEntryId: ledger._id
    };
}

async function completeWithdrawal(user, amount, transferCode) {
    const currentUser = await User.findById(user._id).select('wallet.pendingBalance wallet.lifetimeWithdrawn');
    if (!currentUser) throw new Error('User not found');

    const pendingBefore = currentUser.wallet.pendingBalance || 0;
    if (pendingBefore < amount) throw new Error('Insufficient pending balance');

    const lifetimeWithdrawnBefore = currentUser.wallet.lifetimeWithdrawn || 0;

    const result = await User.findOneAndUpdate(
        { _id: user._id, 'wallet.pendingBalance': pendingBefore },
        {
            $set: {
                'wallet.pendingBalance': pendingBefore - amount,
                'wallet.lifetimeWithdrawn': lifetimeWithdrawnBefore + amount
            }
        },
        { new: true }
    );

    if (!result) throw new Error('Concurrent withdrawal completion detected. Please retry.');

    user.wallet.pendingBalance = pendingBefore - amount;
    user.wallet.lifetimeWithdrawn = lifetimeWithdrawnBefore + amount;

    const Transfer = mongoose.model('Transaction');
    const LedgerEntry = mongoose.model('LedgerEntry');

    await Transfer.updateOne(
        { 'metadata.paystackTransferCode': transferCode },
        { $set: { status: 'completed' } }
    );

    await LedgerEntry.updateOne(
        { 'metadata.paystackTransferCode': transferCode },
        {
            $set: {
                status: 'completed',
                'metadata.description': 'Withdrawal completed'
            }
        }
    );

    return {
        pendingBalance: user.wallet.pendingBalance,
        lifetimeWithdrawn: user.wallet.lifetimeWithdrawn
    };
}

async function failWithdrawal(user, amount, transferCode) {
    const currentUser = await User.findById(user._id).select('wallet.balance wallet.pendingBalance');
    if (!currentUser) throw new Error('User not found');

    const pendingBefore = currentUser.wallet.pendingBalance || 0;
    if (pendingBefore < amount) throw new Error('Insufficient pending balance to reverse');

    const balanceBefore = currentUser.wallet.balance;

    const result = await User.findOneAndUpdate(
        { _id: user._id, 'wallet.pendingBalance': pendingBefore },
        {
            $set: {
                'wallet.balance': balanceBefore + amount,
                'wallet.pendingBalance': pendingBefore - amount
            }
        },
        { new: true }
    );

    if (!result) throw new Error('Concurrent withdrawal failure detected. Please retry.');

    user.wallet.balance = balanceBefore + amount;
    user.wallet.pendingBalance = pendingBefore - amount;

    const Transfer = mongoose.model('Transaction');
    const LedgerEntry = mongoose.model('LedgerEntry');

    await Transfer.updateOne(
        { 'metadata.paystackTransferCode': transferCode },
        { $set: { status: 'failed' } }
    );

    await LedgerEntry.updateOne(
        { 'metadata.paystackTransferCode': transferCode },
        {
            $set: {
                status: 'failed',
                'metadata.description': 'Withdrawal failed — reversed'
            }
        }
    );

    return {
        balance: user.wallet.balance,
        pendingBalance: user.wallet.pendingBalance
    };
}

async function reconcileWallet(user) {
    const LedgerEntry = mongoose.model('LedgerEntry');
    const entries = await LedgerEntry.find({ user: user._id }).sort({ createdAt: 1 });

    let computedBalance = 0;
    let computedLifetimeEarned = 0;
    let computedPendingBalance = user.wallet.pendingBalance || 0;
    let computedLifetimeWithdrawn = user.wallet.lifetimeWithdrawn || 0;

    for (const entry of entries) {
        if (entry.status === 'completed') {
            computedBalance = entry.balanceAfter;
            if (['read_reward', 'achievement', 'referral', 'streak_bonus', 'signup_bonus'].includes(entry.type)) {
                computedLifetimeEarned = Math.max(computedLifetimeEarned, entry.balanceAfter);
            }
            if (entry.type === 'withdrawal_approved') {
                computedLifetimeWithdrawn = Math.max(computedLifetimeWithdrawn, computedLifetimeWithdrawn + entry.amount);
            }
        }
    }

    const drift = Math.abs((user.wallet.balance || 0) - computedBalance);

    user.wallet.balance = computedBalance;
    user.wallet.lifetimeEarned = computedLifetimeEarned;
    user.wallet.balanceLastSynced = new Date();
    await user.save();

    return {
        reconciled: computedBalance,
        drift,
        driftSignificant: drift > 0.01
    };
}

module.exports = {
    addReward,
    requestWithdrawal,
    completeWithdrawal,
    failWithdrawal,
    reconcileWallet
};
