const fp = require('fastify-plugin');

const apiDocumentation = {
    openapi: '3.0.0',
    info: {
        title: 'PaidInk API',
        description: 'A community reading and writing platform for discovering and sharing stories across all topics',
        version: '1.0.0',
        contact: {
            name: 'API Support',
            email: 'support@paidink.example.com'
        },
        license: {
            name: 'ISC'
        }
    },
    servers: [
        {
            url: '{baseUrl}',
            description: 'Local development server',
            variables: {
                baseUrl: {
                    default: 'http://localhost:5050',
                    description: 'Base URL of the API'
                }
            }
        }
    ],
    tags: [
        {
            name: 'Health',
            description: 'Server health and status endpoints'
        },
        {
            name: 'Posts',
            description: 'Blog post operations'
        },
        {
            name: 'Search',
            description: 'Search functionality'
        },
        {
            name: 'Subscription',
            description: 'Newsletter subscription management'
        },
        {
            name: 'Admin',
            description: 'Admin-only operations (protected)'
        }
    ],
    paths: {
        '/api/health': {
            get: {
                tags: ['Health'],
                summary: 'Get server health status',
                description: 'Returns the current health status of the server including database connection state, uptime, and environment.',
                operationId: 'getHealth',
                responses: {
                    '200': {
                        description: 'Server is healthy',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        success: { type: 'boolean', example: true },
                                        status: { type: 'string', example: 'ok' },
                                        timestamp: { type: 'string', format: 'date-time' },
                                        uptime: { type: 'integer', description: 'Server uptime in seconds' },
                                        database: { type: 'string', enum: ['connected', 'disconnected'] },
                                        environment: { type: 'string', enum: ['development', 'production'] },
                                        version: { type: 'string', example: '1.0.0' },
                                        requestId: { type: 'string', description: 'Unique request identifier' }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        '/api/ping': {
            get: {
                tags: ['Health'],
                summary: 'Ping endpoint',
                description: 'Simple ping endpoint for uptime monitoring.',
                operationId: 'ping',
                responses: {
                    '200': {
                        description: 'Pong response',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        success: { type: 'boolean', example: true },
                                        status: { type: 'string', example: 'pong' },
                                        timestamp: { type: 'string', format: 'date-time' },
                                        requestId: { type: 'string' }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        '/api/posts': {
            get: {
                tags: ['Posts'],
                summary: 'Get paginated list of posts',
                description: 'Retrieves a paginated list of blog posts with optional category filtering.',
                operationId: 'getPosts',
                parameters: [
                    {
                        name: 'page',
                        in: 'query',
                        description: 'Page number (default: 1)',
                        schema: { type: 'integer', minimum: 1, default: 1 }
                    },
                    {
                        name: 'limit',
                        in: 'query',
                        description: 'Items per page (default: 12, max: 100)',
                        schema: { type: 'integer', minimum: 1, maximum: 100, default: 12 }
                    },
                    {
                        name: 'category',
                        in: 'query',
                        description: 'Filter by category',
                        schema: {
                            type: 'string',
                            enum: ['development', 'business', 'health', 'lifestyle', 'news', 'sports', 'entertainment', 'politics']
                        }
                    }
                ],
                responses: {
                    '200': {
                        description: 'List of posts with pagination',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        success: { type: 'boolean' },
                                        posts: {
                                            type: 'array',
                                            items: { $ref: '#/components/schemas/Post' }
                                        },
                                        pagination: {
                                            type: 'object',
                                            properties: {
                                                page: { type: 'integer' },
                                                limit: { type: 'integer' },
                                                total: { type: 'integer' },
                                                totalPages: { type: 'integer' },
                                                hasNext: { type: 'boolean' },
                                                hasPrev: { type: 'boolean' }
                                            }
                                        },
                                        requestId: { type: 'string' }
                                    }
                                }
                            }
                        }
                    },
                    '400': {
                        $ref: '#/components/responses/BadRequest'
                    }
                }
            }
        },
        '/api/search': {
            get: {
                tags: ['Search'],
                summary: 'Search posts',
                description: 'Search through blog posts with sanitized query input.',
                operationId: 'searchPosts',
                parameters: [
                    {
                        name: 'q',
                        in: 'query',
                        required: true,
                        description: 'Search query (1-200 characters)',
                        schema: { type: 'string', minLength: 1, maxLength: 200 }
                    },
                    {
                        name: 'page',
                        in: 'query',
                        schema: { type: 'integer', minimum: 1, default: 1 }
                    },
                    {
                        name: 'limit',
                        in: 'query',
                        schema: { type: 'integer', minimum: 1, maximum: 50, default: 10 }
                    }
                ],
                responses: {
                    '200': {
                        description: 'Search results',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        success: { type: 'boolean' },
                                        results: { type: 'array', items: { type: 'object' } },
                                        pagination: { $ref: '#/components/schemas/Pagination' },
                                        requestId: { type: 'string' }
                                    }
                                }
                            }
                        }
                    },
                    '400': {
                        $ref: '#/components/responses/BadRequest'
                    }
                }
            }
        },
        '/api/latest-posts': {
            get: {
                tags: ['Posts'],
                summary: 'Get latest posts',
                description: 'Retrieve the latest posts, optionally filtered by date or category.',
                operationId: 'getLatestPosts',
                parameters: [
                    {
                        name: 'limit',
                        in: 'query',
                        schema: { type: 'integer', minimum: 1, maximum: 50, default: 10 }
                    },
                    {
                        name: 'since',
                        in: 'query',
                        description: 'ISO 8601 date-time to filter posts published after',
                        schema: { type: 'string', format: 'date-time' }
                    },
                    {
                        name: 'category',
                        in: 'query',
                        schema: {
                            type: 'string',
                            enum: ['development', 'business', 'health', 'lifestyle', 'news', 'sports', 'entertainment', 'politics']
                        }
                    }
                ],
                responses: {
                    '200': {
                        description: 'Latest posts',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        success: { type: 'boolean' },
                                        posts: { type: 'array', items: { $ref: '#/components/schemas/PostSummary' } },
                                        timestamp: { type: 'string', format: 'date-time' },
                                        count: { type: 'integer' },
                                        requestId: { type: 'string' }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        '/api/categories': {
            get: {
                tags: ['Posts'],
                summary: 'Get all categories',
                description: 'Returns a list of all available post categories.',
                operationId: 'getCategories',
                responses: {
                    '200': {
                        description: 'List of categories',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        success: { type: 'boolean' },
                                        categories: {
                                            type: 'array',
                                            items: {
                                                type: 'object',
                                                properties: {
                                                    slug: { type: 'string' },
                                                    name: { type: 'string' }
                                                }
                                            }
                                        },
                                        requestId: { type: 'string' }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        '/api/subscribe': {
            post: {
                tags: ['Subscription'],
                summary: 'Subscribe to newsletter',
                description: 'Subscribe an email address to the newsletter.',
                operationId: 'subscribe',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['email'],
                                properties: {
                                    email: { type: 'string', format: 'email', maxLength: 255 }
                                }
                            }
                        }
                    }
                },
                responses: {
                    '200': {
                        description: 'Subscription successful or already subscribed',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        success: { type: 'boolean' },
                                        message: { type: 'string' },
                                        email: { type: 'string' },
                                        subscribedAt: { type: 'string', format: 'date-time' },
                                        requestId: { type: 'string' }
                                    }
                                }
                            }
                        }
                    },
                    '400': {
                        $ref: '#/components/responses/BadRequest'
                    }
                }
            }
        },
        '/api/update': {
            post: {
                tags: ['Admin'],
                summary: 'Trigger content update',
                description: 'Admin endpoint to trigger content generation jobs (requires API key).',
                operationId: 'triggerUpdate',
                security: [{ ApiKeyAuth: [] }],
                requestBody: {
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    sources: {
                                        type: 'array',
                                        items: {
                                            type: 'object',
                                            properties: {
                                                url: { type: 'string' },
                                                category: { type: 'string' },
                                                type: { type: 'string', enum: ['rss', 'url'] }
                                            },
                                            required: ['url', 'category', 'type']
                                        },
                                        maxItems: 20
                                    }
                                }
                            }
                        }
                    }
                },
                responses: {
                    '200': {
                        description: 'Jobs queued successfully',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        success: { type: 'boolean' },
                                        message: { type: 'string' },
                                        jobs: {
                                            type: 'array',
                                            items: {
                                                type: 'object',
                                                properties: {
                                                    id: { type: 'string' },
                                                    source: { type: 'string' },
                                                    category: { type: 'string' }
                                                }
                                            }
                                        },
                                        requestId: { type: 'string' }
                                    }
                                }
                            }
                        }
                    },
                    '401': {
                        $ref: '#/components/responses/Unauthorized'
                    },
                    '503': {
                        $ref: '#/components/responses/ServiceUnavailable'
                    }
                }
            }
        },
        '/api/retry-connection': {
            post: {
                tags: ['Admin'],
                summary: 'Retry database connection',
                description: 'Admin endpoint to retry database connection (requires API key).',
                operationId: 'retryConnection',
                security: [{ ApiKeyAuth: [] }],
                responses: {
                    '200': {
                        description: 'Connection successful',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        success: { type: 'boolean' },
                                        message: { type: 'string' },
                                        requestId: { type: 'string' }
                                    }
                                }
                            }
                        }
                    },
                    '401': {
                        $ref: '#/components/responses/Unauthorized'
                    },
                    '500': {
                        $ref: '#/components/responses/InternalError'
                    }
                }
            }
        },
        '/api/post/{id}': {
            get: {
                tags: ['Posts'],
                summary: 'Get post by ID',
                description: 'Retrieve a single post by its MongoDB ObjectId.',
                operationId: 'getPostById',
                parameters: [
                    {
                        name: 'id',
                        in: 'path',
                        required: true,
                        description: 'MongoDB ObjectId (24 character hex string)',
                        schema: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' }
                    }
                ],
                responses: {
                    '200': {
                        description: 'Post found',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        success: { type: 'boolean' },
                                        post: { $ref: '#/components/schemas/Post' },
                                        requestId: { type: 'string' }
                                    }
                                }
                            }
                        }
                    },
                    '400': {
                        $ref: '#/components/responses/BadRequest'
                    },
                    '404': {
                        $ref: '#/components/responses/NotFound'
                    }
                }
            }
        }
    },
    components: {
        schemas: {
            Post: {
                type: 'object',
                properties: {
                    _id: { type: 'string' },
                    title: { type: 'string' },
                    slug: { type: 'string' },
                    content: { type: 'string' },
                    summary: { type: 'string' },
                    category: {
                        type: 'string',
                        enum: ['development', 'business', 'health', 'lifestyle', 'news', 'sports', 'entertainment', 'politics']
                    },
                    tags: { type: 'array', items: { type: 'string' } },
                    image: { type: 'string' },
                    imageMetadata: {
                        type: 'object',
                        properties: {
                            source: { type: 'string' },
                            alt_text: { type: 'string' },
                            unsplash_id: { type: 'string' },
                            photographer: { type: 'string' },
                            unsplash_url: { type: 'string' }
                        }
                    },
                    publishedAt: { type: 'string', format: 'date-time' },
                    metaDescription: { type: 'string' },
                    createdAt: { type: 'string', format: 'date-time' },
                    updatedAt: { type: 'string', format: 'date-time' }
                }
            },
            PostSummary: {
                type: 'object',
                properties: {
                    title: { type: 'string' },
                    slug: { type: 'string' },
                    summary: { type: 'string' },
                    category: { type: 'string' },
                    image: { type: 'string' },
                    publishedAt: { type: 'string', format: 'date-time' }
                }
            },
            Pagination: {
                type: 'object',
                properties: {
                    page: { type: 'integer' },
                    limit: { type: 'integer' },
                    total: { type: 'integer' },
                    totalPages: { type: 'integer' }
                }
            },
            Error: {
                type: 'object',
                properties: {
                    success: { type: 'boolean', example: false },
                    error: {
                        type: 'object',
                        properties: {
                            code: { type: 'string' },
                            message: { type: 'string' },
                            statusCode: { type: 'integer' },
                            timestamp: { type: 'string', format: 'date-time' },
                            requestId: { type: 'string' }
                        }
                    }
                }
            }
        },
        responses: {
            BadRequest: {
                description: 'Bad Request - Invalid input',
                content: {
                    'application/json': {
                        schema: { $ref: '#/components/schemas/Error' }
                    }
                }
            },
            Unauthorized: {
                description: 'Unauthorized - Invalid or missing API key',
                content: {
                    'application/json': {
                        schema: { $ref: '#/components/schemas/Error' }
                    }
                }
            },
            NotFound: {
                description: 'Not Found - Resource not found',
                content: {
                    'application/json': {
                        schema: { $ref: '#/components/schemas/Error' }
                    }
                }
            },
            RateLimited: {
                description: 'Too Many Requests',
                content: {
                    'application/json': {
                        schema: { $ref: '#/components/schemas/Error' }
                    }
                }
            },
            InternalError: {
                description: 'Internal Server Error',
                content: {
                    'application/json': {
                        schema: { $ref: '#/components/schemas/Error' }
                    }
                }
            },
            ServiceUnavailable: {
                description: 'Service Unavailable',
                content: {
                    'application/json': {
                        schema: { $ref: '#/components/schemas/Error' }
                    }
                }
            }
        },
        securitySchemes: {
            ApiKeyAuth: {
                type: 'apiKey',
                in: 'header',
                name: 'x-api-key',
                description: 'Admin API key for protected endpoints'
            }
        }
    }
};

function createSwaggerPlugin(fastify) {
    fastify.get('/api/docs', async (request, reply) => {
        reply.send(apiDocumentation);
    });

    fastify.get('/api/docs/json', async (request, reply) => {
        reply.header('Content-Type', 'application/json');
        reply.send(apiDocumentation);
    });
}

const swaggerPlugin = fp(async (fastify) => {
    createSwaggerPlugin(fastify);
}, {
    name: 'api-docs'
});

module.exports = swaggerPlugin;
module.exports.apiDocumentation = apiDocumentation;
