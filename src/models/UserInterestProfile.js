const mongoose = require('mongoose');

const UserInterestProfileSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true,
        index: true
    },
    categoryAffinity: {
        type: Map,
        of: Number,
        default: {}
    },
    tagAffinity: {
        type: Map,
        of: Number,
        default: {}
    },
    publisherAffinity: {
        type: Map,
        of: Number,
        default: {}
    },
    totalReads: {
        type: Number,
        default: 0
    },
    lastReadAt: {
        type: Date,
        default: null
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('UserInterestProfile', UserInterestProfileSchema);
