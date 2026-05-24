const fp = require('fastify-plugin');
const crypto = require('crypto');
const { loadConfig } = require('../config');
const { AuthenticationError } = require('../errors/errors');
const { captureMessage } = require('./sentry');

const apiKeyRateLimits = new Map();
const API_KEY_HASHES = new Map();

function hashApiKey(apiKey) {
    return crypto.createHash('sha256').update(apiKey).digest('hex');
}

function getClientIP(request) {
    const forwarded = request.headers['x-forwarded-for'];
    if (forwarded) {
        return forwarded.split(',')[0].trim();
    }
    return request.ip || request.socket.remoteAddress;
}

function isIPAllowed(clientIP, allowedIPs) {
    if (!allowedIPs || allowedIPs.length === 0) {
        return true;
    }

    const normalizedIP = clientIP.replace(/^::ffff:/, '');

    return allowedIPs.some(allowed => {
        if (allowed.includes('/')) {
            return false;
        }
        const normalizedAllowed = allowed.replace(/^::ffff:/, '');
        return normalizedIP === normalizedAllowed || normalizedIP.startsWith(normalizedAllowed);
    });
}

function checkRateLimit(apiKeyHash, maxRequests, windowMs) {
    const now = Date.now();
    const record = apiKeyRateLimits.get(apiKeyHash);

    if (!record || now - record.windowStart > windowMs) {
        apiKeyRateLimits.set(apiKeyHash, {
            count: 1,
            windowStart: now
        });
        return { allowed: true, remaining: maxRequests - 1 };
    }

    if (record.count >= maxRequests) {
        const retryAfter = Math.ceil((windowMs - (now - record.windowStart)) / 1000);
        return { allowed: false, retryAfter };
    }

    record.count++;
    return { allowed: true, remaining: maxRequests - record.count };
}

function createAdminAuthPlugin(fastify) {
    const config = loadConfig();
    const allowedIPs = config.ADMIN_ALLOWED_IPS
        ? config.ADMIN_ALLOWED_IPS.split(',').map(ip => ip.trim())
        : [];
    const apiKeyRotationEnabled = config.API_KEY_ROTATION_ENABLED === 'true';
    const rateLimitMax = parseInt(config.ADMIN_RATE_LIMIT_MAX) || 100;
    const rateLimitWindow = parseInt(config.ADMIN_RATE_LIMIT_WINDOW) || 60000;

    if (apiKeyRotationEnabled && config.ADMIN_API_KEY) {
        const hash = hashApiKey(config.ADMIN_API_KEY);
        API_KEY_HASHES.set('current', hash);
    }

    fastify.decorateRequest('adminAuth', null);

    fastify.decorate('adminAuth', {
        authenticate: async (request, reply) => {
            const apiKey = request.headers['x-api-key'];
            const clientIP = getClientIP(request);
            const requestId = request.id;

            if (!config.ADMIN_API_KEY) {
                request.log.warn({
                    requestId,
                    ip: clientIP,
                    code: 'AUTH_003'
                }, 'Admin API not configured');
                throw new AuthenticationError('ADMIN_NOT_CONFIGURED', { ip: clientIP });
            }

            if (!apiKey) {
                request.log.warn({
                    requestId,
                    ip: clientIP,
                    code: 'AUTH_001'
                }, 'Missing API key');
                captureMessage('Admin auth failed - missing API key', 'warning', {
                    ip: clientIP,
                    requestId
                });
                throw new AuthenticationError('MISSING_API_KEY', { ip: clientIP });
            }

            const apiKeyHash = hashApiKey(apiKey);
            const validHash = hashApiKey(config.ADMIN_API_KEY);

            const rateLimit = checkRateLimit(apiKeyHash, rateLimitMax, rateLimitWindow);
            reply.header('X-RateLimit-Limit', rateLimitMax);
            reply.header('X-RateLimit-Remaining', rateLimit.remaining);
            if (!rateLimit.allowed) {
                reply.header('Retry-After', rateLimit.retryAfter);
                request.log.warn({
                    requestId,
                    ip: clientIP,
                    code: 'RATE_002'
                }, 'Admin API rate limit exceeded');
                throw new AuthenticationError('RATE_LIMIT_EXCEEDED', {
                    ip: clientIP,
                    retryAfter: rateLimit.retryAfter
                });
            }

            if (apiKeyHash !== validHash) {
                request.log.warn({
                    requestId,
                    ip: clientIP,
                    code: 'AUTH_002'
                }, 'Invalid API key');
                captureMessage('Admin auth failed - invalid API key', 'warning', {
                    ip: clientIP,
                    requestId
                });
                throw new AuthenticationError('INVALID_API_KEY', { ip: clientIP });
            }

            if (allowedIPs.length > 0 && !isIPAllowed(clientIP, allowedIPs)) {
                request.log.warn({
                    requestId,
                    ip: clientIP,
                    code: 'AUTH_005'
                }, 'IP not allowed');
                captureMessage('Admin auth failed - IP not allowed', 'warning', {
                    ip: clientIP,
                    requestId,
                    allowedIPs
                });
                throw new AuthenticationError('IP_NOT_ALLOWED', { ip: clientIP });
            }

            request.adminAuth = {
                authenticated: true,
                ip: clientIP,
                requestId,
                timestamp: new Date().toISOString()
            };

            request.log.info({
                requestId,
                ip: clientIP,
                code: 'AUTH_SUCCESS'
            }, 'Admin authenticated successfully');

            return true;
        },

        verifyCsrf: async (request, reply) => {
            const csrfToken = request.headers['x-csrf-token'];
            const sessionToken = request.headers['x-session-token'];

            if (config.CSRF_ENABLED !== 'false') {
                if (!csrfToken || !sessionToken) {
                    request.log.warn({
                        requestId: request.id,
                        code: 'CSRF_001'
                    }, 'Missing CSRF tokens');
                    throw new AuthenticationError('CSRF_INVALID', { reason: 'Missing tokens' });
                }

                const validCsrf = verifyCsrfToken(csrfToken, sessionToken);
                if (!validCsrf) {
                    request.log.warn({
                        requestId: request.id,
                        code: 'CSRF_002'
                    }, 'Invalid CSRF token');
                    throw new AuthenticationError('CSRF_INVALID', { reason: 'Invalid token' });
                }
            }

            return true;
        },

        rotateKey: (newKey) => {
            if (!apiKeyRotationEnabled) {
                throw new Error('API key rotation is not enabled');
            }

            const hash = hashApiKey(newKey);
            API_KEY_HASHES.set('previous', API_KEY_HASHES.get('current'));
            API_KEY_HASHES.set('current', hash);

            captureMessage('API key rotated', 'info');

            return true;
        },

        getStatus: () => ({
            ipAllowlistEnabled: allowedIPs.length > 0,
            allowedIPs: allowedIPs.length > 0 ? allowedIPs : null,
            rateLimitEnabled: true,
            rateLimitMax,
            rateLimitWindowMs: rateLimitWindow,
            keyRotationEnabled: apiKeyRotationEnabled
        })
    });
}

function verifyCsrfToken(csrfToken, sessionToken) {
    if (!csrfToken || !sessionToken) return false;

    try {
        const expectedToken = crypto
            .createHash('sha256')
            .update(sessionToken + process.env.CSRF_SECRET || 'default-secret')
            .digest('hex');

        return crypto.timingSafeEqual(
            Buffer.from(csrfToken),
            Buffer.from(expectedToken)
        );
    } catch {
        return false;
    }
}

function generateCsrfToken(sessionToken) {
    return crypto
        .createHash('sha256')
        .update(sessionToken + process.env.CSRF_SECRET || 'default-secret')
        .digest('hex');
}

const adminAuthPlugin = fp(async (fastify) => {
    createAdminAuthPlugin(fastify);
}, {
    name: 'admin-auth'
});

module.exports = adminAuthPlugin;
module.exports.createAdminAuthPlugin = createAdminAuthPlugin;
module.exports.generateCsrfToken = generateCsrfToken;
module.exports.verifyCsrfToken = verifyCsrfToken;
module.exports.getClientIP = getClientIP;
module.exports.hashApiKey = hashApiKey;
