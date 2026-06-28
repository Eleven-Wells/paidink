process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.MONGO_URI = 'mongodb://localhost:27018/test_nook';
process.env.REDIS_HOST = 'localhost';
process.env.REDIS_PORT = '6379';

const mongoose = require('mongoose');

jest.setTimeout(10000);

let mongoConnected = false;
beforeAll(async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 3000 });
        mongoConnected = true;
    } catch (e) {
        console.warn('MongoDB not available — tests that mock models will still work');
    }
});

afterAll(async () => {
    if (mongoConnected) {
        await mongoose.disconnect();
        await new Promise(resolve => setTimeout(resolve, 500));
    }
});

global.console = {
    ...console,
    log: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
};
