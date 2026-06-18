const mongoose = require('mongoose');

const withdrawalMetadataSchema = new mongoose.Schema({
    paystackTransferCode: { type: String },
    paystackRecipientCode: { type: String },
    method: { type: String, enum: ['bank', 'mpesa', 'airtime'] },
    accountNumber: { type: String },
    bankName: { type: String }
}, { _id: false, strict: true });

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
        required: true  // stored in kobo
    },
    balanceAfter: {
        type: Number,
        required: true  // kobo
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
        type: withdrawalMetadataSchema,
        default: () => ({})
    }
}, {
    timestamps: true
});

transactionSchema.index({ user: 1, createdAt: -1 });
transactionSchema.index({ type: 1 });
transactionSchema.index({ status: 1 });

const Transaction = mongoose.model('Transaction', transactionSchema);

module.exports = Transaction;
