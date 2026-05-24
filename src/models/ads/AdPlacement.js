const mongoose = require('mongoose');

const adPlacementSchema = new mongoose.Schema({
    name: { type: String, required: true },
    slot: { type: String, required: true, enum: ['banner', 'sidebar', 'feed', 'interstitial', 'native', 'rewarded'] },
    position: { type: Number, required: true },
    minSessionAge: { type: Number, default: 0 },
    minReadsBeforeShow: { type: Number, default: 0 },
    active: { type: Boolean, default: true }
}, { timestamps: true });

adPlacementSchema.index({ slot: 1, position: 1 });

const AdPlacement = mongoose.model('AdPlacement', adPlacementSchema);
module.exports = AdPlacement;