const OpenAI = require('openai');
const slugify = require('slugify');
const { sanitizeContent, validateContent } = require('./contentSanitizer');
const { AIError, AppError } = require('../errors/errors');
const { loadConfig } = require('../config');
const { captureError, captureMessage } = require('../plugins/sentry');

function createLogger(component) {
    return {
        debug: (message, context = {}) => console.debug(`[${component}] [DEBUG] ${message}`, { component, ...context }),
        info: (message, context = {}) => console.info(`[${component}] [INFO] ${message}`, { component, ...context }),
        warn: (message, context = {}) => console.warn(`[${component}] [WARN] ${message}`, { component, ...context }),
        error: (message, context = {}) => console.error(`[${component}] [ERROR] ${message}`, { component, ...context })
    };
}

const logger = createLogger('ai');

let openaiClient = null;

function getOpenAIClient() {
    if (!openaiClient) {
        const config = loadConfig();
        if (!config.OPENAI_API_KEY) {
            throw new AIError('API_KEY_MISSING', { service: 'OpenAI' });
        }
        openaiClient = new OpenAI({ apiKey: config.OPENAI_API_KEY });
    }
    return openaiClient;
}

async function generatePostFromSource(rawContent, category, sourceUrl) {
    const config = loadConfig();

    if (!rawContent || rawContent.length < 50) {
        throw new AIError('CONTENT_TOO_SHORT', { sourceUrl, length: rawContent?.length || 0 });
    }

    const prompt = `
    Transform the provided source content into a high-quality, original, SEO-optimized blog post for a developer-focused tech blog.

    IMPORTANT RULES:
    - Do NOT copy sentences directly from the source
    - Rewrite everything in your own words
    - Keep the content factual and accurate
    - Write clearly for beginner to intermediate developers
    - Do not mention the original source
    - Do not include promotional language
    - Do not hallucinate facts

    CONTENT REQUIREMENTS:
    - Article length: 1,500–3,000 characters (approximately 300-600 words)
    - Educational and explanatory with practical insights
    - Provide at least 1–2 concrete takeaways or actionable advice
    - Tone: professional, clear, beginner-friendly but technically accurate
    - Evergreen content (not news-focused or time-sensitive)

    REQUIRED CONTENT STRUCTURE:
    1. Introduction: Provide context and explain why the topic matters
    2. Core Explanation: Break down concepts with examples where applicable
    3. Practical Insights: Share takeaways, best practices, or implementation tips
    4. Short Conclusion: Summarize key points and next steps

    OUTPUT FORMAT:
    Return your response strictly in valid JSON.
    Do NOT include explanations, markdown fences, or extra text.

    JSON STRUCTURE:
    {
      "title": "",
      "slug": "",
      "metaDescription": "",
      "summary": "",
      "content": "",
      "tags": [],
      "category": ""
    }

    FIELD GUIDELINES:
    - title: Clear and descriptive, 60 characters or less, SEO-friendly
    - slug: URL-safe, lowercase, hyphen-separated
    - metaDescription: 140–160 characters
    - summary: 2–3 sentences for previews
    - content: Well-structured HTML with proper heading hierarchy
    - tags: 5–8 relevant tags, lowercase
    - category: One of: "Backend Development", "JavaScript", "Web Performance", "AI for Developers", "DevOps", "Career & Learning"

    SOURCE CONTENT TO TRANSFORM:
    ${rawContent.substring(0, 4000)}
    `;

    try {
        const client = getOpenAIClient();
        logger.debug('Calling OpenAI API', { model: config.OPENAI_MODEL || 'gpt-4o-mini', sourceUrl });

        const response = await client.chat.completions.create({
            model: config.OPENAI_MODEL || 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 4000,
            temperature: 0.7
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
            throw new AIError('INVALID_RESPONSE', { reason: 'Empty response from OpenAI' });
        }

        let generated;
        try {
            generated = JSON.parse(content.trim());
        } catch (parseError) {
            logger.error('JSON parsing failed', { error: parseError.message, content: content.substring(0, 100) });
            throw new AIError('INVALID_RESPONSE', { reason: 'Invalid JSON in AI response' });
        }

        if (generated.content) {
            generated.content = sanitizeContent(generated.content);
            if (!validateContent(generated.content)) {
                throw new AIError('CONTENT_VALIDATION_FAILED', { reason: 'Generated content failed quality check' });
            }
        }

        if (!generated.slug) {
            generated.slug = slugify(generated.title, { lower: true, strict: true });
        }

        if (!generated.title || !generated.content || !generated.summary || !generated.category) {
            throw new AIError('INVALID_RESPONSE', { reason: 'Missing required fields in AI response' });
        }

        logger.info('Content generated successfully', { title: generated.title, category: generated.category });
        captureMessage('AI content generated', 'info', { title: generated.title, category: generated.category });

        return generated;

    } catch (error) {
        if (error instanceof AIError) {
            captureError(error, { component: 'ai', sourceUrl });
            throw error;
        }

        if (error.status === 429 || error.code === 'rate_limit_exceeded') {
            logger.error('OpenAI rate limit exceeded');
            captureMessage('OpenAI rate limit exceeded', 'warning', { sourceUrl });
            throw new AIError('QUOTA_EXCEEDED', { sourceUrl });
        }

        logger.error('OpenAI request failed', { error: error.message, sourceUrl });
        captureError(error, { component: 'ai', sourceUrl });
        throw new AIError('GENERATION_FAILED', { sourceUrl, originalError: error.message });
    }
}

module.exports = { generatePostFromSource };
