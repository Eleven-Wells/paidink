const { fastify, buildApp } = require('../src/app');

let initialized = false;

module.exports = async (req, res) => {
    if (!initialized) {
        await buildApp();
        await fastify.ready();
        initialized = true;
    }

    fastify.server.emit('request', req, res);
};
