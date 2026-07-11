const { fastify, buildApp } = require('./app');
const { disconnectRedis, getRedisConnection } = require('./config/redis');
const { isFeatureEnabled } = require('./config/features');
const { ensureVapidKeys } = require('./services/PushService');
const cronPlugin = require('./plugins/cron-plugin');

let dbConnected = false;

async function initializeRedis() {
    try {
        const redis = getRedisConnection();
        await redis.ping();
        fastify.log.info({ component: 'redis' }, 'Redis connected successfully');
        return true;
    } catch (err) {
        fastify.log.warn({ component: 'redis', error: err.message }, 'Redis connection failed');
        return false;
    }
}

async function initializeDatabase() {
    try {
        const { connectDB } = require('./db');
        await connectDB();
        dbConnected = true;
        fastify.log.info({ component: 'database' }, 'Database connected successfully');

        try {
            const { seedDefaultData } = require('./services/ads/AdSimulationService');
            await seedDefaultData();
            fastify.log.info({ component: 'ads' }, 'Default ad data seeded');
        } catch (err) {
            fastify.log.warn({ component: 'ads', error: err.message }, 'Default ad data seeding failed');
        }
    } catch (err) {
        fastify.log.error({ component: 'database', error: err.message }, 'Database connection failed');
        dbConnected = false;
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

async function start() {
    try {
        fastify.log.info({ component: 'server' }, 'Starting Paidink server');

        await buildApp();
        addDecorators();

        if (process.env.NODE_ENV === 'production') {
            fastify.addHook('onRequest', async (request, reply) => {
                const proto = request.headers['x-forwarded-proto'] || (request.socket.encrypted ? 'https' : 'http');
                if (proto !== 'https') {
                    reply.code(301).redirect(`https://${request.headers.host}${request.url}`);
                }
            });
        }

        await fastify.register(cronPlugin);

        fastify.get('/healthz', async (req, reply) => {
            return reply.code(200).send({ status: 'ok' });
        });

        const port = parseInt(process.env.PORT, 10) || 5050;

        await fastify.listen({
            port,
            host: '0.0.0.0'
        });

        fastify.log.info({ component: 'server', port, environment: process.env.NODE_ENV }, 'Paidink server listening');

        if (fastify.cron && fastify.cron.startAllJobs) {
            fastify.cron.startAllJobs();
            fastify.log.info({ component: 'cron' }, 'All cron jobs started');
        }

        Promise.all([
            initializeRedis(),
            initializeDatabase()
        ]).then(async () => {
            if (dbConnected) {
                await ensureVapidKeys().catch((err) => {
                    fastify.log.warn({ component: 'push' }, 'VAPID key initialization failed: ' + err.message);
                });
            }

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

            if (!isFeatureEnabled('content', 'aiGeneration')) {
                fastify.log.info({ component: 'worker' }, 'AI generation disabled, worker not started');
            } else {
                const worker = require('./worker');
                worker.start().then(status => {
                    fastify.log.info({ component: 'worker', status }, 'Worker started');
                }).catch(err => {
                    fastify.log.warn({ component: 'worker', error: err.message }, 'Worker startup failed');
                });
            }

            const { startPaymentWorker } = require('./worker/paymentWorker');
            startPaymentWorker().then(worker => {
                if (worker) {
                    fastify.log.info({ component: 'payment-worker' }, 'Payment worker started');
                } else {
                    fastify.log.warn({ component: 'payment-worker' }, 'Payment worker not started (no Redis)');
                }
            }).catch(err => {
                fastify.log.warn({ component: 'payment-worker', error: err.message }, 'Payment worker startup failed');
            });

            fastify.log.info({ component: 'server' }, 'Background initialization complete');
        }).catch(err => {
            fastify.log.warn({ component: 'server', error: err.message }, 'Background initialization error');
        });

    } catch (err) {
        fastify.log.fatal({ component: 'server', error: err.message }, 'Server startup failed');
        process.exit(1);
    }
}

async function gracefulShutdown(signal) {
    fastify.log.info({ component: 'server', signal }, 'Shutting down gracefully');

    try {
        if (fastify.cron && fastify.cron.stopAllJobs) {
            fastify.cron.stopAllJobs();
        }

        await fastify.close();
        fastify.log.info({ component: 'server' }, 'HTTP server closed');

        if (dbConnected) {
            const mongoose = require('mongoose');
            if (mongoose.connection.readyState === 1) {
                await mongoose.connection.close();
                fastify.log.info({ component: 'database' }, 'Database connection closed');
            }
        }

        await disconnectRedis();
        fastify.log.info({ component: 'redis' }, 'Redis connection closed');

        process.exit(0);
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

process.on('unhandledRejection', (reason, promise) => {
    fastify.log.fatal({ component: 'unhandled', reason: String(reason) }, 'Unhandled rejection');
    gracefulShutdown('unhandledRejection');
});

module.exports = fastify;

if (require.main === module) {
    start();
}
