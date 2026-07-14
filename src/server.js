const { fastify, buildApp } = require('./app');
const { disconnectRedis, getRedisConnection } = require('./config/redis');
const { isFeatureEnabled } = require('./config/features');
const { ensureVapidKeys } = require('./services/PushService');
const cronPlugin = require('./plugins/cron-plugin');

let dbConnected = false;
let paymentWorkerInstance = null;
const servicesReady = { database: false, redis: false };

async function initializeRedis() {
    fastify.log.info({ component: 'redis' }, 'Connecting Redis');
    try {
        const redis = getRedisConnection();
        await redis.ping();
        servicesReady.redis = true;
        fastify.log.info({ component: 'redis' }, 'Redis connected');
        return true;
    } catch (err) {
        fastify.log.warn({ component: 'redis', error: err.message }, 'Redis connection failed');
        return false;
    }
}

async function initializeDatabase() {
    fastify.log.info({ component: 'database' }, 'Connecting MongoDB');
    try {
        const { connectDB } = require('./db');
        await connectDB();
        dbConnected = true;
        servicesReady.database = true;
        fastify.log.info({ component: 'database' }, 'MongoDB connected');

        try {
            const { seedDefaultData } = require('./services/ads/AdSimulationService');
            await seedDefaultData();
            fastify.log.info({ component: 'ads' }, 'Default ad data seeded');
        } catch (err) {
            fastify.log.warn({ component: 'ads', error: err.message }, 'Default ad data seeding failed');
        }

        return true;
    } catch (err) {
        fastify.log.error({ component: 'database', error: err.message }, 'MongoDB connection failed');
        dbConnected = false;
        return false;
    }
}

function addDecorators() {
    fastify.decorate('db', {
        getter() {
            return {
                connected: dbConnected,
                connection: dbConnected ? require('mongoose') : null
            };
        }
    });
}

function registerProviders() {
    const ProviderFactory = require('./services/ads/providers/ProviderFactory');
    const MockProvider = require('./services/ads/providers/MockProvider');
    ProviderFactory.register('mock', MockProvider);

    const AdProviderInterface = require('./services/ads/providers/AdProviderInterface');
    class DirectProvider extends AdProviderInterface {
        get name() { return 'direct'; }
        async getAds() { return []; }
        async recordImpression() {}
        async recordClick() {}
        async healthCheck() { return true; }
    }
    ProviderFactory.register('direct', DirectProvider);
}

async function startWorkers() {
    if (!servicesReady.redis) {
        fastify.log.warn({ component: 'worker' }, 'Redis unavailable, workers deferred');
        return;
    }
    if (!servicesReady.database) {
        fastify.log.warn({ component: 'worker' }, 'Database unavailable, workers deferred');
        return;
    }

    if (isFeatureEnabled('content', 'aiGeneration')) {
        fastify.log.info({ component: 'worker' }, 'Starting content worker');
        const worker = require('./worker');
        try {
            const status = await worker.start();
            fastify.log.info({ component: 'worker', status }, 'Content worker ready');
        } catch (err) {
            fastify.log.warn({ component: 'worker', error: err.message }, 'Content worker startup failed');
        }
    } else {
        fastify.log.info({ component: 'worker' }, 'Content worker disabled');
    }

    fastify.log.info({ component: 'payment-worker' }, 'Starting payment worker');
    const { startPaymentWorker } = require('./worker/paymentWorker');
    try {
        const pw = await startPaymentWorker();
        if (pw) {
            paymentWorkerInstance = pw;
            fastify.log.info({ component: 'payment-worker' }, 'Payment worker ready');
        } else {
            fastify.log.warn({ component: 'payment-worker' }, 'Payment worker not started (no Redis)');
        }
    } catch (err) {
        fastify.log.warn({ component: 'payment-worker', error: err.message }, 'Payment worker startup failed');
    }

    fastify.log.info({ component: 'server' }, 'Workers started');
}

async function start() {
    try {
        fastify.log.info({ component: 'server' }, 'Starting Paidink server');

        await buildApp();
        addDecorators();

        if (process.env.NODE_ENV === 'production') {
            const healthPaths = new Set(['/health', '/healthz', '/ready', '/readyz', '/live']);
            const localHosts = new Set(['localhost', '127.0.0.1']);

            fastify.addHook('onRequest', async (request, reply) => {
                if (healthPaths.has(request.url)) return;
                if (localHosts.has(request.hostname)) return;

                const proto = request.headers['x-forwarded-proto'];
                if (typeof proto !== 'string' || proto === 'https') return;

                return reply.code(301).redirect(`https://${request.headers.host}${request.url}`);
            });
        }

        fastify.get('/healthz', async (req, reply) => {
            return reply.code(200).send({
                status: 'ok',
                uptime: process.uptime(),
                timestamp: new Date().toISOString(),
                environment: process.env.NODE_ENV
            });
        });

        await fastify.register(cronPlugin);

        fastify.get('/readyz', async (req, reply) => {
            return reply.code(200).send({
                status: 'ready',
                database: dbConnected
            });
        });

        const PORT = Number(process.env.PORT || 3000);

        const dbReady = await initializeDatabase();

        await fastify.listen({
            port: PORT,
            host: '0.0.0.0'
        });

        fastify.log.info({ component: 'server', port: PORT, environment: process.env.NODE_ENV }, `Server running on port ${PORT}`);

        (async () => {
            try {
                const redisOk = await initializeRedis();

                if (dbReady) {
                    await ensureVapidKeys().catch((err) => {
                        fastify.log.warn({ component: 'push' }, 'VAPID key initialization failed: ' + err.message);
                    });
                }

                registerProviders();

                if (fastify.cron && fastify.cron.startAllJobs) {
                    fastify.cron.startAllJobs();
                    fastify.log.info({ component: 'cron' }, 'All cron jobs started');
                }

                if (redisOk && dbReady) {
                    await startWorkers();
                } else {
                    fastify.log.warn({ component: 'worker' }, 'Dependencies not ready, workers deferred');
                }

                fastify.log.info({ component: 'server', services: servicesReady }, 'Background initialization complete');
            } catch (err) {
                fastify.log.warn({ component: 'server', error: err.message }, 'Startup dependency failed');
            }
        })();

    } catch (err) {
        fastify.log.fatal({ component: 'server', error: err.message }, 'Server startup failed');
        process.exit(1);
    }
}

async function gracefulShutdown(signal) {
    fastify.log.info({ component: 'server', signal }, 'Shutting down gracefully');

    const forceExit = setTimeout(() => {
        fastify.log.error({ component: 'shutdown' }, 'Forced exit after shutdown timeout');
        process.exit(1);
    }, 25000);

    try {
        if (fastify.cron && fastify.cron.stopAllJobs) {
            fastify.cron.stopAllJobs();
        }

        await fastify.close();
        fastify.log.info({ component: 'server' }, 'HTTP server closed');

        const { closeWorker } = require('./worker');
        await closeWorker().catch(() => {});

        if (paymentWorkerInstance) {
            await paymentWorkerInstance.close().catch(() => {});
            paymentWorkerInstance = null;
        }

        if (dbConnected) {
            const mongoose = require('mongoose');
            if (mongoose.connection.readyState === 1) {
                await mongoose.connection.close();
                fastify.log.info({ component: 'database' }, 'Database connection closed');
            }
        }

        await disconnectRedis();
        fastify.log.info({ component: 'redis' }, 'Redis connection closed');

        clearTimeout(forceExit);
    } catch (err) {
        fastify.log.error({ component: 'shutdown', error: err.message }, 'Shutdown error');
        process.exit(1);
    }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (err) => {
    fastify.log.fatal({ component: 'uncaught', error: err.message, stack: err.stack }, 'Uncaught exception');
    gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
    fastify.log.fatal({ component: 'unhandled', reason: String(reason) }, 'Unhandled rejection');
    gracefulShutdown('unhandledRejection');
});

module.exports = fastify;

if (require.main === module) {
    start();
}
