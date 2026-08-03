const mongoose = require('mongoose');
const User = require('../../src/models/User');
const LedgerEntry = require('../../src/models/LedgerEntry');
const Transaction = require('../../src/models/Transaction');
const PayoutDetail = require('../../src/models/PayoutDetail');
const PaystackService = require('../../src/services/PaystackService');
const NotificationService = require('../../src/services/NotificationService');
const PayoutService = require('../../src/services/PayoutService');

describe('PayoutService', () => {
    let testUser;
    let currentTransferCode;
    let currentRecipientCode;

    beforeAll(() => {
        process.env.PAYOUT_ENCRYPTION_KEY = 'test-payout-key';
        process.env.PAYSTACK_SECRET_KEY = 'sk_test_payout';
    });

    beforeEach(async () => {
        await PayoutDetail.deleteMany({});
        await LedgerEntry.deleteMany({});
        await Transaction.deleteMany({});
        testUser = await User.create({
            email: 'payout-svc-' + Date.now() + '@test.com',
            password: 'password123',
            'wallet.balance': 100,
            'wallet.pendingBalance': 0,
            'wallet.lifetimeEarned': 100,
            'wallet.lifetimeWithdrawn': 0,
            'wallet.balanceLastSynced': null,
            'stats.lastReadDate': null,
            'stats.streak': 0,
            'stats.longestStreak': 0,
            'stats.totalReads': 0
        });

        currentTransferCode = 'TRF_payout_' + Date.now();
        currentRecipientCode = 'RCP_payout_' + Date.now();

        jest.spyOn(PaystackService, 'createTransferRecipient')
            .mockResolvedValue({ status: true, data: { recipient_code: currentRecipientCode } });
        jest.spyOn(PaystackService, 'initiateTransfer')
            .mockResolvedValue({ status: true, data: { transfer_code: currentTransferCode } });
        jest.spyOn(NotificationService, 'notifyWithdrawal').mockResolvedValue();
    });

    afterEach(async () => {
        process.env.PAYOUT_ENCRYPTION_KEY = 'test-payout-key';
        process.env.PAYSTACK_SECRET_KEY = 'sk_test_payout';
        await PayoutDetail.deleteMany({});
        await LedgerEntry.deleteMany({});
        await Transaction.deleteMany({});
        await User.deleteMany({ email: { $regex: /^payout-svc-/ } });
    });

    const args = (overrides = {}) => ({
        user: testUser,
        amount: 0.3,
        method: 'bank',
        bankName: 'Test Bank',
        bankCode: '058',
        accountNumber: '0123456789',
        accountName: 'Test User',
        ...overrides
    });

    describe('initiateWithdrawal (bank)', () => {
        test('successful withdrawal: deducts wallet, creates pending Transaction, returns result', async () => {
            const result = await PayoutService.initiateWithdrawal(args());

            expect(result.success).toBe(true);
            expect(result.newBalance).toBe(70);
            expect(result.pendingBalance).toBe(30);
            expect(result.transferCode).toBe(currentTransferCode);

            const tx = await Transaction.findOne({ 'metadata.paystackTransferCode': currentTransferCode });
            expect(tx).not.toBeNull();
            expect(tx.user.toString()).toBe(testUser._id.toString());
            expect(tx.type).toBe('withdrawal');
            expect(tx.amount).toBe(-30);
            expect(tx.balanceBefore).toBe(100);
            expect(tx.balanceAfter).toBe(70);
            expect(tx.status).toBe('pending');
            expect(tx.reference).toBe(currentTransferCode);
            expect(tx.description).toBe('Bank withdrawal (****6789)');
            expect(tx.metadata.paystackTransferCode).toBe(currentTransferCode);
            expect(tx.metadata.paystackRecipientCode).toBe(currentRecipientCode);
            expect(tx.metadata.method).toBe('bank');
            expect(tx.metadata.accountNumber).toBe('****6789');
            expect(tx.metadata.bankName).toBe('Test Bank');

            const updatedUser = await User.findById(testUser._id);
            expect(updatedUser.wallet.balance).toBe(70);
            expect(updatedUser.wallet.pendingBalance).toBe(30);

            expect(NotificationService.notifyWithdrawal).toHaveBeenCalledWith(testUser._id, 0.3, 'bank');
        });

        test('successful withdrawal: mutates the passed user document in memory', async () => {
            await PayoutService.initiateWithdrawal(args());
            expect(testUser.wallet.balance).toBe(70);
            expect(testUser.wallet.pendingBalance).toBe(30);
        });

        test('insufficient balance: returns { success: false, error, statusCode: 400 } without creating a Transaction', async () => {
            const result = await PayoutService.initiateWithdrawal(args({ amount: 10 }));

            expect(result.success).toBe(false);
            expect(result.error).toBe('Insufficient balance');
            expect(result.statusCode).toBe(400);

            const tx = await Transaction.findOne({ 'metadata.paystackTransferCode': currentTransferCode });
            expect(tx).toBeNull();

            const updatedUser = await User.findById(testUser._id);
            expect(updatedUser.wallet.balance).toBe(100);
            expect(updatedUser.wallet.pendingBalance).toBe(0);
        });

        test('user not found: returns { success: false, error, statusCode: 500 }', async () => {
            await User.deleteOne({ _id: testUser._id });

            const result = await PayoutService.initiateWithdrawal(args());

            expect(result.success).toBe(false);
            expect(result.error).toBe('User not found');
            expect(result.statusCode).toBe(500);
        });

        test('concurrent balance update: returns { success: false, error, statusCode: 500 } with no Transaction', async () => {
            await User.findOneAndUpdate({ _id: testUser._id }, { 'wallet.balance': 9999 });

            jest.spyOn(User, 'findById').mockImplementation(() => ({
                select: () => Promise.resolve({
                    _id: testUser._id,
                    wallet: { balance: 100, pendingBalance: 0 }
                })
            }));

            const result = await PayoutService.initiateWithdrawal(args());

            expect(result.success).toBe(false);
            expect(result.error).toBe('Concurrent balance update detected. Please retry.');
            expect(result.statusCode).toBe(500);
        });

        test('invalid payout details: returns { success: false, error, statusCode: 400 }', async () => {
            const result = await PayoutService.initiateWithdrawal(args({ accountNumber: null }));

            expect(result.success).toBe(false);
            expect(result.error).toBe('Bank code, account number, and account name are required for bank withdrawals');
            expect(result.statusCode).toBe(400);
        });

        test('missing payout encryption key: returns { success: false, error, statusCode: 500 }', async () => {
            delete process.env.PAYOUT_ENCRYPTION_KEY;

            const result = await PayoutService.initiateWithdrawal(args());

            expect(result.success).toBe(false);
            expect(result.error).toBe('System not configured for withdrawals');
            expect(result.statusCode).toBe(500);

            const tx = await Transaction.findOne({ 'metadata.paystackTransferCode': currentTransferCode });
            expect(tx).toBeNull();
        });

        test('missing paystack key: returns { success: false, error, statusCode: 500 }', async () => {
            process.env.PAYSTACK_SECRET_KEY = 'your_paystack_secret_key_here';

            const result = await PayoutService.initiateWithdrawal(args());

            expect(result.success).toBe(false);
            expect(result.error).toBe('Payment gateway not configured');
            expect(result.statusCode).toBe(500);

            const tx = await Transaction.findOne({ 'metadata.paystackTransferCode': currentTransferCode });
            expect(tx).toBeNull();
        });

        test('Paystack recipient failure: returns { success: false, error, statusCode: 400 }', async () => {
            PaystackService.createTransferRecipient.mockResolvedValueOnce({
                status: false,
                message: 'recipient failed'
            });

            const result = await PayoutService.initiateWithdrawal(args());

            expect(result.success).toBe(false);
            expect(result.error).toBe('recipient failed');
            expect(result.statusCode).toBe(400);

            const tx = await Transaction.findOne({ 'metadata.paystackTransferCode': currentTransferCode });
            expect(tx).toBeNull();
        });

        test('Paystack transfer failure: returns { success: false, error, statusCode: 400 }', async () => {
            PaystackService.initiateTransfer.mockResolvedValueOnce({
                status: false,
                message: 'transfer failed'
            });

            const result = await PayoutService.initiateWithdrawal(args());

            expect(result.success).toBe(false);
            expect(result.error).toBe('transfer failed');
            expect(result.statusCode).toBe(400);

            const tx = await Transaction.findOne({ 'metadata.paystackTransferCode': currentTransferCode });
            expect(tx).toBeNull();
        });

        test('Transaction.create failure: rollback reverses deduction and returns { success: false, error, statusCode: 500 }', async () => {
            jest.spyOn(Transaction, 'create').mockRejectedValueOnce(new Error('tx create failed'));

            const result = await PayoutService.initiateWithdrawal(args());

            expect(result.success).toBe(false);
            expect(result.error).toBe('tx create failed');
            expect(result.statusCode).toBe(500);

            const updatedUser = await User.findById(testUser._id);
            expect(updatedUser.wallet.balance).toBe(100);
            expect(updatedUser.wallet.pendingBalance).toBe(0);
        });

        test('rollback failure behaves identically: returns the rollback error and leaves the deduction in place', async () => {
            const originalFindOneAndUpdate = User.findOneAndUpdate;
            jest.spyOn(Transaction, 'create').mockRejectedValueOnce(new Error('tx create failed'));
            jest.spyOn(User, 'findOneAndUpdate')
                .mockImplementationOnce((...a) => originalFindOneAndUpdate.apply(User, a))
                .mockRejectedValueOnce(new Error('rollback failed'));

            const result = await PayoutService.initiateWithdrawal(args());

            expect(result.success).toBe(false);
            expect(result.error).toBe('rollback failed');
            expect(result.statusCode).toBe(500);

            const updatedUser = await User.findById(testUser._id);
            expect(updatedUser.wallet.balance).toBe(70);
            expect(updatedUser.wallet.pendingBalance).toBe(30);
        });

        test('duplicate initiation: second call deducts again with no dedup (matches existing behavior)', async () => {
            await PayoutService.initiateWithdrawal(args());
            await PayoutService.initiateWithdrawal(args());

            const updatedUser = await User.findById(testUser._id);
            expect(updatedUser.wallet.balance).toBe(40);
            expect(updatedUser.wallet.pendingBalance).toBe(60);

            const count = await Transaction.countDocuments({ user: testUser._id });
            expect(count).toBe(2);
        });
    });

    describe('initiateWithdrawal (mpesa/airtime placeholders)', () => {
        test('mpesa: saves payout detail and returns not-yet-available error', async () => {
            const result = await PayoutService.initiateWithdrawal(args({ method: 'mpesa', phoneNumber: '0712345678' }));

            expect(result.success).toBe(false);
            expect(result.error).toBe('M-Pesa withdrawals are not yet available');
            expect(result.statusCode).toBe(400);

            const detail = await PayoutDetail.findOne({ user: testUser._id });
            expect(detail).not.toBeNull();
            expect(detail.method).toBe('mpesa');
        });

        test('airtime: saves payout detail and returns not-yet-available error', async () => {
            const result = await PayoutService.initiateWithdrawal(args({ method: 'airtime', phoneNumber: '0712345678' }));

            expect(result.success).toBe(false);
            expect(result.error).toBe('Airtime withdrawals are not yet available');
            expect(result.statusCode).toBe(400);
        });

        test('invalid method: returns { success: false, error, statusCode: 400 }', async () => {
            const result = await PayoutService.initiateWithdrawal(args({ method: 'mpesa' }));

            expect(result.success).toBe(false);
            expect(result.error).toBe('Invalid withdrawal method or missing required fields');
            expect(result.statusCode).toBe(400);
        });
    });
});
