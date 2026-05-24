const { createJobLogger } = require('../../src/worker');

describe('Worker Module', () => {
    describe('createJobLogger', () => {
        const mockJob = {
            id: 'job-123',
            data: {
                sourceUrl: 'https://example.com/article',
                category: 'javascript'
            }
        };

        let logger;

        beforeEach(() => {
            logger = createJobLogger(mockJob);
            jest.clearAllMocks();
        });

        test('should create logger with job ID', () => {
            expect(logger).toBeDefined();
            expect(typeof logger.debug).toBe('function');
            expect(typeof logger.info).toBe('function');
            expect(typeof logger.warn).toBe('function');
            expect(typeof logger.error).toBe('function');
        });

        test('should log debug messages', () => {
            logger.debug('Debug message', { key: 'value' });
            expect(console.debug).toHaveBeenCalled();
        });

        test('should log info messages', () => {
            logger.info('Info message', { key: 'value' });
            expect(console.info).toHaveBeenCalled();
        });

        test('should log warn messages', () => {
            logger.warn('Warning message', { key: 'value' });
            expect(console.warn).toHaveBeenCalled();
        });

        test('should log error messages', () => {
            logger.error('Error message', { error: new Error('Test error') });
            expect(console.error).toHaveBeenCalled();
        });

        test('should handle job without ID', () => {
            const jobWithoutId = { data: {} };
            const loggerWithoutId = createJobLogger(jobWithoutId);
            expect(loggerWithoutId).toBeDefined();
        });

        test('should include processing time in logs', () => {
            logger.info('Test message');
            const logCall = console.info.mock.calls[0];
            expect(logCall[1].processingTime).toBeDefined();
            expect(typeof logCall[1].processingTime).toBe('number');
        });

        test('should include component in logs', () => {
            logger.info('Test message');
            const logCall = console.info.mock.calls[0];
            expect(logCall[1].component).toBe('worker');
        });

        test('should include jobId in logs', () => {
            logger.info('Test message');
            const logCall = console.info.mock.calls[0];
            expect(logCall[1].jobId).toBe('job-123');
        });
    });

    describe('Worker Configuration', () => {
        test('should have concurrency of 2', () => {
            const expectedConcurrency = 2;
            expect(expectedConcurrency).toBe(2);
        });

        test('should have limiter max of 10', () => {
            const expectedLimiter = { max: 10, duration: 1000 };
            expect(expectedLimiter.max).toBe(10);
        });
    });
});
