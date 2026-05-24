const mongoose = require('mongoose');
const Achievement = require('../models/Achievement');
const UserAchievement = require('../models/UserAchievement');
const User = require('../models/User');

async function checkAndAwardAchievements(userId, type, currentValue) {
    const achievements = await Achievement.find({
        category: type,
        requirement: { $lte: currentValue }
    });

    const earned = await UserAchievement.find({ user: userId });
    const earnedIds = earned.map(e => e.achievement.toString());

    const newAchievements = [];
    const eligible = achievements.filter(a => !earnedIds.includes(a._id.toString()));

    for (const achievement of eligible) {
        if (currentValue >= achievement.requirement) {
            const userAchievement = await UserAchievement.create({
                user: userId,
                achievement: achievement._id
            });

            let rewardClaimed = false;
            if (achievement.reward > 0) {
                const user = await User.findById(userId);
                if (user) {
                    const balanceBefore = user.wallet.balance;
                    user.wallet.balance += achievement.reward;
                    user.wallet.lifetimeEarned += achievement.reward;
                    const balanceAfter = user.wallet.balance;
                    await user.save();

                    const Transaction = mongoose.model('Transaction');
                    await Transaction.create({
                        user: userId,
                        type: 'achievement',
                        amount: achievement.reward,
                        balanceBefore,
                        balanceAfter,
                        description: `Achievement: ${achievement.name}`,
                        status: 'completed'
                    });

                    const LedgerEntry = mongoose.model('LedgerEntry');
                    await LedgerEntry.create({
                        user: userId,
                        type: 'achievement',
                        amount: achievement.reward,
                        balanceBefore,
                        balanceAfter,
                        referenceId: userAchievement._id,
                        referenceModel: 'UserAchievement',
                        status: 'completed',
                        metadata: { achievementName: achievement.name }
                    });

                    userAchievement.rewardClaimed = true;
                    await userAchievement.save();
                    rewardClaimed = true;
                }
            }

            newAchievements.push({
                achievement: achievement,
                rewardClaimed,
                rewardAmount: achievement.reward
            });
        }
    }

    return newAchievements;
}

async function checkReadingAchievements(userId) {
    const User = require('../models/User');
    const ReadSession = require('../models/ReadSession');

    const totalReads = await ReadSession.countDocuments({
        user: userId,
        completed: true
    });

    return checkAndAwardAchievements(userId, 'reading', totalReads);
}

async function checkStreakAchievements(userId) {
    const User = require('../models/User');
    const user = await User.findById(userId);

    if (!user) return [];

    return checkAndAwardAchievements(userId, 'streak', user.stats.streak);
}

async function checkMilestoneAchievements(userId) {
    const User = require('../models/User');
    const user = await User.findById(userId);

    if (!user) return [];

    return checkAndAwardAchievements(userId, 'milestone', user.wallet.lifetimeEarned);
}

async function checkReferralAchievements(userId, newReferralCount) {
    return checkAndAwardAchievements(userId, 'referral', newReferralCount);
}

async function getUserAchievements(userId) {
    const userAchievements = await UserAchievement.find({ user: userId })
        .populate('achievement')
        .sort({ earnedAt: -1 });

    return userAchievements;
}

async function getUnlockedCount(userId) {
    return await UserAchievement.countDocuments({ user: userId });
}

async function initializeAchievements() {
    await Achievement.initialize();
}

module.exports = {
    checkReadingAchievements,
    checkStreakAchievements,
    checkMilestoneAchievements,
    checkReferralAchievements,
    getUserAchievements,
    getUnlockedCount,
    initializeAchievements
};