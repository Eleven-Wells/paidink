'use strict';

const Post = require('../../models/Post');
const { getReadTime } = require('../ReadTimeService');
const { getAvatarWithFallback } = require('../../routes/viewUtils');

class FeedService {
    /**
     * Get cursor-based paginated feed.
     * Fetches the latest posts before a given timestamp and returns
     * the next cursor if another page of results is available.
     *
     * @param {Object} options
     * @param {string|null} options.cursor - ISO timestamp used as the exclusive lower bound
     * @param {number} options.limit - page size; defaults to 10
     * @returns {Promise<{ data: Array, nextCursor: string|null }>}
     */
    async getPaginatedFeed({ cursor = null, limit = 10 } = {}) {
        const query = {};

        if (cursor) {
            const cursorDate = new Date(cursor);

            if (Number.isNaN(cursorDate.getTime())) {
                const error = new Error('Invalid cursor format');
                error.statusCode = 400;
                throw error;
            }

            query.publishedAt = { $lt: cursorDate };
        }

        const posts = await Post.find(query)
            .sort({ publishedAt: -1 })
            .limit(limit)
            .populate('author', 'displayName avatar role')
            .lean();

        const data = posts.map((post) => {
            if (post.author) {
                post.author.avatar = getAvatarWithFallback(post.author);
            }

            post.readTime = getReadTime(post.content).display;
            return post;
        });

        const nextCursor = data.length === limit && data[data.length - 1]?.publishedAt
            ? new Date(data[data.length - 1].publishedAt).toISOString()
            : null;

        return {
            data,
            nextCursor
        };
    }
}

module.exports = new FeedService();