const { getBullMQConnection } = require('../config/redis');
const PaystackService = require('../services/PaystackService');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const WalletService = require('../services/WalletService');
const { captureError } = require('../plugins/sentry');

async function processWebhookEvent(event, data) {
    const log = {
        info: (msg, ctx = {}) => console.info({ component: 'payment-worker', ...ctx }, msg),
        warn: (msg, ctx = {}) => console.warn({ component: 'payment-worker', ...ctx }, msg),
        error: (msg, ctx = {}) => {
            console.error({ component: 'payment-worker', ...ctx }, msg);
            if (ctx.error) captureError(ctx.error, { component: 'payment-worker', event });
        }
    };

    if (event === 'transfer.success') {
        const transferCode = data.transfer_code;
        const amount = data.amount;

        const tx = await Transaction.findOne({ 'metadata.paystackTransferCode': transferCode });

        if (!tx) {
            log.warn('No transaction found for successful transfer', { transferCode });
            return;
        }

        if (tx.status === 'completed') {
            log.info('Transfer already completed', { transferCode });
            return;
        }

        const user = await User.findById(tx.user);
        if (!user) {
            log.error('User not found for transfer completion', { userId: tx.user, transferCode });
            return;
        }

        await WalletService.completeWithdrawal(user, amount, transferCode);
        log.info('Withdrawal completed', { transferCode, amountKobo: amount });
        return;
    }

    if (event === 'transfer.failed' || event === 'transfer.reversed') {
        const transferCode = data.transfer_code;
        const amount = data.amount;

        const tx = await Transaction.findOne({ 'metadata.paystackTransferCode': transferCode });

        if (!tx) {
            log.warn('No transaction found for failed transfer', { transferCode });
            return;
        }

        if (tx.status === 'failed' || tx.status === 'reversed') {
            log.info('Transfer already reversed', { transferCode });
            return;
        }

        const user = await User.findById(tx.user);
        if (!user) {
            log.error('User not found for transfer reversal', { userId: tx.user, transferCode });
            return;
        }

        await WalletService.failWithdrawal(user, amount, transferCode);
        log.info('Withdrawal reversed', { transferCode, amountKobo: amount });
        return;
    }

    log.info('Unhandled webhook event', { event });
}

async function startPaymentWorker(options = {}) {
    const { concurrency = 1 } = options;
    const redisConnection = getBullMQConnection();

    if (!redisConnection) {
        console.warn('[PaymentWorker] No Redis connection — payment worker not started');
        return null;
    }

    const { Worker } = require('bullmq');

    const worker = new Worker('payment-webhooks', async (job) => {
        console.info('[PaymentWorker] Processing job %s: %s', job.id, job.data.event);
        await processWebhookEvent(job.data.event, job.data.data);
    }, {
        connection: redisConnection,
        concurrency
    });

    worker.on('completed', (job) => {
        console.info('[PaymentWorker] Job %s completed', job.id);
    });

    worker.on('failed', (job, err) => {
        console.error('[PaymentWorker] Job %s failed: %s', job.id, err.message);
    });

    worker.on('error', (err) => {
        console.error('[PaymentWorker] Worker error: %s', err.message);
    });

    console.info('[PaymentWorker] Started');
    return worker;
}

module.exports = { startPaymentWorker, processWebhookEvent };
