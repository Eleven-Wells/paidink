const ErrorCodes = {
    AUTHENTICATION: {
        MISSING_API_KEY: { code: 'AUTH_001', message: 'Missing API key', httpStatus: 401 },
        INVALID_API_KEY: { code: 'AUTH_002', message: 'Invalid API key', httpStatus: 401 },
        ADMIN_NOT_CONFIGURED: { code: 'AUTH_003', message: 'Admin API not configured', httpStatus: 503 },
        SESSION_EXPIRED: { code: 'AUTH_004', message: 'Session expired', httpStatus: 401 }
    },
    VALIDATION: {
        INVALID_INPUT: { code: 'VAL_001', message: 'Invalid input', httpStatus: 400 },
        MISSING_REQUIRED_FIELD: { code: 'VAL_002', message: 'Missing required field', httpStatus: 400 },
        INVALID_EMAIL: { code: 'VAL_003', message: 'Invalid email format', httpStatus: 400 },
        INPUT_TOO_LONG: { code: 'VAL_004', message: 'Input exceeds maximum length', httpStatus: 400 },
        INVALID_ID: { code: 'VAL_005', message: 'Invalid ID format', httpStatus: 400 }
    },
    DATABASE: {
        CONNECTION_FAILED: { code: 'DB_001', message: 'Database connection failed', httpStatus: 503 },
        QUERY_FAILED: { code: 'DB_002', message: 'Database query failed', httpStatus: 500 },
        DUPLICATE_ENTRY: { code: 'DB_003', message: 'Duplicate entry', httpStatus: 409 },
        NOT_FOUND: { code: 'DB_004', message: 'Resource not found', httpStatus: 404 }
    },
    QUEUE: {
        JOB_ADD_FAILED: { code: 'Q_001', message: 'Failed to add job to queue', httpStatus: 500 },
        JOB_PROCESSING_FAILED: { code: 'Q_002', message: 'Job processing failed', httpStatus: 500 },
        QUEUE_NOT_AVAILABLE: { code: 'Q_003', message: 'Queue service not available', httpStatus: 503 }
    },
    EXTERNAL: {
        API_REQUEST_FAILED: { code: 'EXT_001', message: 'External API request failed', httpStatus: 502 },
        API_RATE_LIMITED: { code: 'EXT_002', message: 'External API rate limited', httpStatus: 429 },
        API_KEY_MISSING: { code: 'EXT_003', message: 'API key not configured', httpStatus: 503 },
        FETCH_FAILED: { code: 'EXT_004', message: 'Failed to fetch external resource', httpStatus: 502 }
    },
    AI: {
        GENERATION_FAILED: { code: 'AI_001', message: 'AI content generation failed', httpStatus: 500 },
        INVALID_RESPONSE: { code: 'AI_002', message: 'Invalid AI response', httpStatus: 500 },
        QUOTA_EXCEEDED: { code: 'AI_003', message: 'AI API quota exceeded', httpStatus: 429 }
    },
    CONTENT: {
        SOURCE_FETCH_FAILED: { code: 'CONT_001', message: 'Failed to fetch content source', httpStatus: 502 },
        IMAGE_FETCH_FAILED: { code: 'CONT_002', message: 'Failed to fetch image', httpStatus: 502 },
        CONTENT_TOO_SHORT: { code: 'CONT_003', message: 'Content too short', httpStatus: 400 },
        CONTENT_VALIDATION_FAILED: { code: 'CONT_004', message: 'Content validation failed', httpStatus: 400 }
    },
    RATE_LIMIT: {
        EXCEEDED: { code: 'RATE_001', message: 'Rate limit exceeded', httpStatus: 429 },
        IP_BLOCKED: { code: 'RATE_002', message: 'IP temporarily blocked', httpStatus: 429 }
    },
    INTERNAL: {
        UNEXPECTED_ERROR: { code: 'INT_001', message: 'An unexpected error occurred', httpStatus: 500 },
        NOT_IMPLEMENTED: { code: 'INT_002', message: 'Feature not implemented', httpStatus: 501 },
        CONFIGURATION_ERROR: { code: 'INT_003', message: 'Configuration error', httpStatus: 500 }
    }
};

class AppError extends Error {
    constructor(errorDef, customMessage = null, context = {}) {
        super(customMessage || errorDef.message);
        this.name = this.constructor.name;
        this.code = errorDef.code;
        this.httpStatus = errorDef.httpStatus;
        this.context = context;
        this.timestamp = new Date().toISOString();
        Error.captureStackTrace(this, this.constructor);
    }

    toJSON() {
        return {
            error: {
                code: this.code,
                message: this.message,
                statusCode: this.httpStatus,
                timestamp: this.timestamp,
                ...(Object.keys(this.context).length > 0 && { context: this.context })
            }
        };
    }

    toLog() {
        return {
            code: this.code,
            message: this.message,
            httpStatus: this.httpStatus,
            context: this.context,
            timestamp: this.timestamp,
            stack: this.stack
        };
    }
}

class AuthenticationError extends AppError {
    constructor(type = 'MISSING_API_KEY', context = {}) {
        super(ErrorCodes.AUTHENTICATION[type], null, context);
    }
}

class ValidationError extends AppError {
    constructor(type = 'INVALID_INPUT', context = {}) {
        super(ErrorCodes.VALIDATION[type], null, context);
    }
}

class DatabaseError extends AppError {
    constructor(type = 'QUERY_FAILED', context = {}) {
        super(ErrorCodes.DATABASE[type], null, context);
    }
}

class QueueError extends AppError {
    constructor(type = 'JOB_PROCESSING_FAILED', context = {}) {
        super(ErrorCodes.QUEUE[type], null, context);
    }
}

class ExternalAPIError extends AppError {
    constructor(type = 'API_REQUEST_FAILED', context = {}) {
        super(ErrorCodes.EXTERNAL[type], null, context);
    }
}

class AIError extends AppError {
    constructor(type = 'GENERATION_FAILED', context = {}) {
        super(ErrorCodes.AI[type], null, context);
    }
}

class ContentError extends AppError {
    constructor(type = 'SOURCE_FETCH_FAILED', context = {}) {
        super(ErrorCodes.CONTENT[type], null, context);
    }
}

function createErrorResponse(error, requestId = null) {
    const response = {
        success: false,
        error: {
            code: error.code || 'INT_001',
            message: error.message || 'An unexpected error occurred',
            statusCode: error.httpStatus || 500,
            timestamp: error.timestamp || new Date().toISOString()
        }
    };

    if (requestId) {
        response.error.requestId = requestId;
    }

    if (process.env.NODE_ENV === 'development' && error.stack) {
        response.error.stack = error.stack;
    }

    return response;
}

module.exports = {
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
};
