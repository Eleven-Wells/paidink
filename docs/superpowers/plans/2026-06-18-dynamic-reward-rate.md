# Dynamic Reward Rate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed 500 kobo/read reward with a dynamic rate calculated from a rolling 7-day window of reader pool revenue and total completed reads.

**Architecture:** A new `RewardRateService` computes and caches the rate hourly. The `ReaderRewardService` is simplified to always pay (rate ≤ pool). Anti-gaming measures (daily cap, post cooldown, session gap, speed check) are added to the reads route.

**Tech Stack:** Node.js, Fastify, MongoDB/Mongoose, EJS templates

---

## File Structure

### Files to Create
| File | Responsibility |
|------|---------------|
| `src/services/RewardRateService.js` | Compute dynamic rate from 7d rolling window; cache in memory + DB |
| `src/models/SystemConfig.js` | Simple key-value store for rate + config values |
| `tests/unit/rewardRateService.test.js` | Tests for rate computation, bounds, caching |
| `tests/unit/readsAntiGaming.test.js` | Tests for daily cap, cooldown, speed check, session gap |

### Files to Modify
| File | Change |
|------|--------|
| `src/models/User.js` | Add `lastSessionStart` field to wallet/schema |
| `src/models/ReadSession.js` | Remove `READ_REWARD` constant usage; accept dynamic rate; remove unfunded read references |
| `src/services/ads/ReaderRewardService.js` | Simplify: always pays, no unfunded handling, remove sweep functions |
| `src/routes/reads.js` | Add daily cap check (`getTodayReads()`), post cooldown, session gap, speed validation |
| `src/routes/api.js` | Add `GET /api/rewards/rate` endpoint |
| `src/routes/pages.js` | Inject `currentRate` into dashboard + reads page rendering |
| `src/views/pages/dashboard.ejs` | Display current rate near balance |
| `src/views/pages/reads.ejs` | Display rate + rate history |
| `src/views/admin/pages/earnings.ejs` | Add pool balances + rate breakdown |
| `src/cron/index.js` | Add hourly rate recalculation; remove unfunded sweep functions |
| `src/plugins/cron-plugin.js` | Update cron schedules |

---

### Task 1: SystemConfig Model

**Files:**
- Create: `src/models/SystemConfig.js`
- Test: (used by RewardRateService tests)

- [ ] **Step 1: Create SystemConfig model**

```javascript
// src/models/SystemConfig.js
const mongoose = require('mongoose');

const systemConfigSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    value: { type: mongoose.Schema.Types.Mixed, required: true },
    updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

systemConfigSchema.index({ key: 1 });

const SystemConfig = mongoose.model('SystemConfig', systemConfigSchema);

module.exports = SystemConfig;
```

- [ ] **Step 2: Commit**

```bash
git add src/models/SystemConfig.js
git commit -m "feat: add SystemConfig model for key-value configuration storage"
```

---

### Task 2: RewardRateService

**Files:**
- Create: `src/services/RewardRateService.js`
- Create: `tests/unit/rewardRateService.test.js`

This service computes the dynamic reward rate from a rolling 7-day window.

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/unit/rewardRateService.test.js
const { calculateRate, getCurrentRate, refreshRate } = require('../../src/services/RewardRateService');

// Mock dependencies
jest.mock('../../src/models/LedgerEntry');
jest.mock('../../src/models/ReadSession');
jest.mock('../../src/models/SystemConfig');

const LedgerEntry = require('../../src/models/LedgerEntry');
const ReadSession = require('../../src/models/ReadSession');
const SystemConfig = require('../../src/models/SystemConfig');

describe('RewardRateService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('calculateRate', () => {
        it('returns rate = revenue / reads when both are positive', async () => {
            LedgerEntry.aggregate.mockResolvedValue([{ total: 50000 }]);  // 50000 kobo revenue
            ReadSession.countDocuments.mockResolvedValue(100);            // 100 reads
            const rate = await calculateRate();
            expect(rate).toBe(500);  // 500 kobo per read
        });

        it('returns floor (10) when revenue < reads', async () => {
            LedgerEntry.aggregate.mockResolvedValue([{ total: 100 }]);
            ReadSession.countDocuments.mockResolvedValue(1000);
            const rate = await calculateRate();
            expect(rate).toBe(10);  // floor
        });

        it('returns ceiling (2000) when revenue >> reads', async () => {
            LedgerEntry.aggregate.mockResolvedValue([{ total: 500000 }]);
            ReadSession.countDocuments.mockResolvedValue(10);
            const rate = await calculateRate();
            expect(rate).toBe(2000);  // ceiling
        });

        it('returns floor when no reads in period', async () => {
            LedgerEntry.aggregate.mockResolvedValue([{ total: 50000 }]);
            ReadSession.countDocuments.mockResolvedValue(0);
            const rate = await calculateRate();
            expect(rate).toBe(10);  // floor
        });

        it('returns floor when no revenue in period', async () => {
            LedgerEntry.aggregate.mockResolvedValue([{ total: 0 }]);
            ReadSession.countDocuments.mockResolvedValue(100);
            const rate = await calculateRate();
            expect(rate).toBe(10);  // floor
        });

        it('queries last 7 days for revenue', async () => {
            const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            LedgerEntry.aggregate.mockResolvedValue([{ total: 50000 }]);
            ReadSession.countDocuments.mockResolvedValue(100);
            await calculateRate();
            expect(LedgerEntry.aggregate).toHaveBeenCalled();
            const matchStage = LedgerEntry.aggregate.mock.calls[0][0][0].$match;
            expect(matchStage.createdAt.$gte.getTime()).toBeCloseTo(sevenDaysAgo.getTime(), -3);
        });

        it('queries last 7 days for reads', async () => {
            LedgerEntry.aggregate.mockResolvedValue([{ total: 50000 }]);
            ReadSession.countDocuments.mockResolvedValue(100);
            await calculateRate();
            expect(ReadSession.countDocuments).toHaveBeenCalled();
            const query = ReadSession.countDocuments.mock.calls[0][0];
            expect(query.rewardAwarded).toBe(true);
            expect(query.createdAt.$gte).toBeDefined();
        });
    });

    describe('getCurrentRate', () => {
        it('returns cached rate from SystemConfig', async () => {
            SystemConfig.findOne.mockResolvedValue({ key: 'dynamic_read_rate_kobo', value: 350 });
            const rate = await getCurrentRate();
            expect(rate).toBe(350);
        });

        it('calls refreshRate and returns result when no cache exists', async () => {
            SystemConfig.findOne.mockResolvedValue(null);
            LedgerEntry.aggregate.mockResolvedValue([{ total: 50000 }]);
            ReadSession.countDocuments.mockResolvedValue(100);
            SystemConfig.findOneAndUpdate.mockResolvedValue({ key: 'dynamic_read_rate_kobo', value: 500 });
            const rate = await getCurrentRate();
            expect(rate).toBe(500);
        });
    });

    describe('refreshRate', () => {
        it('calculates and stores new rate in SystemConfig', async () => {
            LedgerEntry.aggregate.mockResolvedValue([{ total: 50000 }]);
            ReadSession.countDocuments.mockResolvedValue(100);
            SystemConfig.findOneAndUpdate.mockResolvedValue({ key: 'dynamic_read_rate_kobo', value: 500 });
            const rate = await refreshRate();
            expect(rate).toBe(500);
            expect(SystemConfig.findOneAndUpdate).toHaveBeenCalledWith(
                { key: 'dynamic_read_rate_kobo' },
                { key: 'dynamic_read_rate_kobo', value: 500, updatedAt: expect.any(Date) },
                { upsert: true, new: true }
            );
        });
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /home/tobe/personal/Nook && npx jest tests/unit/rewardRateService.test.js --no-coverage 2>&1
```
Expected: Tests fail (module not found or functions undefined).

- [ ] **Step 3: Write RewardRateService**

```javascript
// src/services/RewardRateService.js
const LedgerEntry = require('../models/LedgerEntry');
const ReadSession = require('../models/ReadSession');
const SystemConfig = require('../models/SystemConfig');

const RATE_FLOOR = 10;    // 0.10 NGN minimum per read
const RATE_CEILING = 2000; // 20 NGN max per read
const WINDOW_DAYS = 7;

async function calculateRate() {
    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const revenueResult = await LedgerEntry.aggregate([
        {
            $match: {
                pool: 'reader_pool',
                amount: { $gt: 0 },
                status: 'completed',
                createdAt: { $gte: since }
            }
        },
        { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);

    const totalRevenue = revenueResult.length > 0 ? revenueResult[0].total : 0;

    const totalReads = await ReadSession.countDocuments({
        rewardAwarded: true,
        createdAt: { $gte: since }
    });

    if (totalReads === 0 || totalRevenue === 0) {
        return RATE_FLOOR;
    }

    const rate = Math.round(totalRevenue / totalReads);
    return Math.min(Math.max(rate, RATE_FLOOR), RATE_CEILING);
}

async function getCurrentRate() {
    const cached = await SystemConfig.findOne({ key: 'dynamic_read_rate_kobo' });
    if (cached && cached.value) {
        return cached.value;
    }
    return await refreshRate();
}

async function refreshRate() {
    const rate = await calculateRate();
    await SystemConfig.findOneAndUpdate(
        { key: 'dynamic_read_rate_kobo' },
        { key: 'dynamic_read_rate_kobo', value: rate, updatedAt: new Date() },
        { upsert: true, new: true }
    );
    return rate;
}

module.exports = { calculateRate, getCurrentRate, refreshRate, RATE_FLOOR, RATE_CEILING, WINDOW_DAYS };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /home/tobe/personal/Nook && npx jest tests/unit/rewardRateService.test.js --no-coverage 2>&1
```
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/RewardRateService.js tests/unit/rewardRateService.test.js
git commit -m "feat: add RewardRateService for dynamic per-read rate calculation"
```

---

### Task 3: Anti-Gaming — User Model Update

**Files:**
- Modify: `src/models/User.js`

- [ ] **Step 1: Add `lastSessionStart` to wallet schema**

Find the `wallet` sub-schema in `src/models/User.js` (around line 81-119) and add `lastSessionStart`:

```javascript
// Inside wallet: { ... } schema, add:
lastSessionStart: { type: Date, default: null },
```

- [ ] **Step 2: Commit**

```bash
git add src/models/User.js
git commit -m "feat: add lastSessionStart field for session gap anti-gaming"
```

---

### Task 4: Anti-Gaming — Reads Route

**Files:**
- Modify: `src/routes/reads.js`
- Create: `tests/unit/readsAntiGaming.test.js`

- [ ] **Step 1: Write the failing anti-gaming tests**

```javascript
// tests/unit/readsAntiGaming.test.js
const { enforceDailyCap, enforcePostCooldown, enforceSessionGap, enforceReadSpeed } = require('../../src/routes/reads');

describe('Anti-gaming measures', () => {
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
        it('returns true when no prior session exists', async () => {
            ReadSession.findOne = jest.fn().mockResolvedValue(null);
            const result = await enforcePostCooldown('user123', 'post456', 24);
            expect(result).toBe(true);
        });

        it('returns true when last read was > 24h ago', async () => {
            const oldSession = { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) };
            ReadSession.findOne = jest.fn().mockResolvedValue(oldSession);
            const result = await enforcePostCooldown('user123', 'post456', 24);
            expect(result).toBe(true);
        });

        it('returns false when last read was < 24h ago', async () => {
            const recentSession = { createdAt: new Date(Date.now() - 1 * 60 * 60 * 1000) };
            ReadSession.findOne = jest.fn().mockResolvedValue(recentSession);
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
            const oldStart = new Date(Date.now() - 10000); // 10 seconds ago
            const result = enforceSessionGap(oldStart, 3);
            expect(result).toBe(true);
        });

        it('returns false when gap < 3 seconds', () => {
            const recentStart = new Date(Date.now() - 1000); // 1 second ago
            const result = enforceSessionGap(recentStart, 3);
            expect(result).toBe(false);
        });
    });

    describe('enforceReadSpeed', () => {
        it('returns true when time spent >= 10% of expected', () => {
            // 500 words @ 200 WPM = 150 seconds expected, 10% = 15 seconds minimum
            const result = enforceReadSpeed(20, 500, 200, 0.10);
            expect(result).toBe(true);
        });

        it('returns false when time spent < 10% of expected', () => {
            // 1000 words @ 200 WPM = 300 seconds expected, 10% = 30 seconds minimum
            const result = enforceReadSpeed(5, 1000, 200, 0.10);
            expect(result).toBe(false);
        });

        it('return true for very short posts', () => {
            // 10 words @ 200 WPM = 3 seconds expected, 10% = 0.3 seconds — always passes
            const result = enforceReadSpeed(1, 10, 200, 0.10);
            expect(result).toBe(true);
        });
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /home/tobe/personal/Nook && npx jest tests/unit/readsAntiGaming.test.js --no-coverage 2>&1
```
Expected: Tests fail (module not found or functions undefined).

- [ ] **Step 3: Add anti-gaming functions to reads route**

Add the following helper functions at the top of `src/routes/reads.js` (after the requires, around line 8):

```javascript
const DAILY_READ_CAP = 100;
const POST_READ_COOLDOWN_HOURS = 24;
const MIN_SESSION_GAP_SECONDS = 3;
const MIN_READ_SPEED_FRACTION = 0.10;
const WORDS_PER_MINUTE = 200;

async function enforceDailyCap(userId, cap) {
    const todayReads = await ReadSession.getTodayReads(userId);
    return todayReads < cap;
}

async function enforcePostCooldown(userId, postId, cooldownHours) {
    const existing = await ReadSession.findOne({
        user: userId, post: postId, completed: true
    }).sort({ createdAt: -1 }).select('createdAt').lean();

    if (!existing) return true;

    const hoursSince = (Date.now() - existing.createdAt.getTime()) / (1000 * 60 * 60);
    return hoursSince >= cooldownHours;
}

function enforceSessionGap(lastSessionStart, minGapSeconds) {
    if (!lastSessionStart) return true;
    const secondsSince = (Date.now() - new Date(lastSessionStart).getTime()) / 1000;
    return secondsSince >= minGapSeconds;
}

function enforceReadSpeed(timeSpentSeconds, wordCount, wpm, minFraction) {
    const expectedSeconds = (wordCount / wpm) * 60;
    const minimumSeconds = Math.max(expectedSeconds * minFraction, 1);
    return timeSpentSeconds >= minimumSeconds;
}
```

- [ ] **Step 4: Wire checks into `/start` and `/complete` routes**

In the `POST /api/reads/start` handler (around line 70), add checks after the existing incomplete-session check and before creating a new session:

```javascript
// After existing incomplete session check (around line 85), add:
if (!await enforceDailyCap(userId, DAILY_READ_CAP)) {
    return reply.code(429).send({
        success: false,
        error: `Daily read cap of ${DAILY_READ_CAP} reached. Come back tomorrow!`
    });
}

const user = await User.findById(userId).select('wallet.lastSessionStart');
if (!enforceSessionGap(user?.wallet?.lastSessionStart, MIN_SESSION_GAP_SECONDS)) {
    return reply.code(429).send({
        success: false,
        error: 'Please wait a moment before starting another read.'
    });
}

if (!await enforcePostCooldown(userId, postId, POST_READ_COOLDOWN_HOURS)) {
    return reply.code(429).send({
        success: false,
        error: 'You have already read this post recently. Try again later.'
    });
}
```

In the session creation (before saving), update the user's `lastSessionStart`:

```javascript
await User.findByIdAndUpdate(userId, { $set: { 'wallet.lastSessionStart': new Date() } });
```

In the `POST /api/reads/complete` handler (around line 191, inside the markCompleted call or nearby), add speed validation before calling `markCompleted`:

```javascript
// After fetching post for word count (find post), add:
const wordCount = post.content ? post.content.split(/\s+/).length : 0;
if (!enforceReadSpeed(session.timeSpentSeconds || 0, wordCount, WORDS_PER_MINUTE, MIN_READ_SPEED_FRACTION)) {
    session.completed = true;
    session.rewardAwarded = false;
    session.rewardAmount = 0;
    await session.save();
    return reply.send({
        success: true,
        message: 'Read recorded but reward not earned (read too quickly).',
        reward: 0
    });
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd /home/tobe/personal/Nook && npx jest tests/unit/readsAntiGaming.test.js --no-coverage 2>&1
```
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/routes/reads.js tests/unit/readsAntiGaming.test.js
git commit -m "feat: add anti-gaming measures — daily cap, post cooldown, session gap, read speed check"
```

---

### Task 5: Simplify ReaderRewardService

**Files:**
- Modify: `src/services/ads/ReaderRewardService.js`

Remove the unfunded read logic and sweep functions. The service now just checks pool balance and debits it.

- [ ] **Step 1: Rewrite ReaderRewardService**

Replace the file content with:

```javascript
const LedgerEntry = require('../../models/LedgerEntry');
const User = require('../../models/User');

const MAX_REWARD = 2000; // kobo — matches rate ceiling

async function getReaderPoolBalance() {
    const result = await LedgerEntry.aggregate([
        { $match: { pool: 'reader_pool', status: 'completed' } },
        { $group: { _id: null, balance: { $sum: '$amount' } } }
    ]);
    return result.length > 0 ? result[0].balance : 0;
}

async function payoutReaderReward(readSession, rewardAmount) {
    const poolBalance = await getReaderPoolBalance();
    const amount = Math.min(rewardAmount, poolBalance);

    if (amount <= 0) {
        return { paid: false, amount: 0, reason: 'empty_pool' };
    }

    await LedgerEntry.create({
        user: null,
        type: 'reader_reward_payout',
        amount: -amount,
        balanceBefore: poolBalance,
        balanceAfter: poolBalance - amount,
        status: 'completed',
        fundedBy: 'reader_pool',
        correlationId: readSession._id,
        correlationModel: 'ReadSession',
        pool: 'reader_pool',
        metadata: {
            readSessionId: readSession._id,
            rewardAmount: amount,
            sweepType: 'immediate',
            rateAtPayout: rewardAmount
        }
    });

    return { paid: true, amount, poolBalanceAfter: poolBalance - amount };
}

async function dailyFeedRevenueSweep() {
    const AdEvent = require('../../models/ads/AdEvent');
    const lastSweep = await LedgerEntry.findOne({
        type: 'ad_revenue_reader_pool',
        'metadata.sweepType': 'daily_feed_sweep',
        status: 'completed'
    }).sort({ createdAt: -1 }).select('createdAt').lean();

    const since = lastSweep ? lastSweep.createdAt : new Date(Date.now() - 24 * 60 * 60 * 1000);

    const feedAdRevenue = await AdEvent.aggregate([
        {
            $match: {
                'metadata.pageType': 'feed',
                createdAt: { $gte: since }
            }
        },
        { $group: { _id: null, total: { $sum: '$revenue' } } }
    ]);

    const totalFeedRevenue = feedAdRevenue.length > 0 ? feedAdRevenue[0].total : 0;
    if (totalFeedRevenue <= 0) {
        return { swept: 0, note: 'no_feed_revenue' };
    }

    const readerPoolShare = Math.round(totalFeedRevenue * 0.30 * 1e6) / 1e6;
    if (readerPoolShare <= 0) {
        return { swept: 0, note: 'amount_too_small' };
    }

    const poolBefore = await getReaderPoolBalance();

    await LedgerEntry.create({
        user: null,
        type: 'ad_revenue_reader_pool',
        amount: readerPoolShare,
        balanceBefore: poolBefore,
        balanceAfter: poolBefore + readerPoolShare,
        status: 'completed',
        fundedBy: 'ad_revenue',
        correlationModel: null,
        pool: 'reader_pool',
        metadata: {
            sweepType: 'daily_feed_sweep',
            totalFeedRevenue,
            sourcePeriod: { from: since, to: new Date() }
        }
    });

    return { swept: readerPoolShare, poolBalanceAfter: poolBefore + readerPoolShare };
}

module.exports = {
    getReaderPoolBalance,
    payoutReaderReward,
    dailyFeedRevenueSweep,
    MAX_REWARD
};
```

- [ ] **Step 2: Commit**

```bash
git add src/services/ads/ReaderRewardService.js
git commit -m "refactor: simplify ReaderRewardService — remove unfunded reads and sweep functions"
```

---

### Task 6: Update ReadSession.markCompleted

**Files:**
- Modify: `src/models/ReadSession.js`

Replace the fixed `READ_REWARD` usage with a dynamic rate fetched from `RewardRateService`. Remove unfunded read logic.

- [ ] **Step 1: Modify ReadSession model**

In `src/models/ReadSession.js`:

1. Remove the `READ_REWARD` and `MIN_READ_TIME_SECONDS` constants (lines 4-5) — replace `READ_REWARD` with the dynamic rate.
2. Keep `MIN_READ_TIME_SECONDS = 30` as a local constant.
3. Modify `calculateReward` to accept a `rate` parameter or fetch it:

```javascript
// Replace lines 3-5:
const MIN_READ_TIME_SECONDS = 30;
```

4. Modify `calculateReward` method:

```javascript
readSessionSchema.methods.calculateReward = function(rate) {
    if (this.completed && !this.rewardAwarded && this.timeSpentSeconds >= MIN_READ_TIME_SECONDS) {
        return rate || 500; // fallback if no rate provided
    }
    return 0;
};
```

5. In `markCompleted`, fetch the dynamic rate and pass it:

```javascript
// After line 123 (const reward = this.calculateReward();), add rate fetching:
const RewardRateService = require('../services/RewardRateService');
const currentRate = await RewardRateService.getCurrentRate();
const reward = this.calculateReward(currentRate);
```

6. Remove the unfunded read handling (lines 126-134 where it calls `payoutReaderReward` and checks `poolResult.paid`). Replace with a direct call:

```javascript
if (reward > 0) {
    const ReaderRewardService = require('../services/ads/ReaderRewardService');
    const poolResult = await ReaderRewardService.payoutReaderReward(this, reward);

    if (!poolResult.paid) {
        this.rewardAwarded = false;
        this.rewardAmount = 0;
        await this.save();
        return 0;
    }

    this.rewardAwarded = true;
    this.rewardAmount = poolResult.amount; // use actual amount paid (may be less if pool was low)
    // ... rest of the flow stays the same ...
```

7. Remove the `isUnfunded` and `poolPayoutAt` field references if they're no longer set anywhere (they can stay in the schema as unused fields).

- [ ] **Step 2: Commit**

```bash
git add src/models/ReadSession.js
git commit -m "feat: use dynamic reward rate in ReadSession.markCompleted"
```

---

### Task 7: Rewards Rate API Endpoint

**Files:**
- Modify: `src/routes/api.js`

- [ ] **Step 1: Add GET /api/rewards/rate endpoint**

Add to `src/routes/api.js` (after existing routes, before the export):

```javascript
fastify.get('/api/rewards/rate', async (request, reply) => {
    const RewardRateService = require('../services/RewardRateService');
    const rate = await RewardRateService.getCurrentRate();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const LedgerEntry = require('../models/LedgerEntry');
    const ReadSession = require('../models/ReadSession');

    const revenueResult = await LedgerEntry.aggregate([
        {
            $match: {
                pool: 'reader_pool',
                amount: { $gt: 0 },
                status: 'completed',
                createdAt: { $gte: sevenDaysAgo }
            }
        },
        { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const totalRevenue = revenueResult.length > 0 ? revenueResult[0].total : 0;
    const totalReads = await ReadSession.countDocuments({
        rewardAwarded: true,
        createdAt: { $gte: sevenDaysAgo }
    });

    return {
        success: true,
        data: {
            rateKobo: rate,
            rateNgn: (rate / 100).toFixed(2),
            totalRevenueKobo: totalRevenue,
            totalRevenueNgn: (totalRevenue / 100).toFixed(2),
            totalReads,
            windowDays: 7,
            lastUpdated: new Date().toISOString()
        }
    };
});
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/api.js
git commit -m "feat: add GET /api/rewards/rate endpoint for dynamic rate data"
```

---

### Task 8: User-Facing Rate Display

**Files:**
- Modify: `src/routes/pages.js`
- Modify: `src/views/pages/dashboard.ejs`
- Modify: `src/views/pages/reads.ejs`

- [ ] **Step 1: Inject rate into dashboard and reads page rendering**

In `src/routes/pages.js`, find the dashboard route handler. After fetching user data and before rendering, add:

```javascript
const RewardRateService = require('../services/RewardRateService');
const currentRate = await RewardRateService.getCurrentRate();
```

Pass `currentRate` to the template:
```javascript
// In renderPage call, add:
currentRate,
currentRateNgn: (currentRate / 100).toFixed(2),
```

Do the same for the reads page route handler.

- [ ] **Step 2: Display current rate on dashboard**

In `src/views/pages/dashboard.ejs`, find the balance display area (around line 606-641). Add after the balance display:

```html
<% if (typeof currentRateNgn !== 'undefined') { %>
    <div class="current-rate">
        <span class="rate-label">Current read rate:</span>
        <span class="rate-value">~<%= currentRateNgn %> NGN per read</span>
        <span class="rate-note">Based on last 7 days of platform activity</span>
    </div>
<% } %>
```

- [ ] **Step 3: Display rate on reads page**

In `src/views/pages/reads.ejs`, find the header/stats area (around line 358). Add:

```html
<% if (typeof currentRateNgn !== 'undefined') { %>
    <div class="current-read-rate">
        <p>Current reward rate: <strong>~<%= currentRateNgn %> NGN</strong> per completed read</p>
        <small>Rate adjusts hourly based on ad revenue and total reads over the last 7 days</small>
    </div>
<% } %>
```

- [ ] **Step 4: Commit**

```bash
git add src/routes/pages.js src/views/pages/dashboard.ejs src/views/pages/reads.ejs
git commit -m "feat: display current dynamic reward rate on dashboard and reads page"
```

---

### Task 9: Admin Pool Dashboard

**Files:**
- Modify: `src/routes/admin.js`
- Modify: `src/views/admin/pages/earnings.ejs`

- [ ] **Step 1: Add pool data endpoint**

In `src/routes/admin.js`, add or modify the earnings data endpoint to include pool balances:

```javascript
// In the admin earnings route handler, add pool balance fetching:
const LedgerEntry = require('../models/LedgerEntry');
const RewardRateService = require('../services/RewardRateService');

async function getPoolBalance(poolName) {
    const result = await LedgerEntry.aggregate([
        { $match: { pool: poolName, status: 'completed' } },
        { $group: { _id: null, balance: { $sum: '$amount' } } }
    ]);
    return result.length > 0 ? result[0].balance : 0;
}

const readerPool = await getPoolBalance('reader_pool');
const publisherPool = await getPoolBalance('publisher_pool');
const orgOperational = await getPoolBalance('org_operational');
const orgReserve = await getPoolBalance('org_reserve');
const currentRate = await RewardRateService.getCurrentRate();
```

Pass these to the template:
```javascript
{
    readerPool,
    readerPoolNgn: (readerPool / 100).toFixed(2),
    publisherPool, publisherPoolNgn: ...,
    orgOperational, orgOperationalNgn: ...,
    orgReserve, orgReserveNgn: ...,
    currentRate, currentRateNgn: (currentRate / 100).toFixed(2)
}
```

- [ ] **Step 2: Display pools on admin earnings page**

In `src/views/admin/pages/earnings.ejs`, add a pool balances section (after the revenue overview):

```html
<h2>Pool Balances</h2>
<div class="pool-grid">
    <div class="pool-card">
        <h3>Reader Pool</h3>
        <p class="pool-balance">₦<%= readerPoolNgn %></p>
        <p class="pool-desc">Funds available for reader rewards</p>
    </div>
    <div class="pool-card">
        <h3>Publisher Pool</h3>
        <p class="pool-balance">₦<%= publisherPoolNgn %></p>
        <p class="pool-desc">Publisher earnings awaiting settlement</p>
    </div>
    <div class="pool-card">
        <h3>Org Operational</h3>
        <p class="pool-balance">₦<%= orgOperationalNgn %></p>
        <p class="pool-desc">Available for platform costs</p>
    </div>
    <div class="pool-card">
        <h3>Org Reserve</h3>
        <p class="pool-balance">₦<%= orgReserveNgn %></p>
        <p class="pool-desc">Locked reserve (unlock criteria required)</p>
    </div>
</div>

<h2>Current Reward Rate</h2>
<div class="rate-display">
    <p>Dynamic per-read rate: <strong>~<%= currentRateNgn %> NGN</strong></p>
    <p>Recalculated hourly | 7-day rolling window</p>
</div>
```

- [ ] **Step 3: Commit**

```bash
git add src/routes/admin.js src/views/admin/pages/earnings.ejs
git commit -m "feat: add pool balance overview and rate display to admin dashboard"
```

---

### Task 10: Cron Job Updates

**Files:**
- Modify: `src/cron/index.js`
- Modify: `src/plugins/cron-plugin.js`

- [ ] **Step 1: Add hourly rate recalculation cron**

In `src/cron/index.js`, add the rate refresh function:

```javascript
async function refreshRewardRate() {
    const RewardRateService = require('../services/RewardRateService');
    try {
        const rate = await RewardRateService.refreshRate();
        console.log(`[Cron] Reward rate refreshed: ${rate} kobo`);
    } catch (err) {
        console.error('[Cron] Failed to refresh reward rate:', err.message);
    }
}
```

Remove the `unfundedReadsSweep` function and its references since unfunded reads are no longer a concept.

In `src/plugins/cron-plugin.js`, register the hourly rate refresh:

```javascript
// Add with other cron registrations:
schedule('0 * * * *', async () => {
    const { refreshRewardRate } = require('../cron/index');
    await refreshRewardRate();
});
```

And remove the `unfunded-reads-sweep` cron job registration.

- [ ] **Step 2: Commit**

```bash
git add src/cron/index.js src/plugins/cron-plugin.js
git commit -m "feat: add hourly reward rate recalculation cron; remove unfunded reads sweep"
```
