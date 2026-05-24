const fp = require('fastify-plugin');
const crypto = require('crypto');

const REQUEST_ID_HEADER = 'x-request-id';
const REQUEST_ID_REGEX = /^[a-zA-Z0-9_-]{8,64}$/;

function generateRequestId() {
    return `${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}`;
}

function isValidRequestId(id) {
    return REQUEST_ID_REGEX.test(id);
}

const plugin = fp(async (fastify) => {
    fastify.addHook('onRequest', async (request, reply) => {
        let requestId = request.headers[REQUEST_ID_HEADER];

        if (!requestId || !isValidRequestId(requestId)) {
            requestId = generateRequestId();
        }

        request.requestId = requestId;
        reply.header(REQUEST_ID_HEADER, requestId);

        request.startTime = Date.now();

        request.log = request.log.child({
            requestId,
            timestamp: new Date().toISOString()
        });
    });

    fastify.addHook('onResponse', async (request, reply) => {
        const responseTime = Date.now() - (request.startTime || Date.now());

        request.log.info({
            requestId: request.requestId,
            method: request.method,
            url: request.url,
            statusCode: reply.statusCode,
            responseTime,
            userAgent: request.headers['user-agent']
        }, 'Request completed');

        if (reply.statusCode >= 400) {
            request.log.warn({
                requestId: request.requestId,
                statusCode: reply.statusCode,
                responseTime
            }, 'Request completed with error');
        }
    });

    fastify.decorateRequest('getRequestId', function() {
        return this.requestId;
    });

    fastify.decorateReply('setRequestId', function(requestId) {
        this.header(REQUEST_ID_HEADER, requestId);
        return this;
    });
}, {
    name: 'request-id'
});

module.exports = plugin;
module.exports.generateRequestId = generateRequestId;
module.exports.isValidRequestId = isValidRequestId;
module.exports.REQUEST_ID_HEADER = REQUEST_ID_HEADER;
