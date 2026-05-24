const mongoose = require('mongoose');

const ledgerEntrySchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
        index: true
    },
    type: {
        type: String,
        enum: [
            'read_reward',
            'achievement',
            'withdrawal',
            'withdrawal_approved',
            'referral',
            'streak_bonus',
            'signup_bonus',
            'credit_payout',
            'correction',
            'ad_revenue_reader_pool',
            'ad_revenue_publisher',
            'ad_revenue_reserve',
            'ad_revenue_operational',
            'reader_reward_payout',
            'publisher_settlement',
            'reserve_unlock'
        ],
        required: true
    },
    amount: {
        type: Number,
        required: true
    },
    balanceBefore: {
        type: Number,
        default: 0
    },
    balanceAfter: {
        type: Number,
        default: 0
    },
    referenceId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null
    },
    referenceModel: {
        type: String,
        enum: ['ReadSession', 'UserAchievement', 'Transaction', 'PayoutDetail', 'AdEvent', 'LedgerEntry', null],
        default: null
    },
    status: {
        type: String,
        enum: ['completed', 'pending', 'failed'],
        default: 'completed'
    },
    fundedBy: {
        type: String,
        enum: ['ad_revenue', 'system', 'reader_pool', 'publisher_pool', null],
        default: null
    },
    correlationId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
        index: true
    },
    correlationModel: {
        type: String,
        enum: ['AdEvent', 'ReadSession', 'Withdrawal', null],
        default: null
    },
    pool: {
        type: String,
        enum: ['reader_pool', 'publisher_pool', 'org_reserve', 'org_operational', 'user_wallet', null],
        default: null
    },
    metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    }
}, {
    timestamps: true
});

ledgerEntrySchema.index({ user: 1, createdAt: -1 });
ledgerEntrySchema.index({ type: 1 });
ledgerEntrySchema.index({ status: 1 });
ledgerEntrySchema.index({ referenceModel: 1, referenceId: 1 });
ledgerEntrySchema.index({ pool: 1 });
ledgerEntrySchema.index({ correlationModel: 1, correlationId: 1 });

const LedgerEntry = mongoose.model('LedgerEntry', ledgerEntrySchema);

module.exports = LedgerEntry;
