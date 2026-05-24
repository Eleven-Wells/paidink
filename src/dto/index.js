const schemas = require('./schemas');

class DTOFactory {
    static createSuccessResponse(data, requestId = null) {
        return {
            success: true,
            ...data,
            ...(requestId && { requestId })
        };
    }

    static createErrorResponse(code, message, statusCode = 500, requestId = null) {
        const response = {
            success: false,
            error: {
                code,
                message,
                statusCode
            }
        };

        if (requestId) {
            response.error.requestId = requestId;
        }

        return response;
    }

    static createPaginationMeta(page, limit, total) {
        const totalPages = Math.ceil(total / limit);
        return {
            page,
            limit,
            total,
            totalPages,
            hasNext: page < totalPages,
            hasPrev: page > 1
        };
    }

    static sanitizePost(post) {
        if (!post) return null;
        return {
            id: post._id?.toString(),
            title: post.title,
            slug: post.slug,
            summary: post.summary,
            content: post.content,
            category: post.category,
            tags: post.tags,
            image: post.image,
            imageMetadata: post.imageMetadata,
            metaDescription: post.metaDescription,
            publishedAt: post.publishedAt,
            createdAt: post.createdAt,
            updatedAt: post.updatedAt
        };
    }

    static sanitizePosts(posts) {
        return posts.map(post => this.sanitizePost(post));
    }

    static createJobResponse(job, source) {
        return {
            id: job.id,
            source: source.url,
            category: source.category
        };
    }
}

module.exports = {
    ...schemas,
    DTOFactory
};
