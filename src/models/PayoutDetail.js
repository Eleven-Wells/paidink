const mongoose = require('mongoose');
const crypto = require('crypto');

function deriveKey(masterKey, userId) {
    return crypto
        .createHash('sha256')
        .update(masterKey + userId.toString())
        .digest();
}

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
    authTag: {
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
            const key = deriveKey(encryptionKey, this.user);
            const decipher = crypto.createDecipheriv(
                'aes-256-gcm',
                key,
                Buffer.from(this.iv, 'hex')
            );
            decipher.setAuthTag(Buffer.from(this.authTag, 'hex'));
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
        const iv = crypto.randomBytes(12);
        const key = deriveKey(encryptionKey, userId);
        
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        let encrypted = cipher.update(JSON.stringify(details), 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        const lastFour = details.accountNumber?.slice(-4) || details.phoneNumber?.slice(-4);
        
        return this.findOneAndUpdate(
            { user: userId },
            {
                encryptedBankDetails: encrypted,
                iv: iv.toString('hex'),
                authTag: cipher.getAuthTag().toString('hex'),
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