const fastify = require('fastify')();

describe('Platform Health Endpoints', () => {
    beforeAll(async () => {
        fastify.get('/healthz', async (req, reply) => {
            return reply.code(200).send({ status: 'ok' });
        });

        fastify.get('/readyz', async (req, reply) => {
            return reply.code(200).send({
                status: 'ready',
                database: false
            });
        });

        await fastify.ready();
    });

    afterAll(async () => {
        await fastify.close();
    });

    test('GET /healthz returns 200 with status ok', async () => {
        const res = await fastify.inject({
            method: 'GET',
            url: '/healthz'
        });

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ status: 'ok' });
    });

    test('GET /readyz returns 200 with status ready and database field', async () => {
        const res = await fastify.inject({
            method: 'GET',
            url: '/readyz'
        });

        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.status).toBe('ready');
        expect(body).toHaveProperty('database');
    });
});
