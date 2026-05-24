const { fastify, buildApp } = require('../src/app');

const INIT_TIMEOUT = 15000;
let initialized = false;
let initError = null;
let initPromise = null;

async function initialize() {
    try {
        await buildApp();
        await fastify.ready();
        initialized = true;
        initError = null;
    } catch (err) {
        initError = err;
        throw err;
    }
}

module.exports = async (req, res) => {
    if (!initialized && !initPromise) {
        initPromise = Promise.race([
            initialize(),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Initialization timed out after ' + INIT_TIMEOUT + 'ms')), INIT_TIMEOUT)
            )
        ]);
        initPromise.catch(() => {}); // prevent unhandled rejection
    }

    if (initPromise) {
        try {
            await initPromise;
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Initialization failed', message: err.message }));
            initPromise = null;
            return;
        }
    }

    if (initError) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Initialization failed', message: initError.message }));
        return;
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

        const headers = Object.assign({}, response.headers);
        delete headers['transfer-encoding'];

        res.writeHead(response.statusCode, headers);
        res.end(response.body);
    } catch (err) {
        if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Request failed', message: err.message }));
        }
    }
};
