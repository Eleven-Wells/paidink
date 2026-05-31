const {
    isValidObjectId,
    isValidCategory,
    sanitizeSearchQuery,
    CATEGORY_ENUM
} = require('../../src/plugins/validation');

describe('Validation Plugin', () => {
    describe('isValidObjectId', () => {
        test('should return true for valid ObjectId', () => {
            expect(isValidObjectId('507f1f77bcf86cd799439011')).toBe(true);
            expect(isValidObjectId('507F1F77BCF86CD799439011')).toBe(true);
        });

        test('should return false for invalid ObjectId', () => {
            expect(isValidObjectId('invalid')).toBe(false);
            expect(isValidObjectId('123')).toBe(false);
            expect(isValidObjectId('')).toBe(false);
            expect(isValidObjectId(null)).toBe(false);
            expect(isValidObjectId(undefined)).toBe(false);
        });

        test('should return false for ObjectId with wrong length', () => {
            expect(isValidObjectId('507f1f77bcf86cd79943901')).toBe(false);
            expect(isValidObjectId('507f1f77bcf86cd7994390111')).toBe(false);
        });
    });

    describe('isValidCategory', () => {
        test('should return true for valid categories', () => {
            expect(isValidCategory('backend')).toBe(true);
            expect(isValidCategory('javascript')).toBe(true);
            expect(isValidCategory('performance')).toBe(true);
            expect(isValidCategory('ai-tools')).toBe(true);
            expect(isValidCategory('devops')).toBe(true);
            expect(isValidCategory('career')).toBe(true);
        });

        test('should return false for invalid categories', () => {
            expect(isValidCategory('invalid')).toBe(false);
            expect(isValidCategory('backend ')).toBe(false);
            expect(isValidCategory('')).toBe(false);
            expect(isValidCategory(null)).toBe(false);
            expect(isValidCategory(undefined)).toBe(false);
        });
    });

    describe('sanitizeSearchQuery', () => {
        test('should remove XSS patterns', () => {
            expect(sanitizeSearchQuery('<script>alert("xss")</script>')).toBe('alert("xss")');
            expect(sanitizeSearchQuery('test onclick="evil()"')).toBe('test onclick="evil()"');
            expect(sanitizeSearchQuery('javascript:void(0)')).toBe('void(0)');
        });

        test('should trim whitespace', () => {
            expect(sanitizeSearchQuery('  test query  ')).toBe('test query');
        });

        test('should truncate to 200 characters', () => {
            const longString = 'a'.repeat(300);
            expect(sanitizeSearchQuery(longString).length).toBe(200);
        });

        test('should handle empty input', () => {
            expect(sanitizeSearchQuery('')).toBe('');
            expect(sanitizeSearchQuery(null)).toBe('');
            expect(sanitizeSearchQuery(undefined)).toBe('');
        });

        test('should preserve valid characters', () => {
            expect(sanitizeSearchQuery('React & Node.js')).toBe('React & Node.js');
            expect(sanitizeSearchQuery('c++ or c#')).toBe('c++ or c#');
        });
    });

    describe('CATEGORY_ENUM', () => {
        test('should contain all expected categories', () => {
            expect(CATEGORY_ENUM).toContain('development');
            expect(CATEGORY_ENUM).toContain('business');
            expect(CATEGORY_ENUM).toContain('health');
            expect(CATEGORY_ENUM).toContain('lifestyle');
            expect(CATEGORY_ENUM).toContain('news');
            expect(CATEGORY_ENUM).toContain('sports');
            expect(CATEGORY_ENUM).toContain('entertainment');
            expect(CATEGORY_ENUM).toContain('politics');
        });

        test('should have exactly 8 categories', () => {
            expect(CATEGORY_ENUM.length).toBe(8);
        });
    });
});
