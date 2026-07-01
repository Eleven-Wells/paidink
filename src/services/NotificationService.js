const Notification = require('../models/Notification');
const notificationEmitter = require('./NotificationEmitter');
const PushService = require('./PushService');

async function createNotification(userId, type, title, message, data = {}) {
    const notification = await Notification.create({
        user: userId,
        type,
        title,
        message,
        data
    });
    notificationEmitter.emitNotification(String(userId), {
        _id: notification._id,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        data: notification.data,
        createdAt: notification.createdAt,
        read: false
    });
    setImmediate(async () => {
        try {
            const results = await PushService.sendNotification(userId, title, message, data?.url || '/');
            const failed = results.filter((r) => r.status === 'failed');
            if (failed.length) {
                console.error('Push notification partial failure:', failed.map((r) => ({ endpoint: r.endpoint.slice(0, 30) + '...', error: r.error })));
            }
        } catch (err) {
            console.error('Push notification failed:', err.message);
        }
    });
    return notification;
}

async function getNotifications(userId, options = {}) {
    const { limit = 50, unreadOnly = false } = options;

    const query = { user: userId };
    if (unreadOnly) {
        query.read = false;
    }

    return await Notification.find(query)
        .sort({ createdAt: -1 })
        .limit(limit);
}

async function markAsRead(notificationId, userId) {
    return await Notification.findOneAndUpdate(
        { _id: notificationId, user: userId },
        { read: true }
    );
}

async function markAllAsRead(userId) {
    return await Notification.updateMany(
        { user: userId, read: false },
        { read: true }
    );
}

async function getUnreadCount(userId) {
    return await Notification.countDocuments({ user: userId, read: false });
}

async function notifyReward(userId, amount, source = 'reading') {
    const nairaAmount = (amount / 100).toFixed(2);
    const titles = {
        reading: 'Reward Earned!',
        referral: 'Referral Bonus!',
        signup_bonus: 'Welcome Bonus!'
    };

    const messages = {
        reading: `You earned ₦${nairaAmount} for reading articles`,
        referral: `You earned ₦${nairaAmount} for referring a friend`,
        signup_bonus: `Welcome bonus of ₦${nairaAmount} credited to your account`
    };

    return await createNotification(
        userId,
        'reward',
        titles[source] || 'Reward Earned!',
        messages[source] || `You earned ₦${nairaAmount}`,
        { amount, source }
    );
}

async function notifyReferral(userId, referrerName, refereeEmail) {
    const message = `${refereeEmail} used your referral code to sign up! You earned ₦50 reward.`;

    return await createNotification(
        userId,
        'referral',
        'New Referral!',
        message,
        { referrerName, refereeEmail }
    );
}

async function notifyWithdrawal(userId, amount, method) {
    const methodNames = {
        bank: 'bank transfer',
        mpesa: 'M-Pesa',
        airtime: 'airtime'
    };

    const message = `Your withdrawal request of ₦${amount} via ${methodNames[method] || method} is being processed.`;

    return await createNotification(
        userId,
        'withdrawal',
        'Withdrawal Requested',
        message,
        { amount, method }
    );
}

module.exports = {
    createNotification,
    getNotifications,
    markAsRead,
    markAllAsRead,
    getUnreadCount,
    notifyReward,
    notifyReferral,
    notifyWithdrawal
};