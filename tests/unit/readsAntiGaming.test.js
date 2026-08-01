const { enforceDailyCap, enforcePostCooldown, enforceSessionGap, enforceReadSpeed } = require('../../src/services/readPolicies');
const ReadSession = require('../../src/models/ReadSession');

jest.mock('../../src/models/ReadSession');

describe('Anti-gaming measures', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('enforceDailyCap', () => {
        it('returns true when user is under daily cap', async () => {
            ReadSession.getTodayReads = jest.fn().mockResolvedValue(50);
            const result = await enforceDailyCap('user123', 100);
            expect(result).toBe(true);
        });

        it('returns false when user is at daily cap', async () => {
            ReadSession.getTodayReads = jest.fn().mockResolvedValue(100);
            const result = await enforceDailyCap('user123', 100);
            expect(result).toBe(false);
        });

        it('returns false when user exceeds daily cap', async () => {
            ReadSession.getTodayReads = jest.fn().mockResolvedValue(101);
            const result = await enforceDailyCap('user123', 100);
            expect(result).toBe(false);
        });
    });

    describe('enforcePostCooldown', () => {
        function makeThenable(value) {
            const p = Promise.resolve(value);
            p.sort = jest.fn().mockReturnValue(p);
            return p;
        }

        it('returns true when no prior session exists', async () => {
            ReadSession.findOne.mockReturnValue(makeThenable(null));
            const result = await enforcePostCooldown('user123', 'post456', 24);
            expect(result).toBe(true);
        });

        it('returns true when last read was > 24h ago', async () => {
            const oldSession = { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) };
            ReadSession.findOne.mockReturnValue(makeThenable(oldSession));
            const result = await enforcePostCooldown('user123', 'post456', 24);
            expect(result).toBe(true);
        });

        it('returns false when last read was < 24h ago', async () => {
            const recentSession = { createdAt: new Date(Date.now() - 1 * 60 * 60 * 1000) };
            ReadSession.findOne.mockReturnValue(makeThenable(recentSession));
            const result = await enforcePostCooldown('user123', 'post456', 24);
            expect(result).toBe(false);
        });
    });

    describe('enforceSessionGap', () => {
        it('returns true when no prior session', () => {
            const result = enforceSessionGap(null, 3);
            expect(result).toBe(true);
        });

        it('returns true when gap > 3 seconds', () => {
            const oldStart = new Date(Date.now() - 10000);
            const result = enforceSessionGap(oldStart, 3);
            expect(result).toBe(true);
        });

        it('returns false when gap < 3 seconds', () => {
            const recentStart = new Date(Date.now() - 1000);
            const result = enforceSessionGap(recentStart, 3);
            expect(result).toBe(false);
        });
    });

    describe('enforceReadSpeed', () => {
        it('returns true when time spent >= 10% of expected', () => {
            const result = enforceReadSpeed(20, 500, 200, 0.10);
            expect(result).toBe(true);
        });

        it('returns false when time spent < 10% of expected', () => {
            const result = enforceReadSpeed(5, 1000, 200, 0.10);
            expect(result).toBe(false);
        });

        it('returns true for very short posts', () => {
            const result = enforceReadSpeed(1, 10, 200, 0.10);
            expect(result).toBe(true);
        });
    });
});
