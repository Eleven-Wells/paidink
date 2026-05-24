const fp = require('fastify-plugin');
const { AppError, createErrorResponse } = require('../errors/errors');
const { captureError } = require('./sentry');
const ejs = require('ejs');
const fs = require('fs');
const path = require('path');

const viewsPath = path.join(__dirname, '..', 'views');
const layoutsPath = path.join(viewsPath, 'layouts');
const partialsPath = path.join(viewsPath, 'partials');

function renderEjs(templatePath, data) {
    const fullPath = path.join(viewsPath, templatePath);
    const template = fs.readFileSync(fullPath, 'utf8');
    return ejs.render(template, data, {
        async: false,
        views: [viewsPath, path.join(viewsPath, 'layouts'), path.join(viewsPath, 'partials'), path.join(viewsPath, 'pages'), path.join(viewsPath, 'errors')]
    });
}

function renderErrorPage(errorName, req) {
    const errorPath = path.join(viewsPath, 'errors', `${errorName}.ejs`);
    if (!fs.existsSync(errorPath)) {
        return '<div class="p-8 text-center"><h1>Error</h1><p>Something went wrong.</p></div>';
    }
    const errorContent = fs.readFileSync(errorPath, 'utf8');
    return ejs.render(errorContent, {
        lang: req.headers['accept-language']?.startsWith('es') ? 'es' : 'en',
        theme: req.cookies?.theme || 'light'
    }, {
        async: false,
        views: [viewsPath, path.join(viewsPath, 'errors')]
    });
}

function isHtmlRequest(request) {
    const accept = request.headers.accept || '';
    return accept.includes('text/html') || accept === '*/*' || accept === '';
}

function createErrorHandler(fastify) {
    return async function errorHandler(error, request, reply) {
        const requestId = request.id;
        const startTime = request.startTime || Date.now();

        let appError;
        let logLevel = 'error';

        if (error instanceof AppError) {
            appError = error;
        } else if (error.validation) {
            appError = new AppError(
                { code: 'VAL_001', message: 'Validation error', httpStatus: 400 },
                error.message,
                { validation: error.validation }
            );
            logLevel = 'warn';
        } else if (error.statusCode === 404) {
            appError = new AppError(
                { code: 'DB_004', message: 'Resource not found', httpStatus: 404 },
                error.message
            );
            logLevel = 'warn';
        } else if (error.name === 'MongoError' || error.name === 'MongooseError') {
            appError = new AppError(
                { code: 'DB_001', message: 'Database connection error', httpStatus: 503 },
                error.message
            );
        } else if (error.code === 'ECONNREFUSED') {
            appError = new AppError(
                { code: 'DB_001', message: 'Database connection refused', httpStatus: 503 },
                error.message
            );
        } else {
            appError = new AppError(
                { code: 'INT_001', message: 'An unexpected error occurred', httpStatus: 500 },
                process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
                { originalError: error.name }
            );
        }

        request.log[logLevel]({
            requestId,
            code: appError.code,
            message: appError.message,
            httpStatus: appError.httpStatus,
            stack: appError.stack,
            responseTime: Date.now() - startTime,
            url: request.url,
            method: request.method
        }, `Request error: ${appError.code}`);

        captureError(appError, {
            requestId,
            url: request.url,
            method: request.method,
            userAgent: request.headers['user-agent']
        });

        const response = createErrorResponse(appError, requestId);
        
        if (isHtmlRequest(request) && appError.httpStatus >= 500) {
            const lang = request.headers['accept-language']?.startsWith('es') ? 'es' : 'en';
            const pageContent = renderErrorPage('500', request);
            const html = renderEjs('layouts/default.ejs', {
                body: pageContent,
                activeCategory: null,
                lang,
                theme: request.cookies?.theme || 'light',
                title: '500 - Server Error | TechMedia',
                description: 'An unexpected error occurred',
                ogImage: null,
                canonical: `${process.env.BASE_URL || ''}/500`
            });
            return reply.code(appError.httpStatus).type('text/html').send(html);
        }
        
        return reply.code(appError.httpStatus).send(response);
    };
}

function createNotFoundHandler(fastify) {
    return async function notFoundHandler(request, reply) {
        const requestId = request.id;
        const lang = request.headers['accept-language']?.startsWith('es') ? 'es' : 'en';

        request.log.warn({
            requestId,
            url: request.url,
            method: request.method
        }, 'Route not found');

        const pageContent = renderEjs('errors/404.ejs', { lang, theme: 'light' });
        const html = renderEjs('layouts/default.ejs', {
            body: pageContent,
            activeCategory: null,
            lang,
            theme: 'light',
            title: '404 - Page Not Found | TechMedia',
            description: 'The requested page could not be found',
            ogImage: null,
            canonical: `${process.env.BASE_URL || ''}/404`
        });
        return reply.code(404).type('text/html').send(html);
    };
}

module.exports = fp(async (fastify) => {
    fastify.setErrorHandler(createErrorHandler(fastify));
    fastify.setNotFoundHandler(createNotFoundHandler(fastify));
}, {
    name: 'error-handler'
});

module.exports.createErrorHandler = createErrorHandler;
module.exports.createNotFoundHandler = createNotFoundHandler;
