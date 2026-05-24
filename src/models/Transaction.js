const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    type: {
        type: String,
        enum: [
            'ad_reward',
            'article_reward',
            'read_reward',
            'referral_bonus',
            'streak_bonus',
            'signup_bonus',
            'withdrawal',
            'bonus',
            'correction'
        ],
        required: true
    },
    amount: {
        type: Number,
        required: true
    },
    balanceBefore: {
        type: Number,
        required: true
    },
    balanceAfter: {
        type: Number,
        required: true
    },
    reference: String,
    description: {
        type: String,
        required: true
    },
    relatedRead: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ReadSession',
        default: null
    },
    status: {
        type: String,
        enum: ['completed', 'pending', 'failed', 'reversed'],
        default: 'completed'
    },
    metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    }
}, {
    timestamps: true
});

transactionSchema.index({ user: 1, createdAt: -1 });
transactionSchema.index({ type: 1 });
transactionSchema.index({ status: 1 });

const Transaction = mongoose.model('Transaction', transactionSchema);

module.exports = Transaction;
