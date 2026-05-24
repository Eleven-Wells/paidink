const mongoose = require('mongoose');

const adEventSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    adConfig: { type: mongoose.Schema.Types.ObjectId, ref: 'AdConfig', index: true },
    placement: { type: mongoose.Schema.Types.ObjectId, ref: 'AdPlacement', index: true },
    session: { type: mongoose.Schema.Types.ObjectId, ref: 'ReadSession' },
    type: {
        type: String,
        required: true,
        enum: ['impression', 'view', 'click', 'conversion', 'reward_claimed']
    },
    revenue: { type: Number, default: 0 },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    country: { type: String },
    deviceType: { type: String, enum: ['mobile', 'tablet', 'desktop', null] },
    browser: { type: String },
    abTestGroup: { type: String },
    createdAt: { type: Date, default: Date.now }
}, {
    timestamps: true
});

adEventSchema.index({ user: 1, type: 1, createdAt: -1 });
adEventSchema.index({ adConfig: 1, type: 1, createdAt: -1 });
adEventSchema.index({ type: 1, createdAt: -1 });
adEventSchema.index({ abTestGroup: 1, type: 1 });

const AdEvent = mongoose.model('AdEvent', adEventSchema);
module.exports = AdEvent;