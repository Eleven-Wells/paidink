const mongoose = require('mongoose');

const JobLogSchema = new mongoose.Schema({
    jobId: { type: String, required: true },
    status: { type: String, enum: ['success', 'failure'], required: true },
    error: { type: String },
    sourceUrl: { type: String },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('JobLog', JobLogSchema);