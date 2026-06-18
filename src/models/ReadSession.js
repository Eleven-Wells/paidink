const mongoose = require('mongoose');
const Credit = require('./Credit');

const READ_REWARD = 500;
const MIN_READ_TIME_SECONDS = 30;

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

readSessionSchema.pre('save', async function(next) {
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

readSessionSchema.methods.calculateReward = function() {
    if (this.completed && !this.rewardAwarded && this.timeSpentSeconds >= MIN_READ_TIME_SECONDS) {
        return READ_REWARD;
    }
    return 0;
};

readSessionSchema.methods.markCompleted = async function() {
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

    if (reward > 0) {
        const ReaderRewardService = require('../services/ads/ReaderRewardService');
        const poolResult = await ReaderRewardService.payoutReaderReward(this, reward);

        if (!poolResult.paid) {
            this.rewardAwarded = false;
            this.rewardAmount = 0;
            await this.save();
            return 0;
        }

        this.rewardAwarded = true;
        this.rewardAmount = reward;

        try {
            const currentUser = await User.findById(this.user).select('wallet.balance wallet.lifetimeEarned stats.totalReads stats.lastReadDate stats.streak stats.longestStreak');
            if (!currentUser) {
                await this.save();
                return 0;
            }

            const balanceBefore = this.startingBalance !== undefined && this.startingBalance !== null
                ? this.startingBalance
                : currentUser.wallet.balance;
            const balanceAfter = balanceBefore + reward;

            const userResult = await User.findOneAndUpdate(
                { _id: this.user, 'wallet.balance': balanceBefore },
                {
                    $set: {
                        'wallet.balance': balanceAfter,
                        'wallet.lifetimeEarned': currentUser.wallet.lifetimeEarned + reward
                    },
                    $inc: { 'stats.totalReads': 1 }
                },
                { new: true }
            );

            if (!userResult) {
                console.warn('[ReadSession] Concurrent balance update — retrying once',
                    { userId: this.user, readSessionId: this._id, balanceBefore });
                const freshUser = await User.findById(this.user).select('wallet.balance wallet.lifetimeEarned');
                const retryBalanceBefore = freshUser ? freshUser.wallet.balance : balanceBefore;
                const retryResult = await User.findOneAndUpdate(
                    { _id: this.user, 'wallet.balance': retryBalanceBefore },
                    {
                        $set: {
                            'wallet.balance': retryBalanceBefore + reward,
                            'wallet.lifetimeEarned': freshUser ? freshUser.wallet.lifetimeEarned + reward : currentUser.wallet.lifetimeEarned + reward
                        },
                        $inc: { 'stats.totalReads': 1 }
                    },
                    { new: true }
                );
                if (!retryResult) {
                    console.error('[ReadSession] Reward permanently failed after retry',
                        { userId: this.user, readSessionId: this._id });
                    await this.save();
                    return 0;
                }
            }

            try {
                await LedgerEntry.create({
                    user: null,
                    type: 'reader_reward_payout',
                    amount: -reward,
                    balanceBefore: poolResult.poolBalance,
                    balanceAfter: poolResult.poolBalance - reward,
                    status: 'completed',
                    fundedBy: 'reader_pool',
                    correlationId: this._id,
                    correlationModel: 'ReadSession',
                    pool: 'reader_pool',
                    metadata: {
                        readSessionId: this._id,
                        rewardAmount: reward,
                        sweepType: 'immediate'
                    }
                });
            } catch (err) {
                console.error('[ReadSession] Failed to debit reader pool:', err.message);
            }

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
                { $set: { 'stats.streak': newStreak, 'stats.longestStreak': newLongestStreak, 'stats.lastReadDate': new Date() } }
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
                amount: reward,
                balanceBefore,
                balanceAfter,
                description: `Reward for reading article`,
                status: 'completed',
                relatedRead: this._id
            });

            await LedgerEntry.create({
                user: this.user,
                type: 'read_reward',
                amount: reward,
                balanceBefore,
                balanceAfter,
                referenceId: this._id,
                referenceModel: 'ReadSession',
                status: 'completed',
                fundedBy: 'reader_pool',
                pool: 'user_wallet',
                metadata: { postId: this.post, timeSpentSeconds: this.timeSpentSeconds }
            });

            try {
                await NotificationService.notifyReward(this.user, reward, 'reading');
            } catch (err) {
                console.error('[ReadSession] Failed to create reward notification:', err.message);
            }

            try {
                const newAchievements = await AchievementService.checkReadingAchievements(this.user);
                for (const ach of newAchievements) {
                    console.log(`User ${this.user} earned achievement: ${ach.achievement.name}`);
                }
            } catch (err) {
                console.error('[ReadSession] Failed to check achievements:', err.message);
            }

            let post = null;
            try {
                post = await Post.findById(this.post);
                if (post && post.author && post.author.toString() !== this.user.toString()) {
                    const action = this.timeSpentSeconds >= 60 ? 'READ_60S' : 'READ_30S';
                    await Credit.earnCredit(post.author, action, { postId: this.post });
                }
            } catch (err) {
                console.error('[ReadSession] Failed to award author read credit:', err.message);
            }

            if (!post) {
                post = await Post.findById(this.post);
            }
            if (post) {
                post.stats.reads = (post.stats.reads || 0) + 1;
                post.stats.earnings = (post.stats.earnings || 0) + reward;
                await post.save();
            }
        } catch (err) {
            console.error('[ReadSession] Error in markCompleted reward flow:', err.message,
                { userId: this.user, readSessionId: this._id });
            throw err;
        }
    }

    await this.save();
    return reward;
};

readSessionSchema.statics.getTodayReads = async function(userId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return await this.countDocuments({
        user: userId,
        startedAt: { $gte: today },
        completed: true
    });
};

readSessionSchema.statics.getRecentReads = async function(userId, limit = 10) {
    return await this.find({ user: userId })
        .sort({ startedAt: -1 })
        .limit(limit)
        .populate('post', 'title slug summary image');
};

const ReadSession = mongoose.model('ReadSession', readSessionSchema);

module.exports = ReadSession;