const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const userSchema = new mongoose.Schema({
    email: {
        type: String,
        required: [true, 'Email is required'],
        unique: true,
        lowercase: true,
        trim: true,
        match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email']
    },
    password: {
        type: String,
        minlength: [6, 'Password must be at least 6 characters'],
        select: false
    },
    authUserId: {
        type: String,
        sparse: true,
        unique: true
    },
    authProvider: {
        type: String,
        enum: ['email', 'google', 'twitter', 'discord'],
        default: 'email'
    },
    role: {
        type: String,
        enum: ['reader', 'publisher', 'admin'],
        default: 'reader'
    },
    publisherStatus: {
        type: String,
        enum: ['none', 'pending', 'approved', 'rejected'],
        default: 'none'
    },
    publisherAppliedAt: {
        type: Date
    },
    publisherApprovedAt: {
        type: Date
    },
    publisherNotes: {
        type: String
    },
    username: {
        type: String,
        unique: true,
        sparse: true,
        trim: true,
        minlength: 3,
        maxlength: 30,
        match: [/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers and underscores']
    },
    displayName: {
        type: String,
        trim: true,
        maxlength: 50
    },
    avatar: {
        type: String,
        default: null
    },
    bio: {
        type: String,
        maxlength: 500
    },
    following: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    followers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    savedPosts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Post' }],
    country: {
        type: String,
        default: 'Nigeria'
    },
    phone: {
        type: String,
        trim: true
    },
    wallet: {
        balance: {
            type: Number,
            default: 0  // stored in kobo (1 NGN = 100 kobo)
        },
        pendingBalance: {
            type: Number,
            default: 0  // kobo
        },
        lifetimeEarned: {
            type: Number,
            default: 0  // kobo
        },
        lifetimeWithdrawn: {
            type: Number,
            default: 0  // kobo
        },
        balanceLastSynced: {
            type: Date,
            default: null
        },
        totalReaderRewards: {
            type: Number,
            default: 0
        },
        totalPublisherEarnings: {
            type: Number,
            default: 0
        },
        lastPoolSweepAt: {
            type: Date,
            default: null
        },
        lastSessionStart: {
            type: Date,
            default: null
        }
    },
    totalCredits: {
        type: Number,
        default: 0
    },
    stats: {
        totalReads: {
            type: Number,
            default: 0
        },
        totalAdsViewed: {
            type: Number,
            default: 0
        },
        streak: {
            type: Number,
            default: 0
        },
        longestStreak: {
            type: Number,
            default: 0
        },
        lastReadDate: {
            type: Date,
            default: null
        }
    },
    isEmailVerified: {
        type: Boolean,
        default: false
    },
    emailVerificationToken: String,
    emailVerificationExpires: Date,
    passwordResetToken: String,
    passwordResetExpires: Date,
    payoutSettings: {
        method: {
            type: String,
            enum: ['bank', 'mpesa', 'airtime', null],
            default: null
        },
        bankName: String,
        bankAccountNumber: String,
        bankAccountName: String,
        mpesaNumber: String
    },
    preferences: {
        hapticFeedback: { type: Boolean, default: true }
    },
    referralCode: {
        type: String,
        unique: true
    },
    referredBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    isActive: {
        type: Boolean,
        default: true
    },
    lastLogin: {
        type: Date,
        default: null
    }
}, {
    timestamps: true
});

userSchema.index({ 'wallet.balance': -1 });

userSchema.pre('save', async function(next) {
    if (!this.isModified('password') || !this.password) return next();
    
    this.password = await bcrypt.hash(this.password, 12);
    next();
});

userSchema.pre('save', function(next) {
    if (!this.referralCode) {
        this.referralCode = crypto.randomBytes(4).toString('hex');
    }
    next();
});

userSchema.methods.comparePassword = async function(candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.generatePasswordResetToken = function() {
    this.passwordResetToken = crypto.randomBytes(32).toString('hex');
    this.passwordResetExpires = Date.now() + 60 * 60 * 1000;
    return this.passwordResetToken;
};

userSchema.methods.toPublicJSON = function() {
    const obj = this.toObject();
    delete obj.password;
    delete obj.emailVerificationToken;
    delete obj.passwordResetToken;
    delete obj.payoutSettings;
    return obj;
};

userSchema.methods.isPublisher = function() {
    return this.role === 'publisher' && this.publisherStatus === 'approved';
};

userSchema.methods.canApplyForPublisher = function() {
    return this.role === 'reader' && ['none', 'rejected'].includes(this.publisherStatus);
};

const User = mongoose.model('User', userSchema);

module.exports = User;
