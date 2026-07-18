const mongoose = require('mongoose');

const adsSettingsSchema = new mongoose.Schema({
    adsEnabled: { type: Boolean, default: true },
    activeProviderId: { type: mongoose.Schema.Types.ObjectId, ref: 'AdProvider', default: null },
    rotationStrategy: { type: String, enum: ['none', 'random', 'round-robin', 'weighted'], default: 'none' }
}, { timestamps: true });

adsSettingsSchema.index({ createdAt: 1 });

module.exports = mongoose.model('AdsSettings', adsSettingsSchema);
