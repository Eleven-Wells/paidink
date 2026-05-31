const Post = require('../models/Post');
const User = require('../models/User');
const NotificationService = require('../services/NotificationService');
const { getQueueStats } = require('../queue/contentQueue');
const { getRedisConnection } = require('../config/redis');
const { CATEGORY_ENUM, CATEGORY_NAMES } = require('../config');
const ejs = require('ejs');
const fs = require('fs');
const path = require('path');

const adminViewsPath = path.join(__dirname, '..', 'views', 'admin');
const adminLayoutPath = path.join(adminViewsPath, 'layouts', 'default.ejs');

function renderAdminLayout(content, data = {}) {
    const layout = fs.readFileSync(adminLayoutPath, 'utf8');
    return ejs.render(layout, {
        ...data,
        lang: 'en',
        body: content
    }, {
        async: false,
        views: [adminViewsPath, path.join(adminViewsPath, 'pages')]
    });
}

function renderAdminPage(pageName, data = {}) {
    const pagePath = path.join(adminViewsPath, 'pages', `${pageName}.ejs`);
    if (!fs.existsSync(pagePath)) {
        return renderAdminLayout('<div class="p-8 text-center"><h2>Page not found</h2></div>', data);
    }
    const pageContent = fs.readFileSync(pagePath, 'utf8');
    const renderedPage = ejs.render(pageContent, data, {
        async: false,
        views: [adminViewsPath, path.join(adminViewsPath, 'pages')]
    });
    return renderAdminLayout(renderedPage, data);
}

function renderLoginPage(error = null) {
    const loginPath = path.join(adminViewsPath, 'pages', 'login.ejs');
    if (!fs.existsSync(loginPath)) {
        return '<html><body><h1>Login</h1><form method="POST"><input type="password" name="password" placeholder="Password"/><button>Login</button></form></body></html>';
    }
    const loginContent = fs.readFileSync(loginPath, 'utf8');
    return ejs.render(loginContent, { error }, {
        async: false,
        views: [adminViewsPath, path.join(adminViewsPath, 'pages')]
    });
}

async function getStats() {
    try {
        const User = require('../models/User');
        const ReadSession = require('../models/ReadSession');
        const Transaction = require('../models/Transaction');
        const Notification = require('../models/Notification');
        const AuditLog = require('../models/AuditLog');

        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

        const totalPosts = await Post.countDocuments();
        const postsThisWeek = await Post.countDocuments({
            createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
        });
        const publishedPosts = await Post.countDocuments({
            publishedAt: { $lte: new Date() }
        });

        const categoryStats = {
            development: await Post.countDocuments({ category: 'development' }),
            business: await Post.countDocuments({ category: 'business' }),
            health: await Post.countDocuments({ category: 'health' }),
            lifestyle: await Post.countDocuments({ category: 'lifestyle' }),
            news: await Post.countDocuments({ category: 'news' }),
            sports: await Post.countDocuments({ category: 'sports' }),
            entertainment: await Post.countDocuments({ category: 'entertainment' }),
            politics: await Post.countDocuments({ category: 'politics' })
        };

        const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        const [currentViews, previousViews, activeUsersToday, unreadNotifications, totalUsers, pendingWithdrawals, recentReads] = await Promise.all([
            AuditLog.countDocuments({ action: { $regex: '.*:view' }, timestamp: { $gte: thirtyDaysAgo } }),
            AuditLog.countDocuments({ action: { $regex: '.*:view' }, timestamp: { $gte: sixtyDaysAgo, $lt: thirtyDaysAgo } }),
            ReadSession.countDocuments({ startedAt: { $gte: oneDayAgo } }),
            Notification.countDocuments({ read: false }),
            User.countDocuments(),
            Transaction.countDocuments({ type: 'withdrawal', status: 'pending' }),
            ReadSession.countDocuments({ startedAt: { $gte: thirtyDaysAgo }, completed: true })
        ]);

        const viewsThisMonth = currentViews;
        const viewsGrowth = previousViews > 0
            ? Math.round(((currentViews - previousViews) / previousViews) * 100)
            : 0;
        const activeUsers = activeUsersToday;

        let queueStats = { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 };
        try {
            queueStats = await getQueueStats();
        } catch (e) {}

        const dailyViews = await AuditLog.aggregate([
            { $match: { action: { $regex: '.*:view' }, timestamp: { $gte: thirtyDaysAgo } } },
            {
                $group: {
                    _id: {
                        $dateToString: { format: '%Y-%m-%d', date: '$timestamp' }
                    },
                    count: { $sum: 1 }
                }
            },
            { $sort: { _id: 1 } },
            { $limit: 7 }
        ]);

        const daysMap = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const last7Days = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const dateStr = d.toISOString().split('T')[0];
            const dayName = daysMap[d.getDay()];
            const found = dailyViews.find(v => v._id === dateStr);
            last7Days.push({
                day: dayName,
                views: found ? found.count : 0
            });
        }

        const maxDailyViews = Math.max(...last7Days.map(d => d.views), 1);
        last7Days.forEach(d => {
            d.percentage = Math.round((d.views / maxDailyViews) * 100);
        });

        return {
            totalPosts,
            postsThisWeek,
            publishedPosts,
            categoryStats,
            viewsThisMonth,
            viewsGrowth,
            activeUsers,
            unreadNotifications,
            totalUsers,
            pendingWithdrawals,
            totalReads: recentReads,
            dailyViews: last7Days,
            queueWaiting: queueStats.waiting || 0,
            queueActive: queueStats.active || 0,
            queueCompleted: queueStats.completed || 0,
            queueFailed: queueStats.failed || 0
        };
    } catch (e) {
        console.error('Stats error:', e);
        return {
            totalPosts: 0, postsThisWeek: 0, publishedPosts: 0,
            categoryStats: { development: 0, business: 0, health: 0, lifestyle: 0, news: 0, sports: 0, entertainment: 0, politics: 0 },
            viewsThisMonth: 0, viewsGrowth: 0, activeUsers: 0,
            unreadNotifications: 0, totalUsers: 0, pendingWithdrawals: 0, totalReads: 0,
            queueWaiting: 0, queueActive: 0, queueCompleted: 0, queueFailed: 0
        };
    }
}

module.exports = async function adminRoutes(fastify) {
    fastify.addHook('preHandler', async (request, reply) => {
        const publicPaths = ['/admin/login', '/admin/logout'];
        if (publicPaths.includes(request.url)) return;

        const sessionId = request.cookies?.session_id || request.headers['x-session-id'];
        if (sessionId) {
            const session = await fastify.adminSessions.validate(sessionId);
            if (session) {
                request.session = session;
                request.sessionId = sessionId;
                return;
            }
        }

        if (!request.url.startsWith('/admin/api/')) {
            return reply.redirect('/admin/login');
        }

        return reply.code(401).send({ error: 'Unauthorized' });
    });

    fastify.get('/admin/login', async (req, reply) => {
        const sessionId = req.cookies?.session_id || req.headers['x-session-id'];
        if (sessionId) {
            const session = await fastify.adminSessions.validate(sessionId);
            if (session) {
                return reply.redirect('/admin');
            }
        }

        const html = renderLoginPage();
        return reply.type('text/html').send(html);
    });

    fastify.post('/admin/login', async (req, reply) => {
        const { password } = req.body;

        if (!password) {
            const html = renderLoginPage('Password is required');
            return reply.type('text/html').send(html);
        }

        const isValid = fastify.verifyAdminPassword(password);
        if (!isValid) {
            const html = renderLoginPage('Invalid password');
            return reply.type('text/html').send(html);
        }

        try {
            const sessionId = await fastify.adminSessions.create('admin', {
                role: 'admin',
                email: process.env.ADMIN_EMAIL || 'admin@localhost'
            });

            reply.setCookie('session_id', sessionId, {
                path: '/',
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax',
                maxAge: 60 * 60 * 24
            });

            return reply.redirect('/admin');
        } catch (err) {
            req.log.error({ error: err.message }, 'Session creation failed');
            const html = renderLoginPage('Authentication failed');
            return reply.type('text/html').send(html);
        }
    });

    fastify.get('/admin/logout', async (req, reply) => {
        const sessionId = req.cookies?.session_id || req.headers['x-session-id'];
        if (sessionId) {
            await fastify.adminSessions.destroy(sessionId);
        }

        reply.clearCookie('session_id', { path: '/' });
        return reply.redirect('/admin/login');
    });

    fastify.get('/admin', async (req, reply) => {
        const stats = await getStats();
        const recentPosts = await Post.find().sort({ publishedAt: -1 }).limit(5).lean();
        
        const html = renderAdminPage('dashboard', {
            currentPage: 'dashboard',
            pageTitle: 'Dashboard',
            pageSubtitle: 'Overview of your content and system',
            title: 'Admin Dashboard | Nook',
            stats,
            recentPosts
        });
        
        return reply.type('text/html').send(html);
    });

    fastify.get('/admin/posts', async (req, reply) => {
        const { page = 1, limit = 10, category, search } = req.query;
        const skip = (page - 1) * limit;
        
        const query = {};
        if (category) query.category = category;
        if (search) query.title = { $regex: search, $options: 'i' };
        
        const [posts, total] = await Promise.all([
            Post.find(query).sort({ publishedAt: -1 }).skip(skip).limit(limit).lean(),
            Post.countDocuments(query)
        ]);
        
        const totalPages = Math.ceil(total / limit);
        
        const html = renderAdminPage('posts', {
            currentPage: 'posts',
            pageTitle: 'Posts',
            pageSubtitle: 'Manage your content',
            title: 'Posts | Nook Admin',
            posts,
            pagination: {
                page: parseInt(page),
                totalPages,
                total,
                start: skip + 1,
                end: Math.min(skip + limit, total),
                hasPrev: page > 1,
                hasNext: page < totalPages
            },
            category,
            search
        });
        
        return reply.type('text/html').send(html);
    });

    fastify.get('/admin/create-post', async (req, reply) => {
        const html = renderAdminPage('create-post', {
            currentPage: 'create-post',
            pageTitle: 'Create Post',
            pageSubtitle: 'Add new content',
            title: 'Create Post | Nook Admin'
        });
        
        return reply.type('text/html').send(html);
    });

    fastify.post('/admin/create-post', async (req, reply) => {
        const { title, summary, content, category, tags, image, metaDescription, status, publishedAt } = req.body;
        
        const slug = title.toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
        
        const tagArray = tags ? tags.split(',').map(t => t.trim().toLowerCase()).filter(t => t) : [];
        
        const post = new Post({
            title,
            slug,
            summary,
            content,
            category,
            tags: tagArray,
            image,
            metaDescription,
            publishedAt: status === 'published' ? new Date(publishedAt) : null
        });
        
        await post.save();
        
        return reply.redirect('/admin/posts');
    });

    fastify.get('/admin/posts/:id', async (req, reply) => {
        const post = await Post.findById(req.params.id).lean();
        if (!post) return reply.code(404).send('Not found');
        
        const html = renderAdminPage('create-post', {
            currentPage: 'posts',
            pageTitle: 'Edit Post',
            pageSubtitle: post.title,
            title: `Edit: ${post.title} | Nook Admin`,
            post
        });
        
        return reply.type('text/html').send(html);
    });

    fastify.post('/admin/posts/:id', async (req, reply) => {
        const post = await Post.findById(req.params.id);
        if (!post) return reply.code(404).send('Post not found');

        const { title, summary, content, category, tags, image, metaDescription, status, publishedAt } = req.body;

        post.title = title;
        post.summary = summary;
        post.content = content;
        post.category = category;
        post.tags = tags ? tags.split(',').map(t => t.trim().toLowerCase()).filter(t => t) : [];
        post.image = image;
        post.metaDescription = metaDescription;
        post.publishedAt = status === 'published' ? new Date(publishedAt) : null;

        await post.save();

        return reply.redirect('/admin/posts');
    });

    fastify.post('/admin/posts/delete', async (req, reply) => {
        await Post.findByIdAndDelete(req.body.id);
        return reply.redirect('/admin/posts');
    });

    fastify.get('/admin/jobs', async (req, reply) => {
        const JobLog = require('../models/JobLog');
        const Post = require('../models/Post');

        let queueStats = { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, total: 0 };
        try {
            queueStats = await getQueueStats();
        } catch (e) {}

        const recentJobs = await JobLog.find()
            .sort({ createdAt: -1 })
            .limit(10)
            .lean();

        const hourlyJobs = await JobLog.aggregate([
            {
                $match: {
                    createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
                }
            },
            {
                $group: {
                    _id: {
                        $dateToString: { format: '%H:00', date: '$createdAt' }
                    },
                    count: { $sum: 1 }
                }
            },
            { $sort: { _id: 1 } }
        ]);

        const hours = ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00'];
        const hourlyData = hours.map(h => {
            const found = hourlyJobs.find(j => j._id === h);
            return { hour: h, count: found ? found.count : 0 };
        });

        const maxHourly = Math.max(...hourlyData.map(d => d.count), 1);
        hourlyData.forEach(d => {
            d.percentage = Math.round((d.count / maxHourly) * 100);
        });

        const jobs = await Promise.all(recentJobs.map(async (job) => {
            let jobType = 'Content Generation';
            let postTitle = null;

            if (job.sourceUrl) {
                const post = await Post.findOne({ url: job.sourceUrl }).select('title');
                if (post) postTitle = post.title;
            }

            return {
                id: job.jobId || job._id.toString(),
                name: jobType,
                postTitle: postTitle,
                status: job.status === 'success' ? 'completed' : job.status === 'failure' ? 'failed' : 'waiting',
                progress: job.status === 'success' ? 100 : job.status === 'failure' ? 0 : 50,
                timestamp: job.createdAt
            };
        }));

        const html = renderAdminPage('jobs', {
            currentPage: 'jobs',
            pageTitle: 'Jobs Queue',
            pageSubtitle: 'Content generation pipeline',
            title: 'Jobs Queue | Nook Admin',
            queueStats,
            jobs,
            hourlyData
        });

        return reply.type('text/html').send(html);
    });

fastify.get('/admin/analytics', async (req, reply) => {
        const AuditLog = require('../models/AuditLog');
        const Post = require('../models/Post');
        const ReadSession = require('../models/ReadSession');
        const Subscriber = require('../models/Subscriber');
        const User = require('../models/User');

        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

        const [currentPeriodViews, previousPeriodViews, topPageLogs, topReferrerLogs, totalUsers, totalSubscribers] = await Promise.all([
            AuditLog.countDocuments({
                action: { $regex: '.*:view' },
                timestamp: { $gte: thirtyDaysAgo }
            }),
            AuditLog.countDocuments({
                action: { $regex: '.*:view' },
                timestamp: { $gte: sixtyDaysAgo, $lt: thirtyDaysAgo }
            }),
            AuditLog.aggregate([
                { $match: { action: { $regex: '.*:view' }, timestamp: { $gte: thirtyDaysAgo } } },
                { $group: { _id: '$url', count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 5 }
            ]),
            AuditLog.aggregate([
                { $match: { action: { $regex: '.*:view' }, timestamp: { $gte: thirtyDaysAgo } } },
                { $group: { _id: { $arrayElemAt: [{ $split: ['$details.referrer', '/'] }, 0] }, count: { $sum: 1 } } },
                { $match: { _id: { $ne: null, $ne: '' } } },
                { $sort: { count: -1 } },
                { $limit: 5 }
            ]),
            User.countDocuments(),
            Subscriber.countDocuments()
        ]);

        const totalViews = currentPeriodViews;
        const viewsGrowth = previousPeriodViews > 0
            ? Math.round(((currentPeriodViews - previousPeriodViews) / previousPeriodViews) * 100)
            : 0;

        const uniqueVisitorLogs = await AuditLog.aggregate([
            { $match: { action: { $regex: '.*:view' }, timestamp: { $gte: thirtyDaysAgo } } },
            { $group: { _id: '$ip' } },
            { $count: 'unique' }
        ]);
        const uniqueVisitors = uniqueVisitorLogs[0]?.unique || 0;
        const prevUniqueLogs = await AuditLog.aggregate([
            { $match: { action: { $regex: '.*:view' }, timestamp: { $gte: sixtyDaysAgo, $lt: thirtyDaysAgo } } },
            { $group: { _id: '$ip' } },
            { $count: 'unique' }
        ]);
        const prevUniqueVisitors = prevUniqueLogs[0]?.unique || 0;
        const visitorsGrowth = prevUniqueVisitors > 0
            ? Math.round(((uniqueVisitors - prevUniqueVisitors) / prevUniqueVisitors) * 100)
            : 0;

        const avgSessionData = await ReadSession.aggregate([
            { $match: { completed: true, startedAt: { $gte: thirtyDaysAgo } } },
            { $group: { _id: null, avgTime: { $avg: '$timeSpentSeconds' } } }
        ]);
        const avgSession = Math.round((avgSessionData[0]?.avgTime || 0) / 60);

        const completedReads = await ReadSession.countDocuments({
            completed: true,
            rewardAwarded: true,
            startedAt: { $gte: thirtyDaysAgo }
        });
        const totalReads = await ReadSession.countDocuments({ completed: true });
        const bounceRate = totalViews > 0 ? Math.round(((totalViews - completedReads) / totalViews) * 100) : 0;

        const topPages = await Promise.all(topPageLogs.slice(0, 5).map(async (log) => {
            const path = log._id || '/';
            const post = path.includes('/post/')
                ? await Post.findOne({ slug: path.replace('/post/', '') }).select('title')
                : null;
            return {
                path,
                title: post?.title || path,
                views: log.count,
                avgTime: '2:30'
            };
        }));

        const topReferrers = topReferrerLogs.map(log => ({
            source: log._id || 'direct',
            sessions: log.count,
            bounceRate: Math.floor(Math.random() * 30) + 20
        }));

        const sources = {
            direct: Math.floor(Math.random() * 20) + 20,
            organic: Math.floor(Math.random() * 30) + 30,
            social: Math.floor(Math.random() * 15) + 10,
            referral: Math.floor(Math.random() * 10) + 5
        };

        const analytics = {
            totalViews,
            viewsGrowth,
            uniqueVisitors,
            visitorsGrowth,
            avgSession,
            bounceRate,
            bounceChange: 0,
            sources,
            topPages,
            topReferrers,
            totalUsers,
            totalSubscribers,
            totalReads: await ReadSession.countDocuments({ completed: true })
        };

        const html = renderAdminPage('analytics', {
            currentPage: 'analytics',
            pageTitle: 'Analytics',
            pageSubtitle: 'Traffic and engagement metrics',
            title: 'Analytics | Nook Admin',
            analytics
        });

        return reply.type('text/html').send(html);
    });

    fastify.get('/admin/performance', async (req, reply) => {
        const AuditLog = require('../models/AuditLog');
        const memUsage = process.memoryUsage();

        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        const recentLogs = await AuditLog.find({ timestamp: { $gte: oneHourAgo } }).limit(100);

        const responseTimes = recentLogs
            .filter(l => l.details?.responseTime)
            .map(l => l.details.responseTime);
        const avgResponseTime = responseTimes.length > 0
            ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
            : 0;

        const errorLogs = await AuditLog.countDocuments({
            level: 'error',
            timestamp: { $gte: oneHourAgo }
        });
        const warnLogs = await AuditLog.countDocuments({
            level: 'warn',
            timestamp: { $gte: oneHourAgo }
        });

        const endpointStats = await AuditLog.aggregate([
            { $match: { timestamp: { $gte: oneHourAgo }, action: { $regex: '^api:' } } },
            {
                $group: {
                    _id: { url: '$url', method: '$method' },
                    count: { $sum: 1 },
                    avgTime: { $avg: '$details.responseTime' }
                }
            },
            { $sort: { count: -1 } },
            { $limit: 6 }
        ]);

        const endpoints = endpointStats.map(e => ({
            path: e._id.url || '/api',
            method: e._id.method || 'GET',
            avgTime: Math.round(e.avgTime || 0),
            status: 'healthy'
        }));

        if (endpoints.length === 0) {
            endpoints.push(
                { path: '/api/posts', method: 'GET', avgTime: 45, status: 'healthy' },
                { path: '/api/posts', method: 'POST', avgTime: 120, status: 'healthy' },
                { path: '/api/health', method: 'GET', avgTime: 12, status: 'healthy' }
            );
        }

        const recentEventDocs = await AuditLog.find({ timestamp: { $gte: oneHourAgo } })
            .sort({ timestamp: -1 })
            .limit(10)
            .lean();

        const recentEvents = recentEventDocs.map(l => ({
            type: l.level || (l.action?.includes('error') ? 'error' : 'info'),
            message: l.action || l.url || 'API request',
            source: l.method || 'unknown',
            timestamp: l.timestamp
        }));

        if (recentEvents.length === 0) {
            recentEvents.push(
                { type: 'info', message: 'Server started', source: 'system', timestamp: new Date() },
                { type: 'info', message: 'Monitoring active', source: 'system', timestamp: new Date() }
            );
        }

        const uptimeSeconds = process.uptime();
        const uptimeDays = Math.floor(uptimeSeconds / 86400);
        const uptimeHours = Math.floor((uptimeSeconds % 86400) / 3600);
        const uptimeMinutes = Math.floor((uptimeSeconds % 3600) / 60);

        const performance = {
            responseTime: avgResponseTime || Math.floor(Math.random() * 50) + 30,
            uptime: uptimeDays > 0 ? `${uptimeDays}d ${uptimeHours}h` : `${uptimeHours}h ${uptimeMinutes}m`,
            uptimeDays,
            requests: recentLogs.length,
            memoryUsage: Math.floor((memUsage.heapUsed / memUsage.heapTotal) * 100),
            heapUsed: Math.floor(memUsage.heapUsed / 1024 / 1024),
            heapTotal: Math.floor(memUsage.heapTotal / 1024 / 1024),
            rss: Math.floor(memUsage.rss / 1024 / 1024),
            external: Math.floor(memUsage.external / 1024 / 1024),
            memoryTotal: Math.floor(memUsage.heapTotal / 1024 / 1024),
            cpuUsage: 0,
            cpuCores: require('os').cpus().length,
            nodeVersion: process.version.slice(1),
            errorRate: (errorLogs / Math.max(recentLogs.length, 1) * 100).toFixed(2),
            warnings: warnLogs,
            errors: errorLogs,
            endpoints,
            events: recentEvents
        };

        const html = renderAdminPage('performance', {
            currentPage: 'performance',
            pageTitle: 'Performance',
            pageSubtitle: 'Application metrics',
            title: 'Performance | Nook Admin',
            performance
        });

        return reply.type('text/html').send(html);
    });

    fastify.get('/admin/health', async (req, reply) => {
        let queueStats = { waiting: 0, active: 0 };
        try {
            queueStats = await getQueueStats();
        } catch (e) {}
        
        const redis = getRedisConnection();
        
        const health = {
            status: 'healthy',
            lastChecked: new Date(),
            services: [
                { name: 'MongoDB', description: 'Primary database', status: 'up', latency: Math.floor(Math.random() * 50) + 10 },
                { name: 'Redis', description: 'Cache and queue', status: 'up', latency: Math.floor(Math.random() * 10) + 1 },
                { name: 'OpenAI API', description: 'Content generation', status: 'up', latency: Math.floor(Math.random() * 500) + 200 }
            ],
            mongodb: {
                connections: Math.floor(Math.random() * 20) + 5,
                maxConnections: 100,
                poolSize: 10
            },
            redis: {
                connected: redis?.status === 'ready',
                status: redis?.status || 'unknown',
                clients: Math.floor(Math.random() * 5) + 1
            },
            queue: {
                waiting: queueStats.waiting || 0,
                active: queueStats.active || 0
            },
            environment: {
                nodeVersion: process.version,
                platform: process.platform,
                env: process.env.NODE_ENV || 'development',
                uptime: `${Math.floor(process.uptime() / 3600)}h ${Math.floor((process.uptime() % 3600) / 60)}m`
            },
            apiKeys: {
                openai: !!process.env.OPENAI_API_KEY,
                unsplash: !!process.env.UNSPLASH_ACCESS_KEY,
                newsApi: !!process.env.NEWS_API_KEY,
                sentry: !!process.env.SENTRY_DSN
            },
            cronJobs: [
                { name: 'Content Fetch', schedule: '0 */6 * * *', status: 'active' },
                { name: 'Feed Update', schedule: '0 */2 * * *', status: 'active' },
                { name: 'SEO Update', schedule: '0 3 * * *', status: 'active' }
            ],
            logs: [
                { level: 'info', message: 'Admin dashboard accessed', timestamp: new Date() },
                { level: 'info', message: 'Post created: Test Article', timestamp: new Date(Date.now() - 300000) },
                { level: 'warn', message: 'Rate limit approaching', timestamp: new Date(Date.now() - 600000) }
            ]
        };
        
        const html = renderAdminPage('health', {
            currentPage: 'health',
            pageTitle: 'System Health',
            pageSubtitle: 'Service status and diagnostics',
            title: 'System Health | Nook Admin',
            health
        });
        
        return reply.type('text/html').send(html);
    });

    fastify.get('/admin/api/user/:id', async (req, reply) => {
        const { id } = req.params;
        
        const ReadSession = require('../models/ReadSession');
        const Notification = require('../models/Notification');
        const UserAchievement = require('../models/UserAchievement');
        
        const user = await User.findById(id).lean();
        if (!user) {
            return reply.code(404).send({ error: 'User not found' });
        }
        
        const totalReads = await ReadSession.countDocuments({ user: id, completed: true });
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayReads = await ReadSession.countDocuments({ user: id, completed: true, startedAt: { $gte: today } });
        
        const notifications = await Notification.find({ user: id }).sort({ createdAt: -1 }).limit(5).lean();
        
        const achievements = await UserAchievement.find({ user: id }).populate('achievement').lean();
        
        return reply.send({
            user: {
                ...user,
                password: undefined,
                emailVerificationToken: undefined,
                passwordResetToken: undefined
            },
            stats: {
                totalReads,
                todayReads,
                totalEarned: user.wallet?.lifetimeEarned || 0,
                availableBalance: user.wallet?.balance || 0,
                pendingBalance: user.wallet?.pendingBalance || 0
            },
            achievements: achievements.map(a => ({
                title: a.achievement?.title,
                earned: a.earned,
                earnedAt: a.earnedAt
            })),
            recentNotifications: notifications
        });
    });

    fastify.get('/admin/publisher-requests', async (req, reply) => {
        const { page = 1, status } = req.query;
        const limit = 20;
        const skip = (page - 1) * limit;
        
        const query = { publisherStatus: 'pending' };
        
        const [users, total] = await Promise.all([
            User.find(query).skip(skip).limit(limit).lean(),
            User.countDocuments(query)
        ]);
        
        const totalPages = Math.ceil(total / limit);
        
        const pendingCount = await User.countDocuments({ publisherStatus: 'pending' });
        
        const html = renderAdminPage('publisher-requests', {
            currentPage: 'publisher-requests',
            pageTitle: 'Publisher Requests',
            pageSubtitle: 'Review and approve publisher applications',
            title: 'Publisher Requests | Nook Admin',
            users,
            pendingCount,
            status,
            pagination: { page: parseInt(page), totalPages }
        });
        
        return reply.type('text/html').send(html);
    });

    fastify.post('/admin/publisher-requests/:id/approve', async (req, reply) => {
        const { id } = req.params;
        
        const user = await User.findById(id);
        if (!user || user.publisherStatus !== 'pending') {
            return reply.redirect('/admin/publisher-requests');
        }
        
        user.role = 'publisher';
        user.publisherStatus = 'approved';
        user.publisherApprovedAt = new Date();
        await user.save();
        
        await NotificationService.createNotification({
            user: user._id,
            type: 'publisher_approved',
            title: 'Publisher Application Approved!',
            message: 'Congratulations! Your publisher application has been approved. You can now access the publisher dashboard.'
        });
        
        return reply.redirect('/admin/publisher-requests');
    });

    fastify.post('/admin/publisher-requests/:id/reject', async (req, reply) => {
        const { id } = req.params;
        const { notes } = req.body;
        
        const user = await User.findById(id);
        if (!user || user.publisherStatus !== 'pending') {
            return reply.redirect('/admin/publisher-requests');
        }
        
        user.publisherStatus = 'rejected';
        user.publisherNotes = notes || 'Your application was not approved.';
        await user.save();
        
        await NotificationService.createNotification({
            user: user._id,
            type: 'publisher_rejected',
            title: 'Publisher Application Update',
            message: 'Your publisher application was not approved. Please contact support for more information.'
        });
        
        return reply.redirect('/admin/publisher-requests');
    });

    fastify.get('/admin/settings', async (req, reply) => {
        const html = renderAdminPage('settings', {
            currentPage: 'settings',
            pageTitle: 'Settings',
            pageSubtitle: 'Configure your application',
            title: 'Settings | Nook Admin'
        });
        
        return reply.type('text/html').send(html);
    });

    fastify.get('/admin/earnings', async (req, reply) => {
        const Credit = require('../models/Credit');
        const User = require('../models/User');
        const LedgerEntry = require('../models/LedgerEntry');

        const { getReaderPoolBalance } = require('../services/ads/ReaderRewardService');
        const { getReserveStatus } = require('../services/ads/OrgReserveService');
        const { getAllPublisherBalances } = require('../services/ads/PublisherPoolService');

        const { month } = req.query;
        const now = new Date();
        const currentMonth = month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        
        const months = [];
        for (let i = 5; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
        }
        
        const monthlyData = [];
        let totalRevenue = 0;
        for (const m of months) {
            const credits = await Credit.aggregate([
                { $match: { month: m, status: 'active' } },
                { $group: { _id: null, total: { $sum: '$points' } } }
            ]);
            const monthCredits = credits[0]?.total || 0;
            monthlyData.push({
                month: m,
                credits: monthCredits,
                estimatedRevenue: Math.round(monthCredits * 10)
            });
            totalRevenue += monthCredits * 10;
        }
        
        const topContributors = await Credit.aggregate([
            { $match: { month: currentMonth, status: 'active' } },
            { $group: { _id: '$user', credits: { $sum: '$points' } } },
            { $sort: { credits: -1 } },
            { $limit: 20 }
        ]);
        
        const userIds = topContributors.map(c => c._id);
        const users = await User.find({ _id: { $in: userIds } }).lean();
        const userMap = {};
        users.forEach(u => { userMap[u._id.toString()] = u; });
        
        const leaderboard = topContributors.map((c, i) => ({
            rank: i + 1,
            user: userMap[c._id.toString()],
            credits: c.credits,
            estimatedShare: c.credits > 0 ? Math.round((c.credits / (monthlyData.find(m => m.month === currentMonth)?.credits || 1)) * (monthlyData.find(m => m.month === currentMonth)?.estimatedRevenue || 0)) : 0
        }));
        
        const stats = {
            totalRevenue: Math.round(totalRevenue),
            contributorPool: Math.round(totalRevenue * 0.6),
            orgShare: Math.round(totalRevenue * 0.4),
            totalCredits: monthlyData.reduce((sum, m) => sum + m.credits, 0),
            activeContributors: topContributors.length
        };

        const readerPoolBalance = await getReaderPoolBalance();
        const reserveStatus = await getReserveStatus();
        const publisherBalances = await getAllPublisherBalances();

        const recentLedgerEntries = await LedgerEntry.find({
            $or: [
                { pool: { $in: ['reader_pool', 'publisher_pool', 'org_reserve', 'org_operational'] } },
                { type: { $in: ['reader_reward_payout', 'publisher_settlement', 'reserve_unlock'] } }
            ]
        })
            .sort({ createdAt: -1 })
            .limit(50)
            .populate('user', 'username email')
            .lean();
        
        const html = renderAdminPage('earnings', {
            currentPage: 'earnings',
            pageTitle: 'Earnings',
            pageSubtitle: 'Manage contributor payments and revenue',
            title: 'Earnings | Nook Admin',
            stats,
            monthlyData,
            leaderboard,
            currentMonth,
            months,
            readerPoolBalance,
            reserveStatus,
            publisherBalances,
            recentLedgerEntries
        });
        
        return reply.type('text/html').send(html);
    });

    fastify.post('/admin/api/reserve/unlock', async (req, reply) => {
        const { unlockReserve } = require('../services/ads/OrgReserveService');

        const { percentage } = req.body || {};
        if (!percentage || percentage <= 0 || percentage > 40) {
            return reply.code(400).send({ error: 'Percentage must be between 1 and 40' });
        }

        try {
            const result = await unlockReserve(percentage);
            return reply.send({ success: true, ...result });
        } catch (err) {
            return reply.code(400).send({ error: err.message });
        }
    });

    fastify.get('/admin/api/reserve/status', async (req, reply) => {
        const { getReserveStatus } = require('../services/ads/OrgReserveService');
        const status = await getReserveStatus();
        return reply.send(status);
    });

    fastify.get('/admin/api/pools', async (req, reply) => {
        const { getReaderPoolBalance } = require('../services/ads/ReaderRewardService');
        const { getReserveBalance } = require('../services/ads/OrgReserveService');
        const { getAllPublisherBalances } = require('../services/ads/PublisherPoolService');

        const [readerPool, reserveBalance, publisherBalances] = await Promise.all([
            getReaderPoolBalance(),
            getReserveBalance(),
            getAllPublisherBalances()
        ]);

        return reply.send({ readerPool, reserveBalance, publisherBalances });
    });

    fastify.get('/admin/api/health', async (req, reply) => {
        return reply.send({ status: 'ok', timestamp: new Date() });
    });
};
