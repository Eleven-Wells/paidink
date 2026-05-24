const mongoose = require('mongoose');

const ContentSourceSchema = new mongoose.Schema({
    name: { type: String, required: true },
    url: { type: String, required: true },
    type: { type: String, enum: ['rss', 'url'], required: true },
    active: { type: Boolean, default: true },
    lastFetched: { type: Date }
});

module.exports = mongoose.model('ContentSource', ContentSourceSchema);