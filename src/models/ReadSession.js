const mongoose = require('mongoose');
const Credit = require('./Credit');
const debug = require('../logger/debug');

const READ_REWARD = 500;

let User;
let Post;
let Transaction;
let LedgerEntry;
let NotificationService;
let AchievementService;

function getModels() {
    if (!User) User = mongoose.model('User');
    if (!Post) Post = mongoose.model('Post');
    if (!Transaction) Transaction = mongoose.model('Transaction');
    if (!LedgerEntry) LedgerEntry = mongoose.model('LedgerEntry');
    if (!NotificationService) NotificationService = require('../services/NotificationService');
    if (!AchievementService) AchievementService = require('../services/AchievementService');
}

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

readSessionSchema.methods.markCompleted = async function () {
    getModels();

    this.completed = true;
    this.endedAt = new Date();

    if (this.startedAt) {
        const diff = Math.floor((this.endedAt - this.startedAt) / 1000);
        if (diff > 0) {
            this.timeSpentSeconds = diff;
        }
    }

    const reward = this.calculateReward();

    if (reward <= 0) {
        await this.save();
        return 0;
    }

    const ReaderRewardService = require('../services/ads/ReaderRewardService');
    const currentUser = await User.findById(this.user).select('wallet.balance wallet.lifetimeEarned stats.totalReads stats.lastReadDate stats.streak stats.longestStreak');
    if (!currentUser) {
        await this.save();
        return 0;
    }

    let paidReward;
    try {
        const result = await ReaderRewardService.processReadCompletion(currentUser, this);
        paidReward = result.amount;
    } catch (err) {
        console.error('[ReadSession] Reward failed:', err.message);
        this.rewardAwarded = false;
        this.rewardAmount = 0;
        await this.save();
        return 0;
    }

    this.rewardAwarded = true;
    this.rewardAmount = paidReward;

    const balanceBefore = currentUser.wallet.balance;
    const balanceAfter = balanceBefore + paidReward;

    const today = new Date();
    const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    let newStreak = currentUser.stats.streak;
    let newLongestStreak = currentUser.stats.longestStreak;

    if (!currentUser.stats.lastReadDate) {
        newStreak = 1;
    } else {
        const lastReadDate = new Date(currentUser.stats.lastReadDate);
        const lastReadNormalized = new Date(lastReadDate.getFullYear(), lastReadDate.getMonth(), lastReadDate.getDate());
        const diffMs = todayDate - lastReadNormalized;
        const diffDays = Math.floor(diffMs / 86400000);
        if (diffDays === 1) {
            newStreak += 1;
            if (newStreak > newLongestStreak) {
                newLongestStreak = newStreak;
            }
        } else if (diffDays > 1) {
            newStreak = 1;
        }
    }

    await User.findOneAndUpdate(
        { _id: this.user },
        {
            $inc: { 'stats.totalReads': 1 },
            $set: { 'stats.streak': newStreak, 'stats.longestStreak': newLongestStreak, 'stats.lastReadDate': new Date() }
        }
    );

    try {
        const action = this.timeSpentSeconds >= 60 ? 'READ_60S' : 'READ_30S';
        await Credit.earnCredit(this.user, action, { postId: this.post });
    } catch (err) {
        console.error('[ReadSession] Failed to award read credit:', err.message);
    }

    await Transaction.create({
        user: this.user,
        type: 'read_reward',
        amount: paidReward,
        balanceBefore,
        balanceAfter,
        description: `Reward for reading article`,
        status: 'completed',
        relatedRead: this._id
    });

    try {
        const newAchievements = await AchievementService.checkReadingAchievements(this.user);
        for (const ach of newAchievements) {
            debug(`User ${this.user} earned achievement: ${ach.achievement.name}`);
        }
    } catch (err) {
        console.error('[ReadSession] Failed to check achievements:', err.message);
    }

    try {
        const readPost = await Post.findById(this.post);
        if (readPost && readPost.author && readPost.author.toString() !== this.user.toString()) {
            const action = this.timeSpentSeconds >= 60 ? 'READ_60S' : 'READ_30S';
            await Credit.earnCredit(readPost.author, action, { postId: this.post });
        }
        if (readPost) {
            readPost.stats.reads = (readPost.stats.reads || 0) + 1;
            readPost.stats.earnings = (readPost.stats.earnings || 0) + paidReward;
            await readPost.save();
        }
    } catch (err) {
        console.error('[ReadSession] Failed to update post stats:', err.message);
    }

    await this.save();
    return paidReward;
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