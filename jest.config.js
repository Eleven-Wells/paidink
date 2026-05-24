module.exports = {
    testEnvironment: 'node',
    roots: ['<rootDir>/tests'],
    testMatch: [
        '**/*.test.js'
    ],
    collectCoverageFrom: [
        'src/**/*.js',
        '!src/server.js',
        '!src/cron.js',
        '!src/worker.js'
    ],
    coverageDirectory: 'coverage',
    coverageReporters: ['text', 'lcov', 'html'],
    setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
    testTimeout: 10000,
    verbose: true,
    forceExit: true,
    clearMocks: true,
    resetMocks: true,
    restoreMocks: true,
    modulePathIgnorePatterns: ['<rootDir>/node_modules/'],
    moduleDirectories: ['node_modules', 'src']
};
