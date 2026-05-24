const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    type: {
        type: String,
        enum: ['like', 'comment', 'reply', 'follow', 'mention', 'share', 'post', 'reward', 'referral', 'withdrawal', 'system'],
        required: true
    },
    actor: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    target: {
        type: mongoose.Schema.Types.ObjectId,
        refPath: 'targetModel',
        default: null
    },
    targetModel: {
        type: String,
        enum: ['Post', 'Comment', 'User'],
        default: null
    },
    title: {
        type: String,
        required: true
    },
    message: {
        type: String,
        required: true
    },
    read: {
        type: Boolean,
        default: false
    },
    data: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    }
}, {
    timestamps: true
});

notificationSchema.index({ user: 1, read: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);