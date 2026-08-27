'use strict';

const { Writable } = require('stream');

const C = {
    reset: '\x1b[0m',
    dim: '\x1b[2m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    magenta: '\x1b[35m',
    bold: '\x1b[1m'
};

function time() {
    const d = new Date();
    return [
        String(d.getHours()).padStart(2, '0'),
        String(d.getMinutes()).padStart(2, '0'),
        String(d.getSeconds()).padStart(2, '0')
    ].join(':');
}

function statusColor(code) {
    if (code >= 500) return C.red;
    if (code >= 400) return C.yellow;
    if (code >= 300) return C.magenta;
    if (code >= 200) return C.green;
    return C.cyan;
}

function renderRequest(r) {
    const method = String(r.method || 'GET').padEnd(6, ' ');
    const url = r.url || '';
    const status = r.status != null
        ? `${statusColor(r.status)}${r.status}${C.reset}`
        : `${C.dim}---${C.reset}`;
    const ms = r.ms != null ? ` ${C.dim}${Math.round(r.ms)}ms${C.reset}` : '';
    return `${C.dim}${time()}${C.reset} ${C.bold}${C.cyan}${method}${C.reset} ${C.dim}${url}${C.reset} ${status}${ms}`;
}

function renderDefault(obj) {
    const msg = obj.msg || '';
    const t = `${C.dim}${time()}${C.reset} `;
    if (obj.level >= 50) {
        return `${t}${C.red}${C.bold}✖${C.reset} ${C.red}${msg}${C.reset}`;
    }
    if (obj.level === 40) {
        return `${t}${C.yellow}${C.bold}⚠${C.reset} ${C.yellow}${msg}${C.reset}`;
    }
    return `${t}${C.dim}${msg}${C.reset}`;
}

function createTransport() {
    let buffer = '';
    return new Writable({
        write(chunk, _enc, cb) {
            buffer += chunk.toString();
            let idx;
            while ((idx = buffer.indexOf('\n')) !== -1) {
                const line = buffer.slice(0, idx);
                buffer = buffer.slice(idx + 1);
                if (!line.trim()) continue;
                try {
                    const obj = JSON.parse(line);
                    if (obj.nextRequest) {
                        process.stdout.write(renderRequest(obj.nextRequest) + '\n');
                    } else {
                        process.stdout.write(renderDefault(obj) + '\n');
                    }
                } catch (_e) {
                    // ignore malformed lines
                }
            }
            cb();
        },
        final(cb) {
            cb();
        }
    });
}

module.exports = createTransport;
