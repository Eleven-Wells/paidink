const { generateRelatedPostsHtml } = require('../seo/internalLinking');
const { createTranslateFunction, formatDate, formatRelativeTime, getLanguage, supportedLanguages } = require('../i18n/i18n');
const { CATEGORY_ENUM, CATEGORY_NAMES } = require('../config');
const postService = require('../services/PostService');
const NotificationService = require('../services/NotificationService');
const DashboardService = require('../services/DashboardService');
const User = require('../models/User');
const recommendationService = require('../services/RecommendationService');
const searchService = require('../services/SearchService');
const { isFeatureEnabled } = require('../config/features');
const { getReadTime } = require('../services/ReadTimeService');
const { buildSitemapXml, buildRobotsTxt } = require('../seo/seoManager');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const markdownIt = require('markdown-it');
const md = markdownIt({ html: true, breaks: true, linkify: true });

const viewsPath = path.join(__dirname, '..', 'views');
const publisherViewsPath = path.join(viewsPath, 'publisher', 'pages');
const adminViewsPath = path.join(viewsPath, 'admin');
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

function renderPublisherPage(pageName, data) {
    const pagePath = path.join(publisherViewsPath, `${pageName}.ejs`);
    if (!fs.existsSync(pagePath)) {
        return '';
    }
    const ejs = require('ejs');
    const pageContent = fs.readFileSync(pagePath, 'utf8');
    return ejs.render(pageContent, data, {
        async: false,
        views: [viewsPath, publisherViewsPath]
    });
}

function renderPage(pageName, data) {
    const viewsPath = path.join(__dirname, '..', 'views');
    const pagesPath = path.join(viewsPath, 'pages', `${pageName}.ejs`);
    const staticPath = path.join(viewsPath, 'partials', 'static', `${pageName}.ejs`);

    let pagePath = pagesPath;
    if (!fs.existsSync(pagesPath) && fs.existsSync(staticPath)) {
        pagePath = staticPath;
    }

    if (!fs.existsSync(pagePath)) {
        return '';
    }
    const ejs = require('ejs');
    const pageContent = fs.readFileSync(pagePath, 'utf8');
    return ejs.render(pageContent, { ...data, getReadTime }, {
        async: false,
        views: [viewsPath, path.join(viewsPath, 'layouts'), path.join(viewsPath, 'partials'), path.join(viewsPath, 'pages')]
    });
}

function renderErrorPage(errorName, req) {
    const errorPath = path.join(viewsPath, 'errors', `${errorName}.ejs`);
    if (!fs.existsSync(errorPath)) {
        return '<div class="p-8 text-center"><h1>Error</h1><p>Something went wrong.</p></div>';
    }
    const ejs = require('ejs');
    const errorContent = fs.readFileSync(errorPath, 'utf8');
    return ejs.render(errorContent, {
        lang: getLanguage(req),
        theme: req.cookies?.theme || 'light'
    }, {
        async: false,
        views: [viewsPath, path.join(viewsPath, 'errors')]
    });
}

function getAvatarWithFallback(user) {
    if (user && user.avatar) return user.avatar;
    var initial = '?';
    if (user) {
        const nameSource = user.username || user.displayName || '';
        if (nameSource && nameSource.length > 0) initial = nameSource.charAt(0).toUpperCase();
    }
    return 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><circle cx="40" cy="40" r="40" fill="#e5e5e5"/><text x="40" y="52" text-anchor="middle" fill="#6d0a0a" font-size="36" font-family="sans-serif">' + initial + '</text></svg>');
}

async function pagesRoutes(fastify) {
    fastify.addHook('preHandler', async (req, reply) => {
        const token = req.cookies?.auth_token;
        req.isLoggedIn = false;
        req.currentUser = null;
        req.unreadCount = 0;

        if (token) {
            try {
                const decoded = fastify.jwt.verify(token);
                const User = require('../models/User');
                const user = await User.findById(decoded.id);
                if (user && user.isActive) {
                    req.isLoggedIn = true;
                    req.currentUser = user;
                    const Notification = require('../models/Notification');
                    req.unreadCount = await Notification.countDocuments({ user: user._id, read: false });
                }
            } catch (e) { }
        }
    });

    fastify.get('/debug-auth', async (req, reply) => {
        return reply.send({
            cookies: req.cookies,
            cookieHeader: req.headers.cookie || req.raw?.headers?.cookie,
            isLoggedIn: req.isLoggedIn,
            hasAuthToken: !!req.cookies?.auth_token,
            authTokenPrefix: req.cookies?.auth_token ? req.cookies.auth_token.substring(0, 20) + '...' : null
        });
    });

    fastify.get('/sitemap.xml', async (req, reply) => {
        const { content } = await buildSitemapXml();
        reply.type('application/xml; charset=utf-8').send(content);
    });

    fastify.get('/robots.txt', async (req, reply) => {
        const content = await buildRobotsTxt();
        reply.type('text/plain; charset=utf-8').send(content);
    });

    fastify.get('/register', async (req, reply) => {
        const token = req.cookies?.auth_token;
        if (token) {
            try {
                const decoded = fastify.jwt.verify(token);
                const User = require('../models/User');
                const user = await User.findById(decoded.id);
                if (user && user.isActive) {
                    return reply.redirect('/dashboard');
                }
            } catch (e) {
                reply.clearCookie('auth_token', { path: '/' });
            }
        }

        const referralCode = req.query.ref || '';
        return reply.view('pages/register-light.ejs', {
            referralCode,
            error: req.query.error || null,
            isLightTheme: true
        });
    });

    fastify.get('/login', async (req, reply) => {
        const token = req.cookies?.auth_token;
        if (token) {
            try {
                const decoded = fastify.jwt.verify(token);
                const User = require('../models/User');
                const user = await User.findById(decoded.id);
                if (user && user.isActive) {
                    return reply.redirect('/dashboard');
                }
            } catch (e) {
                reply.clearCookie('auth_token', { path: '/' });
            }
        }

        const redirectParam = req.query.redirect || '';
        let redirectUrl = '/dashboard';
        if (redirectParam && redirectParam.startsWith('/')) {
            redirectUrl = redirectParam;
        }

        return reply.view('pages/login-light.ejs', {
            redirectUrl,
            error: req.query.error || null,
            isLightTheme: true
        });
    });

    fastify.get('/about', async (req, reply) => {
        const lang = getLanguage(req);
        const pageContent = renderPage('about', {});
        return reply.view('layouts/default.ejs', {
            body: pageContent,
            activeCategory: null,
            lang,
            theme: req.cookies?.theme || 'light',
            title: 'About Us | PaidInk',
            description: 'Learn more about PaidInk, our mission, and the community behind it.',
            canonical: `${process.env.BASE_URL || ''}/about`,
            isLoggedIn: req.isLoggedIn,
            user: req.currentUser ? req.currentUser.toPublicJSON() : null
        });
    });

    fastify.get('/contact', async (req, reply) => {
        const lang = getLanguage(req);
        const pageContent = renderPage('contact', {});
        return reply.view('layouts/default.ejs', {
            body: pageContent,
            activeCategory: null,
            lang,
            theme: req.cookies?.theme || 'light',
            title: 'Contact Us | PaidInk',
            description: 'Get in touch with the PaidInk team. We\'d love to hear from you.',
            canonical: `${process.env.BASE_URL || ''}/contact`,
            isLoggedIn: req.isLoggedIn,
            user: req.currentUser ? req.currentUser.toPublicJSON() : null
        });
    });

    fastify.get('/privacy', async (req, reply) => {
        const lang = getLanguage(req);
        const pageContent = renderPage('privacy', {});
        return reply.view('layouts/default.ejs', {
            body: pageContent,
            activeCategory: null,
            lang,
            theme: req.cookies?.theme || 'light',
            title: 'Privacy Policy | PaidInk',
            description: 'Read our privacy policy to understand how PaidInk handles your data.',
            canonical: `${process.env.BASE_URL || ''}/privacy`,
            isLoggedIn: req.isLoggedIn,
            user: req.currentUser ? req.currentUser.toPublicJSON() : null
        });
    });

    fastify.get('/terms', async (req, reply) => {
        const lang = getLanguage(req);
        const pageContent = renderPage('terms', {});
        return reply.view('layouts/default.ejs', {
            body: pageContent,
            activeCategory: null,
            lang,
            theme: req.cookies?.theme || 'light',
            title: 'Terms of Service | PaidInk',
            description: 'Read our terms of service to understand the rules and regulations for using PaidInk.',
            canonical: `${process.env.BASE_URL || ''}/terms`,
            isLoggedIn: req.isLoggedIn,
            user: req.currentUser ? req.currentUser.toPublicJSON() : null
        });
    });

    fastify.get('/dashboard', {
        preHandler: [fastify.authenticate]
    }, async (req, reply) => {
        const ReadSession = require('../models/ReadSession');

        const userId = req.user.id;
        const user = await User.findById(userId);

        const RewardRateService = require('../services/RewardRateService');

        const [summary, recentReads, referredCount, currentRate] = await Promise.all([
            DashboardService.getDashboardSummary(userId),
            ReadSession.find({ user: userId })
                .sort({ startedAt: -1 })
                .limit(5)
                .populate('post', 'title slug summary image')
                .lean()
                .then(sessions => sessions.map(s => ({
                    ...s,
                    rewardAmount: s.rewardAmount / 100
                }))),
            User.countDocuments({ referredBy: userId }),
            RewardRateService.getCurrentRate()
        ]);

        const readsToNextMilestone = Math.max(0, 50 - (user?.stats?.totalReads || 0) % 50);

        let rewardedAd = null;
        try {
            const { getAds: getAd } = require('../services/ads/ProviderService');
            const rewardedAds = await getAd({ placement: 'reward_wall', user: { id: userId }, session: null });
            rewardedAd = rewardedAds.length > 0 ? rewardedAds[0] : null;
        } catch (e) {
            // Ads not available
        }

        return reply.view('pages/dashboard.ejs', {
            user: user.toPublicJSON(),
            pageTitle: 'Dashboard',
            readsThisWeek: summary.reads.last7Days,
            isLoggedIn: true,
            unreadCount: req.unreadCount,
            dashboardTheme: 'light',
            title: 'Dashboard | PaidInk',
            description: 'Track your reading activity, earnings, and milestones on PaidInk.',
            canonical: `${process.env.BASE_URL || ''}/dashboard`,
            readHistory: recentReads,
            readStats: {
                todayReads: summary.reads.today,
                totalReads: summary.reads.total,
                reads7d: summary.reads.last7Days,
                reads7dDelta: summary.earnings.last7DaysDelta,
                earned7d: summary.earnings.last7Days,
                earned7dDelta: summary.earnings.last7DaysDelta,
                readsToNextMilestone,
                referredCount,
                referralTarget: 5
            },
            wallet: summary.wallet,
            recentEntries: summary.recentEntries,
            balanceLastSynced: user.wallet.balanceLastSynced,
            rewardedAd,
            currentRate
        });
    });

    fastify.get('/profile', {
        preHandler: [fastify.authenticate]
    }, async (req, reply) => {
        const Post = require('../models/Post');
        const userId = req.user.id;

        const fullUser = await User.findById(userId)
            .select('displayName username email bio phone country avatar wallet stats createdAt referralCode savedPosts following role publisherStatus')
            .lean();

        const savedPostIds = (fullUser && fullUser.savedPosts) ? fullUser.savedPosts : [];
        const followingIds = (fullUser && fullUser.following) ? fullUser.following : [];

        const [savedPosts, followingUsers, followersUsers, followersCount] = await Promise.all([
            savedPostIds.length
                ? Post.find({ _id: { $in: savedPostIds } })
                    .sort({ publishedAt: -1 })
                    .limit(24)
                    .populate('author', 'displayName username avatar role')
                    .lean()
                : [],
            followingIds.length
                ? User.find({ _id: { $in: followingIds } })
                    .select('displayName username avatar role bio')
                    .sort({ displayName: 1 })
                    .lean()
                : [],
            User.find({ following: userId })
                .select('displayName username avatar role bio')
                .sort({ displayName: 1 })
                .limit(50)
                .lean(),
            User.countDocuments({ following: userId })
        ]);

        const savedPostsPrepared = savedPosts.map((post) => {
            if (post.author) {
                post.author.avatar = getAvatarWithFallback(post.author);
            }
            post.readTime = getReadTime(post.content).display;
            return post;
        });

        const mapPerson = (person) => ({
            ...person,
            avatar: getAvatarWithFallback(person)
        });

        const publicUser = req.user.toPublicJSON();
        if (publicUser) {
            publicUser.avatar = getAvatarWithFallback(publicUser);
        }

        return reply.view('pages/profile.ejs', {
            user: publicUser,
            pageTitle: 'Profile',
            isLoggedIn: true,
            unreadCount: req.unreadCount,
            dashboardTheme: 'light',
            title: 'Profile | PaidInk',
            description: 'Manage your PaidInk profile, saved posts, and connections.',
            canonical: `${process.env.BASE_URL || ''}/profile`,
            savedPosts: savedPostsPrepared,
            followingUsers: followingUsers.map(mapPerson),
            followersUsers: followersUsers.map(mapPerson),
            profileStats: {
                followingCount: followingIds.length,
                followersCount,
                savedCount: savedPostIds.length
            }
        });
    });

    fastify.get('/reads', {
        preHandler: [fastify.authenticate]
    }, async (req, reply) => {
        const ReadSession = require('../models/ReadSession');
        const userId = req.user.id;

        const RewardRateService = require('../services/RewardRateService');

        const [reads, totalReads, currentRate] = await Promise.all([
            ReadSession.find({ user: userId })
                .sort({ startedAt: -1 })
                .limit(50)
                .populate('post', 'title slug summary image')
                .lean()
                .then(sessions => sessions.map(s => ({
                    ...s,
                    rewardAmount: s.rewardAmount / 100
                }))),
            ReadSession.countDocuments({
                user: userId,
                completed: true
            }),
            RewardRateService.getCurrentRate()
        ]);

        return reply.view('pages/reads.ejs', {
            user: req.user.toPublicJSON(),
            isLoggedIn: true,
            unreadCount: req.unreadCount,
            dashboardTheme: 'light',
            title: 'My Reads | PaidInk',
            description: 'Review your reading history and track articles you have explored on PaidInk.',
            canonical: `${process.env.BASE_URL || ''}/reads`,
            reads,
            stats: {
                totalReads
            },
            currentRate
        });
    });

    fastify.get('/apply-publisher', {
        preHandler: [fastify.authenticate]
    }, async (req, reply) => {
        const user = await User.findById(req.user.id);

        return reply.view('pages/apply-publisher.ejs', {
            user: req.user.toPublicJSON(),
            pageTitle: 'Apply to Write',
            unreadCount: req.unreadCount,
            dashboardTheme: 'light',
            isLoggedIn: true,
            status: user.publisherStatus,
            appliedAt: user.publisherAppliedAt,
            approvedAt: user.publisherApprovedAt,
            notes: user.publisherNotes,
        });
    });

    fastify.post('/apply-publisher', {
        preHandler: [fastify.authenticate]
    }, async (req, reply) => {
        const user = await User.findById(req.user.id);

        if (!user.canApplyForPublisher()) {
            return reply.redirect('/apply-publisher');
        }

        user.publisherStatus = 'pending';
        user.publisherAppliedAt = new Date();
        user.publisherNotes = undefined;
        await user.save();

        return reply.redirect('/apply-publisher?submitted=1');
    });

    fastify.get('/switch-role', {
        preHandler: [fastify.authenticate]
    }, async (req, reply) => {
        const User = require('../models/User');
        const { role } = req.query;
        const user = await User.findById(req.user.id);

        if (!user.isPublisher()) {
            return reply.redirect('/dashboard');
        }

        if (role === 'publisher') {
            req.session.role = 'publisher';
        } else {
            req.session.role = 'reader';
        }

        return reply.redirect(role === 'publisher' ? '/publisher' : '/dashboard');
    });

    fastify.get('/withdraw', {
        preHandler: [fastify.authenticate]
    }, async (req, reply) => {
        return reply.view('pages/withdraw.ejs', {
            user: req.user.toPublicJSON(),
            pageTitle: 'Withdraw',
            isLoggedIn: true,
            unreadCount: req.unreadCount,
            dashboardTheme: 'light',
            title: 'Withdraw | PaidInk',
            description: 'Cash out your PaidInk earnings and manage your withdrawal history.',
            canonical: `${process.env.BASE_URL || ''}/withdraw`
        });
    });

    fastify.get('/achievements', {
        preHandler: [fastify.authenticate]
    }, async (req, reply) => {
        const AchievementService = require('../services/AchievementService');
        const Achievement = require('../models/Achievement');
        const User = require('../models/User');
        const ReadSession = require('../models/ReadSession');

        await Achievement.initialize();

        const user = await User.findById(req.user.id);
        const totalReads = await ReadSession.countDocuments({ user: req.user.id, completed: true });

        const allAchievements = await Achievement.find().lean();
        const earnedAchievements = await AchievementService.getUserAchievements(req.user.id);
        const earnedIds = earnedAchievements.map(e => e.achievement._id.toString());
        const referralCount = await User.countDocuments({ referredBy: req.user.id });

        const achievementProgress = allAchievements.map(a => {
            const earned = earnedIds.includes(a._id.toString());
            let current = 0;

            switch (a.category) {
                case 'reading':
                    current = totalReads;
                    break;
                case 'streak':
                    current = user?.stats?.streak || 0;
                    break;
                case 'referral':
                    current = referralCount;
                    break;
                case 'milestone':
                    current = user?.wallet?.lifetimeEarned || 0;
                    break;
            }

            const displayCurrent = earned
                ? a.requirement
                : a.category === 'milestone'
                    ? Math.min(current, a.requirement) / 100
                    : Math.min(current, a.requirement);
            const progress = earned ? 100 : Math.min(100, Math.round((current / a.requirement) * 100));

            return {
                ...a,
                earned,
                current: displayCurrent,
                progress
            };
        });

        return reply.view('pages/achievements.ejs', {
            user: req.user.toPublicJSON(),
            pageTitle: 'Achievements',
            isLoggedIn: true,
            unreadCount: req.unreadCount,
            dashboardTheme: 'light',
            title: 'Achievements | PaidInk',
            description: 'Explore your achievements and milestones earned through reading and engagement on PaidInk.',
            canonical: `${process.env.BASE_URL || ''}/achievements`,
            achievements: achievementProgress,
            unlockedCount: earnedAchievements.length,
            totalAchievements: allAchievements.length
        });
    });

    fastify.get('/publisher', {
        preHandler: [fastify.requirePublisher]
    }, async (req, reply) => {
        const Post = require('../models/Post');
        const ReadSession = require('../models/ReadSession');
        const AuditLog = require('../models/AuditLog');

        const posts = await Post.find({ author: req.user.id }).sort({ createdAt: -1 }).lean();
        const totalPosts = posts.length;
        const publishedPosts = posts.filter(p => p.publishedAt).length;
        const draftPosts = totalPosts - publishedPosts;

        const totalViews = posts.reduce((sum, p) => sum + (p.stats?.views || 0), 0);
        const totalReads = posts.reduce((sum, p) => sum + (p.stats?.reads || 0), 0);
        const totalEarnings = posts.reduce((sum, p) => sum + (p.stats?.earnings || 0), 0);

        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

        const postIds = posts.map((p) => p._id);
        const postIdStrings = postIds.map((id) => id.toString());

        let dailyViews = [];
        if (postIdStrings.length > 0) {
            dailyViews = await AuditLog.aggregate([
                {
                    $match: {
                        action: { $regex: /^api:post:view/ },
                        'details.postId': { $in: postIdStrings },
                        timestamp: { $gte: thirtyDaysAgo }
                    }
                },
                { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } }, count: { $sum: 1 } } },
                { $sort: { _id: 1 } }
            ]);
        }

        const dailyReads = postIds.length > 0
            ? await ReadSession.aggregate([
                {
                    $match: {
                        post: { $in: postIds },
                        completed: true,
                        endedAt: { $gte: thirtyDaysAgo }
                    }
                },
                { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$endedAt' } }, count: { $sum: 1 } } },
                { $sort: { _id: 1 } }
            ])
            : [];

        const viewsByDate = Object.fromEntries((dailyViews || []).map((d) => [d._id, d.count]));
        const readsByDate = Object.fromEntries((dailyReads || []).map((d) => [d._id, d.count]));

        const last30Days = [];
        for (let i = 29; i >= 0; i--) {
            const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
            last30Days.push(date.toISOString().split('T')[0]);
        }

        const viewsData = last30Days.map((d) => viewsByDate[d] || 0);
        const readsData = last30Days.map((d) => readsByDate[d] || 0);

        const pctDelta = (series) => {
            const last7 = series.slice(-7).reduce((a, b) => a + b, 0);
            const prev7 = series.slice(-14, -7).reduce((a, b) => a + b, 0);
            if (last7 === 0 && prev7 === 0) return null;
            if (prev7 === 0) return 100;
            return Math.round(((last7 - prev7) / prev7) * 100);
        };

        const deltas = {
            views: pctDelta(viewsData),
            reads: pctDelta(readsData)
        };

        const topPosts = await Post.find({ author: req.user.id })
            .sort({ 'stats.views': -1 })
            .limit(5)
            .select('title slug category stats publishedAt image')
            .lean();

        const pub = req.user.toPublicJSON();
        const body = renderPublisherPage('dashboard', {
            publisherTheme: 'light',
            user: pub,
            currentPage: 'dashboard',
            pageHeading: 'Overview',
            pageSubtitle: `${publishedPosts} published · ${draftPosts} draft${draftPosts === 1 ? '' : 's'}`,
            showNewPostCta: true,
            categoryNames: CATEGORY_NAMES.en,
            stats: { totalPosts, publishedPosts, draftPosts, totalViews, totalReads, totalEarnings },
            charts: { last30Days, viewsData, readsData },
            deltas,
            topPosts
        });

        return reply.view('layouts/default.ejs', {
            title: 'Publisher · Overview',
            currentPage: 'dashboard',
            user: pub,
            body,
            lang: 'en',
            theme: req.cookies?.theme || 'dark',
            description: 'Publisher workspace',
            canonical: `${process.env.BASE_URL || ''}/publisher`,
            activeCategory: null,
            isLoggedIn: true,
            publisherMode: true
        });
    });

    fastify.get('/publisher/posts', {
        preHandler: [fastify.requirePublisher]
    }, async (req, reply) => {
        const Post = require('../models/Post');
        const { page = 1, status } = req.query;
        const limit = 20;
        const skip = (page - 1) * limit;

        const query = { author: req.user.id };
        if (status === 'published') query.publishedAt = { $ne: null };
        else if (status === 'draft') query.publishedAt = null;

        const posts = await Post.find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean();

        const total = await Post.countDocuments(query);
        const totalPages = Math.ceil(total / limit);
        const totalPostsAll = await Post.countDocuments({ author: req.user.id });

        const pub = req.user.toPublicJSON();
        const body = renderPublisherPage('posts', {
            publisherTheme: 'light',
            user: pub,
            currentPage: 'posts',
            pageHeading: 'Posts',
            pageSubtitle: 'Manage drafts and live articles',
            showNewPostCta: true,
            posts,
            pagination: { page: parseInt(page, 10) || 1, totalPages, status },
            stats: { totalPosts: totalPostsAll },
            categoryNames: CATEGORY_NAMES.en,
            formatRelativeTime
        });

        return reply.view('layouts/default.ejs', {
            title: 'Publisher · Posts',
            currentPage: 'posts',
            user: pub,
            body,
            lang: 'en',
            theme: req.cookies?.theme || 'dark',
            description: 'Your posts',
            canonical: `${process.env.BASE_URL || ''}/publisher/posts`,
            activeCategory: null,
            isLoggedIn: true,
            publisherMode: true
        });
    });

    fastify.get('/publisher/create-post', {
        preHandler: [fastify.requirePublisher]
    }, async (req, reply) => {
        const pub = req.user.toPublicJSON();
        const body = renderPublisherPage('create-post', {
            publisherTheme: 'light',
            user: pub,
            currentPage: 'create',
            pageHeading: 'Editor',
            pageSubtitle: 'Compose in Markdown · preview before publishing',
            showNewPostCta: false,
            categories: CATEGORY_ENUM,
            categoryNames: CATEGORY_NAMES.en
        });
        return reply.view('layouts/default.ejs', {
            title: 'Publisher · New post',
            currentPage: 'create',
            user: pub,
            body,
            lang: 'en',
            theme: req.cookies?.theme || 'dark',
            description: 'Create a post',
            canonical: `${process.env.BASE_URL || ''}/publisher/create-post`,
            activeCategory: null,
            isLoggedIn: true,
            publisherMode: true
        });
    });

    fastify.get('/publisher/earnings', {
        preHandler: [fastify.requirePublisher]
    }, async (req, reply) => {
        const Credit = require('../models/Credit');
        const Post = require('../models/Post');

        const now = new Date();
        const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const lastMonthStr = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`;

        const currentMonthCredits = await Credit.getMonthlyCredits(req.user.id, currentMonth);
        const lastMonthCredits = await Credit.getMonthlyCredits(req.user.id, lastMonthStr);

        const lifetimeCredits = await Credit.aggregate([
            { $match: { user: req.user._id, status: 'active' } },
            { $group: { _id: '$category', total: { $sum: '$points' } } }
        ]);
        const { CREDIT_TYPES } = require('../models/Credit');
        const lifetimeBreakdown = { creation: 0, engagement: 0, reach: 0, source: 0, total: 0 };
        lifetimeCredits.forEach(r => {
            if (lifetimeBreakdown.hasOwnProperty(r._id)) {
                lifetimeBreakdown[r._id] = r.total;
                lifetimeBreakdown.total += r.total;
            }
        });

        const posts = await Post.find({ author: req.user.id, publishedAt: { $ne: null } })
            .sort({ 'stats.views': -1 })
            .limit(10)
            .lean();

        const totalViews = posts.reduce((sum, p) => sum + (p.stats?.views || 0), 0);
        const totalReads = posts.reduce((sum, p) => sum + (p.stats?.reads || 0), 0);

        const rank = Credit.getRank(req.user.totalCredits || 0);

        const body = renderPublisherPage('earnings', {
            publisherTheme: 'light',
            user: req.user.toPublicJSON(),
            currentPage: 'earnings',
            pageHeading: 'Earnings',
            pageSubtitle: 'Your contributor earnings and credits',
            credits: currentMonthCredits,
            lastMonthCredits: lastMonthCredits,
            lifetimeCredits: lifetimeBreakdown,
            posts: posts,
            totalViews,
            totalReads,
            rank: rank,
            userCredits: req.user.totalCredits || 0
        });

        return reply.view('layouts/default.ejs', {
            title: 'Earnings | PaidInk Publisher',
            currentPage: 'earnings',
            user: req.user.toPublicJSON(),
            body,
            lang: 'en',
            theme: req.cookies?.theme || 'dark',
            description: 'Your contributor earnings',
            canonical: `${process.env.BASE_URL || ''}/publisher/earnings`,
            activeCategory: null,
            isLoggedIn: true,
            publisherMode: true
        });
    });

    fastify.post('/publisher/create-post', {
        preHandler: [fastify.requirePublisher]
    }, async (req, reply) => {
        const Post = require('../models/Post');
        const { title, summary, content, category, tags, image, metaDescription, status } = req.body;

        if (!title || !summary || !content || !category) {
            const pub = req.user.toPublicJSON();
            const body = renderPublisherPage('create-post', {
                publisherTheme: 'light',
                user: pub,
                currentPage: 'create',
                pageHeading: 'Editor',
                pageSubtitle: 'Compose in Markdown · preview before publishing',
                showNewPostCta: false,
                categories: CATEGORY_ENUM,
                categoryNames: CATEGORY_NAMES.en,
                error: 'Please fill in all required fields'
            });
            return reply.code(400).view('layouts/default.ejs', {
                title: 'Publisher · New post',
                currentPage: 'create',
                user: pub,
                body,
                lang: 'en',
                theme: req.cookies?.theme || 'dark',
                description: '',
                canonical: '',
                activeCategory: null,
                isLoggedIn: true,
                publisherMode: true
            });
        }

        let slug = title.toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');

        const existingSlug = await Post.findOne({ slug });
        if (existingSlug) {
            slug = `${slug}-${Date.now()}`;
        }

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
            author: req.user.id,
            publishedAt: status === 'published' ? new Date() : null,
            stats: { views: 0, reads: 0, earnings: 0 }
        });

        await post.save();

        if (status === 'published') {
            try {
                const Credit = require('../models/Credit');
                await Credit.earnCredit(req.user.id, 'POST_PUBLISHED', { postId: post._id });
            } catch (err) {
                console.error('Failed to award credit:', err.message);
            }
        }

        return reply.redirect('/publisher/posts');
    });

    fastify.get('/publisher/posts/:id', {
        preHandler: [fastify.requirePublisher]
    }, async (req, reply) => {
        const Post = require('../models/Post');
        const { id } = req.params;

        const post = await Post.findOne({ _id: id, author: req.user.id });
        if (!post) {
            return reply.redirect('/publisher/posts');
        }

        const pub = req.user.toPublicJSON();
        const body = renderPublisherPage('create-post', {
            publisherTheme: 'light',
            user: pub,
            currentPage: 'create',
            pageHeading: 'Editor',
            pageSubtitle: 'Update your draft or live article',
            showNewPostCta: false,
            categories: CATEGORY_ENUM,
            categoryNames: CATEGORY_NAMES.en,
            post: post.toObject()
        });
        return reply.view('layouts/default.ejs', {
            title: 'Publisher · Edit post',
            currentPage: 'create',
            user: pub,
            body,
            lang: 'en',
            theme: req.cookies?.theme || 'dark',
            description: 'Edit post',
            canonical: `${process.env.BASE_URL || ''}/publisher/posts/${id}`,
            activeCategory: null,
            isLoggedIn: true,
            publisherMode: true
        });
    });

    fastify.post('/publisher/posts/:id', {
        preHandler: [fastify.requirePublisher]
    }, async (req, reply) => {
        const Post = require('../models/Post');
        const { id } = req.params;
        const { title, summary, content, category, tags, image, metaDescription, status } = req.body;

        const post = await Post.findOne({ _id: id, author: req.user.id });
        if (!post) {
            return reply.redirect('/publisher/posts');
        }

        post.title = title;
        post.summary = summary;
        post.content = content;
        post.category = category;
        post.tags = tags ? tags.split(',').map(t => t.trim().toLowerCase()).filter(t => t) : [];
        post.image = image;
        post.metaDescription = metaDescription;
        post.publishedAt = status === 'published' && !post.publishedAt ? new Date() : (status === 'draft' ? null : post.publishedAt);

        await post.save();

        return reply.redirect('/publisher/posts');
    });

    fastify.get('/publisher/logout', async (req, reply) => {
        reply.clearCookie('auth_token', { path: '/' });
        return reply.redirect('/');
    });

    fastify.get('/logout', async (req, reply) => {
        reply.clearCookie('auth_token', { path: '/' });
        return reply.redirect('/');
    });

    fastify.get('/', async (req, reply) => {
        const lang = getLanguage(req);

        if (req.isLoggedIn) {
            const Post = require('../models/Post');
            const User = require('../models/User');

            const currentUserId = req.currentUser.id;

            const posts = isFeatureEnabled('content', 'recommendationEngine')
                ? await recommendationService.getFeed(currentUserId, { limit: 5 })
                : await Post.find()
                    .sort({ publishedAt: -1 })
                    .limit(5)
                    .populate('author', 'displayName avatar role')
                    .lean();

            const trendingPosts = await Post.find()
                .sort({ 'stats.views': -1 })
                .limit(3)
                .populate('author', 'displayName avatar role')
                .lean();

            const followedIds = await User.distinct('following', { _id: currentUserId });
            const suggestedUsers = await User.find({
                _id: { $ne: currentUserId, $nin: followedIds },
                isActive: true
            })
                .select('displayName avatar role')
                .limit(6)
                .lean();

            const feedSuggestions = suggestedUsers.slice(0, 3);
            const sidebarSuggestions = suggestedUsers;

            const postsWithPublicAuthors = posts.map(post => {
                if (post.author && typeof post.author.toPublicJSON === 'function') {
                    post.author = post.author.toPublicJSON();
                }
                if (post.author) {
                    post.author.avatar = getAvatarWithFallback(post.author);
                }
                post.readTime = getReadTime(post.content).display;
                return post;
            });

            const trendingWithAuthors = trendingPosts.map(post => {
                if (post.author && typeof post.author.toPublicJSON === 'function') {
                    post.author = post.author.toPublicJSON();
                }
                // ensure avatar fallback for trending items as well
                if (post.author) {
                    post.author.avatar = getAvatarWithFallback(post.author);
                }
                post.readTime = getReadTime(post.content).display;
                return post;
            });

            let feedAds = [];
            let sidebarAd = null;
            try {
                const { getAds: getAd } = require('../services/ads/ProviderService');
                feedAds = await getAd({ placement: 'feed_native', user: { id: currentUserId }, session: null, count: 2 });
                const sidebarAds = await getAd({ placement: 'sidebar', user: { id: currentUserId }, session: null });
                sidebarAd = sidebarAds.length > 0 ? sidebarAds[0] : null;
                try {
                    req.log.debug({ feedAds }, 'Fetched feedAds');
                    req.log.debug({ sidebarAd }, 'Fetched sidebarAd');
                } catch (logErr) {
                    console.debug('Ad debug log failed', logErr);
                }
            } catch (e) {
                req.log.warn({ error: e && e.message ? e.message : String(e) }, 'Ad service unavailable');
            }

            return reply.view('pages/home-logged-in.ejs', {
                posts: postsWithPublicAuthors,
                pageTitle: 'Home',
                trendingPosts: trendingWithAuthors,
                suggestedUsers: sidebarSuggestions,
                feedSuggestions,
                feedAds,
                sidebarAd,
                user: req.currentUser ? req.currentUser.toPublicJSON() : null,
                unreadCount: req.unreadCount,
                CATEGORY_ENUM,
                CATEGORY_NAMES,
                categoryNames: CATEGORY_NAMES[lang],
                title: 'PaidInk - Read. Write. Engage.',
                description: 'Stay ahead with the latest in AI, web development, cloud computing, and technology innovation.',
                canonical: `${process.env.BASE_URL || ''}/`,
                ogImage: '/public/images/og-default.png'
            });
        }

        const { page = 1, limit = 12, category } = req.query;

        if (category && !CATEGORY_ENUM.includes(category)) {
            return reply.code(400).view('layouts/default.ejs', {
                body: renderErrorPage('404', req),
                activeCategory: null,
                lang,
                theme: req.cookies?.theme || 'light',
                title: '404 - Page Not Found | PaidInk',
                description: 'The page you are looking for could not be found on PaidInk.',
                canonical: `${process.env.BASE_URL || ''}${req.url}`
            });
        }

        const result = await postService.getPosts({ page, limit, category });
        const categoryName = category ? CATEGORY_NAMES[lang]?.[category] || category : null;

        const pageContent = renderPage('home', {
            blogs: result.posts,
            pagination: result.pagination,
            category,
            categoryName,
            categoryNames: CATEGORY_NAMES[lang],
            lang,
            formatDate,
            formatRelativeTime
        });

        return reply.view('layouts/default.ejs', {
            body: pageContent,
            activeCategory: category,
            lang,
            theme: req.cookies?.theme || 'light',
            title: categoryName ? `${categoryName} - PaidInk` : 'PaidInk - Read. Write. Engage.',
            description: categoryName ? `Latest ${categoryName.toLowerCase()} news` : 'Read. Write. Engage. On PaidInk, attention isn\'t wasted, it\'s returned.',
            ogImage: '/public/images/og-default.png',
            canonical: `${process.env.BASE_URL || ''}${req.url.split('?')[0]}`,
            isLoggedIn: req.isLoggedIn,
            user: req.currentUser ? req.currentUser.toPublicJSON() : null,
            isLightTheme: !category
        });
    });

    fastify.get('/browse', async (req, reply) => {
        const lang = getLanguage(req);
        const { tab } = req.query;
        const Post = require('../models/Post');
        const User = require('../models/User');

        let sortField = { publishedAt: -1 };
        let filterQuery = {};

        if (tab) {
            if (CATEGORY_ENUM.includes(tab)) {
                filterQuery.category = tab;
            } else if (tab === 'trending') {
                sortField = { 'stats.views': -1 };
            }
        }

        function getAvatarWithFallback(user) {
            if (user && user.avatar) return user.avatar;
            var initial = '?';
            if (user && user.displayName && user.displayName.length > 0) {
                initial = user.displayName.charAt(0).toUpperCase();
            }
            return 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><circle cx="40" cy="40" r="40" fill="#e5e5e5"/><text x="40" y="52" text-anchor="middle" fill="#6d0a0a" font-size="36" font-family="sans-serif">' + initial + '</text></svg>');
        }

        const posts = await Post.find(filterQuery)
            .sort(sortField)
            .limit(5)
            .populate('author', 'displayName avatar role')
            .lean();

        const trendingPosts = await Post.find()
            .sort({ 'stats.views': -1 })
            .limit(3)
            .populate('author', 'displayName avatar role')
            .lean();

        const currentUserId = req.currentUser?.id || null;
        let followedIds = [];
        if (currentUserId) {
            followedIds = await User.distinct('following', { _id: currentUserId });
        }

        const suggestedUsers = await User.find({
            _id: { $ne: currentUserId, $nin: followedIds },
            isActive: true
        })
            .select('displayName avatar role')
            .limit(6)
            .lean();

        const feedSuggestions = suggestedUsers.slice(0, 3);
        const sidebarSuggestions = suggestedUsers;

        const postsWithPublicAuthors = posts.map(post => {
            if (post.author) {
                post.author.avatar = getAvatarWithFallback(post.author);
            }
            post.readTime = getReadTime(post.content).display;
            return post;
        });

        const trendingWithAuthors = trendingPosts.map(post => {
            if (post.author) {
                post.author.avatar = getAvatarWithFallback(post.author);
            }
            post.readTime = getReadTime(post.content).display;
            return post;
        });

        const feedSuggestionsWithAvatar = feedSuggestions.map(user => {
            user.avatar = getAvatarWithFallback(user);
            return user;
        });

        const sidebarSuggestionsWithAvatar = sidebarSuggestions.map(user => {
            user.avatar = getAvatarWithFallback(user);
            return user;
        });

        var currentUserJSON = req.currentUser ? req.currentUser.toPublicJSON() : null;
        if (currentUserJSON) {
            currentUserJSON.avatar = getAvatarWithFallback(currentUserJSON);
        }

        let feedAds = [];
        let sidebarAd = null;
        try {
            const { getAds: getAd } = require('../services/ads/ProviderService');
            feedAds = await getAd({ placement: 'feed_native', user: { id: currentUserId }, session: null, count: 2 });
            const sidebarAds = await getAd({ placement: 'sidebar', user: { id: currentUserId }, session: null });
            sidebarAd = sidebarAds.length > 0 ? sidebarAds[0] : null;
            try {
                req.log.debug({ feedAds }, 'Fetched feedAds for explore');
                req.log.debug({ sidebarAd }, 'Fetched sidebarAd for explore');
            } catch (logErr) {
                console.debug('Ad debug log failed', logErr);
            }
        } catch (e) {
            req.log.warn({ error: e && e.message ? e.message : String(e) }, 'Ad service unavailable for explore');
        }

        return reply.view('pages/explore.ejs', {
            activeTab: tab || 'explore',
            pageTitle: 'Explore',
            posts: postsWithPublicAuthors,
            feedSuggestions: feedSuggestionsWithAvatar,
            trendingPosts: trendingWithAuthors,
            suggestedUsers: sidebarSuggestionsWithAvatar,
            user: currentUserJSON,
            isLoggedIn: req.isLoggedIn,
            unreadCount: req.unreadCount,
            lang,
            feedAds,
            sidebarAd,
            CATEGORY_ENUM,
            CATEGORY_NAMES,
            categoryNames: CATEGORY_NAMES[lang],
            title: 'Explore | PaidInk',
            description: 'Discover trending stories, fresh perspectives, and the latest in technology on PaidInk.',
            canonical: `${process.env.BASE_URL || ''}/browse`,
            ogImage: '/public/images/og-default.png'
        });
    });

    fastify.get('/activity', async (req, reply) => {
        const lang = getLanguage(req);
        const { filter } = req.query;
        const Notification = require('../models/Notification');
        const Post = require('../models/Post');
        const User = require('../models/User');

        const activeFilter = filter || 'all';
        let query = {};

        if (req.isLoggedIn && req.currentUser) {
            query.user = req.currentUser._id;
        } else {
            query.user = null;
        }

        if (activeFilter === 'interactions') {
            query.type = { $in: ['like', 'comment', 'reply', 'follow', 'mention', 'share'] };
        } else if (activeFilter === 'following') {
            query.type = { $in: ['post', 'follow'] };
        } else if (activeFilter === 'system') {
            query.type = { $in: ['reward', 'referral', 'withdrawal', 'system'] };
        }

        let activities = [];
        if (req.isLoggedIn && req.currentUser) {
            activities = await Notification.find(query)
                .sort({ createdAt: -1 })
                .limit(50)
                .populate('actor', 'displayName avatar role')
                .lean();
        }

        function getAvatarWithFallback(user) {
            if (user && user.avatar) return user.avatar;
            var initial = '?';
            if (user && user.displayName && user.displayName.length > 0) {
                initial = user.displayName.charAt(0).toUpperCase();
            }
            return 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><circle cx="40" cy="40" r="40" fill="#e5e5e5"/><text x="40" y="52" text-anchor="middle" fill="#6d0a0a" font-size="36" font-family="sans-serif">' + initial + '</text></svg>');
        }

        function timeAgo(date) {
            var seconds = Math.floor((new Date() - new Date(date)) / 1000);
            var interval = seconds / 31536000;
            if (interval > 1) return Math.floor(interval) + 'y ago';
            interval = seconds / 2592000;
            if (interval > 1) return Math.floor(interval) + 'mo ago';
            interval = seconds / 86400;
            if (interval > 1) return Math.floor(interval) + 'd ago';
            interval = seconds / 3600;
            if (interval > 1) return Math.floor(interval) + 'h ago';
            interval = seconds / 60;
            if (interval > 1) return Math.floor(interval) + 'm ago';
            return 'Just now';
        }

        function groupDate(date) {
            var now = new Date();
            var d = new Date(date);
            var diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
            if (diffDays === 0) return 'Today';
            if (diffDays === 1) return 'Yesterday';
            if (diffDays < 7) {
                var days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                return days[d.getDay()];
            }
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        }

        function formatMessage(activity) {
            var actorName = activity.actor ? activity.actor.displayName : 'Someone';
            var typeMessages = {
                like: '<strong>' + actorName + '</strong> liked your post',
                comment: '<strong>' + actorName + '</strong> commented on your post',
                reply: '<strong>' + actorName + '</strong> replied to your comment',
                follow: '<strong>' + actorName + '</strong> started following you',
                mention: '<strong>' + actorName + '</strong> mentioned you in a post',
                share: '<strong>' + actorName + '</strong> shared your post',
                post: '<strong>' + actorName + '</strong> published a new post',
                reward: 'You earned a reward',
                referral: 'New referral joined',
                withdrawal: 'Withdrawal processed',
                system: activity.title || 'Notification'
            };
            return typeMessages[activity.type] || activity.message || typeMessages.system;
        }

        // Fetch post slugs for notifications that reference posts
        var postIds = activities
            .filter(function (a) { return a.target && a.targetModel === 'Post'; })
            .map(function (a) { return a.target; });

        var postSlugMap = {};
        if (postIds.length > 0) {
            var linkedPosts = await Post.find({ _id: { $in: postIds } }).select('slug').lean();
            linkedPosts.forEach(function (p) {
                postSlugMap[String(p._id)] = p.slug;
            });
        }

        function getLink(activity) {
            if (activity.data && activity.data.link) return activity.data.link;
            var slug = activity.target && postSlugMap[String(activity.target)] ? postSlugMap[String(activity.target)] : null;
            if (['like', 'comment', 'share', 'mention'].includes(activity.type) && slug) {
                return '/post/' + slug;
            }
            if (activity.type === 'reply' && slug) {
                return '/post/' + slug + '#comments';
            }
            if (activity.type === 'post' && slug) {
                return '/post/' + slug;
            }
            if (activity.type === 'follow' && activity.actor) {
                return '/profile';
            }
            return '#';
        }

        var groupedActivities = {};
        activities.forEach(function (activity) {
            var dateLabel = groupDate(activity.createdAt);
            if (!groupedActivities[dateLabel]) {
                groupedActivities[dateLabel] = [];
            }
            if (activity.actor) {
                activity.actor.avatar = getAvatarWithFallback(activity.actor);
            }
            groupedActivities[dateLabel].push({
                _id: activity._id,
                type: activity.type,
                message: formatMessage(activity),
                targetPreview: activity.targetPreview || activity.message || '',
                actor: activity.actor,
                read: activity.read,
                timeAgo: timeAgo(activity.createdAt),
                link: getLink(activity),
                createdAt: activity.createdAt
            });
        });

        return reply.view('pages/activity.ejs', {
            activeFilter: activeFilter,
            pageTitle: 'Activity',
            groupedActivities: groupedActivities,
            unreadCount: req.unreadCount,
            totalUnread: req.unreadCount,
            isLoggedIn: req.isLoggedIn,
            user: req.currentUser ? req.currentUser.toPublicJSON() : null,
            lang,
            title: 'Activity | PaidInk',
            description: 'Stay updated with your notifications, interactions, and activity on PaidInk.',
            canonical: `${process.env.BASE_URL || ''}/activity`,
            ogImage: '/public/images/og-default.png'
        });
    });

    fastify.get('/post/:slug', async (req, reply) => {
        console.log('[POST-ROUTE] req.isLoggedIn:', req.isLoggedIn, 'cookies:', JSON.stringify(Object.keys(req.cookies || {})));
        const lang = getLanguage(req);
        const { slug } = req.params;

        if (!slug || typeof slug !== 'string' || slug.length > 100) {
            return reply.code(400).view('layouts/default.ejs', {
                body: renderErrorPage('404', req),
                activeCategory: null,
                lang,
                theme: req.cookies?.theme || 'light',
                title: '404 - Page Not Found | PaidInk',
                description: 'The page you are looking for could not be found on PaidInk.',
                canonical: `${process.env.BASE_URL || ''}/post/${slug}`
            });
        }

        const post = await postService.getPostBySlug(slug);
        if (!post) {
            return reply.code(404).view('layouts/default.ejs', {
                body: renderErrorPage('404', req),
                activeCategory: null,
                lang,
                theme: req.cookies?.theme || 'light',
                title: '404 - Page Not Found | PaidInk',
                description: 'The page you are looking for could not be found on PaidInk.',
                canonical: `${process.env.BASE_URL || ''}/post/${slug}`
            });
        }

        post.readTime = getReadTime(post.content).display;

        const Post = require('../models/Post');
        await Post.findByIdAndUpdate(post._id, { $inc: { 'stats.views': 1 } });

        const authorId = post.author && (post.author._id || post.author);
        if (authorId) {
            try {
                const Credit = require('../models/Credit');
                await Credit.earnCredit(authorId, 'UNIQUE_VIEW', { postId: post._id });
            } catch (err) {
                console.error('Failed to award view credit:', err.message);
            }
        }

        await fastify.audit.apiAccess(req, 'post:view', 'read', {
            postId: post._id?.toString?.() || String(post._id),
            authorId: authorId?.toString?.() || (authorId ? String(authorId) : null)
        });

        const { generateRelatedPostsHtml, addInternalLinks } = require('../seo/internalLinking');

        const relatedPosts = await recommendationService.getRelated(post._id, 5);

        let enhancedContent = md.render(post.content || '');
        try {
            enhancedContent = addInternalLinks(enhancedContent, relatedPosts);
        } catch (err) {
            console.error('Failed to add internal links:', err.message);
        }

        const relatedPostsHtml = generateRelatedPostsHtml(relatedPosts);

        const postForRender = { ...(post.toObject ? post.toObject() : post) };
        postForRender.content = enhancedContent;

        let adInline = null;
        let adBanner = null;
        try {
            const { getAds: getAd } = require('../services/ads/ProviderService');
            const inlineAds = await getAd({ placement: 'article_inline', user: { id: req.currentUser?.id || null }, session: null });
            adInline = inlineAds.length > 0 ? inlineAds[0] : null;
            const bannerAds = await getAd({ placement: 'article_endcap', user: { id: req.currentUser?.id || null }, session: null });
            adBanner = bannerAds.length > 0 ? bannerAds[0] : null;
            try {
                req.log.debug({ adInline }, 'Fetched adInline for post');
                req.log.debug({ adBanner }, 'Fetched adBanner for post');
            } catch (logErr) {
                console.debug('Ad debug log failed', logErr);
            }
        } catch (e) {
            req.log.warn({ error: e && e.message ? e.message : String(e) }, 'Ad service unavailable for post');
        }

        if (adInline && adInline.served && enhancedContent) {
            const paragraphs = enhancedContent.split('</p>');
            const midPoint = Math.floor(paragraphs.length / 2);
            if (paragraphs.length >= 4) {
                const beforeParts = paragraphs.slice(0, midPoint);
                const afterParts = paragraphs.slice(midPoint);
                postForRender.contentBeforeAd = beforeParts.join('</p>') + '</p>';
                postForRender.contentAfterAd = afterParts.join('</p>');
                postForRender.content = null;
            }
        }

        const pageContent = renderPage('post', {
            post: postForRender,
            adInline,
            adBanner,
            relatedPosts,
            relatedPostsHtml,
            lang,
            categoryNames: CATEGORY_NAMES[lang],
            formatDate,
            formatRelativeTime,
            isLoggedIn: req.isLoggedIn,
            user: req.currentUser ? req.currentUser.toPublicJSON() : null
        });

        return reply.view('layouts/default.ejs', {
            body: pageContent,
            activeCategory: post.category,
            lang,
            theme: req.cookies?.theme || 'light',
            title: post.title,
            description: post.metaDescription || post.summary,
            ogImage: post.image,
            ogType: 'article',
            canonical: `${process.env.BASE_URL || ''}/post/${post.slug}`,
            isLoggedIn: req.isLoggedIn,
            user: req.currentUser ? req.currentUser.toPublicJSON() : null,
            isLightTheme: true,
            hideFooter: true
        });
    });

    fastify.get('/category/:category', async (req, reply) => {
        const lang = getLanguage(req);
        const { category } = req.params;

        if (!CATEGORY_ENUM.includes(category)) {
            return reply.code(404).view('layouts/default.ejs', {
                body: renderErrorPage('404', req),
                activeCategory: null,
                lang,
                theme: req.cookies?.theme || 'light',
                title: '404 - Page Not Found | PaidInk',
                description: 'The page you are looking for could not be found on PaidInk.',
                canonical: `${process.env.BASE_URL || ''}/category/${category}`
            });
        }

        const posts = await postService.getPostsByCategory(category, { limit: 50 });
        const categoryName = CATEGORY_NAMES[lang]?.[category] || category;

        const pageContent = renderPage('category', {
            blogs: posts,
            category,
            categoryName,
            categoryNames: CATEGORY_NAMES[lang],
            lang,
            formatDate,
            formatRelativeTime
        });

        return reply.view('layouts/default.ejs', {
            body: pageContent,
            activeCategory: category,
            lang,
            theme: req.cookies?.theme || 'light',
            title: `${categoryName} | PaidInk`,
            description: `Latest ${categoryName.toLowerCase()} news, articles, and insights on PaidInk.`,
            ogImage: '/public/images/og-default.png',
            canonical: `${process.env.BASE_URL || ''}/category/${category}`
        });
    });

    fastify.get('/blog/:id', async (req, reply) => {
        const { id } = req.params;

        if (!id || !/^[a-fA-F0-9]{24}$/.test(id)) {
            return reply.code(404).send('Not Found');
        }

        const blog = await postService.getPostById(id);
        if (!blog) {
            return reply.code(404).send('Not Found');
        }

        return reply.redirect(301, `/post/${blog.slug}`);
    });

    fastify.get('/search', async (req, reply) => {
        const lang = getLanguage(req);
        const { q, page } = req.query;

        if (!q || q.trim().length < 1) {
            return reply.redirect('/browse');
        }

        const query = q.trim();
        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        let results = [];
        let pagination = { page: 1, limit: 12, total: 0, totalPages: 0, hasNext: false, hasPrev: false };

        try {
            const postsResult = await searchService.searchPosts(query, { page: pageNum, limit: 12 });
            results = postsResult.results;
            pagination = postsResult.pagination;
        } catch (err) {
            if (err.code !== 'INVALID_INPUT') throw err;
        }

        const pageContent = renderPage('search', {
            query,
            results,
            pagination,
            formatDate,
            lang
        });

        return reply.view('layouts/default.ejs', {
            body: pageContent,
            title: `${query} — Search | PaidInk`,
            description: `Search results for "${query}" on PaidInk.`,
            isLoggedIn: req.isLoggedIn,
            user: req.currentUser ? req.currentUser.toPublicJSON() : null,
            unreadCount: req.unreadCount,
            lang,
            activeCategory: null,
            theme: req.cookies?.theme || 'light',
            canonical: `${process.env.BASE_URL || ''}/search?q=${encodeURIComponent(query)}`,
            ogImage: '/public/images/og-default.png'
        });
    });
}

module.exports = pagesRoutes;
