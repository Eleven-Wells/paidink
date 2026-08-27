/**
 * @typedef {Object} GeneratedContent
 * @property {string} title - Generated title
 * @property {string} slug - URL-safe slug
 * @property {string} content - HTML content
 * @property {string} summary - Short summary
 * @property {string} metaDescription - SEO meta description
 * @property {string[]} tags - Array of tags
 * @property {string} category - AI category name
 */

/**
 * @typedef {Object} ImageData
 * @property {string} image_url - Image URL
 * @property {string} source - Image source
 * @property {string} alt_text - Alt text
 * @property {string} [unsplash_id] - Unsplash photo ID
 * @property {string} [photographer] - Photographer name
 * @property {string} [unsplash_url] - Unsplash attribution URL
 */

/**
 * @typedef {Object} JobResult
 * @property {boolean} success - Whether job succeeded
 * @property {string} [postId] - Created post ID
 * @property {string} slug - Post slug
 * @property {boolean} [duplicate] - Whether post was duplicate
 */

/**
 * Content Service - Handles content generation pipeline
 * @class ContentService
 */
const { generatePostFromSource } = require('../content/ai');
const { fetchImage } = require('../content/imageFetcher');
const { sourceContent } = require('../content/contentSourcer');
const Post = require('../models/Post');
const debug = require('../logger/debug');
const JobLog = require('../models/JobLog');
const { AppError, AIError, ContentError } = require('../errors/errors');
const { captureError, captureMessage } = require('../plugins/sentry');
const { withSession, isTransactionSupported } = require('../database/dbTransaction');
const { isFeatureEnabled } = require('../config/features');

const CATEGORY_MAP = {
    'Development': 'development',
    'Business': 'business',
    'Health': 'health',
    'Lifestyle': 'lifestyle',
    'News': 'news',
    'Sports': 'sports',
    'Entertainment': 'entertainment',
    'Politics': 'politics'
};

const FALLBACK_IMAGE = {
    image_url: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=800&h=400&fit=crop',
    source: 'fallback',
    alt_text: 'Technology illustration',
    photographer: null,
    unsplash_url: null
};

class ContentService {
    /**
     * Fetch content from a source URL
     * @param {string} sourceUrl - URL to fetch content from
     * @param {string} type - Content type ('rss' or 'url')
     * @param {Object} options - Fetch options
     * @param {number} [options.limit=3] - Max items for RSS feeds
     * @returns {Promise<string>} Raw content text
     * @throws {ContentError} If source is invalid or fetch fails
     */
    async fetchContent(sourceUrl, type, options = {}) {
        const { limit = 3 } = options;

        if (!sourceUrl || typeof sourceUrl !== 'string') {
            throw new ContentError('INVALID_SOURCE', { sourceUrl });
        }

        try {
            const contentResults = await sourceContent(sourceUrl, type, { limit });

            if (Array.isArray(contentResults) && contentResults.length > 0) {
                return contentResults
                    .map(item => `${item.title}\n\n${item.content}`)
                    .join('\n\n---\n\n');
            }

            return contentResults.content || 'No content available';
        } catch (error) {
            captureError(error, { component: 'content-service', sourceUrl });
            throw new ContentError('SOURCE_FETCH_FAILED', { sourceUrl, originalError: error.message });
        }
    }

    async generateContent(rawContent, category, sourceUrl, options = {}) {
        if (!isFeatureEnabled('content', 'aiGeneration')) {
            debug('[ContentService] AI generation disabled, skipping');
            return {
                success: false,
                skipped: true,
                reason: 'AI generation is disabled'
            };
        }
        
        const { maxRetries = 5 } = options;

        if (!rawContent || rawContent.length < 50) {
            throw new ContentError('CONTENT_TOO_SHORT', {
                sourceUrl,
                length: rawContent?.length || 0
            });
        }

        let lastError;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const generated = await generatePostFromSource(rawContent, category, sourceUrl);
                return generated;
            } catch (error) {
                lastError = error;
                if (attempt < maxRetries) {
                    const delay = error.message?.includes('rate limit') 
                        ? 60000 // 1 minute for rate limits
                        : Math.pow(2, attempt) * 1000;
                    debug(`[ContentService] Retry ${attempt}/${maxRetries} in ${delay}ms - ${error.message}`);
                    await this.sleep(delay);
                }
            }
        }

        throw new AIError('GENERATION_FAILED', {
            sourceUrl,
            attempts: maxRetries,
            originalError: lastError?.message
        });
    }

    async fetchImageForPost(title, options = {}) {
        if (!isFeatureEnabled('content', 'imageGeneration')) {
            return { ...FALLBACK_IMAGE };
        }

        const { maxRetries = 3, tags = [], category = '' } = options;

        let lastError;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const imageData = await fetchImage(title, {
                    title,
                    tags,
                    category
                });
                return imageData;
            } catch (error) {
                lastError = error;
                if (attempt < maxRetries) {
                    const delay = Math.pow(2, attempt) * 1000;
                    await this.sleep(delay);
                }
            }
        }

        captureMessage('Using fallback image after retries exhausted', 'warning', { title });
        return { ...FALLBACK_IMAGE, alt_text: `${title} - Technology illustration` };
    }

    mapCategory(aiCategory) {
        return CATEGORY_MAP[aiCategory] || 'development';
    }

    async createPost(generatedContent, imageData, options = {}) {
        const { sourceUrl = '', session = null } = options;

        const postData = {
            title: generatedContent.title,
            slug: generatedContent.slug,
            content: generatedContent.content,
            summary: generatedContent.summary,
            category: this.mapCategory(generatedContent.category),
            tags: generatedContent.tags || [],
            image: imageData.image_url,
            imageMetadata: {
                source: imageData.source,
                alt_text: imageData.alt_text,
                unsplash_id: imageData.unsplash_id,
                photographer: imageData.photographer,
                unsplash_url: imageData.unsplash_url
            },
            metaDescription: generatedContent.metaDescription,
            publishedAt: new Date()
        };

        const post = new Post(postData);
        await post.save({ session });

        return post.toObject();
    }

    async processContentJob(jobData, progressCallback) {
        if (!isFeatureEnabled('content', 'aiGeneration')) {
            throw new AppError(
                { code: 'FEAT_001', message: 'AI content generation is disabled', httpStatus: 503 },
                'Feature not enabled'
            );
        }

        const { sourceUrl, category, type, rawContent, title, source } = jobData;

        progressCallback?.(5);

        let contentToProcess = rawContent;
        if (!contentToProcess) {
            contentToProcess = await this.fetchContent(sourceUrl, type, { limit: 3 });
        }

        progressCallback?.(20);

        const generated = await this.generateContent(contentToProcess, category, sourceUrl);

        progressCallback?.(40);

        const isDuplicate = await DuplicateChecker.checkDuplicate(generated.slug);
        if (isDuplicate) {
            return { success: true, duplicate: true, slug: generated.slug };
        }

        progressCallback?.(60);

        const imageData = await this.fetchImageForPost(generated.title, {
            tags: generated.tags,
            category: generated.category
        });

        progressCallback?.(80);

        let post;
        if (isTransactionSupported()) {
            post = await withSession(async (session) => {
                const createdPost = await this.createPost(generated, imageData, { sourceUrl, session });

                await JobLog.create([{
                    jobId: jobData.jobId,
                    status: 'success',
                    sourceUrl,
                    result: `Created post: ${generated.title}`
                }], { session });

                return createdPost;
            });
        } else {
            post = await this.createPost(generated, imageData, { sourceUrl });

            await JobLog.create({
                jobId: jobData.jobId,
                status: 'success',
                sourceUrl,
                result: `Created post: ${generated.title}`
            });
        }

        progressCallback?.(100);

        captureMessage('Content job completed', 'info', {
            postId: post._id.toString(),
            category: post.category
        });

        return {
            success: true,
            postId: post._id.toString(),
            slug: generated.slug
        };
    }

    async logJobFailure(jobId, error, sourceUrl) {
        try {
            await JobLog.create({
                jobId,
                status: 'failure',
                error: error.message || String(error),
                sourceUrl
            });
        } catch (logError) {
            captureError(logError, { component: 'content-service', context: 'logJobFailure' });
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

const DuplicateChecker = {
    async checkDuplicate(slug) {
        if (!slug) return false;
        const existing = await Post.findOne({ slug }).select('_id').lean();
        return existing !== null;
    }
};

module.exports = new ContentService();
module.exports.ContentService = ContentService;
module.exports.DuplicateChecker = DuplicateChecker;
