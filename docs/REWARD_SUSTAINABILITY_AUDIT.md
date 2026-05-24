# Reward & Sustainability Audit

> **Status:** Audit Complete — Implementation Required  
> **Date:** 2026-05-10  
> **Scope:** Ad Revenue Distribution, Reader Rewards, Org Reserve, Publisher Pool, Credit System, Cron Sweeps, Concurrency Safety

---

## For Future Coding Agents

If you are an AI agent reading this, here is how to approach implementation:

1. **Read this entire document first** — do not start coding until you understand all 6 issues.
2. **Fix 4 (Concurrency) is ALREADY IMPLEMENTED** — do not re-implement it. The `startingBalance` field, `pre('save')` hook, and `$inc` changes are in `src/models/ReadSession.js` and `src/models/User.js`. Tests are in `tests/unit/phase3Fixes.test.js` (10 tests, all passing).
3. **Implement in priority order** — start with P0 fixes first (Fix 2, then Fix 4 verification), then P1, then P2.
4. **Always read the full file before editing** — this codebase uses EJS templates with inline styles; some files are large. Read the target file fully, then make surgical edits.
5. **Run tests after each fix** — use `npx jest tests/unit/phase3Fixes.test.js` for concurrency tests. Add new tests for Fixes 1, 2, 3, 5, 6.
6. **Database migrations are required** — see "Database Migrations Needed" section below. Run them in MongoDB before deploying.
7. **Code style** — this project uses Mongoose with async/await. Follow the existing pattern of `findOneAndUpdate` with `$inc` for atomic operations. Keep functions small and focused.
8. **If unsure about anything** — re-read the "Current Architecture" section to understand the data flow before making changes.

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current Architecture](#current-architecture)
3. [Critical Issues Found](#critical-issues-found)
4. [Fixes Required](#fixes-required)
5. [Implementation Details](#implementation-details)
6. [Sustainability Recommendations](#sustainability-recommendations)
7. [Files to Modify](#files-to-modify)

---

## Executive Summary

The earning system has **six critical flaws** that allow balance inflation, bypass revenue pools, create race conditions, and make the platform financially unsustainable. All fixes must be implemented before scaling to production.

---

## Current Architecture

### Revenue Flow

```
Ad Event (simulated only)
    ↓
AdRevenueService.processAdEvent()
    ↓
MonthlyRevenue (credited to owner wallet directly)
    ↓
dailyFeedRevenueSweep (cron)
    ↓
60% → Reader Pool (reader_pool wallet)
40% → Org Reserve (org_reserve wallet, then sweep to orgOperationalBudget)
```

### Reader Reward Flow

```
User reads article → ReadSession.markCompleted()
    ↓
ReaderRewardService.payoutReaderReward()
    ↓
If reader_pool balance >= 5 NGN: credit user wallet ₦5, debit reader_pool
If reader_pool balance < 5 NGN: mark session unfunded, no payment
```

### Publisher Settlement Flow

```
Manual trigger only
PublisherPoolService.settlePublisher()
    ↓
Debit orgOperationalBudget, credit publisher wallet
```

---

## Critical Issues Found

### 1. Fixed Reader Reward (₦5) is Unsustainable

**Location:** `src/models/ReadSession.js`, `src/services/ads/ReaderRewardService.js`

- `READ_REWARD = 5` is hardcoded.
- Reward does not scale with pool size or ad revenue.
- During low-revenue periods, pool drains rapidly; during high-revenue periods, users are underpaid.
- **Fix:** Make reward dynamic (₦1–₦5) based on `reader_pool.balance / estimated_daily_reads`.

### 2. Bonuses Bypass Revenue Pools (Infinite Money)

**Location:** `src/models/User.js`, `src/services/ads/AdRevenueService.js`

- `addReward()` credits `wallet.balance` directly without debiting any revenue pool.
- Achievement bonus, referral bonus, signup bonus all create money from nothing.
- Org operational budget is never debited for these bonuses.
- **Fix:** All bonuses must debit `orgOperationalBudget` before crediting user.

### 3. `Credit.calculateEarnings()` is Dead Code

**Location:** `src/models/Credit.js`

- Method exists but is never called in any payout flow.
- `wallet.balance` is inflated directly by fixed rewards, bypassing the credit/earning calculation entirely.
- **Fix:** Either remove dead code or integrate it into the payout flow (recommend removal to reduce complexity).

### 4. Phase 3 Concurrency Bugs (Race Conditions)

**Location:** `src/models/ReadSession.js`, `src/models/User.js`

- `markCompleted()` uses stale `session.user.balance` in `findOneAndUpdate` condition — external balance changes between create and complete cause silent failures.
- `User.addReward()` uses `user.wallet.balance` directly in condition — same race condition.
- `stats.totalReads` is set absolutely (`$set`) instead of atomically incremented.
- **Fix:** Capture `startingBalance` at session creation; use `$inc` for counters; use captured balance in conditional updates.

### 5. No Real Ad Network Integration

**Location:** `src/services/ads/AdSimulationService.js`

- Only `simulated` network is used.
- No actual AdMob or Facebook Ad callbacks.
- Revenue is entirely synthetic.
- **Fix:** Integrate real ad networks or implement revenue caps to prevent overspending simulated funds.

### 6. Publisher Settlements are Manual + Unverified

**Location:** `src/services/ads/PublisherPoolService.js`

- No automatic settlement schedule.
- No verification that publisher actually earned the requested amount.
- `orgOperationalBudget` can be overdrawn.
- **Fix:** Add earned-balance tracking per publisher; auto-settle monthly; check balance before debit.

---

## Fixes Required

### Fix 1: Dynamic Reader Reward

**File:** `src/services/ads/ReaderRewardService.js`

Replace fixed reward with dynamic calculation:

```javascript
async calculateDynamicReward() {
  const readerPool = await Wallet.findOne({ label: 'reader_pool' });
  const estimatedDailyReads = await ReadSession.countDocuments({
    createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
  });
  
  if (!estimatedDailyReads) return 1; // minimum
  
  const dailyPool = readerPool.balance; // or a fraction of it
  const reward = Math.floor(dailyPool / estimatedDailyReads);
  
  return Math.min(Math.max(reward, 1), 5); // clamp 1-5 NGN
}
```

Then in `payoutReaderReward()`:

```javascript
const rewardAmount = await this.calculateDynamicReward();
if (readerPool.balance < rewardAmount) {
  // mark unfunded
  return;
}
// proceed with rewardAmount instead of READ_REWARD
```

### Fix 2: Bonuses Must Debit Org Budget

**File:** `src/models/User.js`

Modify `addReward()`:

```javascript
addReward: async function(amount, type = 'reward', description = '') {
  // Debit org budget first
  const orgDebit = await Org.findOneAndUpdate(
    {},
    { $inc: { 'wallet.orgOperationalBudget': -amount } },
    { new: true }
  );
  
  if (!orgDebit || orgDebit.wallet.orgOperationalBudget < 0) {
    throw new Error('Insufficient org operational budget for reward');
  }
  
  // Then credit user
  const user = await this.model('User').findOneAndUpdate(
    { _id: this._id, 'wallet.balance': { $gte: 0 } },
    {
      $inc: { 'wallet.balance': amount },
      $push: {
        'wallet.transactions': {
          type,
          amount,
          description,
          date: new Date()
        }
      }
    },
    { new: true }
  );
  
  return user;
}
```

Also update all call sites:
- `AdRevenueService.js` (signup bonus)
- `ReferralService.js` (referral bonus)
- `AchievementService.js` (achievement bonus)

### Fix 3: Remove Dead Code

**File:** `src/models/Credit.js`

Remove `calculateEarnings()` method or deprecate it. If keeping for future use, document that it is not currently wired into the payout flow.

### Fix 4: Phase 3 Concurrency Fixes (Already Implemented)

**Files:** `src/models/ReadSession.js`, `src/models/User.js`

These have been implemented:

1. `ReadSession` now has `startingBalance` field.
2. `pre('save')` hook captures user's balance at session creation.
3. `markCompleted()` uses `startingBalance` in `findOneAndUpdate` condition.
4. `stats.totalReads` uses `$inc` instead of `$set`.
5. `User.addReward()` uses conditional `findOneAndUpdate` with balance check.

**Test file:** `tests/unit/phase3Fixes.test.js` (10 tests, all passing).

### Fix 5: Ad Network Integration (Future Work)

**File:** `src/services/ads/AdSimulationService.js`

- Add AdMob callback handler.
- Add Facebook Audience Network callback handler.
- Implement revenue caps: `maxDailySyntheticRevenue = 1000 NGN` to prevent overspending.

### Fix 6: Automated Publisher Settlements

**File:** `src/services/ads/PublisherPoolService.js`

1. Add `earnedBalance` field to Publisher model (tracks confirmed earnings).
2. Update `earnedBalance` when articles generate revenue.
3. Auto-settle monthly via cron:

```javascript
// In cron-plugin.js, add monthly job
schedule('0 0 1 * *', async () => {
  await PublisherPoolService.settleAllPublishers();
});
```

4. In `settlePublisher()`, check `publisher.earnedBalance >= amount` before debiting `orgOperationalBudget`.

---

## Implementation Details

### Priority Order

| Priority | Fix | Effort | Impact |
|----------|-----|--------|--------|
| P0 | Fix 2 (Bonuses debit org budget) | 2h | Prevents infinite money |
| P0 | Fix 4 (Concurrency) | 1h | Prevents data corruption |
| P1 | Fix 1 (Dynamic reward) | 2h | Sustainability |
| P1 | Fix 6 (Publisher auto-settle) | 3h | Operational integrity |
| P2 | Fix 3 (Remove dead code) | 30m | Cleanup |
| P2 | Fix 5 (Real ad networks) | 1d | Revenue realism |

### Database Migrations Needed

1. Add `startingBalance` to existing `ReadSession` documents (default to `0`):
   ```javascript
   db.readsessions.updateMany({}, { $set: { startingBalance: 0 } });
   ```

2. Add `earnedBalance` to existing `Publisher` documents (default to `0`):
   ```javascript
   db.publishers.updateMany({}, { $set: { earnedBalance: 0 } });
   ```

### Testing Checklist

- [ ] Dynamic reward stays within 1-5 NGN bounds
- [ ] Org budget cannot go negative from bonuses
- [ ] Concurrent read sessions on same user don't corrupt balance
- [ ] Concurrent bonuses on same user don't double-credit
- [ ] Publisher cannot withdraw more than `earnedBalance`
- [ ] Cron sweeps handle empty pools gracefully

---

## Sustainability Recommendations

### Short Term (This Week)

1. **Cap total daily reader rewards** to 80% of `reader_pool.balance` (keep 20% reserve).
2. **Cap total daily bonuses** to `orgOperationalBudget * 0.1` (10% daily burn max).
3. **Add alerts** when `reader_pool.balance < 1000 NGN` or `orgOperationalBudget < 5000 NGN`.

### Medium Term (This Month)

1. **Implement real ad network callbacks** — even a single AdMob integration provides real revenue.
2. **Add revenue-sharing tiers** — publishers get 40% only after threshold; below threshold, 20%.
3. **Add "reward halving"** — if `reader_pool.balance / daily_reads < 1`, reduce reward to ₦0.5 instead of marking unfunded (keeps engagement during low-revenue periods).

### Long Term (Next Quarter)

1. **Move to credit-based system** — users earn "credits" not NGN; credits convert to NGN at month-end based on pool performance. This decouples engagement from immediate cash outflow.
2. **Implement KYC for withdrawals** — prevents Sybil attacks (one user with 100 accounts draining pool).
3. **Add advertiser dashboard** — real advertisers bidding on ad slots creates sustainable revenue.

---

## Files to Modify

| File | Change |
|------|--------|
| `src/services/ads/ReaderRewardService.js` | Dynamic reward calculation |
| `src/services/ads/AdRevenueService.js` | Bonus org budget debit |
| `src/services/ads/PublisherPoolService.js` | Auto-settlement, earned balance check |
| `src/models/User.js` | `addReward()` debit org budget |
| `src/models/Credit.js` | Remove/deprecate `calculateEarnings()` |
| `src/models/ReadSession.js` | Already fixed (concurrency) |
| `src/models/Publisher.js` | Add `earnedBalance` field |
| `src/plugins/cron-plugin.js` | Add monthly publisher settlement |
| `tests/unit/phase3Fixes.test.js` | Already implemented |

---

*End of Audit.*
