const ReadSession = require('../models/ReadSession');
const Post = require('../models/Post');
const User = require('../models/User');
const Credit = require('../models/Credit');
const Transaction = require('../models/Transaction');
const AchievementService = require('./AchievementService');
const InterestProfileService = require('./InterestProfileService');
const ReaderRewardService = require('./ads/ReaderRewardService');
const { enforceReadSpeed, WORDS_PER_MINUTE, MIN_READ_SPEED_FRACTION } = require('./readPolicies');

async function completeSession({ userId, sessionId, log = console.error }) {
    const session = await ReadSession.findOne({
        _id: sessionId,
        user: userId,
        completed: false
    });

    if (!session) {
        return null;
    }

    const endedAt = new Date();
    let timeSpentSeconds = 0;
    if (session.startedAt) {
        const diff = Math.floor((endedAt - session.startedAt) / 1000);
        if (diff > 0) {
            timeSpentSeconds = diff;
        }
    }

    session.completed = true;
    session.endedAt = endedAt;
    session.timeSpentSeconds = timeSpentSeconds;

    const postForSpeedCheck = await Post.findById(session.post).select('content').lean();
    if (postForSpeedCheck) {
        const wordCount = postForSpeedCheck.content ? postForSpeedCheck.content.split(/\s+/).length : 0;
        if (!enforceReadSpeed(timeSpentSeconds, wordCount, WORDS_PER_MINUTE, MIN_READ_SPEED_FRACTION)) {
            session.rewardAwarded = false;
            session.rewardAmount = 0;
            await session.save();
            return {
                reason: 'speed_gate',
                timeSpent: timeSpentSeconds,
                rewardAwarded: false,
                rewardAmount: 0
            };
        }
    }

    const reward = session.calculateReward();

    let paidReward = 0;
    let rewardAwarded = false;

    if (reward > 0) {
        const currentUser = await User.findById(session.user).select('wallet.balance wallet.lifetimeEarned stats.totalReads stats.lastReadDate stats.streak stats.longestStreak');

        if (currentUser) {
            let balanceBefore;
            let balanceAfter;
            let rewardSucceeded = false;
            try {
                balanceBefore = currentUser.wallet.balance;
                const result = await ReaderRewardService.processReadCompletion(currentUser, session);
                paidReward = result.amount;
                balanceAfter = currentUser.wallet.balance;
                rewardSucceeded = true;
            } catch (err) {
                log(`[ReadService] Reward failed: ${err.message}`);
                session.rewardAwarded = false;
                session.rewardAmount = 0;
            }

            if (rewardSucceeded) {
                session.rewardAwarded = true;
                session.rewardAmount = paidReward;
                rewardAwarded = true;

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
                    { _id: session.user },
                    {
                        $inc: { 'stats.totalReads': 1 },
                        $set: { 'stats.streak': newStreak, 'stats.longestStreak': newLongestStreak, 'stats.lastReadDate': new Date() }
                    }
                );

                try {
                    const action = session.timeSpentSeconds >= 60 ? 'READ_60S' : 'READ_30S';
                    await Credit.earnCredit(session.user, action, { postId: session.post });
                } catch (err) {
                    log(`[ReadService] Failed to award read credit: ${err.message}`);
                }

                await Transaction.create({
                    user: session.user,
                    type: 'read_reward',
                    amount: paidReward,
                    balanceBefore,
                    balanceAfter,
                    description: 'Reward for reading article',
                    status: 'completed',
                    relatedRead: session._id
                });

                try {
                    const newAchievements = await AchievementService.checkReadingAchievements(session.user);
                    for (const ach of newAchievements) {
                        console.log(`User ${session.user} earned achievement: ${ach.achievement.name}`);
                    }
                } catch (err) {
                    log(`[ReadService] Failed to check achievements: ${err.message}`);
                }

                try {
                    const readPost = await Post.findById(session.post);
                    if (readPost && readPost.author && readPost.author.toString() !== session.user.toString()) {
                        const action = session.timeSpentSeconds >= 60 ? 'READ_60S' : 'READ_30S';
                        await Credit.earnCredit(readPost.author, action, { postId: session.post });
                    }
                    if (readPost) {
                        readPost.stats.reads = (readPost.stats.reads || 0) + 1;
                        readPost.stats.earnings = (readPost.stats.earnings || 0) + paidReward;
                        await readPost.save();
                    }
                } catch (err) {
                    log(`[ReadService] Failed to update post stats: ${err.message}`);
                }
            }
        }
    }

    await session.save();

    try {
        const readPost = await Post.findById(session.post).lean();
        if (readPost) {
            await InterestProfileService.updateOnReadCompletion(
                session.user,
                readPost,
                session.timeSpentSeconds,
                session.completed
            );
        }
    } catch (err) {
        log(`[ReadService] Failed to update interest profile: ${err.message}`);
    }

    return {
        reason: rewardAwarded ? 'rewarded' : 'reward_failed',
        timeSpent: timeSpentSeconds,
        rewardAwarded,
        rewardAmount: rewardAwarded ? paidReward : 0
    };
}

module.exports = {
    completeSession
};
