'use strict';

function enabled() {
    return process.env.DEBUG === 'true' || process.env.NODE_ENV === 'test';
}

function debug(...args) {
    if (enabled()) console.log(...args);
}

debug.debug = function (...args) {
    if (enabled()) console.debug(...args);
};

module.exports = debug;
