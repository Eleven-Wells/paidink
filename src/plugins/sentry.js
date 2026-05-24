const fp = require('fastify-plugin');
const Sentry = require('@sentry/node');

let sentryInitialized = false;

function captureError(error, context = {}) {
    if (!sentryInitialized) return null;

    Sentry.withScope((scope) => {
        if (context.userId) scope.setUser({ id: context.userId });
        if (context.requestId) scope.setTag('requestId', context.requestId);
        if (context.jobId) scope.setTag('jobId', context.jobId);

        Object.keys(context).forEach(key => scope.setExtra(key, context[key]));
        Sentry.captureException(error);
    });
}

function captureMessage(message, level = 'info', context = {}) {
    if (!sentryInitialized) return null;

    Sentry.withScope((scope) => {
        Object.keys(context).forEach(key => scope.setExtra(key, context[key]));
        Sentry.captureMessage(message, level);
    });
}

function addBreadcrumb(message, category, data = {}) {
    if (!sentryInitialized) return;
    Sentry.addBreadcrumb({ message, category, data, timestamp: Date.now() / 1000 });
}

function setContext(key, value) {
    if (!sentryInitialized) return;
    Sentry.setContext(key, value);
}

function setExtra(key, value) {
    if (!sentryInitialized) return;
    Sentry.setExtra(key, value);
}

function getTransaction() {
    if (!sentryInitialized) return null;
    return Sentry.startTransaction({ op: 'transaction', name: 'Transaction' });
}

const sentryPlugin = fp(async (fastify) => {
    const dsn = process.env.SENTRY_DSN;

    if (!dsn) {
        console.log('[Sentry] DSN not configured, error tracking disabled');
        sentryInitialized = false;
    } else {
        Sentry.init({
            dsn,
            environment: process.env.NODE_ENV || 'development',
            release: process.env.npm_package_version || '1.0.0',
            tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
            profilesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
            beforeSend(event) {
                if (process.env.NODE_ENV === 'development') {
                    console.log('[Sentry] Event would be sent:', event.event_id);
                    return null;
                }
                return event;
            }
        });

        sentryInitialized = true;
        console.log('[Sentry] Initialized successfully');

        fastify.addHook('onRequest', async (request) => {
            if (sentryInitialized) {
                Sentry.getIsolationScope().setTag('requestMethod', request.method);
                Sentry.getIsolationScope().setTag('requestUrl', request.url);
                Sentry.getIsolationScope().setUser({ ip: request.ip });
            }
        });

        fastify.addHook('onResponse', async (request, reply) => {
            if (sentryInitialized) {
                captureMessage('Request completed', 'request', {
                    method: request.method,
                    url: request.url,
                    statusCode: reply.statusCode,
                    responseTime: reply.elapsedTime
                });
            }
        });
    }

    fastify.decorate('sentry', {
        captureError,
        captureMessage,
        addBreadcrumb,
        setContext,
        setExtra,
        getTransaction,
        isInitialized: () => sentryInitialized
    });
}, {
    name: 'sentry'
});

module.exports = sentryPlugin;
module.exports.captureError = captureError;
module.exports.captureMessage = captureMessage;
module.exports.addBreadcrumb = addBreadcrumb;
module.exports.setContext = setContext;
module.exports.setExtra = setExtra;
module.exports.getTransaction = getTransaction;
