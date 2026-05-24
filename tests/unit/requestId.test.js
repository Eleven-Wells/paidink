const { generateRequestId, isValidRequestId, REQUEST_ID_HEADER } = require('../../src/plugins/request-id');

describe('Request ID Plugin', () => {
    describe('generateRequestId', () => {
        test('should generate unique IDs', () => {
            const id1 = generateRequestId();
            const id2 = generateRequestId();
            expect(id1).not.toBe(id2);
        });

        test('should return string', () => {
            const id = generateRequestId();
            expect(typeof id).toBe('string');
        });

        test('should contain timestamp', () => {
            const id = generateRequestId();
            expect(id).toMatch(/^[a-z0-9]+-/);
        });

        test('should have minimum length', () => {
            const id = generateRequestId();
            expect(id.length).toBeGreaterThanOrEqual(8);
        });
    });

    describe('isValidRequestId', () => {
        test('should return true for valid request IDs', () => {
            expect(isValidRequestId('req_12345678')).toBe(true);
            expect(isValidRequestId('abc12345-DEF67890')).toBe(true);
            expect(isValidRequestId('m1abc123-abcd1234')).toBe(true);
        });

        test('should return false for too short IDs', () => {
            expect(isValidRequestId('short')).toBe(false);
            expect(isValidRequestId('1234567')).toBe(false);
        });

        test('should return false for IDs with invalid characters', () => {
            expect(isValidRequestId('req_12345678!')).toBe(false);
            expect(isValidRequestId('req@12345678')).toBe(false);
            expect(isValidRequestId('req 12345678')).toBe(false);
        });

        test('should return false for null/undefined', () => {
            expect(isValidRequestId(null)).toBe(false);
            expect(isValidRequestId(undefined)).toBe(false);
        });

        test('should return false for empty string', () => {
            expect(isValidRequestId('')).toBe(false);
        });
    });

    describe('REQUEST_ID_HEADER', () => {
        test('should be x-request-id', () => {
            expect(REQUEST_ID_HEADER).toBe('x-request-id');
        });
    });
});
