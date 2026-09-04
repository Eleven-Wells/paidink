'use strict';

const Post = require('../models/Post');
const postService = require('../services/PostService');
const recommendationService = require('../services/RecommendationService');
const FeedService = require('../services/feed/FeedService');
const { isFeatureEnabled } = require('../config/features');
const { getLanguage } = require('../i18n/i18n');
const { getReadTime } = require('../services/ReadTimeService');
const { CATEGORY_ENUM, CATEGORY_NAMES } = require('../config');
const { renderPage, renderErrorPage, getAvatarWithFallback } = require('../routes/viewUtils');
const { formatDate, formatRelativeTime } = require('../i18n/i18n');

function create(fastify) {

    async function indexHandler(req, reply) {
        const lang = getLanguage(req);

        if (req.isLoggedIn) {

            const currentUserId = req.currentUser.id;

            const posts = await fastify.perf.measure('feed:recommendations', async () => {
                return isFeatureEnabled('content', 'recommendationEngine')
                    ? recommendationService.getFeed(currentUserId, { limit: 5 })
                    : Post.find()
                        .sort({ publishedAt: -1 })
                        .limit(5)
                        .populate('author', 'displayName avatar role')
                        .lean();
            });

            const postsWithPublicAuthors = await fastify.perf.measure('feed:readTime', async () => {
                return posts.map(post => {
                    if (post.author && typeof post.author.toPublicJSON === 'function') {
                        post.author = post.author.toPublicJSON();
                    }
                    if (post.author) {
                        post.author.avatar = getAvatarWithFallback(post.author);
                    }
                    post.readTime = getReadTime(post.content).display;
                    return post;
                });
            });

            return fastify.perf.measure('render:view', () => reply.view('pages/home-logged-in.ejs', {
                posts: postsWithPublicAuthors,
                pageTitle: 'Home',
                user: req.currentUser ? req.currentUser.toPublicJSON() : null,
                unreadCount: req.unreadCount,
                CATEGORY_ENUM,
                CATEGORY_NAMES,
                categoryNames: CATEGORY_NAMES[lang],
                title: 'PaidInk - Read. Write. Engage.',
                description: 'Stay ahead with the latest in AI, web development, cloud computing, and technology innovation.',
                canonical: `${process.env.BASE_URL || ''}/`,
                ogImage: '/public/images/og-default.png'
            }));
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

        const result = await fastify.perf.measure('home:getPosts', () => postService.getPosts({ page, limit, category }));
        const categoryName = category ? CATEGORY_NAMES[lang]?.[category] || category : null;

        const pageContent = await fastify.perf.measure('render:body', () => renderPage('home', {
            blogs: result.posts,
            pagination: result.pagination,
            category,
            categoryName,
            categoryNames: CATEGORY_NAMES[lang],
            lang,
            formatDate,
            formatRelativeTime
        }));

        return fastify.perf.measure('render:view', () => reply.view('layouts/default.ejs', {
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
        }));
    }

    async function paginatedFeedHandler(req, reply) {
        try {
            const { cursor } = req.query || {};
            const { data, nextCursor } = await FeedService.getPaginatedFeed({
                cursor,
                limit: 10
            });

            return reply.send({
                success: true,
                data,
                nextCursor
            });
        } catch (error) {
            if (error && error.statusCode === 400) {
                return reply.code(400).send({
                    success: false,
                    data: [],
                    nextCursor: null,
                    error: error.message
                });
            }

            req.log.error({ error: error && error.message ? error.message : String(error) }, 'Paginated feed failed');
            return reply.code(500).send({
                success: false,
                data: [],
                nextCursor: null,
                error: 'Failed to load feed'
            });
        }
    }

    return {
        index: indexHandler,
        getPaginatedFeed: paginatedFeedHandler
    };
}

module.exports = { create };
