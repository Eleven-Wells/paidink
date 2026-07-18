const mongoose = require('mongoose');

const providerConfigSchema = new mongoose.Schema({
    enabled: { type: Boolean, default: false },
    settings: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { _id: false });

const adsSettingsSchema = new mongoose.Schema({
    adsEnabled: { type: Boolean, default: true },
    activeProvider: { type: String, default: 'mock' },
    rotationStrategy: { type: String, enum: ['none', 'random', 'round-robin', 'weighted'], default: 'none' },
    providers: { type: Map, of: providerConfigSchema, default: () => ({}) }
}, { timestamps: true });

adsSettingsSchema.index({ createdAt: 1 });

module.exports = mongoose.model('AdsSettings', adsSettingsSchema);
