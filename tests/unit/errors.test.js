const {
    ErrorCodes,
    AppError,
    AuthenticationError,
    ValidationError,
    DatabaseError,
    QueueError,
    ExternalAPIError,
    AIError,
    ContentError,
    createErrorResponse
} = require('../../src/utils/errors');

describe('Error Utilities', () => {
    describe('ErrorCodes', () => {
        test('should have AUTHENTICATION errors', () => {
            expect(ErrorCodes.AUTHENTICATION.MISSING_API_KEY).toBeDefined();
            expect(ErrorCodes.AUTHENTICATION.MISSING_API_KEY.code).toBe('AUTH_001');
        });

        test('should have VALIDATION errors', () => {
            expect(ErrorCodes.VALIDATION.INVALID_INPUT).toBeDefined();
            expect(ErrorCodes.VALIDATION.INVALID_EMAIL).toBeDefined();
        });

        test('should have DATABASE errors', () => {
            expect(ErrorCodes.DATABASE.CONNECTION_FAILED).toBeDefined();
            expect(ErrorCodes.DATABASE.NOT_FOUND).toBeDefined();
        });

        test('should have QUEUE errors', () => {
            expect(ErrorCodes.QUEUE.JOB_ADD_FAILED).toBeDefined();
            expect(ErrorCodes.QUEUE.JOB_PROCESSING_FAILED).toBeDefined();
        });

        test('should have EXTERNAL errors', () => {
            expect(ErrorCodes.EXTERNAL.API_REQUEST_FAILED).toBeDefined();
            expect(ErrorCodes.EXTERNAL.API_RATE_LIMITED).toBeDefined();
        });

        test('should have AI errors', () => {
            expect(ErrorCodes.AI.GENERATION_FAILED).toBeDefined();
            expect(ErrorCodes.AI.INVALID_RESPONSE).toBeDefined();
        });

        test('should have CONTENT errors', () => {
            expect(ErrorCodes.CONTENT.SOURCE_FETCH_FAILED).toBeDefined();
            expect(ErrorCodes.CONTENT.CONTENT_TOO_SHORT).toBeDefined();
        });
    });

    describe('AppError', () => {
        test('should create error with correct properties', () => {
            const error = new AppError(
                ErrorCodes.DATABASE.CONNECTION_FAILED,
                'Custom message',
                { connection: 'mongodb' }
            );

            expect(error.message).toBe('Custom message');
            expect(error.code).toBe('DB_001');
            expect(error.httpStatus).toBe(503);
            expect(error.context).toEqual({ connection: 'mongodb' });
            expect(error.timestamp).toBeDefined();
        });

        test('should use default message when not provided', () => {
            const error = new AppError(ErrorCodes.DATABASE.CONNECTION_FAILED);
            expect(error.message).toBe('Database connection failed');
        });

        test('should serialize to JSON correctly', () => {
            const error = new AppError(
                ErrorCodes.VALIDATION.INVALID_INPUT,
                'Test error',
                { field: 'email' }
            );

            const json = error.toJSON();

            expect(json.success).toBeUndefined();
            expect(json.error.code).toBe('VAL_001');
            expect(json.error.message).toBe('Test error');
            expect(json.error.statusCode).toBe(400);
            expect(json.error.context).toEqual({ field: 'email' });
        });

        test('should create log object', () => {
            const error = new AppError(
                ErrorCodes.QUEUE.JOB_PROCESSING_FAILED,
                'Job failed',
                { jobId: '123' }
            );

            const logObj = error.toLog();

            expect(logObj.code).toBe('Q_002');
            expect(logObj.httpStatus).toBe(500);
            expect(logObj.stack).toBeDefined();
        });
    });

    describe('AuthenticationError', () => {
        test('should create authentication error', () => {
            const error = new AuthenticationError('MISSING_API_KEY', { ip: '127.0.0.1' });

            expect(error.code).toBe('AUTH_001');
            expect(error.httpStatus).toBe(401);
            expect(error.context).toEqual({ ip: '127.0.0.1' });
        });
    });

    describe('ValidationError', () => {
        test('should create validation error', () => {
            const error = new ValidationError('INVALID_EMAIL', { email: 'invalid' });

            expect(error.code).toBe('VAL_003');
            expect(error.httpStatus).toBe(400);
        });
    });

    describe('DatabaseError', () => {
        test('should create database error', () => {
            const error = new DatabaseError('QUERY_FAILED', { query: 'find()' });

            expect(error.code).toBe('DB_002');
            expect(error.httpStatus).toBe(500);
        });
    });

    describe('QueueError', () => {
        test('should create queue error', () => {
            const error = new QueueError('QUEUE_NOT_AVAILABLE');

            expect(error.code).toBe('Q_003');
            expect(error.httpStatus).toBe(503);
        });
    });

    describe('ExternalAPIError', () => {
        test('should create external API error', () => {
            const error = new ExternalAPIError('API_RATE_LIMITED', { service: 'OpenAI' });

            expect(error.code).toBe('EXT_002');
            expect(error.httpStatus).toBe(429);
        });
    });

    describe('AIError', () => {
        test('should create AI error', () => {
            const error = new AIError('QUOTA_EXCEEDED');

            expect(error.code).toBe('AI_003');
            expect(error.httpStatus).toBe(429);
        });
    });

    describe('ContentError', () => {
        test('should create content error', () => {
            const error = new ContentError('CONTENT_TOO_SHORT');

            expect(error.code).toBe('CONT_003');
            expect(error.httpStatus).toBe(400);
        });
    });

    describe('createErrorResponse', () => {
        test('should create standardized error response', () => {
            const error = new AppError(
                ErrorCodes.VALIDATION.INVALID_INPUT,
                'Test error'
            );

            const response = createErrorResponse(error, 'req_123');

            expect(response.success).toBe(false);
            expect(response.error.code).toBe('VAL_001');
            expect(response.error.message).toBe('Test error');
            expect(response.error.statusCode).toBe(400);
            expect(response.error.requestId).toBe('req_123');
            expect(response.error.timestamp).toBeDefined();
        });

        test('should handle errors without requestId', () => {
            const error = new AppError(ErrorCodes.DATABASE.CONNECTION_FAILED);
            const response = createErrorResponse(error);

            expect(response.success).toBe(false);
            expect(response.error.requestId).toBeUndefined();
        });
    });
});
