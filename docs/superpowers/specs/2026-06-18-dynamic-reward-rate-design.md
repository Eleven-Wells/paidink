# Dynamic Reward Rate System — Design Spec

> **Status:** Design Approved — MVP Ready  
> **Date:** 2026-06-18  
> **Scope:** Dynamic per-read rate, anti-gaming (MVP), admin dashboard, transparency

---

## 1. Executive Summary

Replace the fixed 500 kobo (5 NGN) per-read reward with a **dynamic rate** calculated from a rolling 7-day window of reader pool revenue and total completed reads. This makes the system self-adjusting — rewards rise when revenue rises, fall when revenue falls — eliminating pool exhaustion and deferred/unfunded reads entirely.

---

## 2. Core Architecture

### 2.1 Revenue Flow (Unchanged)

```
Ad Revenue (real or simulated)
        │
        ├── 30% reader_pool → divided by total reads (7d rolling) → per-read rate
        ├── 30% publisher_pool → per-publisher (settled separately)
        └── 40% org_operational → org funds
```

The revenue split ratios stay the same. Only the payout calculation changes.

### 2.2 Dynamic Rate Calculation

```javascript
rate_kobo = total_reader_pool_deposits_7d / total_completed_reads_7d
```

| Parameter | Value | Why |
|-----------|-------|-----|
| Window | Rolling 7 days | Smooths daily variance, responsive within a week |
| Refresh | Every hour | Fresh enough without excessive computation |
| Floor | 10 kobo (0.10 NGN) | Users always earn something |
| Ceiling | 2000 kobo (20 NGN) | Prevents windfall exploitation during low-read periods |

**`total_reader_pool_deposits_7d`** — Sum of all `LedgerEntry` records in the last 7 days where the entry credits the reader pool:
- `type: 'ad_revenue_reader_pool'` (post-page ad revenue share, feed sweep)
- `pool: 'reader_pool'`
- `status: 'completed'`

**`total_completed_reads_7d`** — Count of all `ReadSession` records in the last 7 days where `rewardAwarded: true`.

### 2.3 Rate Storage

The computed rate is stored in a simple `SystemConfig` collection (key-value) or Redis:

```
key: "dynamic_read_rate_kobo"
value: 350       // current rate in kobo
updatedAt: Date  // when last refreshed
```

The rate is fetched by the server on read completion and injected into template rendering (like `getReadTime` is currently injected).

### 2.4 What Changes vs Stays

| Component | Current | MVP |
|-----------|---------|-----|
| Read reward amount | Fixed 500 kobo | Dynamic (10-2000 kobo) |
| Pool exhaustion | Session goes unfunded | Impossible (rate adjusts) |
| Unfunded read sweep | Required | REMOVED — no unfunded reads |
| MAX_UNFUNDED (3 cap) | Required | REMOVED |
| PayoutReaderReward | Checks pool, may defer | Always pays (rate ≤ pool) |
| Per-read rate display | Not shown | Shown on dashboard + reads page |
| ReadSession.rewardAmount | 500 or 0 | Dynamic value |

---

## 3. Anti-Gaming (MVP)

### 3.1 Measures

| Gap | Fix | Where |
|-----|-----|-------|
| Unlimited reads/day | **Daily cap: 100 reads** per user | `POST /api/reads/start` — check `getTodayReads()` |
| Same-post re-reading | **24h cooldown** per post | Check for completed session on same post today |
| Read speed gaming | **Minimum 10% of expected read time** | `wordCount * (60/200) * 0.10` — computed at session start, enforced on complete |
| No session gap | **3-second minimum** between consecutive sessions | Track `lastSessionStart` in user record |
| Scroll progress fraud | **Igored for reward** — time-based only | Remove `scrollProgress` from reward eligibility |

### 3.2 Existing Protections (Stay)

- JWT authentication on all read routes
- Server-side `startedAt`/`endedAt` timestamps (not client-reported)
- `rewardAwarded` boolean guard per session
- Optimistic concurrency on wallet balance updates (`findOneAndUpdate` with balance condition)
- Global rate limiter (50 POST/min)
- ReadSession ownership check (users can only complete their own sessions)

### 3.3 Configuration Constants

```javascript
const DAILY_READ_CAP = 100;
const POST_READ_COOLDOWN_HOURS = 24;
const MIN_SESSION_GAP_SECONDS = 3;
const MIN_READ_SPEED_FRACTION = 0.10; // 10% of expected time
const WORDS_PER_MINUTE = 200;         // average reading speed
```

---

## 4. Transparency & Display

### 4.1 User-Facing

**Dashboard** (`src/views/pages/dashboard.ejs`):
- *"Current read rate: ~3.5 NGN per read"* — displayed prominently under balance
- *"Rate updated 2 hours ago | Based on last 7 days of platform activity"*

**Reads page** (`src/views/pages/reads.ejs`):
- Rate history: last 7 days displayed as a simple list with date + rate per day

**Before reading** (optional, in post page):
- *"Complete this article to earn ~3.5 NGN"*

### 4.2 Admin Dashboard

New admin panel section showing:
- **Pool Balances**: reader_pool, publisher_pool, org_operational, org_reserve (live)
- **7-Day Revenue Chart**: ad revenue by type (banner, native, rewarded, etc.)
- **7-Day Read Volume**: total completed reads per day
- **Current Dynamic Rate**: with breakdown (total_revenue_7d / total_reads_7d = rate)
- **Publisher Pool Balances**: list with manual settlement action

### 4.3 API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/rewards/rate` | Returns current dynamic rate + 7d stats |
| `GET` | `/api/admin/pools` | All pool balances + revenue stats |
| `POST` | `/api/admin/publisher/settle` | Settle publisher pool to wallet |

---

## 5. Files to Modify

| File | Change |
|------|--------|
| `src/services/RewardRateService.js` | **NEW** — Dynamic rate calculation + caching |
| `src/models/SystemConfig.js` | **NEW** — Key-value store for rate + config |
| `src/models/User.js` | Add `lastSessionStart` field; remove `pendingUnfundedReads` eventually |
| `src/models/ReadSession.js` | Replace `READ_REWARD` usage with dynamic rate; remove unfunded read logic |
| `src/services/ads/ReaderRewardService.js` | Simplify: always pays, no unfunded handling; rate fetched from service |
| `src/routes/reads.js` | Add daily cap check, post cooldown check, session gap check, speed validation |
| `src/routes/api.js` | Add `GET /api/rewards/rate` endpoint |
| `src/routes/pages.js` | Inject rate into dashboard + reads page rendering |
| `src/views/pages/dashboard.ejs` | Display current rate |
| `src/views/pages/reads.ejs` | Display rate history |
| `src/views/admin/dashboard.ejs` | Admin pool/revenue overview |
| `src/cron/index.js` | Add hourly rate recalculation cron; remove unfunded sweep cron |
| `src/plugins/cron-plugin.js` | Update cron schedules |

---

## 6. Testing Plan

| Test File | Scope |
|-----------|-------|
| `tests/unit/rewardRateService.test.js` | Rate calculation, bounds, 7d window, caching |
| `tests/unit/readsAntiGaming.test.js` | Daily cap, cooldown, session gap, speed check |
| `tests/integration/rewardFlow.test.js` | Complete flow: read → dynamic rate → wallet credit |

---

## 7. Future Phases (Post-MVP)

1. **Engagement-based scoring** (Approach B) — weight reads by time, scroll depth, content length
2. **Tiered system** (Approach C) — verified users get higher caps/rates
3. **Real ad network integration** — replace simulation with actual AdMob/etc callbacks
4. **Publisher auto-settlement** — automatic monthly payout from publisher pool
5. **KYC for withdrawals** — prevent Sybil attacks at scale
