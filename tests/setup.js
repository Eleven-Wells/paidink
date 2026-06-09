process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.MONGO_URI = 'mongodb://admin:password@localhost:27017/test_nook?authSource=admin';
process.env.REDIS_HOST = 'localhost';
process.env.REDIS_PORT = '6379';

const mongoose = require('mongoose');

jest.setTimeout(10000);

beforeAll(async () => {
    await mongoose.connect(process.env.MONGO_URI);
});

afterAll(async () => {
    await mongoose.disconnect();
    await new Promise(resolve => setTimeout(resolve, 500));
});

global.console = {
    ...console,
    log: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
};
