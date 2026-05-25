/**
 * @typedef {Object} PaginationOptions
 * @property {number} [page=1] - Page number
 * @property {number} [limit=12] - Items per page
 * @property {string} [category] - Filter by category
 */

/**
 * @typedef {Object} PaginationResult
 * @property {Array} posts - Array of posts
 * @property {Object} pagination - Pagination metadata
 */

/**
 * @typedef {Object} PostResult
 * @property {Object} post - The post object
 * @property {Array} [relatedPosts] - Related posts if applicable
 */

/**
 * @typedef {Object} CategoryInfo
 * @property {string} slug - Category slug
 * @property {string} name - Category display name
 */

/**
 * @typedef {Object} CategoryStats
 * @property {string} category - Category name
 * @property {number} count - Number of posts in category
 */

/**
 * Post Service - Handles all post-related business logic
 * @class PostService
 */
const Post = require('../models/Post');
const { getRelatedPosts, addInternalLinks } = require('../seo/internalLinking');
const { ValidationError, DatabaseError } = require('../errors/errors');
const { CATEGORY_ENUM, CATEGORY_NAMES } = require('../config');

class PostService {
    /**
     * Get paginated list of posts
     * @param {PaginationOptions} options - Pagination and filter options
     * @returns {Promise<PaginationResult>} Posts with pagination info
     * @throws {ValidationError} If category is invalid
     */
    async getPosts(options = {}) {
        const {
            page = 1,
            limit = 12,
            category = null
        } = options;

        const query = {};
        if (category) {
            if (!CATEGORY_ENUM.includes(category)) {
                throw new ValidationError('INVALID_INPUT', {
                    field: 'category',
                    allowed: CATEGORY_ENUM
                });
            }
            query.category = category;
        }

        const [total, posts] = await Promise.all([
            Post.countDocuments(query),
            Post.find(query)
                .sort({ publishedAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .lean()
        ]);

        return {
            posts,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
                hasNext: page < Math.ceil(total / limit),
                hasPrev: page > 1
            }
        };
    }

    /**
     * Get a single post by slug with related posts
     * @param {string} slug - Post slug
     * @returns {Promise<Object|null>} Post with related posts or null
     * @throws {ValidationError} If slug is invalid
     */
    async getPostBySlug(slug) {
        if (!slug || typeof slug !== 'string' || slug.length > 100) {
            throw new ValidationError('INVALID_INPUT', {
                field: 'slug',
                message: 'Invalid slug format'
            });
        }

        const post = await Post.findOne({ slug })
            .populate('author', 'displayName username avatar bio')
            .lean();
        if (!post) {
            return null;
        }

        const relatedPosts = await getRelatedPosts(post._id, post.tags, post.category, 3);
        const enhancedContent = addInternalLinks(post.content, relatedPosts);

        return {
            ...post,
            content: enhancedContent,
            relatedPosts
        };
    }

    /**
     * Get a single post by ID
     * @param {string} id - MongoDB ObjectId
     * @returns {Promise<Object|null>} Post or null if not found
     * @throws {ValidationError} If ID format is invalid
     */
    async getPostById(id) {
        if (!id || !/^[a-fA-F0-9]{24}$/.test(id)) {
            throw new ValidationError('INVALID_ID', { field: 'id', value: id });
        }

        const post = await Post.findById(id).lean();
        if (!post) {
            return null;
        }

        return post;
    }

    /**
     * Get latest posts with optional filters
     * @param {Object} options - Filter options
     * @param {number} [options.limit=10] - Max posts to return
     * @param {Date|string} [options.since] - Posts published after this date
     * @param {string} [options.category] - Filter by category
     * @returns {Promise<Array>} Array of posts
     * @throws {ValidationError} If parameters are invalid
     */
    async getLatestPosts(options = {}) {
        const { limit = 10, since = null, category = null } = options;

        const query = {};
        if (since) {
            const sinceDate = new Date(since);
            if (isNaN(sinceDate.getTime())) {
                throw new ValidationError('INVALID_INPUT', {
                    field: 'since',
                    message: 'Invalid date format'
                });
            }
            query.publishedAt = { $gt: sinceDate };
        }
        if (category) {
            if (!CATEGORY_ENUM.includes(category)) {
                throw new ValidationError('INVALID_INPUT', {
                    field: 'category',
                    allowed: CATEGORY_ENUM
                });
            }
            query.category = category;
        }

        const posts = await Post.find(query)
            .sort({ publishedAt: -1 })
            .limit(Math.min(limit, 50))
            .select('title slug summary category image publishedAt')
            .lean();

        return posts;
    }

    /**
     * Get posts by category
     * @param {string} category - Category slug
     * @param {Object} options - Additional options
     * @param {number} [options.limit=50] - Max posts to return
     * @returns {Promise<Array>} Array of posts
     * @throws {ValidationError} If category is invalid
     */
    async getPostsByCategory(category, options = {}) {
        const { limit = 50 } = options;

        if (!CATEGORY_ENUM.includes(category)) {
            throw new ValidationError('INVALID_INPUT', {
                field: 'category',
                allowed: CATEGORY_ENUM
            });
        }

        const posts = await Post.find({ category })
            .sort({ publishedAt: -1 })
            .limit(limit)
            .lean();

        return posts;
    }

    /**
     * Check if a post with given slug already exists
     * @param {string} slug - Post slug to check
     * @returns {Promise<boolean>} True if duplicate exists
     */
    async checkDuplicate(slug) {
        const existing = await Post.findOne({ slug })
            .select('_id')
            .lean();
        return existing !== null;
    }

    /**
     * Create a new post
     * @param {Object} postData - Post data
     * @returns {Promise<Object>} Created post
     */
    async createPost(postData) {
        const post = new Post(postData);
        await post.save();
        return post.toObject();
    }

    /**
     * Get all categories with localized names
     * @param {string} [lang='en'] - Language code
     * @returns {Promise<CategoryInfo[]>} Array of categories
     */
    async getCategories(lang = 'en') {
        return CATEGORY_ENUM.map(slug => ({
            slug,
            name: CATEGORY_NAMES[lang]?.[slug] || slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
        }));
    }

    /**
     * Get post count per category
     * @returns {Promise<CategoryStats[]>} Array of category stats
     */
    async getCategoryStats() {
        const stats = await Post.aggregate([
            { $group: { _id: '$category', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ]);

        return stats.map(stat => ({
            category: stat._id,
            count: stat.count
        }));
    }

    /**
     * Validate if a category is valid
     * @param {string} category - Category to validate
     * @returns {boolean} True if valid
     */
    isValidCategory(category) {
        return CATEGORY_ENUM.includes(category);
    }

    /**
     * Get the category enum array
     * @returns {string[]} Array of valid category slugs
     */
    getCategoriesEnum() {
        return [...CATEGORY_ENUM];
    }
}

module.exports = new PostService();
