const mongoose = require('mongoose');
const User = require('../models/User');
const PayoutDetail = require('../models/PayoutDetail');
const PaystackService = require('./PaystackService');
const WalletService = require('./WalletService');
const NotificationService = require('./NotificationService');

async function initiateWithdrawal(
    { user, amount, method, bankName, bankCode, accountNumber, accountName, phoneNumber },
    { log = console } = {}
) {
    try {
        const encryptionKey = process.env.PAYOUT_ENCRYPTION_KEY;

        if (!encryptionKey || encryptionKey === 'generate_a_secure_random_string_here') {
            return { success: false, error: 'System not configured for withdrawals', statusCode: 500 };
        }

        const amountInKobo = Math.round(amount * 100);

        if (method === 'bank') {
            if (!accountNumber || !accountName || !bankCode) {
                return {
                    success: false,
                    error: 'Bank code, account number, and account name are required for bank withdrawals',
                    statusCode: 400
                };
            }

            await PayoutDetail.encryptAndSave(
                user._id,
                { bankName, bankCode, accountNumber, accountName },
                method,
                encryptionKey
            );

            const paystackKey = process.env.PAYSTACK_SECRET_KEY;
            if (!paystackKey || paystackKey === 'your_paystack_secret_key_here') {
                return { success: false, error: 'Payment gateway not configured', statusCode: 500 };
            }

            const recipientRes = await PaystackService.createTransferRecipient({
                accountName,
                accountNumber,
                bankCode
            });

            if (!recipientRes.status) {
                return {
                    success: false,
                    error: recipientRes.message || 'Failed to create payment recipient',
                    statusCode: 400
                };
            }

            const recipientCode = recipientRes.data.recipient_code;

            const idempotencyKey = `withdraw_${user._id}_${Date.now()}`;

            const transferRes = await PaystackService.initiateTransfer(
                recipientCode,
                amountInKobo,
                `PaidInk withdrawal - ${user._id}`,
                idempotencyKey
            );

            if (!transferRes.status) {
                return {
                    success: false,
                    error: transferRes.message || 'Failed to initiate transfer',
                    statusCode: 400
                };
            }

            const transferCode = transferRes.data.transfer_code;

            const result = await WalletService.requestWithdrawal(user, amountInKobo);

            const Transaction = mongoose.model('Transaction');
            try {
                await Transaction.create({
                    user: user._id,
                    type: 'withdrawal',
                    amount: -amountInKobo,
                    balanceBefore: result.newBalance + amountInKobo,
                    balanceAfter: result.newBalance,
                    status: 'pending',
                    reference: transferCode,
                    description: `Bank withdrawal (****${accountNumber.slice(-4)})`,
                    metadata: {
                        paystackTransferCode: transferCode,
                        paystackRecipientCode: recipientCode,
                        method,
                        accountNumber: `****${accountNumber.slice(-4)}`,
                        bankName
                    }
                });
            } catch (txError) {
                log.error({ error: txError.message, userId: user._id },
                    'Failed to create transaction record, reversing balance deduction');
                await User.findOneAndUpdate(
                    { _id: user._id },
                    { $inc: { 'wallet.balance': amountInKobo, 'wallet.pendingBalance': -amountInKobo } }
                );
                throw txError;
            }

            try {
                await NotificationService.notifyWithdrawal(user._id, amount, method);
            } catch (err) {
                log.error({ component: 'notification', error: err.message, userId: user._id },
                    'Failed to create withdrawal notification');
            }

            return {
                success: true,
                newBalance: result.newBalance,
                pendingBalance: result.pendingBalance,
                transferCode
            };
        }

        if (method === 'mpesa' && phoneNumber) {
            await PayoutDetail.encryptAndSave(user._id, { phoneNumber }, method, encryptionKey);
            return { success: false, error: 'M-Pesa withdrawals are not yet available', statusCode: 400 };
        }

        if (method === 'airtime' && phoneNumber) {
            await PayoutDetail.encryptAndSave(user._id, { phoneNumber }, method, encryptionKey);
            return { success: false, error: 'Airtime withdrawals are not yet available', statusCode: 400 };
        }

        return { success: false, error: 'Invalid withdrawal method or missing required fields', statusCode: 400 };
    } catch (error) {
        log.error({ error: error.message, userId: user._id, method, amount }, 'Withdrawal failed');
        const statusCode = error.message.includes('Insufficient') ? 400 : 500;
        return { success: false, error: error.message || 'Withdrawal failed. Please try again.', statusCode };
    }
}

module.exports = { initiateWithdrawal };
