const axios = require('axios');
const crypto = require('crypto');

const PAYSTACK_API = 'https://api.paystack.co';
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

function getHeaders() {
    return {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json'
    };
}

function verifyWebhookSignature(body, signature) {
    if (!PAYSTACK_SECRET_KEY || !signature) return false;
    const raw = typeof body === 'string' ? body : JSON.stringify(body);
    const hash = crypto
        .createHmac('sha512', PAYSTACK_SECRET_KEY)
        .update(raw)
        .digest('hex');
    return hash === signature;
}

async function apiCallWithRetry(fn, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            if (attempt === maxRetries) throw error;
            const isRetryable = !error.response ||
                error.response.status >= 500 ||
                error.response.status === 429 ||
                error.code === 'ECONNRESET' ||
                error.code === 'ETIMEDOUT';
            if (!isRetryable) throw error;
            const delay = Math.pow(2, attempt) * 200;
            await new Promise(r => setTimeout(r, delay));
        }
    }
}

async function resolveAccount(accountNumber, bankCode) {
    const { data } = await apiCallWithRetry(() => axios.get(`${PAYSTACK_API}/bank/resolve`, {
        headers: getHeaders(),
        params: { account_number: accountNumber, bank_code: bankCode }
    }));
    return data;
}

async function listBanks() {
    const { data } = await apiCallWithRetry(() => axios.get(`${PAYSTACK_API}/bank`, {
        headers: getHeaders(),
        params: { country: 'nigeria', use_cursor: false, perPage: 100 }
    }));
    return data;
}

async function createTransferRecipient(details) {
    const { data } = await apiCallWithRetry(() => axios.post(`${PAYSTACK_API}/transferrecipient`, {
        type: 'nuban',
        name: details.accountName,
        account_number: details.accountNumber,
        bank_code: details.bankCode,
        currency: 'NGN'
    }, { headers: getHeaders() }));
    return data;
}

async function initiateTransfer(recipientCode, amountKobo, reason, idempotencyKey) {
    const { data } = await apiCallWithRetry(() => axios.post(`${PAYSTACK_API}/transfer`, {
        source: 'balance',
        amount: amountKobo,
        recipient: recipientCode,
        reason
    }, {
        headers: {
            ...getHeaders(),
            ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {})
        }
    }));
    return data;
}

async function verifyTransfer(transferCode) {
    const { data } = await apiCallWithRetry(() => axios.get(`${PAYSTACK_API}/transfer/${transferCode}`, {
        headers: getHeaders()
    }));
    return data;
}

async function getBalance() {
    const { data } = await apiCallWithRetry(() => axios.get(`${PAYSTACK_API}/balance`, {
        headers: getHeaders()
    }));
    return data;
}

module.exports = {
    verifyWebhookSignature,
    resolveAccount,
    listBanks,
    createTransferRecipient,
    initiateTransfer,
    verifyTransfer,
    getBalance
};
