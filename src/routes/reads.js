const ReadSession = require('../models/ReadSession');
const Post = require('../models/Post');
const User = require('../models/User');
const interestProfileService = require('../services/InterestProfileService');

const READ_REWARD = 500;
const MIN_READ_TIME_SECONDS = 30;

async function readsAuthenticate(request, reply) {
    try {
        // Support both cookie and Authorization header
        const authHeader = request.headers.authorization;
        const token = authHeader 
            ? authHeader.replace('Bearer ', '') 
            : request.cookies?.auth_token;

        if (!token) {
            return reply.code(401).send({
                success: false,
                error: 'Authentication required'
            });
        }

        const decoded = request.server.jwt.verify(token);
        const user = await User.findById(decoded.id);

        if (!user) {
            return reply.code(401).send({
                success: false,
                error: 'User not found'
            });
        }

        request.user = user;
        request.userId = user._id;
    } catch (error) {
        return reply.code(401).send({
            success: false,
            error: 'Invalid authentication'
        });
    }
}

module.exports = async function readsRoutes(fastify) {
    fastify.addHook('preHandler', readsAuthenticate);

    fastify.post('/start', {
        schema: {
            body: {
                type: 'object',
                required: ['postId'],
                properties: {
                    postId: { type: 'string' }
                }
            }
        }
    }, async (req, reply) => {
        try {
            const { postId } = req.body;
            const userId = req.userId;

            const post = await Post.findById(postId);
            if (!post) {
                return reply.code(404).send({
                    success: false,
                    error: 'Post not found'
                });
            }

            const existingSession = await ReadSession.findOne({
                user: userId,
                post: postId,
                completed: false
            });

            if (existingSession) {
                return reply.send({
                    success: true,
                    data: {
                        sessionId: existingSession._id,
                        startedAt: existingSession.startedAt,
                        message: 'Continuing previous session'
                    }
                });
            }

            const session = await ReadSession.create({
                user: userId,
                post: postId,
                startedAt: new Date()
            });

            return reply.send({
                success: true,
                data: {
                    sessionId: session._id,
                    startedAt: session.startedAt,
                    reward: READ_REWARD / 100,
                    minTime: MIN_READ_TIME_SECONDS
                }
            });

        } catch (error) {
            req.log.error({ error: error.message }, 'Start read session failed');
            return reply.code(500).send({
                success: false,
                error: 'Failed to start reading session'
            });
        }
    });

    fastify.post('/update-progress', {
        schema: {
            body: {
                type: 'object',
                required: ['sessionId', 'progress'],
                properties: {
                    sessionId: { type: 'string' },
                    progress: { type: 'number' }
                }
            }
        }
    }, async (req, reply) => {
        try {
            const { sessionId, progress } = req.body;
            const userId = req.userId;

            const safeProgress = Math.min(100, Math.max(0, Number(progress) || 0));

            const session = await ReadSession.findOne({
                _id: sessionId,
                user: userId,
                completed: false
            });

            if (!session) {
                return reply.code(404).send({
                    success: false,
                    error: 'Session not found'
                });
            }

            session.scrollProgress = safeProgress;
            await session.save();

            return reply.send({
                success: true,
                data: {
                    progress: session.scrollProgress,
                    nearComplete: safeProgress >= 90
                }
            });

        } catch (error) {
            req.log.error({ error: error.message }, 'Update progress failed');
            return reply.code(500).send({
                success: false,
                error: 'Failed to update progress'
            });
        }
    });

    fastify.post('/complete', {
        schema: {
            body: {
                type: 'object',
                required: ['sessionId'],
                properties: {
                    sessionId: { type: 'string' }
                }
            }
        }
    }, async (req, reply) => {
        try {
            const { sessionId } = req.body;
            const userId = req.userId;

            const session = await ReadSession.findOne({
                _id: sessionId,
                user: userId,
                completed: false
            });

            if (!session) {
                return reply.code(404).send({
                    success: false,
                    error: 'Session not found'
                });
            }

            if (session.completed) {
                return reply.send({
                    success: false,
                    error: 'Session already completed'
                });
            }

            await session.markCompleted();

            try {
                const readPost = await Post.findById(session.post).lean();
                if (readPost) {
                    await interestProfileService.updateOnReadCompletion(
                        userId,
                        readPost,
                        session.timeSpentSeconds,
                        session.completed
                    );
                }
            } catch (err) {
                req.log.error({ error: err.message }, 'Failed to update interest profile');
            }

            return reply.send({
                success: true,
                data: {
                    completed: true,
                    timeSpent: session.timeSpentSeconds,
                    rewardAwarded: session.rewardAwarded,
                    rewardAmount: session.rewardAmount / 100,
                    message: session.rewardAwarded 
                        ? `Congratulations! You earned ₦${session.rewardAmount / 100}` 
                        : 'Read completed but minimum time not met'
                }
            });

        } catch (error) {
            req.log.error({ error: error.message }, 'Complete read session failed');
            return reply.code(500).send({
                success: false,
                error: 'Failed to complete reading session'
            });
        }
    });

    fastify.get('/history', {
        schema: {
            querystring: {
                type: 'object',
                properties: {
                    limit: { type: 'integer' },
                    page: { type: 'integer' }
                }
            }
        }
    }, async (req, reply) => {
        try {
            const userId = req.userId;
            const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
            const page = Math.max(1, Number(req.query.page) || 1);
            const skip = (page - 1) * limit;

            const [sessions, total] = await Promise.all([
                ReadSession.find({ user: userId })
                    .sort({ startedAt: -1 })
                    .skip(skip)
                    .limit(limit)
                    .populate('post', 'title slug summary image'),
                ReadSession.countDocuments({ user: userId })
            ]);

            return reply.send({
                success: true,
                data: {
                    sessions: sessions.map(s => ({
                        _id: s._id,
                        post: s.post,
                        startedAt: s.startedAt,
                        endedAt: s.endedAt,
                        timeSpentSeconds: s.timeSpentSeconds,
                        completed: s.completed,
                        rewardAwarded: s.rewardAwarded,
                        rewardAmount: s.rewardAmount / 100
                    })),
                    pagination: {
                        total,
                        page,
                        limit,
                        pages: Math.ceil(total / limit)
                    }
                }
            });

        } catch (error) {
            req.log.error({ error: error.message }, 'Get read history failed');
            return reply.code(500).send({
                success: false,
                error: 'Failed to get read history'
            });
        }
    });

    fastify.get('/stats', async (req, reply) => {
        try {
            const userId = req.userId;

            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const [todayReads, totalReads, todayReward, totalReward] = await Promise.all([
                ReadSession.countDocuments({
                    user: userId,
                    startedAt: { $gte: today },
                    completed: true
                }),
                ReadSession.countDocuments({
                    user: userId,
                    completed: true
                }),
                ReadSession.aggregate([
                    { $match: { user: userId, startedAt: { $gte: today }, rewardAwarded: true } },
                    { $group: { _id: null, total: { $sum: '$rewardAmount' } } }
                ]),
                ReadSession.aggregate([
                    { $match: { user: userId, rewardAwarded: true } },
                    { $group: { _id: null, total: { $sum: '$rewardAmount' } } }
                ])
            ]);

            return reply.send({
                success: true,
                data: {
                    todayReads,
                    totalReads,
                    todayEarnings: (todayReward[0]?.total || 0) / 100,
                    totalEarnings: (totalReward[0]?.total || 0) / 100,
                    rewardPerRead: READ_REWARD / 100
                }
            });

        } catch (error) {
            req.log.error({ error: error.message }, 'Get read stats failed');
            return reply.code(500).send({
                success: false,
                error: 'Failed to get read statistics'
            });
        }
    });
};
