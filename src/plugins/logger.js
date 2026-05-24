const fp = require('fastify-plugin');
const { AsyncLocalStorage } = require('async_hooks');
const { captureError, captureMessage } = require('./sentry');

const requestContextStorage = new AsyncLocalStorage();

function createRequestContext(context = {}) {
    return {
        ...context,
        timestamp: new Date().toISOString()
    };
}

function getRequestContext() {
    return requestContextStorage.getStore() || {};
}

function createComponentLogger(componentName) {
    return {
        debug(message, context = {}) {
            const ctx = { ...getRequestContext(), ...context, component: componentName };
            console.debug(`[${componentName}] [DEBUG] ${message}`, ctx);
        },

        info(message, context = {}) {
            const ctx = { ...getRequestContext(), ...context, component: componentName };
            console.info(`[${componentName}] [INFO] ${message}`, ctx);
        },

        warn(message, context = {}) {
            const ctx = { ...getRequestContext(), ...context, component: componentName };
            console.warn(`[${componentName}] [WARN] ${message}`, ctx);
        },

        error(message, context = {}) {
            const ctx = { ...getRequestContext(), ...context, component: componentName };
            console.error(`[${componentName}] [ERROR] ${message}`, ctx);
            if (ctx.error && ctx.error instanceof Error) {
                captureError(ctx.error, { component: componentName, ...context });
            }
        },

        fatal(message, context = {}) {
            const ctx = { ...getRequestContext(), ...context, component: componentName };
            console.error(`[${componentName}] [FATAL] ${message}`, ctx);
            if (ctx.error && ctx.error instanceof Error) {
                captureError(ctx.error, { component: componentName, ...context });
            }
        }
    };
}

function createRequestLogger(request) {
    const requestId = request.id || generateRequestId();
    const startTime = Date.now();

    return {
        debug(message, context = {}) {
            const ctx = {
                requestId,
                method: request.method,
                url: request.url,
                ...context
            };
            request.log.debug({ ...ctx, responseTime: Date.now() - startTime }, message);
        },

        info(message, context = {}) {
            const ctx = {
                requestId,
                method: request.method,
                url: request.url,
                ...context
            };
            request.log.info({ ...ctx, responseTime: Date.now() - startTime }, message);
        },

        warn(message, context = {}) {
            const ctx = {
                requestId,
                method: request.method,
                url: request.url,
                ...context
            };
            request.log.warn({ ...ctx, responseTime: Date.now() - startTime }, message);
        },

        error(message, context = {}) {
            const ctx = {
                requestId,
                method: request.method,
                url: request.url,
                ...context
            };
            request.log.error({ ...ctx, responseTime: Date.now() - startTime }, message);

            if (context.error) {
                captureError(context.error, {
                    requestId,
                    component: 'http',
                    method: request.method,
                    url: request.url
                });
            }
        }
    };
}

function generateRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function createJobLogger(job) {
    const jobId = job.id || job.data?.jobId || 'unknown';
    const startTime = Date.now();

    return {
        debug(message, context = {}) {
            const ctx = { jobId, ...context };
            console.debug(`[Job:${jobId}] [DEBUG] ${message}`, ctx);
        },

        info(message, context = {}) {
            const ctx = { jobId, ...context, processingTime: Date.now() - startTime };
            console.info(`[Job:${jobId}] [INFO] ${message}`, ctx);
        },

        warn(message, context = {}) {
            const ctx = { jobId, ...context, processingTime: Date.now() - startTime };
            console.warn(`[Job:${jobId}] [WARN] ${message}`, ctx);
        },

        error(message, context = {}) {
            const ctx = { jobId, ...context, processingTime: Date.now() - startTime };
            console.error(`[Job:${jobId}] [ERROR] ${message}`, ctx);

            if (context.error) {
                captureError(context.error, {
                    jobId,
                    component: 'worker',
                    jobData: job.data
                });
            }
        },

        progress(percent) {
            console.info(`[Job:${jobId}] [PROGRESS] ${percent}%`);
        }
    };
}

function createSystemLogger() {
    return createComponentLogger('System');
}

async function runWithContext(context, fn) {
    return requestContextStorage.run(context, fn);
}

const loggerPlugin = fp(async (fastify) => {
    fastify.decorate('createRequestLogger', createRequestLogger);
    fastify.decorate('createComponentLogger', createComponentLogger);
    fastify.decorate('createJobLogger', createJobLogger);
    fastify.decorate('createSystemLogger', createSystemLogger);
    fastify.decorate('runWithContext', runWithContext);
    fastify.decorate('getRequestContext', getRequestContext);
}, {
    name: 'logger'
});

module.exports = loggerPlugin;
module.exports.createComponentLogger = createComponentLogger;
module.exports.createRequestLogger = createRequestLogger;
module.exports.createJobLogger = createJobLogger;
module.exports.createSystemLogger = createSystemLogger;
module.exports.createRequestContext = createRequestContext;
module.exports.getRequestContext = getRequestContext;
module.exports.runWithContext = runWithContext;
module.exports.generateRequestId = generateRequestId;
