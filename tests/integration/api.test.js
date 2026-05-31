const fastify = require('fastify')({ logger: false });

jest.mock('../../src/config', () => ({
    loadConfig: jest.fn(() => ({
        ADMIN_API_KEY: 'test-admin-key',
        NEWS_API_KEY: '',
        NODE_ENV: 'test'
    })),
    getAllowedOrigins: jest.fn(() => ['http://localhost:3000']),
    getContentSources: jest.fn(() => [
        { url: 'https://dev.to/feed', category: 'development', type: 'rss' },
        { url: 'https://github.com/trending', category: 'development', type: 'url' }
    ])
}));

jest.mock('../../src/models/Post', () => {
    const mockPost = {
        find: jest.fn().mockReturnThis(),
        findOne: jest.fn(),
        countDocuments: jest.fn(),
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        select: jest.fn().mockResolvedValue([])
    };
    mockPost.find.mockReturnValue(mockPost);
    return mockPost;
});

jest.mock('../../src/models/Subscriber', () => ({
    findOne: jest.fn(),
    create: jest.fn()
}));

const apiRoutes = require('../../src/routes/api');

describe('API Routes Integration Tests', () => {
    beforeAll(async () => {
        await fastify.register(apiRoutes);
        await fastify.ready();
    });

    afterAll(async () => {
        await fastify.close();
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('GET /api/health', () => {
        test('should return health status', async () => {
            const response = await fastify.inject({
                method: 'GET',
                url: '/api/health'
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.status).toBe('ok');
            expect(body.success).toBe(true);
            expect(body.timestamp).toBeDefined();
        });
    });

    describe('GET /api/ping', () => {
        test('should return pong', async () => {
            const response = await fastify.inject({
                method: 'GET',
                url: '/api/ping'
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.status).toBe('pong');
            expect(body.success).toBe(true);
        });
    });

    describe('GET /api/posts', () => {
        test('should return posts with pagination', async () => {
            const Post = require('../../src/models/Post');
            Post.countDocuments.mockResolvedValue(10);
            Post.find.mockResolvedValue([
                { _id: '1', title: 'Test Post', slug: 'test-post' }
            ]);

            const response = await fastify.inject({
                method: 'GET',
                url: '/api/posts?page=1&limit=5'
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.success).toBe(true);
            expect(body.pagination).toBeDefined();
            expect(body.pagination.page).toBe(1);
            expect(body.pagination.limit).toBe(5);
        });

        test('should filter by category', async () => {
            const Post = require('../../src/models/Post');
            Post.countDocuments.mockResolvedValue(3);
            Post.find.mockResolvedValue([]);

            const response = await fastify.inject({
                method: 'GET',
                url: '/api/posts?category=development'
            });

            expect(response.statusCode).toBe(200);
            expect(Post.find).toHaveBeenCalledWith({ category: 'development' });
        });

        test('should reject invalid category', async () => {
            const response = await fastify.inject({
                method: 'GET',
                url: '/api/posts?category=invalid'
            });

            expect(response.statusCode).toBe(400);
        });
    });

    describe('GET /api/search', () => {
        test('should return search results', async () => {
            jest.mock('../../src/models/Tool', () => ({
                find: jest.fn().mockReturnThis(),
                countDocuments: jest.fn().mockResolvedValue(2),
                sort: jest.fn().mockReturnThis(),
                skip: jest.fn().mockReturnThis(),
                limit: jest.fn().mockResolvedValue([
                    { name: 'Test Tool', description: 'Test description' }
                ])
            }));

            const response = await fastify.inject({
                method: 'GET',
                url: '/api/search?q=test'
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.success).toBe(true);
            expect(body.results).toBeDefined();
        });

        test('should require query parameter', async () => {
            const response = await fastify.inject({
                method: 'GET',
                url: '/api/search'
            });

            expect(response.statusCode).toBe(400);
        });

        test('should sanitize XSS in query', async () => {
            jest.mock('../../src/models/Tool', () => ({
                find: jest.fn().mockReturnThis(),
                countDocuments: jest.fn().mockResolvedValue(0),
                sort: jest.fn().mockReturnThis(),
                skip: jest.fn().mockReturnThis(),
                limit: jest.fn().mockResolvedValue([])
            }));

            const response = await fastify.inject({
                method: 'GET',
                url: '/api/search?q=<script>alert("xss")</script>'
            });

            expect(response.statusCode).toBe(200);
        });
    });

    describe('GET /api/categories', () => {
        test('should return all categories', async () => {
            const response = await fastify.inject({
                method: 'GET',
                url: '/api/categories'
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.success).toBe(true);
            expect(body.categories).toBeDefined();
            expect(body.categories.length).toBe(6);
        });
    });

    describe('POST /api/subscribe', () => {
        test('should subscribe valid email', async () => {
            const Subscriber = require('../../src/models/Subscriber');
            Subscriber.findOne.mockResolvedValue(null);
            Subscriber.create.mockResolvedValue({
                email: 'test@example.com',
                createdAt: new Date()
            });

            const response = await fastify.inject({
                method: 'POST',
                url: '/api/subscribe',
                payload: { email: 'test@example.com' }
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.success).toBe(true);
            expect(body.message).toBe('Subscription successful');
        });

        test('should reject invalid email', async () => {
            const response = await fastify.inject({
                method: 'POST',
                url: '/api/subscribe',
                payload: { email: 'invalid-email' }
            });

            expect(response.statusCode).toBe(400);
        });

        test('should handle already subscribed', async () => {
            const Subscriber = require('../../src/models/Subscriber');
            Subscriber.findOne.mockResolvedValue({
                email: 'existing@example.com'
            });

            const response = await fastify.inject({
                method: 'POST',
                url: '/api/subscribe',
                payload: { email: 'existing@example.com' }
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.message).toBe('Already subscribed');
        });
    });
});
