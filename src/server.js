const { fastify, buildApp } = require('./app');
const { disconnectRedis, getRedisConnection } = require('./config/redis');
const { isFeatureEnabled } = require('./config/features');
const cronPlugin = require('./plugins/cron-plugin');

const DEFAULT_PORT = process.env.PORT || 5050;
let PORT = DEFAULT_PORT;
let dbConnected = false;

async function isPortInUse(port) {
    return new Promise((resolve) => {
        const server = require('net').createServer();
        server.once('error', (err) => {
            resolve(err.code === 'EADDRINUSE');
        });
        server.once('listening', () => {
            server.close();
            resolve(false);
        });
        server.listen(port, '0.0.0.0');
    });
}

async function findAvailablePort(startPort) {
    let port = startPort;
    while (await isPortInUse(port)) {
        port++;
    }
    return port;
}

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

        try {
            if (!isFeatureEnabled('content', 'aiGeneration')) {
                fastify.log.info({ component: 'init' }, 'AI generation disabled, skipping initial fetch');
            } else {
                const fetchLatestBlog = require('./tools/fetchTools');
                await fetchLatestBlog();
                fastify.log.info({ component: 'init' }, 'Sample data initialized');
            }
        } catch (err) {
            fastify.log.warn({ component: 'init', error: err.message }, 'Failed to fetch latest blog');
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
        await buildApp();
        addDecorators();

        await fastify.register(cronPlugin);

        await initializeRedis();

        await initializeDatabase();

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

        PORT = await findAvailablePort(DEFAULT_PORT);
        if (PORT !== DEFAULT_PORT) {
            fastify.log.warn({ component: 'server', port: PORT }, `Port ${DEFAULT_PORT} in use`);
        }

        await fastify.listen({
            port: PORT,
            host: '0.0.0.0'
        });

        if (fastify.cron && fastify.cron.startAllJobs) {
            fastify.cron.startAllJobs();
            fastify.log.info({ component: 'cron' }, 'All cron jobs started');
        }

        fastify.log.info({
            component: 'server',
            port: PORT,
            environment: process.env.NODE_ENV
        }, `Server running at http://localhost:${PORT}`);

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
