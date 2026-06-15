const mongoose = require('mongoose');

const AppReviewSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    rating: {
        type: Number,
        required: true,
        min: 1,
        max: 5
    },
    feedback: {
        type: String,
        required: true,
        trim: true,
        maxLength: 2000
    },
    context: {
        path: {
            type: String,
            trim: true,
            maxLength: 300,
            default: ''
        },
        userAgent: {
            type: String,
            trim: true,
            maxLength: 500,
            default: ''
        }
    },
    discordDelivery: {
        status: {
            type: String,
            enum: ['pending', 'skipped', 'sent', 'failed'],
            default: 'pending'
        },
        sentAt: {
            type: Date,
            default: null
        },
        error: {
            type: String,
            trim: true,
            maxLength: 500,
            default: ''
        }
    }
}, {
    timestamps: true
});

AppReviewSchema.index({ user: 1, createdAt: -1 });
AppReviewSchema.index({ rating: 1, createdAt: -1 });
AppReviewSchema.index({ createdAt: -1 });
AppReviewSchema.index({ 'discordDelivery.status': 1, createdAt: -1 });

AppReviewSchema.set('toJSON', {
    virtuals: true,
    transform: (doc, ret) => {
        delete ret.__v;
        return ret;
    }
});

module.exports = mongoose.model('AppReview', AppReviewSchema);
