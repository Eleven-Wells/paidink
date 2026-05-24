const fetch = require('node-fetch');
const { loadConfig } = require('../config');
const { ExternalAPIError } = require('../errors/errors');

function createLogger(component) {
    return {
        debug: (message, context = {}) => console.debug(`[${component}] [DEBUG] ${message}`, { component, ...context }),
        info: (message, context = {}) => console.info(`[${component}] [INFO] ${message}`, { component, ...context }),
        warn: (message, context = {}) => console.warn(`[${component}] [WARN] ${message}`, { component, ...context }),
        error: (message, context = {}) => console.error(`[${component}] [ERROR] ${message}`, { component, ...context })
    };
}

const logger = createLogger('imageFetcher');

async function fetchImage(query, options = {}) {
    const config = loadConfig();
    const { title, tags, category } = options;
    const apiKey = config.UNSPLASH_ACCESS_KEY;

    if (!apiKey) {
        logger.warn('Unsplash API key not configured, using fallback');
        return getCategoryFallbackImage(category, title);
    }

    const searchQueries = generateSearchQueries(query, title, tags, category);

    for (const searchQuery of searchQueries) {
        try {
            const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(searchQuery)}&per_page=5&client_id=${apiKey}&orientation=landscape`;

            const response = await fetch(url, {
                headers: { 'User-Agent': 'SimpleBlog/1.0' },
                signal: AbortSignal.timeout(10000)
            });

            if (!response.ok) {
                if (response.status === 401) {
                    logger.error('Unsplash API key invalid');
                    return getCategoryFallbackImage(category, title);
                }
                continue;
            }

            const data = await response.json();

            if (data.results && data.results.length > 0) {
                const selectedImage = selectBestImage(data.results, title, tags);
                if (selectedImage) {
                    return {
                        image_url: selectedImage.urls.regular || selectedImage.urls.small,
                        source: 'unsplash',
                        alt_text: generateAltText(title, selectedImage),
                        unsplash_id: selectedImage.id,
                        photographer: selectedImage.user?.name,
                        unsplash_url: selectedImage.links?.html
                    };
                }
            }
        } catch (queryError) {
            logger.warn('Query failed', { query: searchQuery, error: queryError.message });
            continue;
        }
    }

    logger.warn('All image queries failed, using fallback');
    return getCategoryFallbackImage(category, title);
}

function generateSearchQueries(query, title, tags, category) {
    const queries = [];

    if (query) queries.push(query);
    if (title) {
        const titleKeywords = extractKeywords(title);
        if (titleKeywords.length > 0) {
            queries.push(titleKeywords.join(' '));
        }
    }
    if (category && tags && tags.length > 0) {
        queries.push(`${category.toLowerCase().replace(/\s+/g, '-')} ${tags[0]}`);
    }

    if (tags) {
        if (tags.includes('javascript')) queries.push('javascript programming code');
        if (tags.includes('nodejs')) queries.push('node.js server backend');
        if (tags.includes('react')) queries.push('react javascript frontend');
        if (tags.includes('python')) queries.push('python programming development');
        if (tags.includes('database')) queries.push('database server technology');
        if (tags.includes('devops')) queries.push('devops cloud infrastructure');
    }

    return [...new Set(queries)].slice(0, 3);
}

function extractKeywords(text) {
    if (!text) return [];
    const commonWords = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'understanding', 'guide', 'tutorial', 'introduction', 'basics'];
    const words = text.toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length > 2 && !commonWords.includes(word));
    return words.slice(0, 3);
}

function selectBestImage(images, title, tags) {
    if (!images || images.length === 0) return null;

    const scoredImages = images.map(image => {
        let score = 0;
        const description = (image.description || image.alt_description || '').toLowerCase();
        const titleLower = title.toLowerCase();
        const tagsLower = tags ? tags.map(tag => tag.toLowerCase()) : [];

        titleLower.split(/\s+/).forEach(word => {
            if (word.length > 2 && description.includes(word)) {
                score += 3;
            }
        });

        tagsLower.forEach(tag => {
            if (description.includes(tag)) {
                score += 2;
            }
        });

        if (description.length > 10) score += 1;
        if (image.width && image.width >= 1000) score += 1;

        return { image, score };
    });

    scoredImages.sort((a, b) => b.score - a.score);
    return scoredImages[0].image;
}

function generateAltText(title, image) {
    const baseTitle = title.replace(/[^\w\s-]/g, '').substring(0, 50);
    const description = image.description || image.alt_description || '';
    const photographer = image.user?.name ? ` by ${image.user.name}` : '';

    if (description) {
        return `${baseTitle} - ${description.substring(0, 100)}${photographer}`.substring(0, 125);
    }
    return `${baseTitle} - Technology illustration${photographer}`.substring(0, 125);
}

function getCategoryFallbackImage(category, title) {
    const categoryImages = {
        'Backend Development': 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=800&h=400&fit=crop',
        'JavaScript': 'https://images.unsplash.com/photo-1579952363873-27d3bfad9c0d?w=800&h=400&fit=crop',
        'Web Performance': 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800&h=400&fit=crop',
        'AI for Developers': 'https://images.unsplash.com/photo-1677442136019-21780ecad995?w=800&h=400&fit=crop',
        'DevOps': 'https://images.unsplash.com/photo-1618477388954-7852f32655ec?w=800&h=400&fit=crop',
        'Career & Learning': 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=800&h=400&fit=crop'
    };

    const fallbackUrl = categoryImages[category] || 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=800&h=400&fit=crop';

    return {
        image_url: fallbackUrl,
        source: 'unsplash-fallback',
        alt_text: `${title || 'Tech article'} - ${category || 'Technology'} illustration`,
        photographer: 'Unsplash',
        unsplash_url: null
    };
}

module.exports = { fetchImage };
