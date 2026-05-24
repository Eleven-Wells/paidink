const { sanitizeContent, validateContent, extractTextContent } = require('../../src/utils/contentSanitizer');

describe('Content Sanitizer', () => {
    describe('sanitizeContent', () => {
        test('should return empty string for invalid input', () => {
            expect(sanitizeContent('')).toBe('');
            expect(sanitizeContent(null)).toBe('');
            expect(sanitizeContent(undefined)).toBe('');
            expect(sanitizeContent(123)).toBe('');
        });

        test('should convert markdown code blocks to HTML', () => {
            const input = '```javascript\nconst x = 1;\n```';
            const output = sanitizeContent(input);
            expect(output).toContain('<pre><code>');
            expect(output).toContain('</code></pre>');
        });

        test('should convert inline code', () => {
            const input = 'Use `console.log()` for debugging';
            const output = sanitizeContent(input);
            expect(output).toContain('<code>console.log()</code>');
        });

        test('should convert bold text', () => {
            const input = 'This is **important** text';
            const output = sanitizeContent(input);
            expect(output).toContain('<strong>important</strong>');
        });

        test('should convert italic text', () => {
            const input = 'This is *emphasized* text';
            const output = sanitizeContent(input);
            expect(output).toContain('<em>emphasized</em>');
        });

        test('should wrap paragraphs in p tags', () => {
            const input = 'First paragraph\n\nSecond paragraph';
            const output = sanitizeContent(input);
            expect(output).toContain('<p>');
            expect(output).toContain('</p>');
        });

        test('should remove script tags', () => {
            const input = 'Hello <script>alert("xss")</script> World';
            const output = sanitizeContent(input);
            expect(output).not.toContain('<script>');
            expect(output).not.toContain('alert');
        });

        test('should add security attributes to external links', () => {
            const input = '<a href="https://example.com">Link</a>';
            const output = sanitizeContent(input);
            expect(output).toContain('target="_blank"');
            expect(output).toContain('rel="noopener noreferrer"');
        });

        test('should not modify internal links', () => {
            const input = '<a href="/post/my-article">Internal Link</a>';
            const output = sanitizeContent(input);
            expect(output).not.toContain('target="_blank"');
        });

        test('should allow specific HTML tags', () => {
            const input = '<h1>Title</h1><p>Paragraph</p><ul><li>Item</li></ul>';
            const output = sanitizeContent(input);
            expect(output).toContain('<h1>');
            expect(output).toContain('<p>');
            expect(output).toContain('<ul>');
            expect(output).toContain('<li>');
        });

        test('should remove disallowed HTML tags', () => {
            const input = '<div>Hello</div><iframe src="evil.com"></iframe>';
            const output = sanitizeContent(input);
            expect(output).not.toContain('<iframe>');
        });
    });

    describe('validateContent', () => {
        test('should return false for short content', () => {
            expect(validateContent('Short')).toBe(false);
            expect(validateContent('<p>Less than 500 chars</p>')).toBe(false);
        });

        test('should return true for valid content with headings', () => {
            const validContent = `
                <h2>Main Section</h2>
                <p>This is a long paragraph with more than 500 characters to pass validation.
                Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor
                incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis
                nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.</p>
            `.repeat(5);

            expect(validateContent(validContent)).toBe(true);
        });

        test('should return false if no headings', () => {
            const contentWithoutHeadings = '<p>'.repeat(100) + 'a'.repeat(300) + '</p>'.repeat(100);
            expect(validateContent(contentWithoutHeadings)).toBe(false);
        });

        test('should return false if no paragraphs', () => {
            const contentWithoutParagraphs = '<h2>Title</h2>'.repeat(10) + 'a'.repeat(300);
            expect(validateContent(contentWithoutParagraphs)).toBe(false);
        });

        test('should return false for unclosed tags', () => {
            const contentWithUnclosedTags = '<h2>Title</h2><p>Unclosed paragraph';
            expect(validateContent(contentWithUnclosedTags)).toBe(false);
        });

        test('should return false for null/undefined input', () => {
            expect(validateContent(null)).toBe(false);
            expect(validateContent(undefined)).toBe(false);
        });
    });

    describe('extractTextContent', () => {
        test('should extract plain text from HTML', () => {
            const html = '<h1>Title</h1><p>Paragraph text</p>';
            const text = extractTextContent(html);
            expect(text).toContain('Title');
            expect(text).toContain('Paragraph text');
        });

        test('should remove script tags', () => {
            const html = '<p>Text</p><script>alert("xss")</script>';
            const text = extractTextContent(html);
            expect(text).not.toContain('alert');
        });

        test('should remove style tags', () => {
            const html = '<p>Text</p><style>.hidden { display: none; }</style>';
            const text = extractTextContent(html);
            expect(text).not.toContain('.hidden');
        });

        test('should normalize whitespace', () => {
            const html = '<p>Text   with    spaces</p>';
            const text = extractTextContent(html);
            expect(text).toBe('Text with spaces');
        });

        test('should return empty string for null/undefined', () => {
            expect(extractTextContent(null)).toBe('');
            expect(extractTextContent(undefined)).toBe('');
        });
    });
});
