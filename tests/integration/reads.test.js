const mongoose = require('mongoose');
const fastify = require('fastify')({ logger: false });
const ReadSession = require('../../src/models/ReadSession');
const Post = require('../../src/models/Post');
const User = require('../../src/models/User');
const Credit = require('../../src/models/Credit');
const Transaction = require('../../src/models/Transaction');
const LedgerEntry = require('../../src/models/LedgerEntry');
const ReaderRewardService = require('../../src/services/ads/ReaderRewardService');

const READ_REWARD = 500;
const MIN_READ_TIME = 30;

jest.mock('../../src/services/NotificationService', () => ({
    notifyReward: jest.fn().mockResolvedValue(true),
    createNotification: jest.fn().mockResolvedValue(true),
    getUnreadCount: jest.fn().mockResolvedValue(0)
}));

jest.mock('../../src/services/AchievementService', () => ({
    checkReadingAchievements: jest.fn().mockResolvedValue([])
}));

describe('Reads Tracking System', () => {
    let testUser;
    let testPost;
    let token;

    beforeAll(async () => {
        process.env.JWT_SECRET = 'test-jwt-secret';
        await fastify.register(require('@fastify/jwt'), { secret: process.env.JWT_SECRET });
        await fastify.register(require('../../src/plugins/audit'));
        await fastify.register(require('../../src/routes/reads'), { prefix: '/api/reads' });
        await fastify.ready();
    }, 15000);

    afterAll(async () => {
        await fastify.close();
    });

    beforeEach(async () => {
        jest.spyOn(ReaderRewardService, 'processReadCompletion').mockResolvedValue({ paid: true, amount: 500, balance: { balance: 500, lifetimeEarned: 500 } });

        await ReadSession.deleteMany({});
        await Transaction.deleteMany({});
        await LedgerEntry.deleteMany({});
        await Post.deleteMany({});
        await User.deleteMany({ email: /^reads-test-/ });
        await Credit.deleteMany({});

        testUser = await User.create({
            email: 'reads-test-' + Date.now() + '@test.com',
            username: 'readstest' + Date.now(),
            displayName: 'Reads Test User',
            password: 'password123',
            'wallet.balance': 0,
            'wallet.lifetimeEarned': 0,
            'wallet.pendingUnfundedReads': 0,
            'wallet.totalReaderRewards': 0,
            'stats.totalReads': 0,
            'stats.streak': 1,
            'stats.lastReadDate': null,
            'stats.longestStreak': 1,
            role: 'reader',
            isActive: true
        });

        testPost = await Post.create({
            title: 'Test Read Tracking Post',
            slug: 'test-read-tracking-' + Date.now(),
            summary: 'A test post for read tracking',
            content: '<p>Test content</p>'.repeat(20),
            category: 'development',
            author: testUser._id,
            publishedAt: new Date(),
            stats: { views: 0, reads: 0, earnings: 0 }
        });

        token = fastify.jwt.sign({ id: testUser._id.toString(), email: testUser.email });
    });

    describe('ReadSession Model', () => {
        describe('calculateReward()', () => {
            test('returns 0 when session is not completed', () => {
                const session = new ReadSession({
                    user: testUser._id,
                    post: testPost._id,
                    completed: false,
                    timeSpentSeconds: 60
                });
                expect(session.calculateReward()).toBe(0);
            });

            test('returns 0 when reward already awarded', () => {
                const session = new ReadSession({
                    user: testUser._id,
                    post: testPost._id,
                    completed: true,
                    rewardAwarded: true,
                    timeSpentSeconds: 60
                });
                expect(session.calculateReward()).toBe(0);
            });

            test('returns 0 when time spent is below minimum', () => {
                const session = new ReadSession({
                    user: testUser._id,
                    post: testPost._id,
                    completed: true,
                    rewardAwarded: false,
                    timeSpentSeconds: 10
                });
                expect(session.calculateReward()).toBe(0);
            });

            test('returns READ_REWARD when all conditions are met', () => {
                const session = new ReadSession({
                    user: testUser._id,
                    post: testPost._id,
                    completed: true,
                    rewardAwarded: false,
                    timeSpentSeconds: 45
                });
                expect(session.calculateReward()).toBe(READ_REWARD);
            });

            test('exactly at the 30s threshold earns the reward', () => {
                const session = new ReadSession({
                    user: testUser._id,
                    post: testPost._id,
                    completed: true,
                    rewardAwarded: false,
                    timeSpentSeconds: 30
                });
                expect(session.calculateReward()).toBe(READ_REWARD);
            });
        });

        describe('markCompleted()', () => {
            test('sets completed flag and endedAt timestamp', async () => {
                const session = await ReadSession.create({
                    user: testUser._id,
                    post: testPost._id,
                    startedAt: new Date(Date.now() - 60000),
                    scrollProgress: 95
                });

                await session.markCompleted();

                expect(session.completed).toBe(true);
                expect(session.endedAt).toBeInstanceOf(Date);
                expect(session.timeSpentSeconds).toBeGreaterThanOrEqual(59);
            });

            test('records reward outcome on the session', async () => {
                const session = await ReadSession.create({
                    user: testUser._id,
                    post: testPost._id,
                    startedAt: new Date(Date.now() - 60000),
                    scrollProgress: 95
                });

                await session.markCompleted({ rewardAwarded: true, rewardAmount: 250 });

                expect(session.completed).toBe(true);
                expect(session.rewardAwarded).toBe(true);
                expect(session.rewardAmount).toBe(250);
            });
        });
    });

    describe('POST /api/reads/start', () => {
        async function startSession(authToken) {
            return await fastify.inject({
                method: 'POST',
                url: '/api/reads/start',
                headers: { authorization: `Bearer ${authToken || token}` },
                payload: { postId: testPost._id.toString() }
            });
        }

        test('creates a new read session', async () => {
            const res = await startSession();

            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.success).toBe(true);
            expect(body.data.sessionId).toBeDefined();
            expect(body.data.reward).toBe(READ_REWARD);
            expect(body.data.minTime).toBe(MIN_READ_TIME);

            const session = await ReadSession.findById(body.data.sessionId);
            expect(session).not.toBeNull();
            expect(session.user.toString()).toBe(testUser._id.toString());
            expect(session.post.toString()).toBe(testPost._id.toString());
            expect(session.completed).toBe(false);
        });

        test('returns existing session if already started and incomplete', async () => {
            const res1 = await startSession();
            const res2 = await startSession();

            expect(res2.statusCode).toBe(200);
            const body2 = JSON.parse(res2.body);
            expect(body2.data.sessionId).toBe(JSON.parse(res1.body).data.sessionId);
            expect(body2.data.message).toBe('Continuing previous session');
        });

        test('rejects request without auth token', async () => {
            const res = await fastify.inject({
                method: 'POST',
                url: '/api/reads/start',
                payload: { postId: testPost._id.toString() }
            });

            expect(res.statusCode).toBe(401);
        });

        test('rejects request with invalid postId', async () => {
            const res = await fastify.inject({
                method: 'POST',
                url: '/api/reads/start',
                headers: { authorization: `Bearer ${token}` },
                payload: { postId: new mongoose.Types.ObjectId().toString() }
            });

            expect(res.statusCode).toBe(404);
        });

        test('rejects request with missing postId', async () => {
            const res = await fastify.inject({
                method: 'POST',
                url: '/api/reads/start',
                headers: { authorization: `Bearer ${token}` },
                payload: {}
            });

            expect(res.statusCode).toBe(400);
        });
    });

    describe('POST /api/reads/update-progress', () => {
        async function createSession() {
            const res = await fastify.inject({
                method: 'POST',
                url: '/api/reads/start',
                headers: { authorization: `Bearer ${token}` },
                payload: { postId: testPost._id.toString() }
            });
            return JSON.parse(res.body).data.sessionId;
        }

        test('updates scroll progress on active session', async () => {
            const sessionId = await createSession();

            const res = await fastify.inject({
                method: 'POST',
                url: '/api/reads/update-progress',
                headers: { authorization: `Bearer ${token}` },
                payload: { sessionId, progress: 75 }
            });

            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.success).toBe(true);
            expect(body.data.progress).toBe(75);

            const session = await ReadSession.findById(sessionId);
            expect(session.scrollProgress).toBe(75);
        });

        test('clamps progress to 0-100', async () => {
            const sessionId = await createSession();

            const res = await fastify.inject({
                method: 'POST',
                url: '/api/reads/update-progress',
                headers: { authorization: `Bearer ${token}` },
                payload: { sessionId, progress: 999 }
            });

            const body = JSON.parse(res.body);
            expect(body.data.progress).toBe(100);
        });

        test('returns 404 for invalid sessionId', async () => {
            const res = await fastify.inject({
                method: 'POST',
                url: '/api/reads/update-progress',
                headers: { authorization: `Bearer ${token}` },
                payload: { sessionId: new mongoose.Types.ObjectId().toString(), progress: 50 }
            });

            expect(res.statusCode).toBe(404);
        });

        test('rejects request without auth', async () => {
            const res = await fastify.inject({
                method: 'POST',
                url: '/api/reads/update-progress',
                payload: { sessionId: new mongoose.Types.ObjectId().toString(), progress: 50 }
            });

            expect(res.statusCode).toBe(401);
        });
    });

    describe('POST /api/reads/complete', () => {
        async function createStartedSession() {
            const res = await fastify.inject({
                method: 'POST',
                url: '/api/reads/start',
                headers: { authorization: `Bearer ${token}` },
                payload: { postId: testPost._id.toString() }
            });
            const sessionId = JSON.parse(res.body).data.sessionId;
            const session = await ReadSession.findById(sessionId);
            session.startedAt = new Date(Date.now() - 60000);
            await session.save();
            return sessionId;
        }

        test('completes a read session', async () => {
            const sessionId = await createStartedSession();

            const res = await fastify.inject({
                method: 'POST',
                url: '/api/reads/complete',
                headers: { authorization: `Bearer ${token}` },
                payload: { sessionId }
            });

            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.success).toBe(true);
            expect(body.data.completed).toBe(true);
        });

        test('returns 404 for invalid sessionId', async () => {
            const res = await fastify.inject({
                method: 'POST',
                url: '/api/reads/complete',
                headers: { authorization: `Bearer ${token}` },
                payload: { sessionId: new mongoose.Types.ObjectId().toString() }
            });

            expect(res.statusCode).toBe(404);
        });

        test('handles double completion gracefully', async () => {
            const sessionId = await createStartedSession();

            const res1 = await fastify.inject({
                method: 'POST',
                url: '/api/reads/complete',
                headers: { authorization: `Bearer ${token}` },
                payload: { sessionId }
            });
            expect(res1.statusCode).toBe(200);

            const res2 = await fastify.inject({
                method: 'POST',
                url: '/api/reads/complete',
                headers: { authorization: `Bearer ${token}` },
                payload: { sessionId }
            });
            expect(res2.statusCode).toBe(404);
        });
    });

    describe('GET /api/reads/history', () => {
        test('returns empty array for user with no reads', async () => {
            const res = await fastify.inject({
                method: 'GET',
                url: '/api/reads/history',
                headers: { authorization: `Bearer ${token}` }
            });

            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.success).toBe(true);
            expect(body.data.sessions).toEqual([]);
            expect(body.data.pagination.total).toBe(0);
        });

        test('returns completed reads in history', async () => {
            await ReadSession.create({
                user: testUser._id,
                post: testPost._id,
                startedAt: new Date(Date.now() - 60000),
                completed: true,
                timeSpentSeconds: 45
            });

            const res = await fastify.inject({
                method: 'GET',
                url: '/api/reads/history',
                headers: { authorization: `Bearer ${token}` }
            });

            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.data.sessions.length).toBe(1);
            expect(body.data.sessions[0].completed).toBe(true);
        });
    });

    describe('GET /api/reads/stats', () => {
        test('returns zero stats for user with no reads', async () => {
            const res = await fastify.inject({
                method: 'GET',
                url: '/api/reads/stats',
                headers: { authorization: `Bearer ${token}` }
            });

            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.data.todayReads).toBe(0);
            expect(body.data.totalReads).toBe(0);
            expect(body.data.totalEarnings).toBe(0);
        });

        test('reflects completed reads in stats', async () => {
            await ReadSession.create({
                user: testUser._id,
                post: testPost._id,
                startedAt: new Date(),
                completed: true,
                rewardAwarded: true,
                rewardAmount: 5,
                timeSpentSeconds: 45
            });

            const res = await fastify.inject({
                method: 'GET',
                url: '/api/reads/stats',
                headers: { authorization: `Bearer ${token}` }
            });

            const body = JSON.parse(res.body);
            expect(body.data.totalReads).toBe(1);
            expect(body.data.todayReads).toBe(1);
        });
    });

    describe('Full read flow (start → progress → complete)', () => {
        test('complete flow increments post reads stat', async () => {
            const startRes = await fastify.inject({
                method: 'POST',
                url: '/api/reads/start',
                headers: { authorization: `Bearer ${token}` },
                payload: { postId: testPost._id.toString() }
            });
            const sessionId = JSON.parse(startRes.body).data.sessionId;

            await fastify.inject({
                method: 'POST',
                url: '/api/reads/update-progress',
                headers: { authorization: `Bearer ${token}` },
                payload: { sessionId, progress: 92 }
            });

            const session = await ReadSession.findById(sessionId);
            session.startedAt = new Date(Date.now() - 60000);
            await session.save();

            await fastify.inject({
                method: 'POST',
                url: '/api/reads/complete',
                headers: { authorization: `Bearer ${token}` },
                payload: { sessionId }
            });

            const updatedSession = await ReadSession.findById(sessionId);
            expect(updatedSession.completed).toBe(true);
            expect(updatedSession.scrollProgress).toBe(92);
            expect(updatedSession.timeSpentSeconds).toBeGreaterThanOrEqual(59);

            const updatedPost = await Post.findById(testPost._id);
            expect(updatedPost.stats.reads).toBe(1);

            const historyRes = await fastify.inject({
                method: 'GET',
                url: '/api/reads/history',
                headers: { authorization: `Bearer ${token}` }
            });
            const historyBody = JSON.parse(historyRes.body);
            expect(historyBody.data.sessions.length).toBe(1);

            const statsRes = await fastify.inject({
                method: 'GET',
                url: '/api/reads/stats',
                headers: { authorization: `Bearer ${token}` }
            });
            const statsBody = JSON.parse(statsRes.body);
            expect(statsBody.data.totalReads).toBe(1);
        });
    });
});
