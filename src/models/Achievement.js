const mongoose = require('mongoose');

const achievementSchema = new mongoose.Schema({
    slug: {
        type: String,
        required: true,
        unique: true,
        lowercase: true
    },
    name: {
        type: String,
        required: true
    },
    description: {
        type: String,
        required: true
    },
    icon: {
        type: String,
        default: 'trophy'
    },
    category: {
        type: String,
        enum: ['reading', 'streak', 'referral', 'social', 'milestone'],
        default: 'milestone'
    },
    requirement: {
        type: Number,
        required: true
    },
    reward: {
        type: Number,
        default: 0
    },
    rarity: {
        type: String,
        enum: ['common', 'rare', 'epic', 'legendary'],
        default: 'common'
    }
});

achievementSchema.statics.getDefinitions = function() {
    return [
        {
            slug: 'first-read',
            name: 'First Steps',
            description: 'Read your first article',
            icon: 'book-open',
            category: 'reading',
            requirement: 1,
            reward: 10,
            rarity: 'common'
        },
        {
            slug: 'bookworm',
            name: 'Bookworm',
            description: 'Read 10 articles',
            icon: 'book',
            category: 'reading',
            requirement: 10,
            reward: 25,
            rarity: 'common'
        },
        {
            slug: 'scholar',
            name: 'Scholar',
            description: 'Read 50 articles',
            icon: 'graduation-cap',
            category: 'reading',
            requirement: 50,
            reward: 50,
            rarity: 'rare'
        },
        {
            slug: 'sage',
            name: 'Sage of Nook',
            description: 'Read 100 articles',
            icon: 'star',
            category: 'reading',
            requirement: 100,
            reward: 100,
            rarity: 'epic'
        },
        {
            slug: 'streak-3',
            name: 'Getting Started',
            description: 'Maintain a 3-day reading streak',
            icon: 'fire',
            category: 'streak',
            requirement: 3,
            reward: 15,
            rarity: 'common'
        },
        {
            slug: 'streak-7',
            name: 'Week Warrior',
            description: 'Maintain a 7-day reading streak',
            icon: 'flame',
            category: 'streak',
            requirement: 7,
            reward: 30,
            rarity: 'rare'
        },
        {
            slug: 'streak-30',
            name: 'Monthly Master',
            description: 'Maintain a 30-day reading streak',
            icon: 'crown',
            category: 'streak',
            requirement: 30,
            reward: 100,
            rarity: 'epic'
        },
        {
            slug: 'referrer-1',
            name: 'Influencer',
            description: 'Refer 1 Friend',
            icon: 'users',
            category: 'referral',
            requirement: 1,
            reward: 50,
            rarity: 'common'
        },
        {
            slug: 'referrer-5',
            name: 'Word Spreader',
            description: 'Refer 5 Friends',
            icon: 'share',
            category: 'referral',
            requirement: 5,
            reward: 100,
            rarity: 'rare'
        },
        {
            slug: 'rich',
            name: 'High Earner',
            description: 'Earn ₦500 in total',
            icon: 'coins',
            category: 'milestone',
            requirement: 500,
            reward: 50,
            rarity: 'rare'
        },
        {
            slug: 'tycoon',
            name: 'Tycoon',
            description: 'Earn ₦1000 in total',
            icon: 'diamond',
            category: 'milestone',
            requirement: 1000,
            reward: 100,
            rarity: 'epic'
        }
    ];
};

achievementSchema.statics.initialize = async function() {
    const definitions = this.getDefinitions();
    const existing = await this.countDocuments();

    if (existing === 0) {
        await this.insertMany(definitions);
        console.log('Achievements initialized');
    }
};

const Achievement = mongoose.model('Achievement', achievementSchema);

module.exports = Achievement;