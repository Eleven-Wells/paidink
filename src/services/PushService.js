const webpush = require('web-push');
const PushSubscription = require('../models/PushSubscription');
const SystemConfig = require('../models/SystemConfig');
const mongoose = require('mongoose');

const VAPID_KEYS_CONFIG_KEY = 'vapid_keys';

async function ensureVapidKeys() {
    let config = await SystemConfig.findOne({ key: VAPID_KEYS_CONFIG_KEY });

    if (config && config.value.publicKey && config.value.privateKey) {
        webpush.setVapidDetails(
            'mailto:push@paidink.com',
            config.value.publicKey,
            config.value.privateKey
        );
        return;
    }

    const keys = webpush.generateVAPIDKeys();

    if (config) {
        config.value = keys;
        await config.save();
    } else {
        config = await SystemConfig.create({
            key: VAPID_KEYS_CONFIG_KEY,
            value: keys
        });
    }

    webpush.setVapidDetails(
        'mailto:push@paidink.com',
        config.value.publicKey,
        config.value.privateKey
    );
}

function getVapidPublicKey() {
    return webpush.getVapidKeys ? webpush.getVapidKeys().publicKey : null;
}

async function sendNotification(userId, title, body, url) {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
        throw new Error('Invalid userId');
    }

    await ensureVapidKeys();

    const subscriptions = await PushSubscription.find({ userId });

    if (!subscriptions.length) return;

    const payload = JSON.stringify({ title, body, url });

    const results = await Promise.allSettled(
        subscriptions.map(async (sub) => {
            try {
                await webpush.sendNotification({
                    endpoint: sub.endpoint,
                    keys: {
                        p256dh: sub.keys.p256dh,
                        auth: sub.keys.auth
                    }
                }, payload);
                return 'sent';
            } catch (err) {
                if (err.statusCode === 410 || err.statusCode === 404) {
                    try {
                        await PushSubscription.deleteOne({ _id: sub._id });
                    } catch (deleteErr) {
                        console.error('Failed to delete expired push subscription:', deleteErr.message);
                    }
                    return 'removed';
                }
                throw err;
            }
        })
    );

    return results.map((r, i) => ({
        endpoint: subscriptions[i].endpoint,
        status: r.status === 'fulfilled' ? r.value : 'failed',
        error: r.status === 'rejected' ? (r.reason?.message || 'Unknown error') : null
    }));
}

module.exports = {
    ensureVapidKeys,
    getVapidPublicKey,
    sendNotification
};
