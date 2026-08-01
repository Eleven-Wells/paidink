const ReadService = require('../../src/services/ReadService');

const ReadSession = require('../../src/models/ReadSession');
const Post = require('../../src/models/Post');
const User = require('../../src/models/User');
const Credit = require('../../src/models/Credit');
const Transaction = require('../../src/models/Transaction');
const AchievementService = require('../../src/services/AchievementService');
const InterestProfileService = require('../../src/services/InterestProfileService');
const ReaderRewardService = require('../../src/services/ads/ReaderRewardService');
const { enforceReadSpeed } = require('../../src/services/readPolicies');

jest.mock('../../src/models/ReadSession');
jest.mock('../../src/models/Post');
jest.mock('../../src/models/User');
jest.mock('../../src/models/Credit');
jest.mock('../../src/models/Transaction');
jest.mock('../../src/services/AchievementService');
jest.mock('../../src/services/InterestProfileService');
jest.mock('../../src/services/ads/ReaderRewardService');
jest.mock('../../src/services/readPolicies', () => ({
    enforceReadSpeed: jest.fn(),
    WORDS_PER_MINUTE: 200,
    MIN_READ_SPEED_FRACTION: 0.10
}));

function makeSession(overrides = {}) {
    return {
        _id: 'session-1',
        user: 'user-1',
        post: 'post-1',
        startedAt: new Date(Date.now() - 60000),
        timeSpentSeconds: 60,
        completed: false,
        rewardAwarded: false,
        rewardAmount: 0,
        calculateReward: jest.fn().mockReturnValue(500),
        save: jest.fn().mockResolvedValue(true),
        ...overrides
    };
}

function makePostQuery(overrides = {}) {
    return {
        author: null,
        stats: { reads: 0, earnings: 0 },
        save: jest.fn().mockResolvedValue(true),
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnValue(Promise.resolve({ content: 'post content' })),
        ...overrides
    };
}

function makeUser(overrides = {}) {
    return {
        _id: 'user-1',
        wallet: { balance: 100, lifetimeEarned: 100 },
        stats: { totalReads: 0, streak: 1, longestStreak: 1, lastReadDate: null },
        ...overrides
    };
}

function mockUserFindById(user) {
    User.findById.mockReturnValue({
        select: jest.fn().mockReturnValue(Promise.resolve(user))
    });
}

describe('ReadService.completeSession', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        enforceReadSpeed.mockReturnValue(true);
        Post.findById.mockReturnValue(makePostQuery());
    });

    test('returns null when no active session exists (404 / wrong user / already completed)', async () => {
        ReadSession.findOne.mockResolvedValue(null);

        const result = await ReadService.completeSession({ userId: 'user-1', sessionId: 'session-1' });

        expect(result).toBeNull();
        expect(ReadSession.findOne).toHaveBeenCalledWith({
            _id: 'session-1',
            user: 'user-1',
            completed: false
        });
    });

    test('speed gate: completes session without reward and runs no side effects', async () => {
        const session = makeSession();
        ReadSession.findOne.mockResolvedValue(session);
        enforceReadSpeed.mockReturnValue(false);

        const result = await ReadService.completeSession({ userId: 'user-1', sessionId: 'session-1' });

        expect(result).toEqual({
            reason: 'speed_gate',
            timeSpent: 60,
            rewardAwarded: false,
            rewardAmount: 0
        });
        expect(session.completed).toBe(true);
        expect(session.rewardAwarded).toBe(false);
        expect(session.rewardAmount).toBe(0);
        expect(session.save).toHaveBeenCalledTimes(1);
        expect(ReaderRewardService.processReadCompletion).not.toHaveBeenCalled();
        expect(User.findOneAndUpdate).not.toHaveBeenCalled();
        expect(Credit.earnCredit).not.toHaveBeenCalled();
        expect(Transaction.create).not.toHaveBeenCalled();
        expect(AchievementService.checkReadingAchievements).not.toHaveBeenCalled();
        expect(InterestProfileService.updateOnReadCompletion).not.toHaveBeenCalled();
    });

    test('rewarded: pays reward, updates streak, credits user and author, records Transaction with correct balances, updates post and interest profile', async () => {
        const session = makeSession();
        const user = makeUser();
        ReadSession.findOne.mockResolvedValue(session);
        mockUserFindById(user);
        User.findOneAndUpdate.mockResolvedValue(user);
        ReaderRewardService.processReadCompletion.mockImplementation(async (currentUser) => {
            currentUser.wallet.balance += 10;
            return { paid: true, amount: 10, balance: currentUser.wallet.balance };
        });
        Credit.earnCredit.mockResolvedValue(true);
        Transaction.create.mockResolvedValue(true);
        AchievementService.checkReadingAchievements.mockResolvedValue([]);

        const result = await ReadService.completeSession({ userId: 'user-1', sessionId: 'session-1' });

        expect(result).toEqual({
            reason: 'rewarded',
            timeSpent: 60,
            rewardAwarded: true,
            rewardAmount: 10
        });
        expect(ReaderRewardService.processReadCompletion).toHaveBeenCalledTimes(1);
        expect(User.findOneAndUpdate).toHaveBeenCalledTimes(1);
        expect(Credit.earnCredit).toHaveBeenCalled();
        expect(AchievementService.checkReadingAchievements).toHaveBeenCalledWith('user-1');
        expect(session.rewardAwarded).toBe(true);
        expect(session.rewardAmount).toBe(10);
        expect(session.save).toHaveBeenCalledTimes(1);
    });

    test('records Transaction with correct balanceBefore/balanceAfter (#3)', async () => {
        const session = makeSession();
        const user = makeUser({ wallet: { balance: 100, lifetimeEarned: 100 } });
        ReadSession.findOne.mockResolvedValue(session);
        mockUserFindById(user);
        ReaderRewardService.processReadCompletion.mockImplementation(async (currentUser) => {
            currentUser.wallet.balance += 10;
            return { paid: true, amount: 10, balance: currentUser.wallet.balance };
        });
        Transaction.create.mockResolvedValue(true);

        await ReadService.completeSession({ userId: 'user-1', sessionId: 'session-1' });

        expect(Transaction.create).toHaveBeenCalledWith(expect.objectContaining({
            user: 'user-1',
            type: 'read_reward',
            amount: 10,
            balanceBefore: 100,
            balanceAfter: 110,
            status: 'completed',
            relatedRead: 'session-1'
        }));
    });

    test('reward failure: completes session unpaid, skips money/history writes, still updates interest profile', async () => {
        const session = makeSession();
        const user = makeUser();
        ReadSession.findOne.mockResolvedValue(session);
        mockUserFindById(user);
        ReaderRewardService.processReadCompletion.mockRejectedValue(new Error('pool exhausted'));
        InterestProfileService.updateOnReadCompletion.mockResolvedValue(true);

        const result = await ReadService.completeSession({ userId: 'user-1', sessionId: 'session-1' });

        expect(result).toEqual({
            reason: 'reward_failed',
            timeSpent: 60,
            rewardAwarded: false,
            rewardAmount: 0
        });
        expect(session.rewardAwarded).toBe(false);
        expect(session.rewardAmount).toBe(0);
        expect(session.save).toHaveBeenCalledTimes(1);
        expect(User.findOneAndUpdate).not.toHaveBeenCalled();
        expect(Credit.earnCredit).not.toHaveBeenCalled();
        expect(Transaction.create).not.toHaveBeenCalled();
        expect(AchievementService.checkReadingAchievements).not.toHaveBeenCalled();
        expect(InterestProfileService.updateOnReadCompletion).toHaveBeenCalledTimes(1);
    });

    test('Transaction.create failure propagates and the session is NOT finalized (current behavior)', async () => {
        const session = makeSession();
        const user = makeUser();
        ReadSession.findOne.mockResolvedValue(session);
        mockUserFindById(user);
        ReaderRewardService.processReadCompletion.mockImplementation(async (currentUser) => {
            currentUser.wallet.balance += 10;
            return { paid: true, amount: 10, balance: currentUser.wallet.balance };
        });
        Transaction.create.mockRejectedValue(new Error('db down'));

        await expect(
            ReadService.completeSession({ userId: 'user-1', sessionId: 'session-1' })
        ).rejects.toThrow('db down');
        expect(session.save).not.toHaveBeenCalled();
        expect(InterestProfileService.updateOnReadCompletion).not.toHaveBeenCalled();
    });
});
