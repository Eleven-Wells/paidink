const ProviderService = require('../services/ads/ProviderService');
const { AD_EVENTS, PLACEMENTS } = require('../config/ads');

let eventBus = null;

function setEventBus(bus) {
    eventBus = bus;
}

async function adsRoutes(fastify) {
    fastify.get('/ads', async (req, reply) => {
        const { placement, count = 1 } = req.query;
        if (!placement) {
            return reply.status(400).send({ error: 'placement query parameter is required' });
        }
        const context = buildContext(req, placement, parseInt(count, 10) || 1);
        const ads = await ProviderService.getAds(context);
        return { success: true, ads };
    });

    fastify.get('/ads/:placement', async (req, reply) => {
        const { placement } = req.params;
        const count = parseInt(req.query.count || '1', 10);
        const context = buildContext(req, placement, count);
        const ads = await ProviderService.getAds(context);
        return { success: true, ads };
    });

    fastify.post('/ads/:id/impression', async (req, reply) => {
        if (eventBus) {
            eventBus.emit(AD_EVENTS.IMPRESSION, {
                adId: req.params.id,
                adConfigId: req.body?.adConfigId,
                userId: req.currentUser?.id,
                placement: req.body?.placement,
                sessionId: req.body?.sessionId,
                device: req.headers['user-agent'],
                browser: req.headers['user-agent'],
                country: req.headers['cf-ipcountry'] || null
            });
        }
        return { success: true };
    });

    fastify.post('/ads/:id/click', async (req, reply) => {
        if (eventBus) {
            eventBus.emit(AD_EVENTS.CLICKED, {
                impressionId: req.params.id,
                adId: req.params.id,
                userId: req.currentUser?.id,
                placement: req.body?.placement,
                destination: req.body?.destination,
                referrer: req.headers.referer,
                device: req.headers['user-agent']
            });
        }
        return { success: true };
    });

    fastify.get('/ads/placements', async (req, reply) => {
        return { success: true, placements: Object.values(PLACEMENTS) };
    });
}

function buildContext(req, placement, count) {
    return {
        placement,
        count,
        user: req.currentUser ? { id: req.currentUser.id, role: req.currentUser.role } : { role: 'guest' },
        session: req.session ? { id: req.session } : null,
        request: req,
        locale: req.headers['accept-language'] || 'en-US',
        page: req.url,
        route: req.routeOptions?.url || '',
        tags: req.pageTags || [],
        category: req.pageCategory || ''
    };
}

module.exports = adsRoutes;
module.exports.setEventBus = setEventBus;
