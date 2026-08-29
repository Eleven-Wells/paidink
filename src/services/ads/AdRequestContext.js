const { AsyncLocalStorage } = require('async_hooks');

const als = new AsyncLocalStorage();

function run(store, fn) {
    return als.run(store, fn);
}

function getStore() {
    return als.getStore();
}

async function memoize(key, producer) {
    const store = als.getStore();
    if (!store) return producer();
    if (store.has(key)) return store.get(key);
    const promise = Promise.resolve().then(producer);
    store.set(key, promise);
    return promise;
}

module.exports = { run, getStore, memoize };