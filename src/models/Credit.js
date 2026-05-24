const mongoose = require('mongoose');

const CREDIT_TYPES = {
    CREATION: 'creation',
    ENGAGEMENT: 'engagement',
    REACH: 'reach',
    SOURCE: 'source'
};

const CREDIT_ACTIONS = {
    POST_PUBLISHED: { category: CREDIT_TYPES.CREATION, points: 20, description: 'Published a post' },
    POST_APPROVED: { category: CREDIT_TYPES.CREATION, points: 10, description: 'Post approved' },
    UNIQUE_VIEW: { category: CREDIT_TYPES.ENGAGEMENT, points: 1, description: 'Unique page view' },
    READ_30S: { category: CREDIT_TYPES.ENGAGEMENT, points: 2, description: 'Read for 30+ seconds' },
    READ_60S: { category: CREDIT_TYPES.ENGAGEMENT, points: 4, description: 'Read for 60+ seconds' },
    COMMENT: { category: CREDIT_TYPES.ENGAGEMENT, points: 1, description: 'Left a comment' },
    SHARE_CLICK: { category: CREDIT_TYPES.REACH, points: 3, description: 'Shared post' },
    SCREENSHOT: { category: CREDIT_TYPES.REACH, points: 2, description: 'Screenshot shared' },
    VERIFIED_POST: { category: CREDIT_TYPES.SOURCE, points: 10, description: 'Post verified' },
    FIRST_TO_BREAK: { category: CREDIT_TYPES.SOURCE, points: 20, description: 'First to break story' }
};

const RANK_TIERS = {
    BRONZE: { min: 0, multiplier: 1.0 },
    SILVER: { min: 500, multiplier: 1.25 },
    GOLD: { min: 2000, multiplier: 1.5 },
    INSIDER: { min: 5000, multiplier: 2.0 }
};

const creditSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    action: {
        type: String,
        required: true
    },
    points: {
        type: Number,
        required: true
    },
    category: {
        type: String,
        required: true
    },
    description: String,
    post: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Post',
        default: null
    },
    metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    month: {
        type: String,
        required: true
    },
    status: {
        type: String,
        enum: ['active', 'voided'],
        default: 'active'
    }
}, {
    timestamps: true
});

creditSchema.index({ user: 1, month: -1 });
creditSchema.index({ user: 1, category: 1, month: -1 });
creditSchema.index({ month: 1 });

function getRank(credits) {
    if (credits >= RANK_TIERS.INSIDER.min) return { name: 'INSIDER', multiplier: RANK_TIERS.INSIDER.multiplier };
    if (credits >= RANK_TIERS.GOLD.min) return { name: 'GOLD', multiplier: RANK_TIERS.GOLD.multiplier };
    if (credits >= RANK_TIERS.SILVER.min) return { name: 'SILVER', multiplier: RANK_TIERS.SILVER.multiplier };
    return { name: 'BRONZE', multiplier: RANK_TIERS.BRONZE.multiplier };
}

function getRankMultiplier(credits) {
    return getRank(credits).multiplier;
}

creditSchema.statics.earnCredit = async function(userId, action, options = {}) {
    const actionConfig = CREDIT_ACTIONS[action];
    if (!actionConfig) {
        throw new Error(`Invalid action: ${action}`);
    }
    
    const User = mongoose.model('User');
    const user = await User.findById(userId);
    if (!user) {
        throw new Error('User not found');
    }
    
    const rankMultiplier = getRankMultiplier(user.totalCredits || 0);
    const points = actionConfig.points * rankMultiplier;
    
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    
    const credit = await this.create({
        user: userId,
        action: action,
        points: points,
        category: actionConfig.category,
        description: actionConfig.description,
        post: options.postId || null,
        metadata: options.metadata || {},
        month: month
    });
    
    await User.findByIdAndUpdate(userId, {
        $inc: { totalCredits: points }
    });
    
    return credit;
};

creditSchema.statics.getMonthlyCredits = async function(userId, month) {
    const User = mongoose.model('User');
    const result = await this.aggregate([
        { $match: { user: userId, month: month, status: 'active' } },
        { $group: { _id: '$category', total: { $sum: '$points' } } }
    ]);
    
    const breakdown = {};
    Object.values(CREDIT_TYPES).forEach(type => {
        const found = result.find(r => r._id === type);
        breakdown[type] = found ? found.total : 0;
    });
    
    const total = result.reduce((sum, r) => sum + r.total, 0);
    
    return { ...breakdown, total };
};

creditSchema.statics.getMonthlyPool = function(totalMonthlyRevenue) {
    return totalMonthlyRevenue * 0.6;
};

creditSchema.statics.calculateEarnings = async function(month, totalMonthlyRevenue) {
    const User = mongoose.model('User');
    const contributorPool = totalMonthlyRevenue * 0.6;
    
    const topPerformers = await this.aggregate([
        { $match: { month: month, status: 'active' } },
        { $group: { _id: '$user', credits: { $sum: '$points' } } },
        { $sort: { credits: -1 } },
        { $limit: 100 }
    ]);
    
    const totalCredits = topPerformers.reduce((sum, u) => sum + u.credits, 0);
    
    const earnings = [];
    for (const performer of topPerformers) {
        const share = performer.credits / totalCredits;
        const amount = share * contributorPool;
        const rank = getRank(performer.credits);
        
        earnings.push({
            user: performer._id,
            credits: performer.credits,
            share: share,
            amount: Math.round(amount * 100) / 100,
            rank: rank.name,
            multiplier: rank.multiplier
        });
    }
    
    return {
        month: month,
        totalRevenue: totalMonthlyRevenue,
        orgShare: Math.round(totalMonthlyRevenue * 0.4 * 100) / 100,
        contributorPool: Math.round(contributorPool * 100) / 100,
        totalCredits,
        contributors: earnings
    };
};

creditSchema.statics.getRank = getRank;
creditSchema.statics.getRankMultiplier = getRankMultiplier;

const Credit = mongoose.model('Credit', creditSchema);

module.exports = Credit;