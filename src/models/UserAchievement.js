const mongoose = require('mongoose');

const userAchievementSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    achievement: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Achievement',
        required: true
    },
    earnedAt: {
        type: Date,
        default: Date.now
    },
    rewardClaimed: {
        type: Boolean,
        default: false
    }
});

userAchievementSchema.index({ user: 1, achievement: 1 }, { unique: true });
userAchievementSchema.index({ user: 1, earnedAt: -1 });

const UserAchievement = mongoose.model('UserAchievement', userAchievementSchema);

module.exports = UserAchievement;