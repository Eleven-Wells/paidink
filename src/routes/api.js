const contentQueue = require('../queue/contentQueue');
const mongoose = require('mongoose');
const crypto = require('crypto');
const { loadConfig, getContentSources, CATEGORY_ENUM, getEnabledFeatures, isFeatureEnabled, isMaintenanceMode } = require('../config');
const { ValidationError } = require('../errors/errors');

const postService = require('../services/PostService');
const subscriptionService = require('../services/SubscriptionService');
const searchService = require('../services/SearchService');
const healthService = require('../services/HealthService');
const dashboardService = require('../services/DashboardService');
const AchievementService = require('../services/AchievementService');

const Post = require('../models/Post');
const User = require('../models/User');
const Notification = require('../models/Notification');
const Achievement = require('../models/Achievement');
const ReadSession = require('../models/ReadSession');
const PayoutDetail = require('../models/PayoutDetail');
const RewardRateService = require('../services/RewardRateService');
const Comment = require('../models/Comment');
const Credit = require('../models/Credit');
const NotificationService = require('../services/NotificationService');
const AppReview = require('../models/AppReview');
const { sendReviewToDiscord } = require('../services/ReviewNotificationService');
const PaystackService = require('../services/PaystackService');

async function apiRoutes(fastify) {
    fastify.get('/health', async (req, reply) => {
        const detailed = req.query.detailed === 'true';
        const health = detailed
            ? await healthService.getCompositeHealth({ includeQueue: true, detailed: false })
            : await healthService.getSimpleHealth();

        const statusCode = health.status === 'ok' || health.status === 'healthy' ? 200 : 503;

        return reply.code(statusCode).send({
            success: statusCode === 200,
            ...health,
            requestId: req.requestId
        });
    });

    fastify.get('/ping', async (req, reply) => {
        return {
            success: true,
            status: 'pong',
            timestamp: new Date().toISOString(),
            requestId: req.requestId
        };
    });

    fastify.get('/dashboard/summary', {
        preHandler: [fastify.authenticate]
    }, async (req, reply) => {
        try {
            const summary = await dashboardService.getDashboardSummary(req.user.id);
            return {
                success: true,
                data: summary,
                requestId: req.requestId
            };
        } catch (error) {
            req.log.error({ error: error.message }, 'Dashboard summary failed');
            return reply.code(500).send({
                success: false,
                error: 'Failed to load dashboard summary'
            });
        }
    });

    fastify.post('/wallet/reconcile', {
        preHandler: [fastify.authenticate]
    }, async (req, reply) => {
        try {
            const result = await req.user.reconcileWallet();
            return {
                success: true,
                data: result,
                requestId: req.requestId
            };
        } catch (error) {
            req.log.error({ error: error.message }, 'Wallet reconciliation failed');
            return reply.code(500).send({
                success: false,
                error: 'Wallet reconciliation failed'
            });
        }
    });

    fastify.get('/wallet/sync-status', {
        preHandler: [fastify.authenticate]
    }, async (req, reply) => {
        const LedgerEntry = require('../models/LedgerEntry');
        const latestEntry = await LedgerEntry.findOne({ user: req.user.id }).sort({ createdAt: -1 });

        return {
            success: true,
            data: {
                walletBalance: req.user.wallet.balance / 100,
                walletLifetimeEarned: req.user.wallet.lifetimeEarned / 100,
                balanceLastSynced: req.user.wallet.balanceLastSynced,
                ledgerLastEntry: latestEntry ? latestEntry.createdAt : null,
                needsSync: !req.user.wallet.balanceLastSynced ||
                    (latestEntry && latestEntry.createdAt > req.user.wallet.balanceLastSynced)
            },
            requestId: req.requestId
        };
    });

    fastify.get('/features', async (req, reply) => {
        return {
            success: true,
            features: getEnabledFeatures(),
            maintenanceMode: isMaintenanceMode(),
            requestId: req.requestId
        };
    });

    fastify.get('/reviews/me', {
        preHandler: [fastify.authenticate]
    }, async (req, reply) => {
        const review = await AppReview.findOne({ user: req.user.id })
            .sort({ createdAt: -1 })
            .lean();

        return {
            success: true,
            review: review ? {
                rating: review.rating,
                feedback: review.feedback,
                createdAt: review.createdAt
            } : null,
            requestId: req.requestId
        };
    });

    fastify.post('/reviews', {
        preHandler: [fastify.authenticate],
        schema: {
            body: {
                type: 'object',
                required: ['rating', 'feedback'],
                properties: {
                    rating: { type: 'integer', minimum: 1, maximum: 5 },
                    feedback: { type: 'string', minLength: 10, maxLength: 2000 },
                    path: { type: 'string', maxLength: 300 }
                },
                additionalProperties: false
            }
        }
    }, async (req, reply) => {
        const rating = Number(req.body.rating);
        const feedback = String(req.body.feedback || '').trim();
        const path = String(req.body.path || '').trim();

        if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
            return reply.code(400).send({
                success: false,
                error: 'Choose a rating from 1 to 5'
            });
        }

        if (feedback.length < 10) {
            return reply.code(400).send({
                success: false,
                error: 'Review must be at least 10 characters'
            });
        }

        const review = await AppReview.create({
            user: req.user.id,
            rating,
            feedback,
            context: {
                path,
                userAgent: req.headers['user-agent'] || ''
            }
        });

        const discordResult = await sendReviewToDiscord(review, req.user);
        review.discordDelivery = {
            status: discordResult.status,
            sentAt: discordResult.status === 'sent' ? new Date() : null,
            error: discordResult.error || ''
        };
        await review.save();

        return reply.code(201).send({
            success: true,
            message: 'Thanks for the review',
            review: {
                id: review._id,
                rating: review.rating,
                createdAt: review.createdAt
            },
            requestId: req.requestId
        });
    });

    fastify.get('/posts', {
        schema: {
            querystring: {
                type: 'object',
                properties: {
                    page: { type: 'integer', minimum: 1, default: 1 },
                    limit: { type: 'integer', minimum: 1, maximum: 100, default: 12 },
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
        }
    }, async (req, reply) => {
        const { page = 1, limit = 12, category } = req.query;

        const result = await postService.getPosts({ page, limit, category });

        await fastify.audit.apiAccess(req, 'posts', 'list');

        return {
            success: true,
            posts: result.posts,
            pagination: result.pagination,
            requestId: req.requestId
        };
    });

    fastify.post('/posts', {
        preHandler: [fastify.authenticate]
    }, async (req, reply) => {
        const { content, title, image, link } = req.body;

        const hasContent = content && typeof content === 'string' && content.trim();
        const hasImage = image && typeof image === 'string';
        const hasLink = link && typeof link === 'string';

        if (!hasContent && !hasImage && !hasLink) {
            return reply.code(400).send({
                success: false,
                error: 'Content, image, or link is required'
            });
        }

        var safeLink = '';
        if (link && typeof link === 'string') {
            try {
                const parsedLink = new URL(link);
                if (parsedLink.protocol === 'http:' || parsedLink.protocol === 'https:') {
                    safeLink = parsedLink.toString();
                } else {
                    return reply.code(400).send({
                        success: false,
                        error: 'Link must be a valid http or https URL'
                    });
                }
            } catch (e) {
                return reply.code(400).send({
                    success: false,
                    error: 'Link must be a valid http or https URL'
                });
            }
        }

        const trimmedContent = hasContent ? content.trim() : (hasLink ? link.trim() : 'Shared an image');
        const finalContent = safeLink && !trimmedContent.includes(safeLink) ? `${trimmedContent}\n\n${safeLink}` : trimmedContent;
        const slug = (title || finalContent.substring(0, 60)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + crypto.randomBytes(4).toString('hex');
        const summary = finalContent.substring(0, 200);

        const post = new Post({
            title: title || undefined,
            slug,
            content: finalContent,
            summary,
            category: 'development',
            image: image && typeof image === 'string' ? image : undefined,
            author: req.user.id,
            publishedAt: new Date()
        });

        await post.save();

        return reply.code(201).send({
            success: true,
            message: 'Post created successfully',
            post: {
                id: post._id,
                title: post.title,
                slug: post.slug
            }
        });
    });

    fastify.post('/posts/:id/like', {
        preHandler: [fastify.authenticate],
        schema: { body: { type: 'object', properties: {}, additionalProperties: false } }
    }, async (req, reply) => {
        const { id } = req.params;

        const post = await Post.findById(id);
        if (!post) {
            return reply.code(404).send({
                success: false,
                error: 'Post not found'
            });
        }

        if (!post.likes) {
            post.likes = [];
        }

        const userId = req.user.id;
        const likedIndex = post.likes.indexOf(userId);

        if (likedIndex > -1) {
            post.likes.splice(likedIndex, 1);
        } else {
            post.likes.push(userId);
        }

        await post.save();

        return {
            success: true,
            liked: likedIndex === -1,
            likesCount: post.likes.length
        };
    });

    // Update current user's profile
    fastify.put('/user', {
        preHandler: [fastify.authenticate]
    }, async (req, reply) => {
        try {
            const { displayName, username, bio, phone, country, preferences } = req.body || {};

            // Basic validation
            const updates = {};
            if (typeof displayName === 'string') updates.displayName = displayName.trim().slice(0, 50) || undefined;
            if (typeof username === 'string') updates.username = username.trim();
            if (typeof bio === 'string') updates.bio = bio.trim().slice(0, 500) || undefined;
            if (typeof phone === 'string') updates.phone = phone.trim() || undefined;
            if (typeof country === 'string') updates.country = country.trim() || undefined;
            if (preferences && typeof preferences === 'object') {
                updates.preferences = {};
                if (typeof preferences.hapticFeedback === 'boolean') {
                    updates.preferences.hapticFeedback = preferences.hapticFeedback;
                }
            }

            // Username validation only if username field present and different from current
            if (Object.prototype.hasOwnProperty.call(req.body || {}, 'username')) {
                const rawUsername = updates.username || '';
                if (!rawUsername || !/^[a-zA-Z0-9_]{3,30}$/.test(rawUsername)) {
                    return reply.code(400).send({ success: false, error: 'Username must be 3-30 chars and contain only letters, numbers and underscores' });
                }

                const user = await User.findById(req.user.id);
                const currentUsername = (user && user.username) ? String(user.username) : '';
                if (rawUsername !== currentUsername) {
                    const existing = await User.findOne({ username: rawUsername });
                    if (existing && existing._id.toString() !== req.user.id.toString()) {
                        return reply.code(409).send({ success: false, error: 'Username already taken' });
                    }
                }
            }

            // Apply updates
            const user = await User.findById(req.user.id);
            if (!user) return reply.code(404).send({ success: false, error: 'User not found' });

            Object.keys(updates).forEach(k => {
                if (typeof updates[k] !== 'undefined') user[k] = updates[k];
            });

            await user.save();

            // Audit user update
            try {
                await fastify.audit.apiAccess(req, 'user:update', 'write', { userId: user._id.toString() });
            } catch (e) {
                // non-fatal
            }

            return { success: true, user: user.toPublicJSON(), requestId: req.requestId };
        } catch (err) {
            req.log.error({ err: err.message }, 'Profile update failed');
            return reply.code(500).send({ success: false, error: 'Profile update failed' });
        }
    });

    // Check username availability (no auth required)
    fastify.get('/users/username-available', async (req, reply) => {
        try {
            const username = (req.query && req.query.username) ? String(req.query.username).trim() : '';

            if (!username || !/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
                return reply.code(400).send({ success: false, available: false, error: 'Invalid username format' });
            }

            const existing = await User.findOne({ username });

            // If not found => available
            if (!existing) return { success: true, available: true };

            // If the caller is authenticated and owns the username, consider it available
            if (req.user && existing._id.toString() === req.user.id.toString()) {
                return { success: true, available: true };
            }

            return { success: true, available: false };
        } catch (err) {
            req.log.error({ err: err.message }, 'Username availability check failed');
            return reply.code(500).send({ success: false, available: false, error: 'Lookup failed' });
        }
    });

    // Allow PATCH for partial updates (same behavior as PUT)
    fastify.patch('/user', {
        preHandler: [fastify.authenticate]
    }, async (req, reply) => {
        try {
            const { displayName, username, bio, phone, country, preferences } = req.body || {};

            // Basic validation
            const updates = {};
            if (typeof displayName === 'string') updates.displayName = displayName.trim().slice(0, 50) || undefined;
            if (typeof username === 'string') updates.username = username.trim();
            if (typeof bio === 'string') updates.bio = bio.trim().slice(0, 500) || undefined;
            if (typeof phone === 'string') updates.phone = phone.trim() || undefined;
            if (typeof country === 'string') updates.country = country.trim() || undefined;
            if (preferences && typeof preferences === 'object') {
                updates.preferences = {};
                if (typeof preferences.hapticFeedback === 'boolean') {
                    updates.preferences.hapticFeedback = preferences.hapticFeedback;
                }
            }

            // Username validation only if username field present and different from current
            if (Object.prototype.hasOwnProperty.call(req.body || {}, 'username')) {
                const rawUsername = updates.username || '';
                if (!rawUsername || !/^[a-zA-Z0-9_]{3,30}$/.test(rawUsername)) {
                    return reply.code(400).send({ success: false, error: 'Username must be 3-30 chars and contain only letters, numbers and underscores' });
                }

                const user = await User.findById(req.user.id);
                const currentUsername = (user && user.username) ? String(user.username) : '';
                if (rawUsername !== currentUsername) {
                    const existing = await User.findOne({ username: rawUsername });
                    if (existing && existing._id.toString() !== req.user.id.toString()) {
                        return reply.code(409).send({ success: false, error: 'Username already taken' });
                    }
                }
            }

            // Apply updates
            const user = await User.findById(req.user.id);
            if (!user) return reply.code(404).send({ success: false, error: 'User not found' });

            Object.keys(updates).forEach(k => {
                if (typeof updates[k] !== 'undefined') user[k] = updates[k];
            });

            await user.save();

            // Audit user update
            try {
                await fastify.audit.apiAccess(req, 'user:update', 'write', { userId: user._id.toString() });
            } catch (e) {
                // non-fatal
            }

            return { success: true, user: user.toPublicJSON(), requestId: req.requestId };
        } catch (err) {
            req.log.error({ err: err.message }, 'Profile update failed');
            return reply.code(500).send({ success: false, error: 'Profile update failed' });
        }
    });

    fastify.post('/posts/:id/save', {
        preHandler: [fastify.authenticate],
        schema: { body: { type: 'object', properties: {}, additionalProperties: false } }
    }, async (req, reply) => {
        const { id } = req.params;

        const user = await User.findById(req.user.id);
        if (!user) {
            return reply.code(404).send({ success: false, error: 'User not found' });
        }

        if (!user.savedPosts) {
            user.savedPosts = [];
        }

        const savedIndex = user.savedPosts.indexOf(id);
        let saved;

        if (savedIndex > -1) {
            user.savedPosts.splice(savedIndex, 1);
            saved = false;
        } else {
            user.savedPosts.push(id);
            saved = true;
        }

        await user.save();

        return { success: true, saved };
    });

    fastify.post('/posts/:id/share', {
        preHandler: [fastify.authenticate],
        schema: { body: { type: 'object', properties: {}, additionalProperties: false } }
    }, async (req, reply) => {
        const { id } = req.params;

        const post = await Post.findById(id);
        if (!post) {
            return reply.code(404).send({ success: false, error: 'Post not found' });
        }

        post.shares = (post.shares || 0) + 1;
        await post.save();

        return { success: true, shares: post.shares };
    });

    fastify.post('/users/:id/follow', {
        preHandler: [fastify.authenticate]
    }, async (req, reply) => {
        const { id } = req.params;

        const targetUser = await User.findById(id);
        if (!targetUser) {
            return reply.code(404).send({
                success: false,
                error: 'User not found'
            });
        }

        if (id === req.user.id) {
            return reply.code(400).send({
                success: false,
                error: 'Cannot follow yourself'
            });
        }

        const currentUser = await User.findById(req.user.id);
        if (!currentUser.following) {
            currentUser.following = [];
        }

        const alreadyFollowing = currentUser.following.indexOf(id);
        if (alreadyFollowing > -1) {
            return reply.code(400).send({
                success: false,
                error: 'Already following this user'
            });
        }

        currentUser.following.push(id);
        await currentUser.save();

        if (!targetUser.followers) {
            targetUser.followers = [];
        }
        const followerIndex = targetUser.followers.findIndex(
            (followerId) => String(followerId) === String(req.user.id)
        );
        if (followerIndex === -1) {
            targetUser.followers.push(req.user.id);
            await targetUser.save();
        }

        return {
            success: true,
            message: 'Successfully followed user'
        };
    });

    fastify.get('/search', {
        schema: {
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
    }, async (req, reply) => {
        const { q, page = 1, limit = 10 } = req.query;

        const result = await searchService.searchTools(q, { page, limit });

        await fastify.audit.apiAccess(req, 'search', 'query');

        return {
            success: true,
            results: result.results,
            pagination: result.pagination,
            requestId: req.requestId
        };
    });

    fastify.get('/search/posts', {
        schema: {
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
    }, async (req, reply) => {
        const { q, page = 1, limit = 10 } = req.query;

        const result = await searchService.searchPosts(q, { page, limit });

        await fastify.audit.apiAccess(req, 'search:posts', 'query');

        return {
            success: true,
            results: result.results,
            pagination: result.pagination,
            requestId: req.requestId
        };
    });

    fastify.post('/update', {
        preHandler: [
            fastify.adminAuth.authenticate,
            fastify.adminAuth.verifyCsrf
        ],
        schema: {
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
            }
        }
    }, async (req, reply) => {
        const config = loadConfig();
        const sources = req.body?.sources || getContentSources();

        const jobs = [];
        for (const source of sources) {
            if (source.requiresAuth && !config.NEWS_API_KEY) {
                continue;
            }

            const job = await contentQueue.add('generate-post', {
                sourceUrl: source.url,
                category: source.category,
                type: source.type
            });

            jobs.push({
                id: job.id,
                source: source.url,
                category: source.category
            });
        }

        await fastify.audit.adminAction(req, 'job:trigger', {
            jobCount: jobs.length,
            sources: sources.map(s => s.url)
        });

        return {
            success: true,
            message: `Added ${jobs.length} content processing jobs to queue`,
            jobs,
            requestId: req.requestId
        };
    });

    fastify.get('/latest-posts', {
        schema: {
            querystring: {
                type: 'object',
                properties: {
                    limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
                    since: { type: 'string', format: 'date-time' },
                    category: { type: 'string', enum: CATEGORY_ENUM }
                }
            }
        }
    }, async (req, reply) => {
        const { limit = 10, since, category } = req.query;

        const posts = await postService.getLatestPosts({ limit, since, category });

        await fastify.audit.apiAccess(req, 'latest-posts', 'read');

        return {
            success: true,
            posts,
            timestamp: new Date(),
            count: posts.length,
            requestId: req.requestId
        };
    });

    fastify.post('/subscribe', {
        schema: {
            body: {
                type: 'object',
                required: ['email'],
                properties: {
                    email: { type: 'string', format: 'email', maxLength: 255 }
                }
            }
        }
    }, async (req, reply) => {
        const { email } = req.body;

        const result = await subscriptionService.subscribe(email);

        if (!result.alreadySubscribed) {
            await fastify.audit.adminAction(req, 'subscribe', {
                email: result.email
            });
        }

        return {
            success: true,
            message: result.message,
            email: result.email,
            requestId: req.requestId
        };
    });

    fastify.get('/post/:id', {
        schema: {
            params: {
                type: 'object',
                properties: {
                    id: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' }
                },
                required: ['id']
            }
        }
    }, async (req, reply) => {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            throw new ValidationError('INVALID_ID', { field: 'id', value: id });
        }

        const post = await postService.getPostById(id);
        if (!post) {
            return reply.code(404).send({
                success: false,
                error: {
                    code: 'DB_004',
                    message: 'Post not found',
                    statusCode: 404
                }
            });
        }

        await fastify.audit.apiAccess(req, 'post', 'read');

        return {
            success: true,
            post,
            requestId: req.requestId
        };
    });

    fastify.get('/categories', async (req, reply) => {
        const categories = await postService.getCategories();

        return {
            success: true,
            categories,
            requestId: req.requestId
        };
    });

    fastify.post('/retry-connection', {
        preHandler: fastify.adminAuth.authenticate
    }, async (req, reply) => {
        try {
            if (mongoose.connection.readyState === 1) {
                await fastify.audit.adminAction(req, 'connection:check', { status: 'already_connected' });
                return {
                    success: true,
                    message: 'Already connected',
                    requestId: req.requestId
                };
            }

            const connectDB = require('../db');
            await connectDB();

            if (mongoose.connection.readyState === 1) {
                await fastify.audit.adminAction(req, 'connection:reconnect', { status: 'success' });
                return {
                    success: true,
                    message: 'Reconnected successfully',
                    requestId: req.requestId
                };
            }

            await fastify.audit.adminAction(req, 'connection:reconnect', { status: 'failed' });
            return reply.code(500).send({
                success: false,
                error: {
                    code: 'DB_001',
                    message: 'Reconnect attempt failed',
                    statusCode: 500
                },
                requestId: req.requestId
            });
        } catch (err) {
            await fastify.audit.adminAction(req, 'connection:reconnect', {
                status: 'error',
                error: err.message
            });
            throw err;
        }
    });

    fastify.get('/notifications', {
        preHandler: [fastify.authenticate]
    }, async (req, reply) => {
        const notifications = await Notification.find({ user: req.user.id })
            .sort({ createdAt: -1 })
            .limit(50);

        return reply.send({ success: true, notifications });
    });

    fastify.put('/notifications/:id/read', {
        preHandler: [fastify.authenticate]
    }, async (req, reply) => {
        await Notification.findOneAndUpdate(
            { _id: req.params.id, user: req.user.id },
            { read: true }
        );
        return reply.send({ success: true });
    });

    fastify.put('/notifications/read-all', {
        preHandler: [fastify.authenticate]
    }, async (req, reply) => {
        await Notification.updateMany(
            { user: req.user.id, read: false },
            { read: true }
        );
        return reply.send({ success: true });
    });

    const notificationEmitter = require('../services/NotificationEmitter');

    fastify.get('/notifications/stream', {
        sse: true,
        preHandler: [fastify.authenticate]
    }, async (req, reply) => {
        const userId = req.user.id;

        await reply.sse.send({
            event: 'connected',
            data: { connected: true }
        });

        const handler = (notification) => {
            reply.sse.send({
                event: 'notification',
                data: notification
            }).catch(() => {
                notificationEmitter.removeNotificationListener(userId, handler);
            });
        };

        notificationEmitter.onNotification(userId, handler);

        req.raw.on('close', () => {
            notificationEmitter.removeNotificationListener(userId, handler);
        });
    });

    fastify.get('/achievements', {
        preHandler: [fastify.authenticate]
    }, async (req, reply) => {
        const earnedAchievements = await AchievementService.getUserAchievements(req.user.id);
        const earnedIds = earnedAchievements.map(e => e.achievement._id.toString());
        const unlockedCount = earnedAchievements.length;

        const user = await User.findById(req.user.id);
        const totalReads = await ReadSession.countDocuments({ user: req.user.id, completed: true });
        const referralCount = await User.countDocuments({ referredBy: req.user.id });

        const allAchievements = await Achievement.find().lean();

        const achievementList = allAchievements.map(a => {
            const earned = earnedIds.includes(a._id.toString());
            let current = 0;

            switch (a.category) {
                case 'reading': current = totalReads; break;
                case 'streak': current = user?.stats?.streak || 0; break;
                case 'referral': current = referralCount; break;
                case 'milestone': current = (user?.wallet?.lifetimeEarned || 0) / 100; break;
            }

            const progress = Math.min(100, Math.round((current / a.requirement) * 100));

            return { ...a, earned, current, progress };
        });

        return reply.send({
            success: true,
            achievements: achievementList,
            unlockedCount,
            totalAchievements: allAchievements.length
        });
    });

    fastify.post('/withdraw', {
        schema: {
            body: {
                type: 'object',
                required: ['amount', 'method'],
                properties: {
                    amount: { type: 'number', minimum: 100 },
                    method: { type: 'string', enum: ['bank', 'mpesa', 'airtime'] },
                    bankName: { type: 'string' },
                    bankCode: { type: 'string' },
                    accountNumber: { type: 'string' },
                    accountName: { type: 'string' },
                    phoneNumber: { type: 'string' }
                }
            }
        },
        preHandler: [fastify.authenticate]
    }, async (req, reply) => {
        try {
            const { amount, method, bankName, bankCode, accountNumber, accountName, phoneNumber } = req.body;
            const user = req.user;

            const encryptionKey = process.env.PAYOUT_ENCRYPTION_KEY;

            if (!encryptionKey || encryptionKey === 'generate_a_secure_random_string_here') {
                return reply.code(500).send({
                    success: false,
                    error: 'System not configured for withdrawals'
                });
            }

            const amountInKobo = Math.round(amount * 100);

            if (method === 'bank') {
                if (!accountNumber || !accountName || !bankCode) {
                    return reply.code(400).send({
                        success: false,
                        error: 'Bank code, account number, and account name are required for bank withdrawals'
                    });
                }

                await PayoutDetail.encryptAndSave(
                    user._id,
                    { bankName, bankCode, accountNumber, accountName },
                    method,
                    encryptionKey
                );

                const paystackKey = process.env.PAYSTACK_SECRET_KEY;
                if (!paystackKey || paystackKey === 'your_paystack_secret_key_here') {
                    return reply.code(500).send({
                        success: false,
                        error: 'Payment gateway not configured'
                    });
                }

                const recipientRes = await PaystackService.createTransferRecipient({
                    accountName,
                    accountNumber,
                    bankCode
                });

                if (!recipientRes.status) {
                    return reply.code(400).send({
                        success: false,
                        error: recipientRes.message || 'Failed to create payment recipient'
                    });
                }

                const recipientCode = recipientRes.data.recipient_code;

                const idempotencyKey = `withdraw_${user._id}_${Date.now()}`;

                const transferRes = await PaystackService.initiateTransfer(
                    recipientCode,
                    amountInKobo,
                    `PaidInk withdrawal - ${user._id}`,
                    idempotencyKey
                );

                if (!transferRes.status) {
                    return reply.code(400).send({
                        success: false,
                        error: transferRes.message || 'Failed to initiate transfer'
                    });
                }

                const transferCode = transferRes.data.transfer_code;

                const result = await user.requestWithdrawal(amountInKobo);

                const Transaction = mongoose.model('Transaction');
                let transactionRecord;
                try {
                    transactionRecord = await Transaction.create({
                        user: user._id,
                        type: 'withdrawal',
                        amount: -amountInKobo,
                        balanceBefore: result.newBalance + amountInKobo,
                        balanceAfter: result.newBalance,
                        status: 'pending',
                        reference: transferCode,
                        description: `Bank withdrawal (****${accountNumber.slice(-4)})`,
                        metadata: {
                            paystackTransferCode: transferCode,
                            paystackRecipientCode: recipientCode,
                            method: 'bank',
                            accountNumber: `****${accountNumber.slice(-4)}`,
                            bankName
                        }
                    });
                } catch (txError) {
                    req.log.error({ error: txError.message, userId: user._id },
                        'Failed to create transaction record, reversing balance deduction');
                    await User.findOneAndUpdate(
                        { _id: user._id },
                        { $inc: { 'wallet.balance': amountInKobo, 'wallet.pendingBalance': -amountInKobo } }
                    );
                    throw txError;
                }

                try {
                    await NotificationService.notifyWithdrawal(user._id, amount, method);
                } catch (err) {
                    req.log.error({ component: 'notification', error: err.message, userId: user._id },
                        'Failed to create withdrawal notification');
                }

                return reply.send({
                    success: true,
                    message: 'Withdrawal initiated successfully. Funds will be sent to your bank account.',
                    data: {
                        newBalance: result.newBalance / 100,
                        pendingBalance: result.pendingBalance / 100,
                        transferCode,
                        reference: transferCode
                    }
                });
            } else if (method === 'mpesa' && phoneNumber) {
                await PayoutDetail.encryptAndSave(
                    user._id,
                    { phoneNumber },
                    method,
                    encryptionKey
                );

                return reply.code(400).send({
                    success: false,
                    error: 'M-Pesa withdrawals are not yet available'
                });
            } else if (method === 'airtime' && phoneNumber) {
                await PayoutDetail.encryptAndSave(
                    user._id,
                    { phoneNumber },
                    method,
                    encryptionKey
                );

                return reply.code(400).send({
                    success: false,
                    error: 'Airtime withdrawals are not yet available'
                });
            } else {
                return reply.code(400).send({
                    success: false,
                    error: 'Invalid withdrawal method or missing required fields'
                });
            }
        } catch (error) {
            req.log.error({ error: error.message, userId: user._id, method, amount },
                'Withdrawal failed');
            const statusCode = error.message.includes('Insufficient') ? 400 : 500;
            return reply.code(statusCode).send({
                success: false,
                error: error.message || 'Withdrawal failed. Please try again.'
            });
        }
    });

    fastify.post('/posts/:postId/comments', {
        preHandler: [fastify.authenticate]
    }, async (req, reply) => {
        try {
            const { postId } = req.params;
            const { content } = req.body;
            const userId = req.user._id;

            if (!content || !content.trim()) {
                return reply.code(400).send({
                    success: false,
                    error: 'Comment content is required'
                });
            }

            if (content.length > 2000) {
                return reply.code(400).send({
                    success: false,
                    error: 'Comment must be less than 2000 characters'
                });
            }

            const post = await Post.findById(postId);
            if (!post) {
                return reply.code(404).send({
                    success: false,
                    error: 'Post not found'
                });
            }

            const comment = new Comment({
                content: content.trim(),
                post: postId,
                author: userId
            });

            await comment.save();
            await Post.findByIdAndUpdate(postId, { $push: { comments: comment._id } });

            try {
                await Credit.earnCredit(userId, 'COMMENT', { postId });
            } catch (err) {
                console.error('Failed to award comment credit:', err.message);
            }

            return reply.send({
                success: true,
                data: comment.toJSON()
            });
        } catch (error) {
            req.log.error({ error: error.message }, 'Comment creation failed');
            return reply.code(500).send({
                success: false,
                error: 'Failed to add comment'
            });
        }
    });

    fastify.get('/posts/:postId/comments', async (req, reply) => {
        try {
            const { postId } = req.params;

            const comments = await Comment.find({ post: postId })
                .populate('author', 'displayName')
                .sort({ createdAt: -1 })
                .lean();

            comments.forEach(function (c) {
                if (!c.author) {
                    c.author = { _id: null, displayName: 'Deleted User' };
                }
            });

            return reply.send({
                success: true,
                data: comments,
                total: comments.length
            });
        } catch (error) {
            req.log.error({ error: error.message }, 'Failed to fetch comments');
            return reply.code(500).send({
                success: false,
                error: 'Failed to fetch comments'
            });
        }
    });

    fastify.post('/posts/:postId/comments/:commentId/like', {
        preHandler: [fastify.authenticate]
    }, async (req, reply) => {
        try {
            const { commentId } = req.params;
            const userId = req.user._id;

            const comment = await Comment.findById(commentId);
            if (!comment) {
                return reply.code(404).send({
                    success: false,
                    error: 'Comment not found'
                });
            }

            const likeIndex = comment.likes.indexOf(userId);
            if (likeIndex > -1) {
                comment.likes.splice(likeIndex, 1);
            } else {
                comment.likes.push(userId);
            }

            await comment.save();

            return reply.send({
                success: true,
                liked: likeIndex === -1,
                likesCount: comment.likes.length
            });
        } catch (error) {
            req.log.error({ error: error.message }, 'Comment like failed');
            return reply.code(500).send({
                success: false,
                error: 'Failed to toggle like'
            });
        }
    });

    fastify.delete('/posts/:postId/comments/:commentId', {
        preHandler: [fastify.authenticate]
    }, async (req, reply) => {
        try {
            const { commentId, postId } = req.params;
            const userId = req.user._id;

            const comment = await Comment.findById(commentId);
            if (!comment) {
                return reply.code(404).send({
                    success: false,
                    error: 'Comment not found'
                });
            }

            if (comment.author.toString() !== userId.toString()) {
                return reply.code(403).send({
                    success: false,
                    error: 'Not authorized to delete this comment'
                });
            }

            await Comment.findByIdAndDelete(commentId);
            await Post.findByIdAndUpdate(postId, { $pull: { comments: commentId } });

            return reply.send({
                success: true,
                message: 'Comment deleted'
            });
        } catch (error) {
            req.log.error({ error: error.message }, 'Comment deletion failed');
            return reply.code(500).send({
                success: false,
                error: 'Failed to delete comment'
            });
        }
    });

    fastify.post('/notifications/mark-all-read', async (req, reply) => {
        try {
            if (!req.isLoggedIn || !req.currentUser) {
                return reply.code(401).send({
                    success: false,
                    error: 'Please log in'
                });
            }

            await Notification.updateMany(
                { user: req.currentUser._id, read: false },
                { $set: { read: true } }
            );

            return reply.send({
                success: true,
                message: 'All notifications marked as read'
            });
        } catch (error) {
            req.log.error({ error: error.message }, 'Mark all read failed');
            return reply.code(500).send({
                success: false,
                error: 'Failed to mark notifications as read'
            });
        }
    });

    fastify.get('/rewards/rate', async (req, reply) => {
        try {
            const rateKobo = await RewardRateService.getCurrentRate();
            return {
                success: true,
                data: {
                    rateKobo,
                    rateNaira: rateKobo / 100,
                    floor: 10,
                    ceiling: 2000,
                    windowDays: 7
                }
            };
        } catch (error) {
            req.log.error({ error: error.message }, 'Get reward rate failed');
            return reply.code(500).send({
                success: false,
                error: 'Failed to get current reward rate'
            });
        }
    });
}

module.exports = apiRoutes;
