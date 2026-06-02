const warmupHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta http-equiv="refresh" content="5">
<title>Warming up...</title>
<style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#f9fafb;color:#374151;}
.wrapper{text-align:center;}.spinner{border:4px solid #e5e7eb;border-top-color:#6366f1;border-radius:50%;width:40px;height:40px;animation:spin .8s linear infinite;margin:0 auto 1rem;}
@keyframes spin{to{transform:rotate(360deg)}}h1{font-size:1.25rem;margin:0 0 .25rem;}p{color:#6b7280;margin:0;}</style></head>
<body><div class="wrapper"><div class="spinner"></div><h1>Nook is warming up</h1><p>This page will refresh automatically.</p></div></body></html>`;

let fastify = null;
let initialized = false;
let initError = null;
let initStarted = false;

async function initialize() {
    const t0 = Date.now();
    console.error('[cold-start] init begin');

    const { connectDB } = require('../src/db');
    const app = require('../src/app');
    const f = app.fastify || app;
    const build = f.buildApp || app.buildApp;

    console.error('[cold-start] modules loaded in', Date.now() - t0, 'ms');

    await Promise.all([
        connectDB(),
        build()
    ]);

    console.error('[cold-start] connectDB + buildApp done in', Date.now() - t0, 'ms');

    await f.ready();
    fastify = f;
    initialized = true;
    initError = null;

    console.error('[cold-start] init complete in', Date.now() - t0, 'ms');
}

module.exports = async (req, res) => {
    if (!initialized && !initStarted) {
        initStarted = true;
        initialize().catch(err => {
            console.error('[cold-start] init failed:', err.message);
            initError = err;
            initStarted = false;
            fastify = null;
        });
    }

    if (!initialized) {
        res.writeHead(503, {
            'Content-Type': 'text/html; charset=utf-8',
            'Retry-After': '5'
        });
        res.end(warmupHtml);
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
