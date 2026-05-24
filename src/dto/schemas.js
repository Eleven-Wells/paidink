const { CATEGORY_ENUM } = require('../config');

const paginationSchema = {
    type: 'object',
    properties: {
        page: { type: 'integer', minimum: 1, default: 1 },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 12 }
    }
};

const postSchemas = {
    getPosts: {
        querystring: {
            type: 'object',
            properties: {
                ...paginationSchema.properties,
                category: { type: 'string', enum: CATEGORY_ENUM }
            }
        },
        response: {
            200: {
                type: 'object',
                properties: {
                    success: { type: 'boolean' },
                    posts: { type: 'array' },
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
    },

    getPostById: {
        params: {
            type: 'object',
            properties: {
                id: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' }
            },
            required: ['id']
        },
        response: {
            200: {
                type: 'object',
                properties: {
                    success: { type: 'boolean' },
                    post: { type: 'object' },
                    requestId: { type: 'string' }
                }
            }
        }
    },

    getLatestPosts: {
        querystring: {
            type: 'object',
            properties: {
                limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
                since: { type: 'string', format: 'date-time' },
                category: { type: 'string', enum: CATEGORY_ENUM }
            }
        },
        response: {
            200: {
                type: 'object',
                properties: {
                    success: { type: 'boolean' },
                    posts: { type: 'array' },
                    timestamp: { type: 'string' },
                    count: { type: 'integer' },
                    requestId: { type: 'string' }
                }
            }
        }
    },

    getCategories: {
        response: {
            200: {
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
};

const searchSchemas = {
    search: {
        querystring: {
            type: 'object',
            required: ['q'],
            properties: {
                q: { type: 'string', minLength: 1, maxLength: 200 },
                page: { type: 'integer', minimum: 1, default: 1 },
                limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 }
            }
        },
        response: {
            200: {
                type: 'object',
                properties: {
                    success: { type: 'boolean' },
                    results: { type: 'array' },
                    pagination: { type: 'object' },
                    requestId: { type: 'string' }
                }
            }
        }
    }
};

const subscriptionSchemas = {
    subscribe: {
        body: {
            type: 'object',
            required: ['email'],
            properties: {
                email: { type: 'string', format: 'email', maxLength: 255 }
            }
        },
        response: {
            200: {
                type: 'object',
                properties: {
                    success: { type: 'boolean' },
                    message: { type: 'string' },
                    email: { type: 'string' },
                    requestId: { type: 'string' }
                }
            }
        }
    }
};

const adminSchemas = {
    triggerUpdate: {
        body: {
            type: 'object',
            properties: {
                sources: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            url: { type: 'string', minLength: 1 },
                            category: { type: 'string', enum: CATEGORY_ENUM },
                            type: { type: 'string', enum: ['rss', 'url'] }
                        },
                        required: ['url', 'category', 'type']
                    },
                    maxItems: 20
                }
            }
        },
        response: {
            200: {
                type: 'object',
                properties: {
                    success: { type: 'boolean' },
                    message: { type: 'string' },
                    jobs: { type: 'array' },
                    requestId: { type: 'string' }
                }
            }
        }
    },

    retryConnection: {
        response: {
            200: {
                type: 'object',
                properties: {
                    success: { type: 'boolean' },
                    message: { type: 'string' },
                    requestId: { type: 'string' }
                }
            }
        }
    }
};

const healthSchemas = {
    health: {
        querystring: {
            type: 'object',
            properties: {
                detailed: { type: 'string', enum: ['true', 'false'], default: 'false' }
            }
        },
        response: {
            200: {
                type: 'object',
                properties: {
                    success: { type: 'boolean' },
                    status: { type: 'string', enum: ['ok', 'healthy', 'degraded'] },
                    timestamp: { type: 'string' },
                    uptime: { type: 'integer' },
                    database: { type: 'string' },
                    cache: { type: 'string' },
                    dependencies: {
                        type: 'object',
                        properties: {
                            mongodb: {
                                type: 'object',
                                properties: {
                                    status: { type: 'string' },
                                    latency: { type: 'integer' },
                                    error: { type: 'string' }
                                }
                            },
                            redis: {
                                type: 'object',
                                properties: {
                                    status: { type: 'string' },
                                    latency: { type: 'integer' },
                                    error: { type: 'string' }
                                }
                            },
                            queue: {
                                type: 'object',
                                properties: {
                                    status: { type: 'string' },
                                    latency: { type: 'integer' },
                                    error: { type: 'string' },
                                    stats: {
                                        type: 'object',
                                        properties: {
                                            waiting: { type: 'integer' },
                                            active: { type: 'integer' },
                                            completed: { type: 'integer' },
                                            failed: { type: 'integer' }
                                        }
                                    }
                                }
                            }
                        }
                    },
                    environment: { type: 'string' },
                    version: { type: 'string' },
                    requestId: { type: 'string' }
                }
            }
        }
    },

    ping: {
        response: {
            200: {
                type: 'object',
                properties: {
                    success: { type: 'boolean' },
                    status: { type: 'string' },
                    timestamp: { type: 'string' },
                    requestId: { type: 'string' }
                }
            }
        }
    }
};

module.exports = {
    postSchemas,
    searchSchemas,
    subscriptionSchemas,
    adminSchemas,
    healthSchemas,
    paginationSchema
};
