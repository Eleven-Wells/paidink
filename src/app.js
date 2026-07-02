const mongoose = require('mongoose');
mongoose.set('bufferTimeoutMS', 60000);

const fastify = require('fastify')({
    logger: {
        level: process.env.LOG_LEVEL || 'info',
        transport: !process.env.VERCEL && process.env.NODE_ENV !== 'production' ? {
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
const fastifyCors = require('@fastify/cors');
const fastifyHelmet = require('@fastify/helmet');
const fastifyRateLimit = require('@fastify/rate-limit');
const path = require('path');
const ejs = require('ejs');
const dotenv = require('dotenv');
dotenv.config();

const { loadConfig, getAllowedOrigins, CATEGORY_ENUM, CATEGORY_NAMES } = require('./config');
const { initLogto } = require('./services/LogtoService');

const { assetUrl } = require('./config/assets');
const errorHandlerPlugin = require('./plugins/error-handler');
const sentryPlugin = require('./plugins/sentry');
const requestIdPlugin = require('./plugins/request-id');
const validationPlugin = require('./plugins/validation');
const adminAuthPlugin = require('./plugins/admin-auth');
const adminSessionPlugin = require('./plugins/admin-session');
const auditPlugin = require('./plugins/audit');
const cachePlugin = require('./plugins/cache');
const swaggerPlugin = require('./plugins/swagger');
const authPlugin = require('./plugins/auth');

async function buildApp() {
    loadConfig();
    await initLogto();

    // Register static assets plugin only if reply.sendFile isn't already decorated.
    // This avoids "The decorator 'sendFile' has already been added!" when buildApp
    // is invoked more than once in the same process (serverless + server handlers).
    const shouldRegisterStatic = (typeof fastify.hasReplyDecorator === 'function')
        ? !fastify.hasReplyDecorator('sendFile')
        : true;

    if (shouldRegisterStatic) {
        try {
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

        } catch (err) {
            // If another module already decorated reply.sendFile, skip and warn.
            if (err && err.message && err.message.includes("The decorator 'sendFile' has already been added")) {
                fastify.log.warn({ component: 'static' }, "Static plugin skipped: sendFile already decorated");
            } else {
                throw err;
            }
        }
    }

    await fastify.register(fastifyView, {
        engine: { ejs },
        root: path.join(__dirname, 'views'),
        defaultContext: {
            CATEGORY_ENUM,
            CATEGORY_NAMES,
            assetUrl
        }
    });

    await fastify.register(fastifyCookie);

    if (!process.env.JWT_SECRET) {
        throw new Error('JWT_SECRET environment variable is required');
    }
    await fastify.register(fastifyJwt, {
        secret: process.env.JWT_SECRET
    });

    await fastify.register(fastifyHelmet, {
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'", "'unsafe-inline'", 'cdn.jsdelivr.net', 'cdn.tailwindcss.com', 'cdnjs.cloudflare.com', 'https://storage.googleapis.com'],
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

    const fastifySSE = require('@fastify/sse');
    await fastify.register(fastifySSE);

    await fastify.register(sentryPlugin);
    await fastify.register(requestIdPlugin);
    await fastify.register(validationPlugin);
    await fastify.register(cachePlugin);
    await fastify.register(adminAuthPlugin);
    await fastify.register(adminSessionPlugin);
    await fastify.register(auditPlugin);
    await fastify.register(authPlugin);
    await fastify.register(errorHandlerPlugin);
    await fastify.register(swaggerPlugin);

    fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
        const raw = body.toString();
        req.rawBody = raw;
        try {
            done(null, JSON.parse(raw));
        } catch (err) {
            done(err);
        }
    });

    fastify.get('/sw.js', (req, reply) => {
        reply.header('Service-Worker-Allowed', '/');
        reply.header('Cache-Control', 'no-cache');
        reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' https://storage.googleapis.com; connect-src 'self' https: http:; worker-src 'self' blob:");
        return reply.sendFile('sw.js');
    });

    fastify.register(require('./routes/pages'));
    fastify.register(require('./routes/api'), { prefix: '/api' });
    fastify.register(require('./routes/auth'), { prefix: '/api/auth' });
    fastify.register(require('./routes/reads'), { prefix: '/api/reads' });
    fastify.register(require('./routes/admin'));
    fastify.register(require('./routes/recommendations'));
    fastify.register(require('./routes/webhook'));
    fastify.register(require('./routes/push'), { prefix: '/api/push' });

    await fastify.after();
}

fastify.buildApp = buildApp;
fastify.fastify = fastify;

module.exports = fastify;
module.exports.default = fastify;
module.exports.__esModule = true;
