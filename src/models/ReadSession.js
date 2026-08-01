const mongoose = require('mongoose');

const READ_REWARD = 500;

const readSessionSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    post: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Post',
        required: true
    },
    startedAt: {
        type: Date,
        default: Date.now
    },
    endedAt: {
        type: Date,
        default: null
    },
    timeSpentSeconds: {
        type: Number,
        default: 0
    },
    completed: {
        type: Boolean,
        default: false
    },
    rewardAwarded: {
        type: Boolean,
        default: false
    },
    rewardAmount: {
        type: Number,
        default: 0
    },
    startingBalance: {
        type: Number,
        default: null
    },
    scrollProgress: {
        type: Number,
        default: 0,
        min: 0,
        max: 100
    },
    isUnfunded: {
        type: Boolean,
        default: false
    },
    poolPayoutAt: {
        type: Date,
        default: null
    },
    userPendingCount: {
        type: Number,
        default: 0
    }
}, {
    timestamps: true
});

readSessionSchema.index({ user: 1, post: 1 });
readSessionSchema.index({ user: 1, startedAt: -1 });
readSessionSchema.index({ completed: 1, rewardAwarded: 1 });

readSessionSchema.pre('save', async function (next) {
    if (this.isNew && (this.startingBalance === undefined || this.startingBalance === null)) {
        try {
            const UserModel = mongoose.model('User');
            const user = await UserModel.findById(this.user).select('wallet.balance').lean();
            if (user) {
                this.startingBalance = user.wallet.balance;
            }
        } catch (err) {
            console.error('Failed to capture startingBalance:', err.message);
        }
    }
    next();
});

readSessionSchema.methods.calculateReward = function () {
    if (this.completed && !this.rewardAwarded) {
        return READ_REWARD;
    }
    return 0;
};

readSessionSchema.methods.markCompleted = async function ({ rewardAwarded = false, rewardAmount = 0 } = {}) {
    this.completed = true;
    this.endedAt = new Date();

    if (this.startedAt) {
        const diff = Math.floor((this.endedAt - this.startedAt) / 1000);
        if (diff > 0) {
            this.timeSpentSeconds = diff;
        }
    }

    this.rewardAwarded = rewardAwarded;
    this.rewardAmount = rewardAmount;
    await this.save();
    return rewardAmount;
};

readSessionSchema.statics.getTodayReads = async function (userId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return await this.countDocuments({
        user: userId,
        startedAt: { $gte: today },
        completed: true
    });
};

readSessionSchema.statics.getRecentReads = async function (userId, limit = 10) {
    return await this.find({ user: userId })
        .sort({ startedAt: -1 })
        .limit(limit)
        .populate('post', 'title slug summary image');
};

const ReadSession = mongoose.model('ReadSession', readSessionSchema);

module.exports = ReadSession;