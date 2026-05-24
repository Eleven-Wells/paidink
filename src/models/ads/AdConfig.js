const mongoose = require('mongoose');

const adConfigSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    network: { type: String, required: true, enum: ['simulated', 'admob', 'facebook', 'custom'] },
    type: { type: String, required: true, enum: ['banner', 'interstitial', 'native', 'rewarded', 'video'] },
    weight: { type: Number, default: 1 },
    cpm: { type: Number, default: 0 },
    cpc: { type: Number, default: 0 },
    cpa: { type: Number, default: 0 },
    payoutRate: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
    testMode: { type: Boolean, default: false }
}, { timestamps: true });

adConfigSchema.index({ type: 1, active: 1 });
adConfigSchema.index({ name: 1 });

const AdConfig = mongoose.model('AdConfig', adConfigSchema);
module.exports = AdConfig;