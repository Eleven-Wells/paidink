'use strict';

const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const { getReadTime } = require('../services/ReadTimeService');
const { getLanguage } = require('../i18n/i18n');

const viewsPath = path.join(__dirname, '..', 'views');

function renderPage(pageName, data) {
    const pagesPath = path.join(viewsPath, 'pages', `${pageName}.ejs`);
    const staticPath = path.join(viewsPath, 'partials', 'static', `${pageName}.ejs`);

    let pagePath = pagesPath;
    if (!fs.existsSync(pagesPath) && fs.existsSync(staticPath)) {
        pagePath = staticPath;
    }

    if (!fs.existsSync(pagePath)) {
        return '';
    }
    const pageContent = fs.readFileSync(pagePath, 'utf8');
    return ejs.render(pageContent, { ...data, getReadTime }, {
        async: false,
        views: [viewsPath, path.join(viewsPath, 'layouts'), path.join(viewsPath, 'partials'), path.join(viewsPath, 'pages')]
    });
}

function renderErrorPage(errorName, req) {
    const errorPath = path.join(viewsPath, 'errors', `${errorName}.ejs`);
    if (!fs.existsSync(errorPath)) {
        return '<div class="p-8 text-center"><h1>Error</h1><p>Something went wrong.</p></div>';
    }
    const errorContent = fs.readFileSync(errorPath, 'utf8');
    return ejs.render(errorContent, {
        lang: getLanguage(req),
        theme: req.cookies?.theme || 'light'
    }, {
        async: false,
        views: [viewsPath, path.join(viewsPath, 'errors')]
    });
}

function getAvatarWithFallback(user) {
    if (user && user.avatar) return user.avatar;
    var initial = '?';
    if (user) {
        const nameSource = user.username || user.displayName || '';
        if (nameSource && nameSource.length > 0) initial = nameSource.charAt(0).toUpperCase();
    }
    return 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><circle cx="40" cy="40" r="40" fill="#e5e5e5"/><text x="40" y="52" text-anchor="middle" fill="#6d0a0a" font-size="36" font-family="sans-serif">' + initial + '</text></svg>');
}

module.exports = { renderPage, renderErrorPage, getAvatarWithFallback, viewsPath };
