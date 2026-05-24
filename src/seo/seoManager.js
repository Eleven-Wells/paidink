const fs = require('fs').promises;
const path = require('path');
const Post = require('../models/Post');
const { loadConfig } = require('../config');

const isServerless = !!process.env.VERCEL || !!process.env.SERVERLESS;

async function buildSitemapXml() {
    const config = loadConfig();
    const posts = await Post.find({}).sort({ publishedAt: -1 });
    const baseUrl = (config.BASE_URL || '').replace(/\/$/, '');

    const categoryPages = [
        { slug: 'backend', name: 'Backend Development' },
        { slug: 'javascript', name: 'JavaScript' },
        { slug: 'performance', name: 'Web Performance' },
        { slug: 'ai-tools', name: 'AI for Developers' },
        { slug: 'devops', name: 'DevOps' },
        { slug: 'career', name: 'Career & Learning' }
    ];

    const staticPages = [
        { slug: 'about', priority: '0.5' },
        { slug: 'contact', priority: '0.5' },
        { slug: 'privacy', priority: '0.3' },
        { slug: 'terms', priority: '0.3' },
        { slug: 'browse', priority: '0.7' },
        { slug: 'register', priority: '0.6' },
        { slug: 'login', priority: '0.6' }
    ];

    const today = new Date().toISOString().split('T')[0];

    let sitemapContent = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9
        http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd">

    <url>
        <loc>${baseUrl}/</loc>
        <lastmod>${today}</lastmod>
        <changefreq>daily</changefreq>
        <priority>1.0</priority>
    </url>
`;

    for (const category of categoryPages) {
        sitemapContent += `
    <url>
        <loc>${baseUrl}/category/${category.slug}</loc>
        <lastmod>${today}</lastmod>
        <changefreq>weekly</changefreq>
        <priority>0.8</priority>
    </url>
`;
    }

    for (const page of staticPages) {
        sitemapContent += `
    <url>
        <loc>${baseUrl}/${page.slug}</loc>
        <lastmod>${today}</lastmod>
        <changefreq>monthly</changefreq>
        <priority>${page.priority}</priority>
    </url>
`;
    }

    for (const post of posts) {
        const lastmod = post.publishedAt ? new Date(post.publishedAt).toISOString().split('T')[0] : today;
        const daysSincePublished = post.publishedAt
            ? Math.floor((new Date() - new Date(post.publishedAt)) / (7 * 24 * 60 * 60 * 1000))
            : 30;
        const priority = daysSincePublished < 7 ? '0.9' : '0.7';

        sitemapContent += `
    <url>
        <loc>${baseUrl}/post/${post.slug}</loc>
        <lastmod>${lastmod}</lastmod>
        <changefreq>monthly</changefreq>
        <priority>${priority}</priority>
    </url>
`;
    }

    sitemapContent += '\n</urlset>';
    return { content: sitemapContent, postCount: posts.length };
}

async function generateSitemap() {
    try {
        const { content, postCount } = await buildSitemapXml();

        if (isServerless) {
            console.log('[SEO] Serverless runtime detected; skipping sitemap file write.');
            return true;
        }

        const publicDir = path.join(__dirname, '../../public');
        await fs.mkdir(publicDir, { recursive: true });
        await fs.writeFile(path.join(publicDir, 'sitemap.xml'), content, 'utf8');

        console.log(`[SEO] Generated sitemap with ${postCount} posts`);
        return true;
    } catch (error) {
        console.error('[SEO] Failed to generate sitemap:', error);
        return false;
    }
}

async function pingSearchEngines() {
    const config = loadConfig();
    const sitemapUrl = `${config.BASE_URL}/sitemap.xml`;

    const searchEngines = [
        `https://www.google.com/ping?sitemap=${encodeURIComponent(sitemapUrl)}`,
        `https://www.bing.com/ping?sitemap=${encodeURIComponent(sitemapUrl)}`
    ];

    const results = [];

    for (const pingUrl of searchEngines) {
        try {
            const response = await fetch(pingUrl, {
                signal: AbortSignal.timeout(10000)
            });
            const engine = pingUrl.split('/')[2];
            if (response.ok) {
                console.log(`[SEO] Successfully pinged ${engine}`);
                results.push({ engine, success: true });
            } else {
                console.warn(`[SEO] Failed to ping ${engine}: ${response.status}`);
                results.push({ engine, success: false, status: response.status });
            }
        } catch (error) {
            const engine = pingUrl.includes('google') ? 'google' : 'bing';
            console.warn(`[SEO] Error pinging ${engine}:`, error.message);
            results.push({ engine, success: false, error: error.message });
        }
    }

    return results;
}

async function buildRobotsTxt() {
    const config = loadConfig();
    const baseUrl = (config.BASE_URL || '').replace(/\/$/, '');

    return `User-agent: *
Allow: /

Sitemap: ${baseUrl}/sitemap.xml

Disallow: /api/private/
Disallow: /admin/
`;
}

async function generateRobotsTxt() {
    try {
        const robotsContent = await buildRobotsTxt();

        if (isServerless) {
            console.log('[SEO] Serverless runtime detected; skipping robots.txt file write.');
            return true;
        }

        const publicDir = path.join(__dirname, '../../public');
        await fs.mkdir(publicDir, { recursive: true });
        await fs.writeFile(path.join(publicDir, 'robots.txt'), robotsContent, 'utf8');

        console.log('[SEO] Generated robots.txt');
        return true;
    } catch (error) {
        console.error('[SEO] Failed to generate robots.txt:', error);
        return false;
    }
}

async function updateSEOFiles() {
    console.log('[SEO] Updating SEO files...');

    const sitemapSuccess = await generateSitemap();
    const robotsSuccess = await generateRobotsTxt();

    if (sitemapSuccess) {
        await pingSearchEngines();
    }

    return { sitemap: sitemapSuccess, robots: robotsSuccess };
}

module.exports = {
    buildSitemapXml,
    generateSitemap,
    pingSearchEngines,
    buildRobotsTxt,
    generateRobotsTxt,
    updateSEOFiles
};
