const mongoose = require('mongoose');

const frequencyRuleSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    slot: { type: String, required: true, enum: ['banner', 'sidebar', 'feed', 'interstitial', 'native', 'rewarded'] },
    maxPerSession: { type: Number, default: 10 },
    minIntervalSeconds: { type: Number, default: 30 },
    dailyLimit: { type: Number },
    weeklyLimit: { type: Number },
    excludeAfterRewardClaim: { type: Boolean, default: false },
    active: { type: Boolean, default: true }
}, { timestamps: true });

const FrequencyRule = mongoose.model('FrequencyRule', frequencyRuleSchema);
module.exports = FrequencyRule;