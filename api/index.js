const { fastify, buildApp } = require('../src/app');

let initialized = false;

module.exports = async (req, res) => {
    if (!initialized) {
        try {
            await buildApp();
            await fastify.ready();
            initialized = true;
        } catch (err) {
            console.error('[Vercel] Init failed:', err.message, err.stack);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Initialization failed', message: err.message }));
            return;
        }
    }

    try {
        let body;
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            body = await new Promise((resolve, reject) => {
                const chunks = [];
                req.on('data', c => chunks.push(c));
                req.on('end', () => resolve(Buffer.concat(chunks).toString()));
                req.on('error', reject);
            });
        }

        const response = await fastify.inject({
            method: req.method,
            url: req.url,
            headers: req.headers,
            payload: body || undefined,
        });

        const headers = response.headers || {};
        delete headers['transfer-encoding'];

        res.writeHead(response.statusCode, headers);
        res.end(response.body);
    } catch (err) {
        console.error('[Vercel] Request failed:', err.message, err.stack);
        if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Request failed', message: err.message }));
        }
    }
};
