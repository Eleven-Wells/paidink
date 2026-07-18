let clerkInitialized = false;
let frontendApiUrl = '';

function initClerk() {
    const secretKey = process.env.CLERK_SECRET_KEY;
    const publishableKey = process.env.CLERK_PUBLISHABLE_KEY;

    if (!secretKey || !publishableKey) {
        console.warn('Clerk credentials not configured — social login disabled');
        return;
    }

    clerkInitialized = true;
    frontendApiUrl = deriveFrontendApiUrl(publishableKey);
}

function deriveFrontendApiUrl(publishableKey) {
    try {
        const parts = publishableKey.split('_');
        const encoded = parts[parts.length - 1];
        const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
        const parsed = JSON.parse(decoded);
        return `https://${parsed.instance}`;
    } catch {
        return process.env.CLERK_FRONTEND_API_URL || 'https://api.clerk.com';
    }
}

function isConfigured() {
    return clerkInitialized && process.env.CLERK_SECRET_KEY && process.env.CLERK_PUBLISHABLE_KEY;
}

const PROVIDER_MAP = {
    google: 'oauth_google',
    twitter: 'oauth_twitter',
    discord: 'oauth_discord',
};

async function getOAuthUrl(provider, redirectUri) {
    const strategy = PROVIDER_MAP[provider];
    if (!strategy) {
        throw new Error(`Unknown OAuth provider: ${provider}`);
    }

    const url = `${frontendApiUrl}/v1/client/sign_ins`;

    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${process.env.CLERK_SECRET_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            strategy,
            redirect_url: redirectUri,
        }),
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Clerk sign-in creation failed (${res.status}): ${errText}`);
    }

    const data = await res.json();
    return data.authorization_url;
}

async function verifySessionToken(sessionToken) {
    const { verifyToken } = require('@clerk/fastify');
    const payload = await verifyToken(sessionToken, {
        secretKey: process.env.CLERK_SECRET_KEY,
    });
    return payload;
}

async function getUserInfo(userId) {
    const { clerkClient } = require('@clerk/fastify');
    const user = await clerkClient.users.getUser(userId);

    const primaryEmail = user.emailAddresses && user.emailAddresses.length > 0
        ? user.emailAddresses.find(e => e.id === user.primaryEmailAddressId) || user.emailAddresses[0]
        : null;

    return {
        sub: user.id,
        email: primaryEmail ? primaryEmail.emailAddress : null,
        emailVerified: primaryEmail ? primaryEmail.verification && primaryEmail.verification.status === 'verified' : false,
        name: [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.username || null,
        picture: user.imageUrl || null,
        username: user.username || null,
    };
}

module.exports = {
    initClerk,
    isConfigured,
    getOAuthUrl,
    verifySessionToken,
    getUserInfo,
};
