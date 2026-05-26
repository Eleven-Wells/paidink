const recommendationService = require('../services/RecommendationService');

module.exports = async function recommendationsRoutes(fastify) {
    fastify.get('/api/recommendations/related/:postId', async (req, reply) => {
        try {
            const { postId } = req.params;
            const limit = Math.min(parseInt(req.query.limit) || 5, 20);

            const posts = await recommendationService.getRelated(postId, limit);
            return reply.send({ success: true, data: posts });
        } catch (err) {
            req.log.error({ error: err.message }, 'Failed to get related recommendations');
            return reply.code(500).send({ success: false, error: 'Failed to get recommendations' });
        }
    });

    fastify.get('/api/recommendations/feed', async (req, reply) => {
        try {
            const limit = Math.min(parseInt(req.query.limit) || 10, 50);
            const userId = req.isLoggedIn ? req.currentUser?.id : null;

            const posts = await recommendationService.getFeed(userId, { limit });
            return reply.send({
                success: true,
                data: posts,
                source: userId ? 'personalized' : 'trending'
            });
        } catch (err) {
            req.log.error({ error: err.message }, 'Failed to get feed recommendations');
            return reply.code(500).send({ success: false, error: 'Failed to get feed' });
        }
    });

    fastify.get('/api/recommendations/for-you', async (req, reply) => {
        if (!req.isLoggedIn || !req.currentUser) {
            return reply.code(401).send({ success: false, error: 'Authentication required' });
        }

        try {
            const limit = Math.min(parseInt(req.query.limit) || 5, 20);
            const posts = await recommendationService.getForYou(req.currentUser.id, { limit });
            return reply.send({ success: true, data: posts });
        } catch (err) {
            req.log.error({ error: err.message }, 'Failed to get for-you recommendations');
            return reply.code(500).send({ success: false, error: 'Failed to get recommendations' });
        }
    });
};
