const mongoose = require('mongoose');

const userInterestProfileSchema = new mongoose.Schema({
    user: {
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

const UserInterestProfile = mongoose.model('UserInterestProfile', userInterestProfileSchema);

module.exports = UserInterestProfile;
