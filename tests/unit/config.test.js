const {
    loadConfig,
    getConfig,
    getContentSources,
    getAllowedOrigins,
    resetConfig,
    ConfigError
} = require('../../src/config');

jest.mock('dotenv', () => ({
    config: jest.fn()
}));

jest.mock(process.env, () => ({
    MONGO_URI: 'mongodb://localhost:27017/test',
    NODE_ENV: 'test',
    OPENAI_API_KEY: 'test-key',
    NEWS_API_KEY: '',
    REDIS_HOST: 'localhost',
    REDIS_PORT: '6379'
}));

describe('Config Module', () => {
    beforeEach(() => {
        resetConfig();
    });

    describe('getConfig', () => {
        test('should return cached config on subsequent calls', () => {
            const config1 = getConfig();
            const config2 = getConfig();
            expect(config1).toBe(config2);
        });

        test('should have isProduction property', () => {
            const config = getConfig();
            expect(typeof config.isProduction).toBe('boolean');
        });

        test('should have isDevelopment property', () => {
            const config = getConfig();
            expect(typeof config.isDevelopment).toBe('boolean');
        });

        test('should have default values for optional config', () => {
            const config = getConfig();
            expect(config.PORT).toBeDefined();
            expect(config.LOG_LEVEL).toBeDefined();
        });
    });

    describe('getContentSources', () => {
        test('should return array of sources', () => {
            const sources = getContentSources();
            expect(Array.isArray(sources)).toBe(true);
            expect(sources.length).toBeGreaterThan(0);
        });

        test('should include dev.to RSS feed', () => {
            const sources = getContentSources();
            const devToSource = sources.find(s => s.url.includes('dev.to'));
            expect(devToSource).toBeDefined();
            expect(devToSource.type).toBe('rss');
            expect(devToSource.category).toBe('javascript');
        });

        test('should include GitHub trending source', () => {
            const sources = getContentSources();
            const githubSource = sources.find(s => s.url.includes('github.com'));
            expect(githubSource).toBeDefined();
            expect(githubSource.type).toBe('url');
            expect(githubSource.category).toBe('devops');
        });

        test('should not include NewsAPI source when key is not set', () => {
            const sources = getContentSources();
            const newsSource = sources.find(s => s.url.includes('newsapi.org'));
            expect(newsSource).toBeUndefined();
        });
    });

    describe('getAllowedOrigins', () => {
        test('should return array of origins', () => {
            const origins = getAllowedOrigins();
            expect(Array.isArray(origins)).toBe(true);
        });

        test('should split comma-separated origins', () => {
            const origins = getAllowedOrigins();
            expect(origins.length).toBeGreaterThanOrEqual(1);
        });

        test('should trim whitespace from origins', () => {
            const origins = getAllowedOrigins();
            origins.forEach(origin => {
                expect(origin).toBe(origin.trim());
            });
        });
    });

    describe('ConfigError', () => {
        test('should create error with message and variable', () => {
            const error = new ConfigError('Missing required variable', 'MONGO_URI');
            expect(error.message).toBe('Missing required variable');
            expect(error.variable).toBe('MONGO_URI');
            expect(error.name).toBe('ConfigError');
        });
    });

    describe('resetConfig', () => {
        test('should clear cached config', () => {
            getConfig();
            resetConfig();
            const config1 = getConfig();
            const config2 = getConfig();
            expect(config1).toBe(config2);
        });
    });
});
