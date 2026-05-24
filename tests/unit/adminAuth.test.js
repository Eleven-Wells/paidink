const { hashApiKey, getClientIP, generateCsrfToken, verifyCsrfToken } = require('../../src/plugins/admin-auth');

describe('Admin Auth Plugin', () => {
    describe('hashApiKey', () => {
        test('should return consistent hash for same input', () => {
            const key = 'test-api-key';
            const hash1 = hashApiKey(key);
            const hash2 = hashApiKey(key);
            expect(hash1).toBe(hash2);
        });

        test('should return different hash for different input', () => {
            const hash1 = hashApiKey('key1');
            const hash2 = hashApiKey('key2');
            expect(hash1).not.toBe(hash2);
        });

        test('should return 64 character hex string', () => {
            const hash = hashApiKey('test-key');
            expect(hash).toMatch(/^[a-f0-9]{64}$/);
        });
    });

    describe('getClientIP', () => {
        test('should extract IP from x-forwarded-for header', () => {
            const request = {
                headers: {
                    'x-forwarded-for': '192.168.1.1, 10.0.0.1'
                },
                ip: '127.0.0.1'
            };
            expect(getClientIP(request)).toBe('192.168.1.1');
        });

        test('should fall back to request.ip', () => {
            const request = {
                headers: {},
                ip: '192.168.1.100'
            };
            expect(getClientIP(request)).toBe('192.168.1.100');
        });

        test('should fall back to socket.remoteAddress', () => {
            const request = {
                headers: {},
                socket: {
                    remoteAddress: '10.0.0.50'
                }
            };
            expect(getClientIP(request)).toBe('10.0.0.50');
        });

        test('should handle single IP in x-forwarded-for', () => {
            const request = {
                headers: {
                    'x-forwarded-for': '203.0.113.50'
                }
            };
            expect(getClientIP(request)).toBe('203.0.113.50');
        });
    });

    describe('generateCsrfToken', () => {
        test('should return a hex string', () => {
            const token = generateCsrfToken('session-123');
            expect(token).toMatch(/^[a-f0-9]{64}$/);
        });

        test('should return consistent token for same session', () => {
            const token1 = generateCsrfToken('session-123');
            const token2 = generateCsrfToken('session-123');
            expect(token1).toBe(token2);
        });

        test('should return different token for different sessions', () => {
            const token1 = generateCsrfToken('session-1');
            const token2 = generateCsrfToken('session-2');
            expect(token1).not.toBe(token2);
        });
    });

    describe('verifyCsrfToken', () => {
        test('should return true for valid token', () => {
            const session = 'session-123';
            const token = generateCsrfToken(session);
            expect(verifyCsrfToken(token, session)).toBe(true);
        });

        test('should return false for invalid token', () => {
            const session = 'session-123';
            const token = generateCsrfToken(session);
            expect(verifyCsrfToken('invalid-token', session)).toBe(false);
        });

        test('should return false for wrong session', () => {
            const token = generateCsrfToken('session-1');
            expect(verifyCsrfToken(token, 'session-2')).toBe(false);
        });

        test('should return false for null/undefined inputs', () => {
            expect(verifyCsrfToken(null, 'session')).toBe(false);
            expect(verifyCsrfToken('token', null)).toBe(false);
            expect(verifyCsrfToken(null, null)).toBe(false);
        });
    });
});
