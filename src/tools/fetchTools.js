const Post = require('../models/Post');
const fetch = require('node-fetch');
const slugify = require('slugify');
const contentQueue = require('../queue/contentQueue');
const { loadConfig } = require('../config');
const { ExternalAPIError } = require('../errors/errors');
const { getCacheKey } = require('../plugins/cache');
const pLimit = require('p-limit');
const { isFeatureEnabled } = require('../config/features');

function createLogger(component) {
    return {
        debug: (message, context = {}) => console.debug(`[${component}] [DEBUG] ${message}`, { component, ...context }),
        info: (message, context = {}) => console.info(`[${component}] [INFO] ${message}`, { component, ...context }),
        warn: (message, context = {}) => console.warn(`[${component}] [WARN] ${message}`, { component, ...context }),
        error: (message, context = {}) => console.error(`[${component}] [ERROR] ${message}`, { component, ...context })
    };
}

const logger = createLogger('fetchTools');

const limit = pLimit(3);

async function fetchFromNewsAPI() {
    const config = loadConfig();

    if (!config.NEWS_API_KEY) {
        logger.debug('API key not configured, skipping NewsAPI');
        return [];
    }

    const cacheKey = getCacheKey('newsapi', { endpoint: 'technology' });

    try {
        const response = await fetch(
            'https://newsapi.org/v2/everything?q=technology&language=en&sortBy=publishedAt',
            {
                headers: {
                    'X-Api-Key': config.NEWS_API_KEY
                },
                signal: AbortSignal.timeout(10000)
            }
        );

        if (!response.ok) {
            throw new ExternalAPIError('API_REQUEST_FAILED', {
                service: 'NewsAPI',
                status: response.status,
                url: 'https://newsapi.org'
            });
        }

        const data = await response.json();

        if (data.status === 'error') {
            logger.warn('NewsAPI returned error', { message: data.message });
            return [];
        }

        if (data.articles && Array.isArray(data.articles)) {
            return data.articles.slice(0, 10).map(article => ({
                name: article.title,
                description: article.description,
                link: article.url,
                category: 'Tech News',
                source: article.source.name,
                imageUrl: article.urlToImage || 'https://via.placeholder.com/400x300?text=Tech+News',
                publishedAt: article.publishedAt
            }));
        }

        return [];
    } catch (error) {
        logger.error('NewsAPI fetch error', { error: error.message });
        return [];
    }
}

async function fetchFromDevTo() {
    try {
        const response = await fetch('https://dev.to/api/articles?tag=technology&top=10', {
            signal: AbortSignal.timeout(10000)
        });

        if (!response.ok) {
            throw new ExternalAPIError('API_REQUEST_FAILED', {
                service: 'Dev.to',
                status: response.status,
                url: 'https://dev.to/api/articles'
            });
        }

        const articles = await response.json();

        if (!Array.isArray(articles)) {
            return [];
        }

        return articles.map(article => ({
            name: article.title,
            description: article.description,
            link: article.url,
            category: 'Dev.to',
            source: 'Dev.to',
            publishedAt: article.published_at
        }));
    } catch (error) {
        logger.error('Dev.to fetch error', { error: error.message });
        return [];
    }
}

async function fetchFromGitHubTrending() {
    try {
        const response = await fetch(
            'https://api.github.com/search/repositories?q=created:>2023-10-01&sort=stars&order=desc&per_page=10',
            {
                headers: {
                    'Accept': 'application/vnd.github.v3+json',
                    'User-Agent': 'SimpleBlog/1.0'
                },
                signal: AbortSignal.timeout(15000)
            }
        );

        if (!response.ok) {
            throw new ExternalAPIError('API_REQUEST_FAILED', {
                service: 'GitHub',
                status: response.status,
                url: 'https://api.github.com/search/repositories'
            });
        }

        const data = await response.json();
        const repos = data.items?.slice(0, 10) || [];

        const repoPromises = repos.map(repo => limit(async () => {
            try {
                const readmeContent = await fetchRepoReadme(repo.full_name);
                return buildGitHubArticle(repo, readmeContent);
            } catch (error) {
                logger.error('Error processing repo', { repo: repo.full_name, error: error.message });
                return buildGitHubArticle(repo, null);
            }
        }));

        const results = await Promise.allSettled(repoPromises);
        return results
            .filter(r => r.status === 'fulfilled')
            .map(r => r.value);
    } catch (error) {
        logger.error('GitHub trending fetch error', { error: error.message });
        return [];
    }
}

async function fetchRepoReadme(fullName) {
    const readmeUrls = [
        `https://raw.githubusercontent.com/${fullName}/main/README.md`,
        `https://raw.githubusercontent.com/${fullName}/master/README.md`
    ];

    const fetchPromises = readmeUrls.map(async (url) => {
        try {
            const response = await fetch(url, {
                headers: { 'User-Agent': 'SimpleBlog/1.0' },
                signal: AbortSignal.timeout(5000)
            });
            if (response.ok) {
                return await response.text();
            }
        } catch {
            return null;
        }
        return null;
    });

    const results = await Promise.allSettled(fetchPromises);

    for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
            return result.value.substring(0, 5000);
        }
    }

    return null;
}

function buildGitHubArticle(repo, readmeContent) {
    let summary = repo.description || '';

    if (!summary && readmeContent) {
        const lines = readmeContent
            .split('\n')
            .filter(line => line.trim() && !line.startsWith('#'));
        const firstParagraph = lines.find(line => line.length > 50);
        if (firstParagraph) {
            summary = firstParagraph.substring(0, 200);
            const lastSentence = summary.lastIndexOf('.');
            if (lastSentence > 50) {
                summary = summary.substring(0, lastSentence + 1);
            }
        }
    }

    if (!summary) {
        summary = `Explore ${repo.name} - a trending GitHub project with ${repo.stargazers_count} stars`;
    }

    return {
        name: repo.name,
        description: summary,
        link: repo.html_url,
        category: 'GitHub Trending',
        source: 'GitHub',
        content: readmeContent || repo.description || `## ${repo.name}\n\n${repo.description || 'A trending GitHub project.'}\n\n**Stars:** ${repo.stargazers_count}\n**Language:** ${repo.language || 'Various'}\n\nCheck it out on GitHub: ${repo.html_url}`,
        stars: repo.stargazers_count,
        language: repo.language,
        publishedAt: repo.created_at
    };
}

async function checkDuplicatePost(name) {
    const slug = slugify(name, { lower: true, strict: true });
    const exists = await Post.findOne({ slug }).select('_id').lean();
    return exists !== null;
}

async function addToQueue(article, categoryMap) {
    if (!isFeatureEnabled('content', 'aiGeneration')) {
        console.log('[FetchTools] AI generation disabled, skipping:', article.name);
        return { status: 'skipped', reason: 'AI generation disabled', title: article.name };
    }
    
    const category = categoryMap[article.category] || 'development';
    const slug = slugify(article.name, { lower: true, strict: true });

    const exists = await Post.findOne({ slug }).select('_id').lean();
    if (exists) {
        return { status: 'skipped', reason: 'duplicate', title: article.name };
    }

    await contentQueue.add('generate-post', {
        sourceUrl: article.link || `content-${Date.now()}`,
        category,
        type: 'content',
        rawContent: article.content || article.description || '',
        title: article.name,
        source: article.source || 'Unknown'
    }, {
        jobId: `post-${slug}`
    });

    return { status: 'added', title: article.name };
}

async function fetchLatestBlog() {
    logger.info('Starting blog fetch');

    try {
        const [newsArticles, devToArticles, githubTrending] = await Promise.allSettled([
            fetchFromNewsAPI(),
            fetchFromDevTo(),
            fetchFromGitHubTrending()
        ]);

        const allArticles = [
            ...(newsArticles.status === 'fulfilled' ? newsArticles.value : []),
            ...(devToArticles.status === 'fulfilled' ? devToArticles.value : []),
            ...(githubTrending.status === 'fulfilled' ? githubTrending.value : [])
        ];

        logger.info('Fetched articles', { count: allArticles.length });

        const categoryMap = {
            'Development': 'development',
            'Business': 'business',
            'Health': 'health',
            'Lifestyle': 'lifestyle',
            'News': 'news',
            'Sports': 'sports',
            'Entertainment': 'entertainment',
            'Politics': 'politics'
        };

        const queuePromises = allArticles.map(article =>
            limit(() => addToQueue(article, categoryMap))
        );

        const results = await Promise.allSettled(queuePromises);

        const stats = {
            added: 0,
            skipped: 0,
            failed: 0,
            total: allArticles.length
        };

        for (const result of results) {
            if (result.status === 'fulfilled') {
                if (result.value.status === 'added') {
                    stats.added++;
                } else if (result.value.status === 'skipped') {
                    stats.skipped++;
                }
            } else {
                stats.failed++;
                logger.error('Queue error', { error: result.reason?.message });
            }
        }

        logger.info('Blog fetch complete', stats);
        return { success: true, ...stats };
    } catch (error) {
        logger.error('Blog fetch failed', { error: error.message });
        return { success: false, error: error.message };
    }
}

module.exports = fetchLatestBlog;
