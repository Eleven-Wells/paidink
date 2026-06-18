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
        pendingUnfundedReads: {
            type: Number,
            default: 0,
            max: 3
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

userSchema.methods.generateEmailVerificationToken = function() {
    this.emailVerificationToken = crypto.randomBytes(32).toString('hex');
    this.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000;
    return this.emailVerificationToken;
};

userSchema.methods.generatePasswordResetToken = function() {
    this.passwordResetToken = crypto.randomBytes(32).toString('hex');
    this.passwordResetExpires = Date.now() + 60 * 60 * 1000;
    return this.passwordResetToken;
};

userSchema.methods.updateStreak = function() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (!this.stats.lastReadDate) {
        this.stats.streak = 1;
    } else {
        const lastRead = new Date(this.stats.lastReadDate);
        lastRead.setHours(0, 0, 0, 0);
        
        const diffDays = Math.floor((today - lastRead) / (1000 * 60 * 60 * 24));
        
        if (diffDays === 0) {
            // Same day, no change
        } else if (diffDays === 1) {
            this.stats.streak += 1;
            if (this.stats.streak > this.stats.longestStreak) {
                this.stats.longestStreak = this.stats.streak;
            }
        } else {
            this.stats.streak = 1;
        }
    }
    
    this.stats.lastReadDate = new Date();
    return this.stats.streak;
};

userSchema.methods.addReward = async function(amount, type, description) {
    const User = this.constructor;
    
    const currentUser = await User.findById(this._id).select('wallet.balance wallet.lifetimeEarned');
    if (!currentUser) {
        throw new Error('User not found');
    }
    
    let balanceBefore = currentUser.wallet.balance;

    let result = await User.findOneAndUpdate(
        { _id: this._id, 'wallet.balance': balanceBefore },
        {
            $set: {
                'wallet.balance': balanceBefore + amount,
                'wallet.lifetimeEarned': currentUser.wallet.lifetimeEarned + amount
            }
        },
        { new: true }
    );

    if (!result) {
        const freshUser = await User.findById(this._id).select('wallet.balance wallet.lifetimeEarned');
        if (freshUser) {
            balanceBefore = freshUser.wallet.balance;
            result = await User.findOneAndUpdate(
                { _id: this._id, 'wallet.balance': balanceBefore },
                {
                    $set: {
                        'wallet.balance': balanceBefore + amount,
                        'wallet.lifetimeEarned': freshUser.wallet.lifetimeEarned + amount
                    }
                },
                { new: true }
            );
        }
    }

    if (!result) {
        throw new Error('Concurrent balance update detected. Please retry.');
    }

    const LedgerEntry = mongoose.model('LedgerEntry');
    await LedgerEntry.create({
        user: this._id,
        type,
        amount,
        balanceBefore,
        balanceAfter: balanceBefore + amount,
        status: 'completed',
        metadata: { description }
    });

    const Transaction = mongoose.model('Transaction');
    try {
        await Transaction.create({
            user: this._id,
            type,
            amount,
            balanceBefore,
            balanceAfter,
            description: description || `${type} reward`,
            status: 'completed'
        });
    } catch (err) {
        console.error(`Failed to create transaction for ${type}:`, err.message);
    }

    try {
        const NotificationService = require('../services/NotificationService');
        await NotificationService.notifyReward(this._id, amount, type);
    } catch (err) {
        console.error('Failed to create notification:', err.message);
    }

    this.wallet.balance = balanceBefore + amount;
    this.wallet.lifetimeEarned += amount;
    return this.wallet.balance;
};

userSchema.methods.requestWithdrawal = async function(amount) {
    const User = this.constructor;
    
    const currentUser = await User.findById(this._id).select('wallet.balance wallet.pendingBalance');
    if (!currentUser) {
        throw new Error('User not found');
    }
    
    if (currentUser.wallet.balance < amount) {
        throw new Error('Insufficient balance');
    }
    
    const balanceBefore = currentUser.wallet.balance;
    const newPendingBalance = (currentUser.wallet.pendingBalance || 0) + amount;
    
    const result = await User.findOneAndUpdate(
        { _id: this._id, 'wallet.balance': balanceBefore },
        {
            $set: {
                'wallet.balance': balanceBefore - amount,
                'wallet.pendingBalance': newPendingBalance
            }
        },
        { new: true }
    );
    
    if (!result) {
        throw new Error('Concurrent balance update detected. Please retry.');
    }
    
    const balanceAfter = balanceBefore - amount;
    
    this.wallet.balance = balanceAfter;
    this.wallet.pendingBalance = newPendingBalance;
    
    const LedgerEntry = mongoose.model('LedgerEntry');
    const ledger = await LedgerEntry.create({
        user: this._id,
        type: 'withdrawal',
        amount: -amount,
        balanceBefore,
        balanceAfter,
        status: 'pending',
        metadata: { description: 'Withdrawal requested' }
    });

    return {
        newBalance: balanceAfter,
        pendingBalance: newPendingBalance,
        ledgerEntryId: ledger._id
    };
};

userSchema.methods.completeWithdrawal = async function(amount, transferCode) {
    const User = this.constructor;
    const currentUser = await User.findById(this._id).select('wallet.pendingBalance wallet.lifetimeWithdrawn');
    if (!currentUser) throw new Error('User not found');

    const pendingBefore = currentUser.wallet.pendingBalance || 0;
    if (pendingBefore < amount) throw new Error('Insufficient pending balance');

    const lifetimeWithdrawnBefore = currentUser.wallet.lifetimeWithdrawn || 0;

    const result = await User.findOneAndUpdate(
        { _id: this._id, 'wallet.pendingBalance': pendingBefore },
        {
            $set: {
                'wallet.pendingBalance': pendingBefore - amount,
                'wallet.lifetimeWithdrawn': lifetimeWithdrawnBefore + amount
            }
        },
        { new: true }
    );

    if (!result) throw new Error('Concurrent withdrawal completion detected. Please retry.');

    this.wallet.pendingBalance = pendingBefore - amount;
    this.wallet.lifetimeWithdrawn = lifetimeWithdrawnBefore + amount;

    const Transfer = mongoose.model('Transaction');
    const LedgerEntry = mongoose.model('LedgerEntry');

    await Transfer.updateOne(
        { 'metadata.paystackTransferCode': transferCode },
        { $set: { status: 'completed' } }
    );

    await LedgerEntry.updateOne(
        { 'metadata.paystackTransferCode': transferCode },
        {
            $set: {
                status: 'completed',
                'metadata.description': 'Withdrawal completed'
            }
        }
    );

    return {
        pendingBalance: this.wallet.pendingBalance,
        lifetimeWithdrawn: this.wallet.lifetimeWithdrawn
    };
};

userSchema.methods.failWithdrawal = async function(amount, transferCode) {
    const User = this.constructor;
    const currentUser = await User.findById(this._id).select('wallet.balance wallet.pendingBalance');
    if (!currentUser) throw new Error('User not found');

    const pendingBefore = currentUser.wallet.pendingBalance || 0;
    if (pendingBefore < amount) throw new Error('Insufficient pending balance to reverse');

    const balanceBefore = currentUser.wallet.balance;

    const result = await User.findOneAndUpdate(
        { _id: this._id, 'wallet.pendingBalance': pendingBefore },
        {
            $set: {
                'wallet.balance': balanceBefore + amount,
                'wallet.pendingBalance': pendingBefore - amount
            }
        },
        { new: true }
    );

    if (!result) throw new Error('Concurrent withdrawal failure detected. Please retry.');

    this.wallet.balance = balanceBefore + amount;
    this.wallet.pendingBalance = pendingBefore - amount;

    const Transfer = mongoose.model('Transaction');
    const LedgerEntry = mongoose.model('LedgerEntry');

    await Transfer.updateOne(
        { 'metadata.paystackTransferCode': transferCode },
        { $set: { status: 'failed' } }
    );

    await LedgerEntry.updateOne(
        { 'metadata.paystackTransferCode': transferCode },
        {
            $set: {
                status: 'failed',
                'metadata.description': 'Withdrawal failed — reversed'
            }
        }
    );

    return {
        balance: this.wallet.balance,
        pendingBalance: this.wallet.pendingBalance
    };
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

userSchema.methods.reconcileWallet = async function() {
    const LedgerEntry = mongoose.model('LedgerEntry');
    const entries = await LedgerEntry.find({ user: this._id }).sort({ createdAt: 1 });

    let computedBalance = 0;
    let computedLifetimeEarned = 0;
    let computedPendingBalance = this.wallet.pendingBalance || 0;
    let computedLifetimeWithdrawn = this.wallet.lifetimeWithdrawn || 0;

    for (const entry of entries) {
        if (entry.status === 'completed') {
            computedBalance = entry.balanceAfter;
            if (['read_reward', 'achievement', 'referral', 'streak_bonus', 'signup_bonus'].includes(entry.type)) {
                computedLifetimeEarned = Math.max(computedLifetimeEarned, entry.balanceAfter);
            }
            if (entry.type === 'withdrawal_approved') {
                computedLifetimeWithdrawn = Math.max(computedLifetimeWithdrawn, computedLifetimeWithdrawn + entry.amount);
            }
        }
    }

    const drift = Math.abs((this.wallet.balance || 0) - computedBalance);

    this.wallet.balance = computedBalance;
    this.wallet.lifetimeEarned = computedLifetimeEarned;
    this.wallet.balanceLastSynced = new Date();
    await this.save();

    return {
        reconciled: computedBalance,
        drift,
        driftSignificant: drift > 0.01
    };
};

const User = mongoose.model('User', userSchema);

module.exports = User;
