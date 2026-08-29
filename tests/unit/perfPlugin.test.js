const Fastify = require('fastify');
const pino = require('pino');
const perfPlugin = require('../../src/plugins/perf');

describe('perf instrumentation plugin', () => {
    const original = process.env.PERF_LOGGING;

    beforeAll(() => {
        process.env.PERF_LOGGING = 'true';
    });

    afterAll(() => {
        process.env.PERF_LOGGING = original;
    });

    test('measure() returns the function result unchanged', async () => {
        const app = Fastify();
        await app.register(perfPlugin);
        app.get('/echo', async (req, reply) => {
            const result = await app.perf.measure('work', async () => ({ ok: true, n: 42 }));
            return reply.send(result);
        });

        const res = await app.inject({ url: '/echo' });

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ ok: true, n: 42 });
    });

    test('measure() records a span with the given label', async () => {
        const app = Fastify();
        await app.register(perfPlugin);
        app.get('/span', async (req, reply) => {
            await app.perf.measure('service:alpha', async () => {
                await new Promise(r => setTimeout(r, 5));
            });
            const store = app.perf.getCurrentStore();
            return reply.send({ spanCount: store.spans.length, label: store.spans[0] && store.spans[0].label });
        });

        const res = await app.inject({ url: '/span' });
        const body = res.json();

        expect(body.spanCount).toBe(1);
        expect(body.label).toBe('service:alpha');
    });

    test('nested measures record parent/child relationships', async () => {
        const app = Fastify();
        await app.register(perfPlugin);
        app.get('/nested', async (req, reply) => {
            await app.perf.measure('outer', async () => {
                await app.perf.measure('inner', async () => {
                    await new Promise(r => setTimeout(r, 2));
                });
            });
            const store = app.perf.getCurrentStore();
            return reply.send(store.spans);
        });

        const res = await app.inject({ url: '/nested' });
        const spans = res.json();

        expect(spans).toHaveLength(2);
        const outer = spans.find(s => s.label === 'outer');
        const inner = spans.find(s => s.label === 'inner');
        expect(outer.childOf).toBeNull();
        expect(inner.childOf).toBe('outer');
    });

    test('onResponse logs a perf breakdown with method, route, status and totalMs', async () => {
        const lines = [];
        const stream = { write: (s) => { lines.push(JSON.parse(s)); } };
        const app = Fastify({ loggerInstance: pino({ level: 'info' }, stream) });
        await app.register(perfPlugin);
        app.get('/meta', async (req, reply) => {
            await app.perf.measure('work', async () => 1);
            return reply.send({ ok: true });
        });

        const res = await app.inject({ url: '/meta' });

        expect(res.statusCode).toBe(200);
        const perfLog = lines.find(l => l.perf);
        expect(perfLog).toBeDefined();
        expect(perfLog.perf.method).toBe('GET');
        expect(perfLog.perf.route).toBe('/meta');
        expect(perfLog.perf.status).toBe(200);
        expect(typeof perfLog.perf.totalMs).toBe('number');
        expect(perfLog.perf.spans).toEqual([expect.objectContaining({ label: 'work' })]);
    });

    test('captures isLoggedIn from request state at response time', async () => {
        const lines = [];
        const stream = { write: (s) => { lines.push(JSON.parse(s)); } };
        const app = Fastify({ loggerInstance: pino({ level: 'info' }, stream) });
        await app.register(perfPlugin);
        app.addHook('preHandler', (req, reply, done) => {
            req.isLoggedIn = true;
            done();
        });
        app.get('/authed', async (req, reply) => {
            await app.perf.measure('work', async () => 1);
            return reply.send({ ok: true });
        });

        const res = await app.inject({ url: '/authed' });
        expect(res.statusCode).toBe(200);
        const perfLog = lines.find(l => l.perf);
        expect(perfLog.perf.isLoggedIn).toBe(true);
    });

    test('when PERF_LOGGING is disabled, behavior is unchanged and nothing is recorded', async () => {
        process.env.PERF_LOGGING = 'false';
        const lines = [];
        const stream = { write: (s) => { lines.push(JSON.parse(s)); } };
        const app = Fastify({ loggerInstance: pino({ level: 'info' }, stream) });
        await app.register(perfPlugin);
        app.get('/off', async (req, reply) => {
            const result = await app.perf.measure('work', async () => 'result');
            const store = app.perf.getCurrentStore();
            return reply.send({ result, spanCount: store.spans.length });
        });

        const res = await app.inject({ url: '/off' });
        const body = res.json();

        expect(body.result).toBe('result');
        expect(body.spanCount).toBe(0);
        expect(lines.find(l => l.perf)).toBeUndefined();
        process.env.PERF_LOGGING = 'true';
    });
});
