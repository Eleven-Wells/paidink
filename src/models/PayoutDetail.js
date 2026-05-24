const mongoose = require('mongoose');
const crypto = require('crypto');

const payoutDetailSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true
    },
    encryptedBankDetails: {
        type: String,
        required: true
    },
    iv: {
        type: String,
        required: true
    },
    method: {
        type: String,
        enum: ['bank', 'mpesa', 'airtime'],
        required: true
    },
    lastFour: {
        type: String,
        maxlength: 4
    },
    isVerified: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true
});

payoutDetailSchema.methods = {
    decrypt(encryptionKey) {
        try {
            const decipher = crypto.createDecipheriv(
                'aes-256-cbc',
                Buffer.from(encryptionKey, 'hex'),
                Buffer.from(this.iv, 'hex')
            );
            let decrypted = decipher.update(this.encryptedBankDetails, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            return JSON.parse(decrypted);
        } catch (error) {
            console.error('Failed to decrypt payout details:', error.message);
            return null;
        }
    }
};

payoutDetailSchema.statics = {
    async encryptAndSave(userId, details, method, encryptionKey) {
        const iv = crypto.randomBytes(16);
        const key = Buffer.from(encryptionKey, 'hex');
        
        const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
        let encrypted = cipher.update(JSON.stringify(details), 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        const lastFour = details.accountNumber?.slice(-4) || details.phoneNumber?.slice(-4);
        
        return this.findOneAndUpdate(
            { user: userId },
            {
                encryptedBankDetails: encrypted,
                iv: iv.toString('hex'),
                method,
                lastFour,
                isVerified: false
            },
            { upsert: true, new: true }
        );
    }
};

const PayoutDetail = mongoose.model('PayoutDetail', payoutDetailSchema);

module.exports = PayoutDetail;