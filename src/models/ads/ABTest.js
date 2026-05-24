const mongoose = require('mongoose');

const variantSchema = new mongoose.Schema({
    name: { type: String, required: true },
    trafficPercentage: { type: Number, required: true, min: 0, max: 100 },
    adConfigIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'AdConfig' }],
    placementOverrides: {
        type: Map,
        of: {
            position: Number,
            minSessionAge: Number,
            minReadsBeforeShow: Number
        }
    },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
});

const abTestSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    status: { type: String, enum: ['draft', 'running', 'paused', 'completed'], default: 'draft' },
    startDate: { type: Date },
    endDate: { type: Date },
    primaryMetric: { type: String, enum: ['impressions', 'clicks', 'revenue', 'ctr', 'viewability'], default: 'ctr' },
    variants: [variantSchema],
    targetSampleSize: { type: Number },
    minSampleSize: { type: Number, default: 1000 }
}, { timestamps: true });

abTestSchema.index({ status: 1 });

const ABTest = mongoose.model('ABTest', abTestSchema);
module.exports = ABTest;