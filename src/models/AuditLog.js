const mongoose = require('mongoose');

const AuditLogSchema = new mongoose.Schema({
    action: {
        type: String,
        required: true,
        index: true
    },
    method: {
        type: String,
        enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
        index: true
    },
    url: {
        type: String,
        required: true
    },
    ip: {
        type: String,
        index: true
    },
    userAgent: {
        type: String
    },
    requestId: {
        type: String,
        index: true
    },
    adminAuth: {
        authenticated: Boolean,
        ip: String,
        requestId: String,
        timestamp: String
    },
    details: {
        type: mongoose.Schema.Types.Mixed
    },
    level: {
        type: String,
        enum: ['debug', 'info', 'warn', 'error'],
        default: 'info'
    },
    timestamp: {
        type: Date,
        default: Date.now,
        index: true
    }
});

AuditLogSchema.index({ timestamp: -1 });
AuditLogSchema.index({ action: 1, timestamp: -1 });
AuditLogSchema.index({ ip: 1, timestamp: -1 });

AuditLogSchema.statics.findByAction = function(action, options = {}) {
    const { limit = 100, startDate, endDate } = options;
    const query = { action };

    if (startDate || endDate) {
        query.timestamp = {};
        if (startDate) query.timestamp.$gte = startDate;
        if (endDate) query.timestamp.$lte = endDate;
    }

    return this.find(query)
        .sort({ timestamp: -1 })
        .limit(limit);
};

AuditLogSchema.statics.findByIP = function(ip, options = {}) {
    const { limit = 100, startDate } = options;
    const query = { ip };

    if (startDate) {
        query.timestamp = { $gte: startDate };
    }

    return this.find(query)
        .sort({ timestamp: -1 })
        .limit(limit);
};

AuditLogSchema.statics.findSecurityEvents = function(options = {}) {
    const { limit = 100, severity } = options;
    const query = { action: /^security:/ };

    if (severity) {
        query.level = severity;
    }

    return this.find(query)
        .sort({ timestamp: -1 })
        .limit(limit);
};

AuditLogSchema.statics.cleanupOldLogs = async function(daysToKeep = 90) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const result = await this.deleteMany({
        timestamp: { $lt: cutoffDate },
        action: { $not: /^security:/ }
    });

    return result.deletedCount;
};

AuditLogSchema.methods.toJSON = function() {
    const obj = this.toObject();
    delete obj.__v;
    return obj;
};

module.exports = mongoose.model('AuditLog', AuditLogSchema);
