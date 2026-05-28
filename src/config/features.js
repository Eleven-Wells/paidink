const dotenv = require('dotenv');
dotenv.config();

const featureFlags = {
    content: {
        aiGeneration: {
            enabled: process.env.FEATURE_AI_GENERATION !== 'false',
            description: 'Enable AI-powered content generation',
            envVar: 'FEATURE_AI_GENERATION'
        },
        autoIngestion: {
            enabled: process.env.FEATURE_AUTO_INGESTION !== 'false',
            description: 'Enable automatic content ingestion from RSS feeds',
            envVar: 'FEATURE_AUTO_INGESTION'
        },
        imageGeneration: {
            enabled: process.env.FEATURE_IMAGE_GENERATION !== 'false',
            description: 'Enable AI-generated images for posts',
            envVar: 'FEATURE_IMAGE_GENERATION'
        },
        internalLinking: {
            enabled: process.env.FEATURE_INTERNAL_LINKING !== 'false',
            description: 'Enable automatic internal linking between posts',
            envVar: 'FEATURE_INTERNAL_LINKING'
        },
        recommendationEngine: {
            enabled: process.env.FEATURE_RECOMMENDATION_ENGINE !== 'false',
            description: 'Enable personalized recommendation engine',
            envVar: 'FEATURE_RECOMMENDATION_ENGINE'
        }
    },
    seo: {
        sitemapGeneration: {
            enabled: process.env.FEATURE_SITEMAP !== 'false',
            description: 'Enable automatic sitemap generation',
            envVar: 'FEATURE_SITEMAP'
        },
        seoUpdates: {
            enabled: process.env.FEATURE_SEO_UPDATES !== 'false',
            description: 'Enable scheduled SEO file updates',
            envVar: 'FEATURE_SEO_UPDATES'
        }
    },
    social: {
        newsletter: {
            enabled: process.env.FEATURE_NEWSLETTER !== 'false',
            description: 'Enable newsletter subscription',
            envVar: 'FEATURE_NEWSLETTER'
        },
        sharing: {
            enabled: process.env.FEATURE_SOCIAL_SHARING !== 'true',
            description: 'Enable social sharing buttons',
            envVar: 'FEATURE_SOCIAL_SHARING'
        }
    },
    security: {
        rateLimiting: {
            enabled: process.env.FEATURE_RATE_LIMITING !== 'false',
            description: 'Enable API rate limiting',
            envVar: 'FEATURE_RATE_LIMITING'
        },
        csrfProtection: {
            enabled: process.env.CSRF_ENABLED === 'true',
            description: 'Enable CSRF protection for admin endpoints',
            envVar: 'CSRF_ENABLED'
        },
        ipAllowlist: {
            enabled: process.env.FEATURE_IP_ALLOWLIST === 'true',
            description: 'Enable IP allowlisting for admin access',
            envVar: 'FEATURE_IP_ALLOWLIST'
        }
    },
    analytics: {
        auditLogging: {
            enabled: process.env.FEATURE_AUDIT_LOGGING !== 'false',
            description: 'Enable audit logging for API access',
            envVar: 'FEATURE_AUDIT_LOGGING'
        },
        errorTracking: {
            enabled: !!process.env.SENTRY_DSN,
            description: 'Enable Sentry error tracking',
            envVar: 'SENTRY_DSN'
        }
    },
    maintenance: {
        debugMode: {
            enabled: process.env.NODE_ENV === 'development',
            description: 'Enable debug mode (development only)',
            envVar: 'NODE_ENV'
        },
        maintenanceMode: {
            enabled: process.env.MAINTENANCE_MODE === 'true',
            description: 'Enable maintenance mode',
            envVar: 'MAINTENANCE_MODE'
        }
    }
};

function isFeatureEnabled(category, feature) {
    if (!featureFlags[category] || !featureFlags[category][feature]) {
        return false;
    }
    return featureFlags[category][feature].enabled;
}

function getFeatureStatus(category, feature) {
    if (!featureFlags[category] || !featureFlags[category][feature]) {
        return null;
    }
    const flag = featureFlags[category][feature];
    return {
        name: feature,
        enabled: flag.enabled,
        description: flag.description,
        configured: process.env[flag.envVar] !== undefined
    };
}

function getAllFeatures() {
    const result = {};
    for (const [category, features] of Object.entries(featureFlags)) {
        result[category] = {};
        for (const [name, flag] of Object.entries(features)) {
            result[category][name] = {
                enabled: flag.enabled,
                description: flag.description
            };
        }
    }
    return result;
}

function getEnabledFeatures() {
    const enabled = {};
    for (const [category, features] of Object.entries(featureFlags)) {
        const categoryEnabled = {};
        for (const [name, flag] of Object.entries(features)) {
            if (flag.enabled) {
                categoryEnabled[name] = flag.description;
            }
        }
        if (Object.keys(categoryEnabled).length > 0) {
            enabled[category] = categoryEnabled;
        }
    }
    return enabled;
}

function isMaintenanceMode() {
    return isFeatureEnabled('maintenance', 'maintenanceMode');
}

function isDebugMode() {
    return isFeatureEnabled('maintenance', 'debugMode');
}

module.exports = {
    featureFlags,
    isFeatureEnabled,
    getFeatureStatus,
    getAllFeatures,
    getEnabledFeatures,
    isMaintenanceMode,
    isDebugMode
};
