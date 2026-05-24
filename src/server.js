const fastify = require('fastify')({
    logger: {
        level: process.env.LOG_LEVEL || 'info',
        transport: process.env.NODE_ENV !== 'production' ? {
            targets: [{
                target: 'pino-pretty',
                options: {
                    colorize: true,
                    translateTime: 'SYS:standard',
                    ignore: 'pid,hostname'
                },
                level: 'info'
            }]
        } : undefined,
        serializers: {
            req(request) {
                return {
                    method: request.method,
                    url: request.url,
                    path: request.routerPath,
                    parameters: request.params,
                    headers: {
                        host: request.headers.host,
                        'user-agent': request.headers['user-agent'],
                        'content-type': request.headers['content-type'],
                        'x-request-id': request.headers['x-request-id']
                    }
                };
            },
            res(reply) {
                return {
                    statusCode: reply.statusCode
                };
            }
        }
    },
    routerOptions: {
        ignoreTrailingSlash: true
    },
    genReqId: (req) => {
        const crypto = require('crypto');
        return `${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}`;
    }
});

const fastifyView = require('@fastify/view');
const fastifyStatic = require('@fastify/static');
const fastifyCookie = require('@fastify/cookie');
const fastifyJwt = require('@fastify/jwt');
const fastifyCache = require('@fastify/caching');
const fastifyCors = require('@fastify/cors');
const fastifyHelmet = require('@fastify/helmet');
const fastifyRateLimit = require('@fastify/rate-limit');
const path = require('path');
const ejs = require('ejs');
const dotenv = require('dotenv');
dotenv.config();

const { loadConfig, getAllowedOrigins, CATEGORY_ENUM, CATEGORY_NAMES } = require('./config');
const { disconnectRedis, getRedisConnection } = require('./config/redis');
const errorHandlerPlugin = require('./plugins/error-handler');
const sentryPlugin = require('./plugins/sentry');
const requestIdPlugin = require('./plugins/request-id');
const validationPlugin = require('./plugins/validation');
const adminAuthPlugin = require('./plugins/admin-auth');
const adminSessionPlugin = require('./plugins/admin-session');
const auditPlugin = require('./plugins/audit');
const cachePlugin = require('./plugins/cache');
const cronPlugin = require('./plugins/cron-plugin');
const swaggerPlugin = require('./plugins/swagger');
const authPlugin = require('./plugins/auth');

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

async function registerPlugins() {
    await fastify.register(fastifyStatic, {
        root: path.join(__dirname, '..', 'public'),
        prefix: '/public/',
        setHeaders: (res, filepath) => {
            const ext = path.extname(filepath).toLowerCase().slice(1);

            if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) {
                res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
                res.setHeader('CDN-Cache-Control', 'max-age=604800');
            } else if (['css', 'js'].includes(ext)) {
                res.setHeader('Cache-Control', 'public, max-age=3600');
            } else {
                res.setHeader('Cache-Control', 'public, max-age=3600');
            }

            res.setHeader('X-Content-Type-Options', 'nosniff');
        }
    });

    await fastify.register(fastifyView, {
        engine: { ejs },
        root: path.join(__dirname, 'views'),
        defaultContext: {
            CATEGORY_ENUM,
            CATEGORY_NAMES
        }
    });

    await fastify.register(fastifyCookie);

    await fastify.register(fastifyJwt, {
        secret: process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production'
    });

    await fastify.register(fastifyHelmet, {
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'", "'unsafe-inline'", 'cdn.jsdelivr.net', 'cdn.tailwindcss.com', 'cdnjs.cloudflare.com'],
                scriptSrcAttr: ["'unsafe-inline'"],
                styleSrc: ["'self'", "'unsafe-inline'", 'fonts.googleapis.com', 'cdn.jsdelivr.net', 'cdn.tailwindcss.com', 'cdnjs.cloudflare.com'],
                imgSrc: ["'self'", 'data:', 'images.unsplash.com', 'via.placeholder.com'],
                fontSrc: ["'self'", 'fonts.gstatic.com', 'fonts.googleapis.com'],
                connectSrc: ["'self'"],
                frameAncestors: ["'none'"]
            }
        },
        hsts: {
            maxAge: 31536000,
            includeSubDomains: true
        }
    });

    await fastify.register(fastifyRateLimit, {
        max: (request, reply) => {
            const path = request.url;
            const method = request.method;
            
            if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
                if (path.includes('/api/auth/register')) return 5;
                if (path.includes('/api/auth/login')) return 10;
                if (path.includes('/api/withdraw')) return 20;
                if (path.includes('/api/achievements')) return 30;
                if (path.includes('/api/subscribe')) return 20;
                return 50;
            }
            
            if (method === 'GET') {
                if (path.includes('/api/posts')) return 200;
                if (path.includes('/api/latest-posts')) return 200;
                if (path.includes('/api/search')) return 100;
                return 100;
            }
            
            return 100;
        },
        timeWindow: '1 minute',
        keyGenerator: (request) => {
            const path = request.url;
            const method = request.method;
            
            if (path.includes('/api/auth/register')) return `register:${request.ip}`;
            if (path.includes('/api/auth/login')) return `login:${request.ip}`;
            if (path.includes('/api/withdraw')) return `withdraw:${request.ip}`;
            
            return request.ip;
        },
        errorResponseBuilder: (request, context) => ({
            success: false,
            error: {
                code: 'RATE_001',
                message: 'Rate limit exceeded',
                statusCode: 429,
                retryAfter: Math.ceil(context.ttl / 1000)
            }
        })
    });

    await fastify.register(fastifyCors, {
        origin: getAllowedOrigins(),
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        credentials: true
    });

    await fastify.register(sentryPlugin);
    await fastify.register(requestIdPlugin);
    await fastify.register(validationPlugin);
    await fastify.register(cachePlugin);
    await fastify.register(adminAuthPlugin);
    await fastify.register(adminSessionPlugin);
    await fastify.register(auditPlugin);
    await fastify.register(authPlugin);
    await fastify.register(errorHandlerPlugin);
    await fastify.register(cronPlugin);
    await fastify.register(swaggerPlugin);
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
            const { isFeatureEnabled } = require('./config/features');
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
        loadConfig();
        addDecorators();
        await registerPlugins();

        fastify.register(require('./routes/pages'));
        fastify.register(require('./routes/api'), { prefix: '/api' });
        fastify.register(require('./routes/auth'), { prefix: '/api/auth' });
        fastify.register(require('./routes/reads'), { prefix: '/api/reads' });
        fastify.register(require('./routes/admin'));

        initializeRedis();

        initializeDatabase().catch(err => {
            fastify.log.error({ component: 'init', error: err.message }, 'Database initialization error');
        });

        const { isFeatureEnabled } = require('./config/features');
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
