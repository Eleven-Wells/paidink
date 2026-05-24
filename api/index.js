const { fastify, buildApp } = require('../src/app');

let initialized = false;

module.exports = async (req, res) => {
    if (!initialized) {
        try {
            await buildApp();
            await fastify.ready();
            initialized = true;
        } catch (err) {
            console.error('[Vercel] Initialization failed:', err.message, err.stack);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Initialization failed', message: err.message }));
            return;
        }
    }

    fastify.server.emit('request', req, res);
};
