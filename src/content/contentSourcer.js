const Parser = require('rss-parser');
const fetch = require('node-fetch');
const { ContentError, ExternalAPIError } = require('../errors/errors');
const { getCacheKey } = require('../plugins/cache');

function createLogger(component) {
    return {
        debug: (message, context = {}) => console.debug(`[${component}] [DEBUG] ${message}`, { component, ...context }),
        info: (message, context = {}) => console.info(`[${component}] [INFO] ${message}`, { component, ...context }),
        warn: (message, context = {}) => console.warn(`[${component}] [WARN] ${message}`, { component, ...context }),
        error: (message, context = {}) => console.error(`[${component}] [ERROR] ${message}`, { component, ...context })
    };
}

const logger = createLogger('contentSourcer');
const parser = new Parser();

async function sourceContent(url, type, options = {}) {
    const { limit = 5, useCache = true } = options;

    try {
        if (type === 'rss') {
            return await sourceRSS(url, { limit, useCache });
        } else {
            return await sourceURL(url, { useCache });
        }
    } catch (error) {
        logger.error('Content sourcing failed', { url, type, error: error.message });
        throw new ContentError('SOURCE_FETCH_FAILED', { url, type });
    }
}

async function sourceRSS(url, options = {}) {
    const { limit = 5 } = options;

    try {
        logger.debug('Fetching RSS feed', { url, limit });
        const feed = await parser.parseURL(url);

        if (!feed.items || feed.items.length === 0) {
            logger.warn('RSS feed has no items', { url });
            return [];
        }

        const items = feed.items.slice(0, limit);
        const results = items.map(item => ({
            title: item.title || 'Untitled',
            content: item.content || item.summary || item.description || '',
            link: item.link || '',
            pubDate: item.pubDate || item.isoDate || new Date().toISOString(),
            author: item.creator || item.author || feed.title || 'Unknown'
        }));

        logger.info('RSS content fetched', { url, itemCount: results.length });
        return results;
    } catch (error) {
        logger.error('RSS parsing failed', { url, error: error.message });
        throw new ExternalAPIError('FETCH_FAILED', { url, service: 'RSS', originalError: error.message });
    }
}

async function sourceURL(url, options = {}) {
    const { useCache = true } = options;

    try {
        logger.debug('Fetching URL', { url });
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            },
            signal: AbortSignal.timeout(15000)
        });

        if (!response.ok) {
            throw new ExternalAPIError('API_REQUEST_FAILED', {
                url,
                status: response.status,
                statusText: response.statusText
            });
        }

        const html = await response.text();
        let content = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        if (content.length < 100) {
            logger.warn('Content too short after extraction', { url, length: content.length });
            content = 'Content could not be extracted properly from this source.';
        }

        content = content.substring(0, 8000);
        logger.info('URL content fetched', { url, length: content.length });

        return [{
            title: url.split('/').pop() || 'Untitled',
            content,
            link: url,
            pubDate: new Date().toISOString(),
            author: 'Unknown'
        }];
    } catch (error) {
        if (error instanceof ExternalAPIError) {
            throw error;
        }
        logger.error('URL fetch failed', { url, error: error.message });
        throw new ExternalAPIError('FETCH_FAILED', { url, originalError: error.message });
    }
}

async function fetchMultipleRSS(feeds, options = {}) {
    const { concurrency = 3 } = options;

    const results = [];
    const batchSize = concurrency;

    for (let i = 0; i < feeds.length; i += batchSize) {
        const batch = feeds.slice(i, i + batchSize);
        const batchResults = await Promise.allSettled(
            batch.map(feed => sourceRSS(feed.url, { limit: feed.limit || 3 }))
        );

        for (let j = 0; j < batchResults.length; j++) {
            const result = batchResults[j];
            if (result.status === 'fulfilled') {
                results.push({
                    source: batch[j].url,
                    items: result.value
                });
            } else {
                logger.error('RSS fetch failed', { url: batch[j].url, error: result.reason?.message });
                results.push({
                    source: batch[j].url,
                    items: [],
                    error: result.reason?.message
                });
            }
        }
    }

    return results;
}

module.exports = { sourceContent, sourceRSS, sourceURL, fetchMultipleRSS };
