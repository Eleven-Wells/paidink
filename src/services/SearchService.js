const Blog = require('../models/Tool');
const Post = require('../models/Post');
const { ValidationError } = require('../errors/errors');
const { sanitizeSearchQuery } = require('../plugins/validation');

class SearchService {
    escapeRegex(string) {
        if (!string) return '';
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    async searchTools(query, options = {}) {
        const { page = 1, limit = 10 } = options;

        const sanitizedQuery = sanitizeSearchQuery(query);
        if (!sanitizedQuery || sanitizedQuery.length < 1) {
            throw new ValidationError('INVALID_INPUT', {
                field: 'q',
                message: 'Query too short or empty'
            });
        }

        const escapedQuery = this.escapeRegex(sanitizedQuery);
        const regex = new RegExp(escapedQuery, 'i');

        const searchQuery = {
            $or: [
                { name: regex },
                { description: regex },
                { source: regex }
            ]
        };

        const [total, results] = await Promise.all([
            Blog.countDocuments(searchQuery),
            Blog.find(searchQuery)
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .lean()
        ]);

        return {
            results,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
                hasNext: page < Math.ceil(total / limit),
                hasPrev: page > 1
            },
            query: sanitizedQuery
        };
    }

    async searchPosts(query, options = {}) {
        const { page = 1, limit = 10, category = null } = options;

        const sanitizedQuery = sanitizeSearchQuery(query);
        if (!sanitizedQuery || sanitizedQuery.length < 1) {
            throw new ValidationError('INVALID_INPUT', {
                field: 'q',
                message: 'Query too short or empty'
            });
        }

        const escapedQuery = this.escapeRegex(sanitizedQuery);
        const regex = new RegExp(escapedQuery, 'i');

        const searchQuery = {
            $or: [
                { title: regex },
                { summary: regex },
                { content: regex },
                { tags: regex }
            ]
        };

        if (category) {
            searchQuery.category = category;
        }

        const [total, results] = await Promise.all([
            Post.countDocuments(searchQuery),
            Post.find(searchQuery)
                .sort({ publishedAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .select('title slug summary category image publishedAt tags')
                .lean()
        ]);

        return {
            results,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
                hasNext: page < Math.ceil(total / limit),
                hasPrev: page > 1
            },
            query: sanitizedQuery
        };
    }

    async searchAll(query, options = {}) {
        const { page = 1, limit = 10, category = null } = options;

        const sanitizedQuery = sanitizeSearchQuery(query);
        if (!sanitizedQuery || sanitizedQuery.length < 1) {
            throw new ValidationError('INVALID_INPUT', {
                field: 'q',
                message: 'Query too short or empty'
            });
        }

        const [toolsResult, postsResult] = await Promise.all([
            this.searchTools(sanitizedQuery, { page: 1, limit: Math.ceil(limit / 2) }),
            this.searchPosts(sanitizedQuery, { page: 1, limit: Math.ceil(limit / 2), category })
        ]);

        return {
            tools: toolsResult.results,
            posts: postsResult.results,
            pagination: {
                page,
                limit,
                totalTools: toolsResult.pagination.total,
                totalPosts: postsResult.pagination.total,
                total: toolsResult.pagination.total + postsResult.pagination.total
            },
            query: sanitizedQuery
        };
    }

    async getSuggestions(prefix, options = {}) {
        const { limit = 5 } = options;

        if (!prefix || prefix.length < 2) {
            return { suggestions: [] };
        }

        const sanitized = sanitizeSearchQuery(prefix);
        const escapedQuery = this.escapeRegex(sanitized);
        const regex = new RegExp(`^${escapedQuery}`, 'i');

        const [postTitles, toolNames] = await Promise.all([
            Post.find({ title: regex })
                .select('title slug')
                .limit(limit)
                .lean(),
            Blog.find({ name: regex })
                .select('name')
                .limit(limit)
                .lean()
        ]);

        const suggestions = [
            ...postTitles.map(p => ({ type: 'post', text: p.title, slug: p.slug })),
            ...toolNames.map(t => ({ type: 'tool', text: t.name }))
        ];

        return {
            suggestions: suggestions.slice(0, limit),
            query: sanitized
        };
    }
}

module.exports = new SearchService();
module.exports.SearchService = SearchService;
