const fp = require('fastify-plugin');
const { AsyncLocalStorage } = require('async_hooks');

const PERF_LOGGING_FLAG = 'PERF_LOGGING';
const MONGOOSE_START = Symbol('perf.mongoose.start');

const als = new AsyncLocalStorage();

function perfEnabled() {
    return process.env.PERF_LOGGING === 'true';
}

function roundMs(ms) {
    return Math.round(ms * 100) / 100;
}

function elapsedMs(start) {
    return Number(process.hrtime.bigint() - start) / 1e6;
}

function createStore(request) {
    return {
        method: request.method,
        route: (request.routeOptions && request.routeOptions.url) || request.raw && request.raw.url || '',
        isLoggedIn: Boolean(request.isLoggedIn),
        status: null,
        startTime: process.hrtime.bigint(),
        totalMs: 0,
        spans: [],
        dbOps: [],
        dbMs: 0,
        dbOpCount: 0,
        spanStack: []
    };
}

async function measure(label, fn) {
    const store = als.getStore();
    if (!store || !perfEnabled()) {
        return fn();
    }
    const start = process.hrtime.bigint();
    const parent = store.spanStack.length ? store.spanStack[store.spanStack.length - 1] : null;
    store.spanStack.push(label);
    try {
        return await fn();
    } finally {
        store.spans.push({
            label,
            ms: roundMs(elapsedMs(start)),
            childOf: parent
        });
        store.spanStack.pop();
    }
}

function instrumentMongoose(mongoose) {
    function collectOp(operation, thisObj) {
        const store = als.getStore();
        if (!store || !perfEnabled()) return;
        const start = thisObj[MONGOOSE_START];
        if (start === undefined) return;
        const collection = (thisObj.model && thisObj.model.collection && thisObj.model.collection.name)
            || (thisObj._model && thisObj._model.collection && thisObj._model.collection.name)
            || (thisObj.collection && thisObj.collection.name)
            || 'unknown';
        store.dbOps.push({
            op: operation,
            collection,
            ms: roundMs(elapsedMs(start)),
            label: store.spanStack.length ? store.spanStack[store.spanStack.length - 1] : null
        });
        store.dbMs += elapsedMs(start);
        store.dbOpCount += 1;
    }

    const mongoosePerfPlugin = (schema) => {
        const OPERATIONS = [
            'find',
            'findOne',
            'countDocuments',
            'count',
            'estimatedDocumentCount',
            'distinct',
            'aggregate',
            'findOneAndUpdate',
            'findByIdAndUpdate',
            'findOneAndDelete',
            'findByIdAndDelete',
            'updateOne',
            'updateMany',
            'deleteOne',
            'deleteMany',
            'insertMany',
            'save'
        ];
        for (const operation of OPERATIONS) {
            try {
                schema.pre(operation, function () {
                    this[MONGOOSE_START] = process.hrtime.bigint();
                });
                schema.post(operation, function () {
                    collectOp(operation, this);
                });
            } catch (e) {
                // operation is not hookable on this schema; skip
            }
        }
    };

    mongoose.plugin(mongoosePerfPlugin);
    for (const modelName of mongoose.modelNames()) {
        try {
            mongoose.model(modelName).plugin(mongoosePerfPlugin);
        } catch (e) {
            // model unavailable; skip
        }
    }
}

function perfPlugin(fastify, opts, done) {
    fastify.addHook('onRequest', (request, reply, hookDone) => {
        const store = createStore(request);
        request._perfStore = store;
        als.run(store, hookDone);
    });

    fastify.addHook('onResponse', (request, reply, hookDone) => {
        const store = request._perfStore;
        if (store) {
            store.status = reply.statusCode;
            store.isLoggedIn = Boolean(request.isLoggedIn);
            store.totalMs = roundMs(elapsedMs(store.startTime));
            if (perfEnabled() && request.log && request.log.info) {
                const shouldLog = store.dbOpCount > 0 || store.spans.length > 0;
                if (shouldLog) {
                    request.log.info({
                        perf: {
                            route: store.route,
                            method: store.method,
                            status: store.status,
                            totalMs: store.totalMs,
                            isLoggedIn: store.isLoggedIn,
                            dbOpCount: store.dbOpCount,
                            dbMs: roundMs(store.dbMs),
                            dbOps: store.dbOps,
                            spans: store.spans
                        }
                    }, 'perf-baseline');
                }
            }
        }
        hookDone();
    });

    fastify.decorate('perf', {
        measure,
        getCurrentStore() {
            return als.getStore();
        }
    });

    done();
}

module.exports = fp(perfPlugin, { name: 'perf' });
module.exports.instrumentMongoose = instrumentMongoose;
module.exports.perfEnabled = perfEnabled;
