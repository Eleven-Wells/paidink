const {
    discovery,
    buildAuthorizationUrl,
    authorizationCodeGrant,
    randomPKCECodeVerifier,
    calculatePKCECodeChallenge,
    randomState,
    randomNonce,
    ClientSecretBasic
} = require('openid-client');

let config = null;

function getConfig() {
    if (config) return config;
    throw new Error('Logto not initialized. Call initLogto() first.');
}

async function initLogto() {
    const endpoint = process.env.LOGTO_ENDPOINT;
    const appId = process.env.LOGTO_APP_ID;
    const appSecret = process.env.LOGTO_APP_SECRET;

    if (!endpoint || !appId || !appSecret) {
        console.warn('Logto credentials not configured — social login disabled');
        return;
    }

    const issuerUrl = endpoint.replace(/\/+$/, '') + '/oidc';
    config = await discovery(
        new URL(issuerUrl),
        appId,
        { client_secret: appSecret },
        ClientSecretBasic(appSecret)
    );
}

const CONNECTOR_TARGETS = {
    google: 'google',
    discord: 'discord',
    twitter: 'twitter',
};

async function getAuthorizationUrl(redirectUri, provider) {
    const c = getConfig();
    const codeVerifier = randomPKCECodeVerifier();
    const state = randomState();
    const nonce = randomNonce();

    const parameters = {
        redirect_uri: redirectUri,
        scope: 'openid profile email',
        code_challenge: await calculatePKCECodeChallenge(codeVerifier),
        code_challenge_method: 'S256',
        state,
        nonce,
    };

    const target = CONNECTOR_TARGETS[provider];
    if (target) {
        parameters.direct_sign_in = 'social:' + target;
    }

    const authUrl = buildAuthorizationUrl(c, parameters);

    return { url: authUrl.href, codeVerifier, state, nonce };
}

async function handleCallback(currentUrl, redirectUri, codeVerifier, expectedState, expectedNonce) {
    const c = getConfig();
    const tokens = await authorizationCodeGrant(c, new URL(currentUrl), {
        pkceCodeVerifier: codeVerifier,
        expectedState,
        expectedNonce,
        idTokenExpected: true,
    });

    const claims = tokens.claims();
    return {
        sub: claims.sub,
        email: claims.email,
        emailVerified: claims.email_verified,
        name: claims.name || claims.username || claims.sub,
        picture: claims.picture || null,
    };
}

module.exports = {
    initLogto,
    getAuthorizationUrl,
    handleCallback
};
