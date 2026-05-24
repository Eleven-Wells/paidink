const fp = require('fastify-plugin');
const { ValidationError } = require('../errors/errors');
const { CATEGORY_ENUM } = require('../config');

const MONGODB_OBJECTID_REGEX = /^[a-fA-F0-9]{24}$/;

function isValidObjectId(id) {
    return MONGODB_OBJECTID_REGEX.test(id);
}

function isValidCategory(category) {
    return CATEGORY_ENUM.includes(category);
}

function sanitizeSearchQuery(query) {
    if (!query || typeof query !== 'string') return '';

    return query
        .trim()
        .substring(0, 200)
        .replace(/[<>]/g, '')
        .replace(/javascript:/gi, '')
        .replace(/on\w+=/gi, '')
        .replace(/<\/?[^>]+(>|$)/gi, '');
}

const validationSchemas = {
    objectId: {
        type: 'string',
        pattern: MONGODB_OBJECTID_REGEX.source
    },
    category: {
        type: 'string',
        enum: CATEGORY_ENUM
    },
    email: {
        type: 'string',
        format: 'email',
        maxLength: 255
    },
    slug: {
        type: 'string',
        pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
        maxLength: 100
    },
    searchQuery: {
        type: 'string',
        minLength: 1,
        maxLength: 200
    },
    pagination: {
        type: 'object',
        properties: {
            page: { type: 'integer', minimum: 1, default: 1 },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 12 }
        }
    }
};

function createValidationPlugin(fastify) {
    fastify.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (req, body, done) => {
        try {
            const urlSearchParams = new URLSearchParams(body);
            const data = Object.fromEntries(urlSearchParams.entries());
            done(null, data);
        } catch (err) {
            done(err, undefined);
        }
    });

    fastify.decorate('validate', {
        objectId: (id, fieldName = 'id') => {
            if (!isValidObjectId(id)) {
                throw new ValidationError('INVALID_ID', { field: fieldName, value: id });
            }
            return id;
        },
        category: (category, fieldName = 'category') => {
            if (!isValidCategory(category)) {
                throw new ValidationError('INVALID_INPUT', {
                    field: fieldName,
                    value: category,
                    allowed: CATEGORY_ENUM
                });
            }
            return category;
        },
        searchQuery: (query) => {
            return sanitizeSearchQuery(query);
        },
        email: (email) => {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                throw new ValidationError('INVALID_EMAIL', { value: email });
            }
            return email.toLowerCase().trim();
        },
        pagination: (page, limit) => {
            const p = Math.max(1, parseInt(page) || 1);
            const l = Math.min(100, Math.max(1, parseInt(limit) || 12));
            return { page: p, limit: l };
        }
    });

    fastify.decorateRequest('validationErrors', null);

    fastify.addHook('preHandler', async (request) => {
        request.validationErrors = [];
    });
}

async function registerValidationSchemas(fastify) {
    for (const [name, schema] of Object.entries(validationSchemas)) {
        if (typeof schema === 'object') {
            fastify.addSchema({
                $id: name,
                ...schema
            });
        }
    }
}

const validationPlugin = fp(async (fastify) => {
    createValidationPlugin(fastify);
    await registerValidationSchemas(fastify);
}, {
    name: 'validation'
});

module.exports = validationPlugin;
module.exports.isValidObjectId = isValidObjectId;
module.exports.isValidCategory = isValidCategory;
module.exports.sanitizeSearchQuery = sanitizeSearchQuery;
module.exports.CATEGORY_ENUM = CATEGORY_ENUM;
module.exports.validationSchemas = validationSchemas;
