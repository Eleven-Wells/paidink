const mongoose = require('mongoose');

const adProviderSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    type: { type: String, required: true, trim: true },
    enabled: { type: Boolean, default: true },
    status: { type: String, enum: ['unknown', 'healthy', 'warning', 'failed'], default: 'unknown' },
    config: { type: mongoose.Schema.Types.Mixed, default: {} },
    lastHealthCheck: { type: Date, default: null }
}, { timestamps: true });

adProviderSchema.index({ name: 1 }, { unique: true });
adProviderSchema.index({ enabled: 1 });

module.exports = mongoose.model('AdProvider', adProviderSchema);
