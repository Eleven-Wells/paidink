const mongoose = require('mongoose');
const User = require('../../../src/models/User');
const Post = require('../../../src/models/Post');
const ReadSession = require('../../../src/models/ReadSession');
const Credit = require('../../../src/models/Credit');
const AuditLog = require('../../../src/models/AuditLog');
const { seedDefaultData } = require('../../../src/services/ads/AdSimulationService');

let app = null;

async function boot() {
    if (app) return app;

    process.env.JWT_SECRET = process.env.JWT_SECRET || 'pages-golden-test-secret';
    process.env.BASE_URL = process.env.BASE_URL || 'https://example.test';
    process.env.PERF_LOGGING = 'true';
    process.env.PERF_CAPTURE = 'true';

    if (mongoose.connection.readyState !== 1) {
        await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27018/test_nook', {
            serverSelectionTimeoutMS: 5000
        });
    }

    await seedDefaultData();

    const { createApp } = require('../../../src/app');
    app = await createApp();
    await app.buildApp();
    await app.ready();

    return app;
}

async function shutdown() {
    if (app) {
        await app.close();
        app = null;
    }
    if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
    }
}

async function resetUserCollections() {
    await User.deleteMany({});
    await Post.deleteMany({});
    await ReadSession.deleteMany({});
    await Credit.deleteMany({});
    await AuditLog.deleteMany({});
}

async function createUser(overrides = {}) {
    const stamp = Date.now();
    const rand = Math.floor(Math.random() * 100000);
    const uname = `golden${stamp}${rand}`;
    const user = await User.create({
        email: `golden-${stamp}-${rand}@test.com`,
        username: uname,
        displayName: `Golden User ${stamp}`,
        password: 'password123',
        'wallet.balance': 0,
        'wallet.lifetimeEarned': 0,
        'wallet.pendingUnfundedReads': 0,
        'wallet.totalReaderRewards': 0,
        'stats.totalReads': 0,
        'stats.streak': 1,
        'stats.lastReadDate': null,
        'stats.longestStreak': 1,
        role: 'reader',
        isActive: true,
        ...overrides
    });
    return user;
}

async function createPost(overrides = {}) {
    const stamp = Date.now() + '-' + Math.floor(Math.random() * 100000);
    const post = await Post.create({
        title: 'Golden Post ' + stamp,
        slug: 'golden-post-' + stamp,
        summary: 'A golden post summary',
        content: '<p>Golden body paragraph one.</p><p>Golden body paragraph two.</p><p>Golden body paragraph three.</p><p>Golden body paragraph four.</p><p>Golden body paragraph five.</p><p>Golden body paragraph six.</p>',
        category: 'development',
        author: null,
        publishedAt: new Date(),
        stats: { views: 0, reads: 0, earnings: 0 },
        ...overrides
    });
    return post;
}

function bearerToken(user) {
    return app.jwt.sign({ id: user._id.toString(), email: user.email });
}

function cookieAuth(token) {
    return { cookie: `auth_token=${token}` };
}

async function goldenRequest(route, { auth = 'anon', token } = {}) {
    let headers = {};
    if (auth === 'reader' || auth === 'publisher') {
        const user = auth === 'reader' ? fixtures.reader : fixtures.publisher;
        headers = cookieAuth(bearerToken(user));
    } else if (token) {
        headers = cookieAuth(token);
    }
    return app.inject({ method: route.method || 'GET', url: route.url, headers });
}

const fixtures = { reader: null, publisher: null, posts: [] };

async function seedFixtures() {
    await resetUserCollections();
    fixtures.reader = await createUser({ role: 'reader' });
    fixtures.publisher = await createUser({ role: 'publisher', publisherStatus: 'approved' });
    fixtures.posts = [
        await createPost({ author: fixtures.publisher._id }),
        await createPost({ author: fixtures.publisher._id }),
        await createPost({ author: fixtures.reader._id })
    ];
}

module.exports = {
    boot,
    shutdown,
    seedFixtures,
    createUser,
    createPost,
    bearerToken,
    cookieAuth,
    goldenRequest,
    get app() { return app; },
    fixtures
};
