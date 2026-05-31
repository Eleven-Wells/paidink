const dotenv = require('dotenv');
dotenv.config();

const CATEGORY_ENUM = ['development', 'business', 'health', 'lifestyle', 'news', 'sports', 'entertainment', 'politics'];

const CATEGORY_NAMES = {
    en: {
        development: 'Development',
        business: 'Business',
        health: 'Health',
        lifestyle: 'Lifestyle',
        news: 'News',
        sports: 'Sports',
        entertainment: 'Entertainment',
        politics: 'Politics'
    },
    es: {
        development: 'Desarrollo',
        business: 'Negocios',
        health: 'Salud',
        lifestyle: 'Estilo de Vida',
        news: 'Noticias',
        sports: 'Deportes',
        entertainment: 'Entretenimiento',
        politics: 'Política'
    }
};

class ConfigError extends Error {
    constructor(message, variable) {
        super(message);
        this.name = 'ConfigError';
        this.variable = variable;
    }
}

const configSchema = {
    required: {
        MONGO_URI: {
            validate: (val) => val && val.length > 0,
            message: 'MongoDB connection URI is required'
        }
    },
    optional: {
        REDIS_HOST: { default: 'localhost' },
        REDIS_PORT: { default: '6379', parse: parseInt },
        REDIS_PASSWORD: { default: null },
        PORT: { default: '5050', parse: parseInt },
        NODE_ENV: { default: 'development' },
        OPENAI_API_KEY: { default: null },
        OPENAI_MODEL: { default: 'gpt-4o-mini' },
        UNSPLASH_ACCESS_KEY: { default: null },
        NEWS_API_KEY: { default: null },
        ADMIN_API_KEY: { default: null },
        ADMIN_EMAIL: { default: 'admin@localhost' },
        ADMIN_PASSWORD: { default: 'admin123' },
        ADMIN_ALLOWED_IPS: { default: null },
        API_KEY_ROTATION_ENABLED: { default: 'false' },
        ADMIN_RATE_LIMIT_MAX: { default: '100', parse: parseInt },
        ADMIN_RATE_LIMIT_WINDOW: { default: '60000', parse: parseInt },
        CSRF_ENABLED: { default: 'false' },
        CSRF_SECRET: { default: null },
        ALLOWED_ORIGINS: { default: 'http://localhost:5050,http://localhost:3000' },
        BASE_URL: {
            default: process.env.NODE_ENV === 'production'
                ? 'https://nook-app.onrender.com'
                : `http://localhost:${process.env.PORT || 5050}`
        },
        SMTP_HOST: { default: null },
        SMTP_PORT: { default: '587', parse: parseInt },
        SMTP_USER: { default: null },
        SMTP_PASS: { default: null },
        LOG_LEVEL: { default: 'info' },
        SENTRY_DSN: { default: null },
        MAX_CONTENT_LENGTH: { default: '5000', parse: parseInt },
        CONTENT_SOURCES_LIMIT: { default: '10', parse: parseInt },
        AI_SUMMARY_LENGTH: { default: '300', parse: parseInt },
        AI_REWRITE_LENGTH: { default: '800', parse: parseInt },
        CONTENT_INGESTION_SCHEDULE: { default: '0 */6 * * *' },
        FEED_UPDATE_SCHEDULE: { default: '0 */2 * * *' },
        TOOLS_UPDATE_SCHEDULE: { default: '0 * * * *' },
        SEO_UPDATE_SCHEDULE: { default: '0 3 * * *' },
        CLEANUP_SCHEDULE: { default: '0 4 * * 0' },
        READER_POOL_SWEEP_SCHEDULE: { default: '0 0 * * *' },
        UNFUNDED_READS_SWEEP_SCHEDULE: { default: '30 0 * * *' }
    }
};

function validateConfig() {
    const errors = [];

    for (const [key, schema] of Object.entries(configSchema.required)) {
        const value = process.env[key];
        if (!schema.validate(value)) {
            errors.push(new ConfigError(schema.message, key));
        }
    }

    if (errors.length > 0) {
        throw errors[0];
    }

    if (process.env.CSRF_ENABLED === 'true' && !process.env.CSRF_SECRET) {
        console.warn('WARNING: CSRF_ENABLED is true but CSRF_SECRET is not set');
    }
}

function parseValue(value, schema) {
    if (schema.parse) {
        return schema.parse(value);
    }
    return value;
}

let cachedConfig = null;

function getConfig() {
    if (cachedConfig) return cachedConfig;

    const config = {};

    for (const [key, schema] of Object.entries(configSchema.required)) {
        config[key] = process.env[key];
    }

    for (const [key, schema] of Object.entries(configSchema.optional)) {
        const value = process.env[key];
        config[key] = value !== undefined ? parseValue(value, schema) : schema.default;
    }

    Object.defineProperty(config, 'isProduction', {
        get() {
            return this.NODE_ENV === 'production';
        }
    });

    Object.defineProperty(config, 'isDevelopment', {
        get() {
            return this.NODE_ENV === 'development';
        }
    });

    Object.defineProperty(config, 'security', {
        get() {
            return {
                csrfEnabled: this.CSRF_ENABLED === 'true',
                apiKeyRotation: this.API_KEY_ROTATION_ENABLED === 'true',
                ipAllowlist: this.ADMIN_ALLOWED_IPS ? this.ADMIN_ALLOWED_IPS.split(',') : [],
                rateLimit: {
                    max: this.ADMIN_RATE_LIMIT_MAX,
                    window: this.ADMIN_RATE_LIMIT_WINDOW
                }
            };
        }
    });

    cachedConfig = Object.freeze(config);
    return cachedConfig;
}

function loadConfig() {
    try {
        validateConfig();
        return getConfig();
    } catch (error) {
        console.error(`Configuration error: ${error.message}`);
        if (error instanceof ConfigError) {
            console.error(`Missing variable: ${error.variable}`);
        }
        throw error;
    }
}

function getContentSources() {
    const config = getConfig();
    const sources = [
        { url: 'https://dev.to/feed', category: 'development', type: 'rss' }
    ];

    if (config.NEWS_API_KEY) {
        sources.push({
            url: 'https://newsapi.org/v2/everything?q=technology&language=en&sortBy=publishedAt',
            category: 'development',
            type: 'url',
            requiresAuth: true
        });
    }

    sources.push({
        url: 'https://api.github.com/search/repositories?q=created:>2023-10-01&sort=stars&order=desc',
        category: 'development',
        type: 'url'
    });

    return sources;
}

function getAllowedOrigins() {
    const config = getConfig();
    return config.ALLOWED_ORIGINS.split(',').map(s => s.trim());
}

function resetConfig() {
    cachedConfig = null;
}

const features = require('./features');

module.exports = {
    loadConfig,
    getConfig,
    getContentSources,
    getAllowedOrigins,
    validateConfig,
    resetConfig,
    ConfigError,
    CATEGORY_ENUM,
    CATEGORY_NAMES,
    ...features
};
