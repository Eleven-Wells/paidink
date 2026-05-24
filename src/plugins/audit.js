const fp = require('fastify-plugin');
const { captureMessage } = require('./sentry');

const AuditLog = require('../models/AuditLog');

function createAuditContext(request) {
    return {
        requestId: request.id,
        method: request.method,
        url: request.url,
        ip: getClientIP(request),
        userAgent: request.headers['user-agent'],
        adminAuth: request.adminAuth,
        timestamp: new Date().toISOString()
    };
}

function getClientIP(request) {
    const forwarded = request.headers['x-forwarded-for'];
    if (forwarded) {
        return forwarded.split(',')[0].trim();
    }
    return request.ip || request.socket.remoteAddress;
}

function createAuditPlugin(fastify) {
    fastify.decorateRequest('auditContext', null);

    fastify.addHook('onRequest', async (request) => {
        request.auditContext = createAuditContext(request);
    });

    fastify.decorate('audit', {
        log: async (action, details = {}, request = null) => {
            const context = request?.auditContext || {};

            const auditEntry = {
                action,
                ...context,
                details,
                level: details.level || 'info'
            };

            if (process.env.NODE_ENV !== 'test') {
                try {
                    if (AuditLog) {
                        await AuditLog.create({
                            action: auditEntry.action,
                            method: auditEntry.method,
                            url: auditEntry.url,
                            ip: auditEntry.ip,
                            userAgent: auditEntry.userAgent,
                            requestId: auditEntry.requestId,
                            adminAuth: auditEntry.adminAuth,
                            details: details,
                            timestamp: new Date()
                        });
                    }
                } catch (error) {
                    console.error('[Audit] Failed to persist audit log:', error.message);
                }
            }

            const logLevel = auditEntry.level || 'info';
            const logMessage = `[Audit] ${action}`;

            switch (logLevel) {
                case 'debug':
                    console.debug(logMessage, auditEntry);
                    break;
                case 'info':
                    console.info(logMessage, auditEntry);
                    break;
                case 'warn':
                    console.warn(logMessage, auditEntry);
                    break;
                case 'error':
                    console.error(logMessage, auditEntry);
                    break;
                default:
                    console.info(logMessage, auditEntry);
            }

            if (auditEntry.level === 'warn' || auditEntry.level === 'error') {
                captureMessage(logMessage, auditEntry.level, {
                    action: auditEntry.action,
                    ip: auditEntry.ip,
                    requestId: auditEntry.requestId,
                    details
                });
            }

            return auditEntry;
        },

        adminAction: async (request, action, details = {}) => {
            return await fastify.audit.log(
                `admin:${action}`,
                {
                    ...details,
                    adminIP: getClientIP(request),
                    authenticated: request.adminAuth?.authenticated || false
                },
                request
            );
        },

        securityEvent: async (request, event, details = {}) => {
            return await fastify.audit.log(
                `security:${event}`,
                {
                    ...details,
                    severity: details.severity || 'medium'
                },
                request
            );
        },

        apiAccess: async (request, resource, action = 'read', details = {}) => {
            return await fastify.audit.log(
                `api:${resource}:${action}`,
                details,
                request
            );
        },

        dataChange: async (request, entity, action, before, after) => {
            return await fastify.audit.log(
                `data:${entity}:${action}`,
                {
                    before,
                    after
                },
                request
            );
        }
    });
}

const auditActions = {
    AUTH_SUCCESS: 'auth:success',
    AUTH_FAILURE: 'auth:failure',
    ADMIN_LOGIN: 'admin:login',
    ADMIN_LOGOUT: 'admin:logout',
    CONTENT_CREATE: 'content:create',
    CONTENT_UPDATE: 'content:update',
    CONTENT_DELETE: 'content:delete',
    JOB_TRIGGER: 'job:trigger',
    JOB_CANCEL: 'job:cancel',
    CONFIG_CHANGE: 'config:change',
    USER_CREATE: 'user:create',
    USER_UPDATE: 'user:update',
    USER_DELETE: 'user:delete'
};

const auditPlugin = fp(async (fastify) => {
    createAuditPlugin(fastify);
}, {
    name: 'audit'
});

module.exports = auditPlugin;
module.exports.createAuditPlugin = createAuditPlugin;
module.exports.createAuditContext = createAuditContext;
module.exports.getClientIP = getClientIP;
module.exports.auditActions = auditActions;
