const sanitizeHtml = require('sanitize-html');

/**
 * Sanitizes and formats HTML content for safe display
 * @param {string} html - Raw HTML content from AI
 * @returns {string} - Sanitized and formatted HTML
 */
function sanitizeContent(html) {
    if (!html || typeof html !== 'string') {
        return '';
    }

    // First, clean up any malformed HTML from AI output
    let cleanedHtml = html
        // Fix common AI formatting issues
        .replace(/```\s*(\w+)?\s*\n/g, '<pre><code>') // Convert markdown code blocks
        .replace(/```\s*$/gm, '</code></pre>') // Close code blocks
        .replace(/`([^`\n]+)`/g, '<code>$1</code>') // Convert inline code
        .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>') // Convert bold
        .replace(/\*([^*\n]+)\*/g, '<em>$1</em>') // Convert italic
        // Ensure proper paragraph structure
        .replace(/\n\n+/g, '</p><p>') // Convert double newlines to paragraphs
        .replace(/^(.+)$/gm, '<p>$1</p>') // Wrap single lines in paragraphs
        // Clean up excessive paragraph nesting
        .replace(/<\/p>\s*<p><\/p>\s*<p>/g, '</p><p>')
        .replace(/(<p><\/p>)+/g, '');

    // Sanitize HTML to prevent XSS and ensure safe content
    const sanitized = sanitizeHtml(cleanedHtml, {
        allowedTags: [
            'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
            'p', 'br', 'strong', 'em', 'u',
            'ul', 'ol', 'li',
            'blockquote', 'code', 'pre',
            'a', 'img',
            'table', 'thead', 'tbody', 'tr', 'th', 'td'
        ],
        allowedAttributes: {
            'a': ['href', 'title', 'target', 'rel'],
            'img': ['src', 'alt', 'title', 'loading', 'width', 'height'],
            'code': ['class'],
            'pre': ['class'],
            '*': ['id', 'class']
        },
        allowedSchemes: ['http', 'https', 'mailto'],
        transformTags: {
            'a': (tagName, attribs) => {
                // Ensure external links open in new tab with security
                if (attribs.href && (attribs.href.startsWith('http') || attribs.href.startsWith('//'))) {
                    return {
                        tagName,
                        attribs: {
                            ...attribs,
                            target: '_blank',
                            rel: 'noopener noreferrer'
                        }
                    };
                }
                return { tagName, attribs };
            }
        },
        // Allow some CSS classes for syntax highlighting
        allowedClasses: {
            'code': ['language-*', 'lang-*'],
            'pre': ['language-*', 'lang-*']
        }
    });

    // Final cleanup
    return sanitized
        .replace(/(<p><\/p>)+/g, '') // Remove empty paragraphs
        .replace(/(<br\s*\/?>)+/g, '<br>') // Normalize br tags
        .trim();
}

/**
 * Validates that content meets minimum quality standards
 * @param {string} content - HTML content to validate
 * @returns {boolean} - Whether content passes validation
 */
function validateContent(content) {
    if (!content || content.length < 500) {
        return false;
    }

    // Check for required HTML structure
    const hasHeadings = /<h[1-6][^>]*>/.test(content);
    const hasParagraphs = /<p[^>]*>/.test(content);
    const noBrokenTags = !/<[^>]*$/.test(content); // No unclosed tags

    return hasHeadings && hasParagraphs && noBrokenTags;
}

/**
 * Extracts plain text from HTML for search indexing
 * @param {string} html - HTML content
 * @returns {string} - Plain text version
 */
function extractTextContent(html) {
    if (!html) return '';

    return html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

module.exports = {
    sanitizeContent,
    validateContent,
    extractTextContent
};