# Ad Revenue & Reward System — Technical Architecture

## 1. Overview

The platform generates revenue from ad placements across two page categories: **post pages** (article view) and **feed pages** (home/explore). Revenue is distributed into multiple pools in real-time as ad events fire, then settled to readers and publishers programmatically. A locked Org Reserve provides financial stability.

### Core Principle

Ad revenue funds the entire reward system. Users are not paid directly from ads — instead, ads generate the pool from which reader rewards and publisher shares are paid. No ad revenue = no rewards.

---

## 2. Revenue Distribution Model

### 2.1 Post Page Ad Revenue

When an ad event fires on a post page (e.g., `article_inline`, `article_endcap`), revenue is split three ways immediately:

```
Ad Event Revenue (100%)
    │
    ├── 30% → Reader Pool (distributed to users for completed reads)
    ├── 30% → Publisher Share (credited to the post's author)
    └── 40% → Org Operational (available immediately for platform costs)
```

### 2.2 Feed Page Ad Revenue

When an ad event fires on a feed page (e.g., `feed_native`, `feed_banner`, `sidebar`), revenue is split:

```
Ad Event Revenue (100%)
    │
    ├── 30% → Reader Pool (via daily sweep)
    └── 70% → Org Reserve (locked)
```

Feed pages are platform-owned inventory, not tied to any specific publisher's content. The 70% reserve ensures system sustainability during low-revenue periods.

### 2.3 Page Type Classification

| Page | Route | Classification |
|---|---|---|
| Post (article) | `/post/:slug` | Post page |
| Home (logged-in) | `/` | Feed page |
| Explore | `/browse` | Feed page |
| Category | `/category/:slug` | Feed page |
| Dashboard | `/dashboard` | Feed page |
| Profile | `/profile` | Feed page |
| Activity | `/activity` | Feed page |

---

## 3. Pool Architecture

### 3.1 Pool Definitions

| Pool | Source | Destination | Locked |
|---|---|---|---|
| **Reader Pool** | 30% post + 30% feed (daily sweep) | Reader rewards (completed reads) | No |
| **Publisher Share** | 30% post | Publisher withdrawals | No |
| **Org Operational** | 40% post | Platform operating costs | No |
| **Org Reserve** | 70% feed | Long-term stability | Yes (see 3.2) |

### 3.2 Org Reserve Unlock Criteria

The Org Reserve is locked until **all** the following criteria are met simultaneously:

- **A** — Reader Pool balance ≥ full day of average reader reward payouts, for 30 consecutive days
- **B** — Publisher settlements paid on time for 8 consecutive weeks
- **C** — Org Reserve balance ≥ 30 days of average reader reward payouts

When all criteria are met, 40% of the reserve may be unlocked to Org Operational. The remaining 60% stays locked. Criteria are re-evaluated daily.

### 3.3 Pool Math Details

When an ad event is recorded, the distribution creates **four** separate credit entries in the ledger:

```
AdEvent revenue: ₦0.0042 (cpm impression)

Ledger entries:
  CREDIT Reader Pool        ₦0.00126  (30%)
  CREDIT Publisher Pool     ₦0.00126  (30%) — post page only
  CREDIT Org Operating      ₦0.00168  (40%) — post page only
  CREDIT Org Reserve        ₦0.00294  (70%) — feed page only
```

All four entries are created atomically in the same transaction (`AdEvent._id` as the correlation ID linking to `LedgerEntry`).

---

## 4. Ledger Infrastructure

### 4.1 New Ledger Entry Actions

Extending the existing `LedgerEntry` action enum:

| Action | Debit/Credit | Pool Target | Notes |
|---|---|---|---|
| `ad_revenue_reader_pool` | Credit | Reader Pool | Funds the reader reward pool |
| `ad_revenue_publisher` | Credit | Publisher Pool | Per-author pool (post page only) |
| `ad_revenue_reserve` | Credit | Org Reserve | Locked reserve (feed page only) |
| `ad_revenue_operational` | Credit | Org Wallet | Available for platform costs |
| `reader_reward_payout` | Debit | Reader Pool → User | Deducts pool, credits user wallet |
| `publisher_settlement` | Debit | Publisher Pool → User | Deducts publisher pool, credits publisher's wallet |
| `reserve_unlock` | Debit | Org Reserve → Org Wallet | Admin-triggered, only when unlock criteria met |

### 4.2 AdEvent → Ledger Mapping

Every `AdEvent.create()` call must trigger distribution:

```
AdEvent created (type: impression|click|conversion)
    │
    ▼
AdRevenueService.distributeAdRevenue(adEvent, pageType)
    │
    ├── Identify publisher (if post page) from adEvent.metadata.postId
    ├── Calculate splits based on pageType + adType
    ├── Create LedgerEntry records (one per pool target)
    └── Link each LedgerEntry to AdEvent via correlationId = adEvent._id
```

### 4.3 LedgerEntry Schema Extension

```
_current LedgerEntry schema + new field:_

fundedBy: {
    type: String,
    enum: ['ad_revenue', 'system', 'reader_pool', 'publisher_pool'],
    default: 'system'
},

correlationId: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: 'correlationModel',
    index: true
},

correlationModel: {
    type: String,
    enum: ['AdEvent', 'ReadSession', 'Withdrawal'],
    default: 'ReadSession'
},

pool: {
    type: String,
    enum: ['reader_pool', 'publisher_pool', 'org_reserve', 'org_operational', 'user_wallet'],
    default: 'user_wallet'
}
```

---

## 5. Reader Reward Flow

### 5.1 Reward Eligibility

A reader qualifies for a reward when `ReadSession.markCompleted()` is called and:
- Minimum 30 seconds spent reading
- Scroll depth ≥ 90%
- Tab was visible during reading
- Session hasn't already been rewarded

### 5.2 Reward Payout Logic

```
markCompleted()
    │
    ▼
Check reader pool balance
    │
    ├── balance > 0
    │       │
    │       ▼
    │   Calculate reward (max ₦5 or pool balance if less)
    │   Debit reader pool
    │   Credit user wallet
    │   Create LedgerEntry: reader_reward_payout
    │   Mark session as rewarded
    │
    └── balance = 0
            │
            ▼
        Mark session as "unfunded"
        Increment user's pending reward count
        Max 3 pending unfunded reads per user
```

### 5.3 Unfunded Read Sweep (Daily)

```
Daily cron job (runs every 24h):
    │
    ▼
    Query all ReadSessions where rewardAwarded=false AND completed=true
    Group by user
    For each user with unfunded reads:
        Check reader pool balance
        If balance > 0:
            Sweep: credit user wallet for each unfunded read (up to 3)
            Create LedgerEntry: reader_reward_payout for each
            Mark sessions as rewarded
        If balance = 0:
            Skip until next daily sweep
```

### 5.4 Feed Page Daily Sweep

```
Daily cron job (runs daily):
    │
    ▼
    Aggregate all feed page ad revenue from last 24 hours
    Calculate 30% share
    Credit Reader Pool
    Create LedgerEntry: ad_revenue_reader_pool (sweep)
    Update ReaderPool daily tracking record
```

---

## 6. Publisher Share Flow

### 6.1 Publisher Identification

When an ad event fires on a post page, the publisher is identified via:
```
AdEvent.metadata.postId → Post → Post.author → User._id
```

This establishes which publisher's pool receives the 30% credit.

### 6.2 Publisher Withdrawal

Publishers request withdrawal from their individual pool:
```
Publisher request withdrawal
    │
    ▼
    Check publisher pool balance
    Deduct from publisher pool
    Credit publisher's user wallet
    Create LedgerEntry: publisher_settlement
    Proceed to normal withdrawal flow
```

### 6.3 No Publisher for Feed Ads

Feed ads (home, explore) have no publisher attribution — the full 70% goes to Org Reserve. No publisher pool entry is created for feed page ad events.

---

## 7. Audit Trail & Admin UI

### 7.1 Audit Requirements

Every financial transaction must be traceable:
- Each `LedgerEntry` stores `correlationId` → links to `AdEvent`, `ReadSession`, or `Withdrawal`
- Each `AdEvent` stores `postId` and `publisherId` in `metadata`
- Pool balances are computed on-the-fly from ledger aggregation (not stored as mutable fields)

### 7.2 Admin Earnings Page Data

The admin earnings page displays:

```
Revenue Overview (daily breakdown):
  ├── Post Page Ad Revenue
  │     ├── Impressions
  │     ├── Clicks
  │     ├── Conversions
  │     └── Total Revenue
  └── Feed Page Ad Revenue
        ├── Impressions
        ├── Clicks
        ├── Conversions
        └── Total Revenue

Pool Balances:
  ├── Reader Pool (current balance)
  │     └── Funding History (daily sweep log)
  ├── Publisher Pool (total across all publishers)
  │     └── Settlement Log
  └── Org Reserve
        ├── Locked Balance
        └── Unlockable Balance

Unlock Criteria Status:
  ├── [✓ / ✗] Criterion A: Reader pool ≥ 1 day avg payout for 30 days
  ├── [✓ / ✗] Criterion B: Publisher settlements on time for 8 weeks
  └── [✓ / ✗] Criterion C: Reserve ≥ 30 days avg reader rewards

Transaction Audit Trail:
  └── All LedgerEntry records (filterable by action, pool, date)
```

### 7.3 Key Metrics (Computed from Ledger)

| Metric | Query |
|---|---|
| Reader Pool Balance | `SUM(Credit) - SUM(Debit)` where `pool='reader_pool'` |
| Publisher Pool Balance | `SUM(Credit) - SUM(Debit)` where `pool='publisher_pool'` per user |
| Org Reserve Balance | `SUM(Credit)` where `pool='org_reserve'` |
| Daily Reader Payout Average | `AVG(daily SUM(Debit where action='reader_reward_payout'))` over last 30 days |
| Average Daily Ad Revenue | `AVG(daily SUM(Credit where action LIKE 'ad_revenue_%'))` over last 30 days |

---

## 8. Revenue Distribution Per Ad Type

### 8.1 Base Revenue Rates

These are the simulation constants used by `AdSimulationService`:

| Ad Type | Base CPM (₦) | Base CPC (₦) | Viewability Rate | CTR Range |
|---|---|---|---|---|
| `banner` | 2.00 | 0.10 | 55-95% | 0.5-2.0% |
| `interstitial` | 5.00 | 0.25 | 55-95% | 2.0-6.0% |
| `native` | 4.00 | 0.15 | 55-95% | 1.5-4.0% |
| `rewarded` | 10.00 | 0.50 | 55-95% | 8.0-20.0% |
| `video` | 8.00 | 0.30 | 55-95% | 3.0-8.0% |

### 8.2 Revenue Computation

```
impression_revenue = (baseCpm / 1000) * randomBetween(0.8, 1.2)
click_revenue     = baseCpc * randomBetween(0.8, 1.2)
conversion_revenue = baseCpc * 5 * randomBetween(0.8, 1.2)
```

### 8.3 Distribution Example (Post Page)

```
Ad Event: native impression on /post/tech-article
Revenue generated: ₦0.0040 (after random multiplier)

Distribution:
  Reader Pool     ₦0.0012  (30%)
  Publisher Pool  ₦0.0012  (30%) → credited to article author
  Org Operational ₦0.0016  (40%)
```

### 8.4 Distribution Example (Feed Page)

```
Ad Event: banner impression on /browse
Revenue generated: ₦0.0024 (after random multiplier)

Distribution:
  Reader Pool     ₦0.00072  (30%) → via daily sweep
  Org Reserve     ₦0.00168  (70%) → locked
```

---

## 9. Placement Slot Definitions

### 9.1 `article_inline`

| Property | Value |
|---|---|
| Page | Post page (`/post/:slug`) |
| Priority | High |
| Ad Types | Native, banner |
| Positions | Configurable per placement (e.g., after paragraph 3, after paragraph 7) |
| Content Splitting | Article content split into paragraphs server-side, ads injected at configurable positions |
| `noAdsBelow` | Maximum paragraph index beyond which no inline ad is placed (e.g., skip if article has < 5 paragraphs) |

### 9.2 `article_endcap`

| Property | Value |
|---|---|
| Page | Post page |
| Priority | High |
| Ad Types | Native, banner |
| Position | Between `</article>` and comments section |

### 9.3 `feed_native`

| Property | Value |
|---|---|
| Pages | Home (`/`), Explore (`/browse`) |
| Priority | High |
| Ad Types | Native |
| Position | After every 2 posts in the feed loop |
| Styling | Matches post card styling for native feel |

### 9.4 `feed_banner`

| Property | Value |
|---|---|
| Pages | Home (`/`), Explore (`/browse`) |
| Priority | Medium |
| Ad Types | Banner |
| Position | After every 2 posts (alternating with feed_native) |

### 9.5 `sidebar`

| Property | Value |
|---|---|
| Pages | Home, Explore |
| Priority | Medium |
| Ad Types | Banner |
| Position | In sidebar, sticky on scroll |

### 9.6 `interstitial`

| Property | Value |
|---|---|
| Page | Post page (on navigation) |
| Priority | High |
| Ad Types | Interstitial, rewarded |
| Trigger | User clicks "related post" link, interstitial shows before navigation |

### 9.7 `reward_wall`

| Property | Value |
|---|---|
| Pages | Dashboard reads page, dashboard pages |
| Priority | High |
| Ad Types | Rewarded |
| Flow | User clicks "Watch ad to unlock more reads" → modal with rewarded ad → reward credited → reads unlocked |

---

## 10. Implementation Phases

### Phase 1: Ledger Infrastructure for Ad Revenue (`AdRevenueService`)

- Create `AdRevenueService.js` with `distributeAdRevenue()`
- Extend `LedgerEntry` schema with `fundedBy`, `correlationId`, `correlationModel`, `pool` fields
- Create `ReaderPoolService.js` with pool balance query, daily sweep logic
- Create `OrgReserveService.js` with unlock criteria evaluation
- Wire `AdSimulationService.simulateImpression()/Click()/Conversion()` → `AdRevenueService.distributeAdRevenue()`
- Wire `AdSimulationService.triggerRewardedAd()` → `AdRevenueService.distributeAdRevenue()`
- Tests: distribution splits, pool balances, correlation linking

### Phase 2: Reader Reward Pool & Payout

- Create `ReaderRewardService.js`:
  - `computeReaderReward(readSession)` — max ₦5, capped by pool balance
  - `payoutReaderReward(readSession)` — debits pool, credits user, creates LedgerEntry
  - `handleUnfundedRead(readSession)` — marks session, increments pending count (max 3)
  - `sweepUnfundedReads()` — daily job
- Update `ReadSession.markCompleted()` → delegate to `ReaderRewardService`
- Wire in `User.addReward()` — ensure `fundedBy: 'reader_pool'` on created LedgerEntry
- Tests: pool payout, unfunded read cap, daily sweep

### Phase 3: Daily Sweep from Feed Revenue

- Create cron job: `dailyFeedRevenueSweep()`
  - Aggregates feed page `AdEvent` revenue for last 24h
  - Calculates 30%
  - Credits Reader Pool with LedgerEntry
- Create cron job: `dailyReaderRewardSweep()`
  - Processes all unfunded reads
  - Credits users with available pool balance
- Tests: sweep math, unfunded read resolution, pool balance after sweep

### Phase 4: Publisher Share Integration

- Create `PublisherPoolService.js`:
  - `distributePublisherShare(adEvent, publisherId)` — credits publisher's pool
  - `getPublisherBalance(publisherId)` — aggregates from LedgerEntry
  - `settlePublisherPayout(publisherId, amount)` — debits pool, credits user wallet
- Wire into `AdRevenueService.distributeAdRevenue()` for post page ad events
- Update publisher dashboard to show publisher pool balance
- Tests: per-publisher pool isolation, settlement flow

### Phase 5: Org Reserve & Unlock Criteria

- Create `OrgReserveService.js`:
  - `lockRevenue(amount)` — credits Org Reserve
  - `evaluateUnlockCriteria()` — checks criteria A, B, C
  - `unlockReserve(percentage)` — only when criteria met, only by admin
- Create admin endpoint: `POST /api/admin/reserve/unlock`
- Create admin endpoint: `GET /api/admin/reserve/status` — returns criteria status, balances
- Tests: unlock criteria evaluation, reserve accounting

### Phase 6: Admin UI

- Update admin earnings page with:
  - Revenue breakdown (post vs feed)
  - Pool balances (reader, publisher, reserve)
  - Unlock criteria status indicators
  - Full transaction audit trail (LedgerEntry explorer)
- Wire `GET /api/admin/earnings` endpoint to aggregate from LedgerEntry
- Tests: endpoint response shape, aggregation queries

### Phase 7: Ad Placement Template Wiring

- Create placement partials in `src/views/partials/ads/`
- Wire `article_inline` into `post.ejs` (server-side paragraph splitting)
- Wire `article_endcap` into `post.ejs`
- Wire `feed_native` and `feed_banner` into feed partials
- Wire `sidebar` into home/explore sidebar partials
- Wire `interstitial` modal into post.ejs (triggered on related post click)
- Wire `reward_wall` into dashboard pages
- Tests: each partial renders safely, layout breakage prevention

---

## 11. Data Flow Diagrams

### 11.1 Post Page Ad → Distribution

```
User reads post
    │
    ▼
AdSimulationService.triggerAdForUser(slot='article_inline')
    │
    ├── selectAdConfig → AdConfig
    ├── simulateImpression → AdEvent(impression)
    │       │
    │       ▼
    │   AdRevenueService.distributeAdRevenue(adEvent, 'post')
    │       │
    │       ├── LedgerEntry(ad_revenue_reader_pool)   CREDIT Reader Pool
    │       ├── LedgerEntry(ad_revenue_publisher)      CREDIT Publisher Pool (authorId)
    │       └── LedgerEntry(ad_revenue_operational)    CREDIT Org Wallet
    │
    ├── (optional) simulateClick → AdEvent(click)
    │       │
    │       ▼
    │   AdRevenueService.distributeAdRevenue(adEvent, 'post')
    │       │
    │       ├── LedgerEntry(ad_revenue_reader_pool)   CREDIT Reader Pool
    │       ├── LedgerEntry(ad_revenue_publisher)      CREDIT Publisher Pool (authorId)
    │       └── LedgerEntry(ad_revenue_operational)    CREDIT Org Wallet
    │
    └── (optional) simulateConversion → AdEvent(conversion)
            │
            ▼
        AdRevenueService.distributeAdRevenue(adEvent, 'post')
            │
            ├── LedgerEntry(ad_revenue_reader_pool)   CREDIT Reader Pool
            ├── LedgerEntry(ad_revenue_publisher)      CREDIT Publisher Pool (authorId)
            └── LedgerEntry(ad_revenue_operational)    CREDIT Org Wallet
```

### 11.2 Feed Page Ad → Distribution

```
User scrolls feed
    │
    ▼
AdSimulationService.triggerAdForUser(slot='feed_native')
    │
    ├── simulateImpression → AdEvent(impression)
    │       │
    │       ▼
    │   AdRevenueService.distributeAdRevenue(adEvent, 'feed')
    │       │
    │       ├── LedgerEntry(ad_revenue_reader_pool)   CREDIT Pending reader pool (daily sweep)
    │       └── LedgerEntry(ad_revenue_reserve)        CREDIT Org Reserve (locked)
    │
    └── (optional) simulateClick → AdEvent(click)
            │
            ▼
        AdRevenueService.distributeAdRevenue(adEvent, 'feed')
            │
            ├── LedgerEntry(ad_revenue_reader_pool)   CREDIT Pending reader pool (daily sweep)
            └── LedgerEntry(ad_revenue_reserve)        CREDIT Org Reserve (locked)
```

### 11.3 Reader Completion → Reward

```
User completes reading (scroll ≥ 90%, time ≥ 30s)
    │
    ▼
ReadSession.markCompleted()
    │
    ▼
ReaderRewardService.payoutReaderReward(session)
    │
    ├── Query LedgerEntry: balance = SUM(ad_revenue_reader_pool) - SUM(reader_reward_payout)
    │
    ├── balance ≥ maxReward (₦5)?
    │       YES → Debit Reader Pool ₦5
    │              Credit User Wallet ₦5
    │              LedgerEntry(reader_reward_payout)
    │
    └── balance = 0?
            → ReaderRewardService.handleUnfundedRead(session)
            → Session marked unfunded (counter ≤ 3)
```

### 11.4 Daily Sweep

```
Daily cron job
    │
    ├── 1. Feed Revenue Sweep
    │       │
    │       ▼
    │   Aggregate all feed page AdEvent.createdAt from last 24h
    │   readerPoolContribution = SUM(revenue) * 0.30
    │   LedgerEntry(ad_revenue_reader_pool) CREDIT Reader Pool: readerPoolContribution
    │
    └── 2. Unfunded Read Sweep
            │
            ▼
        Find all unfunded ReadSessions (rewardAwarded=false, completed=true)
        Check Reader Pool balance
        For each user (max 3 per user):
            Debit Reader Pool ₦5
            Credit User Wallet ₦5
            LedgerEntry(reader_reward_payout)
            Mark session rewarded
```

---

## 12. Database Schema Changes

### 12.1 LedgerEntry Extension

```
// New fields on existing LedgerEntry schema
fundedBy: {
    type: String,
    enum: ['ad_revenue', 'system', 'reader_pool', 'publisher_pool'],
    default: 'system'
},
correlationId: {
    type: ObjectId,
    refPath: 'correlationModel',
    index: true
},
correlationModel: {
    type: String,
    enum: ['AdEvent', 'ReadSession', 'Withdrawal'],
    default: 'ReadSession'
},
pool: {
    type: String,
    enum: ['reader_pool', 'publisher_pool', 'org_reserve', 'org_operational', 'user_wallet'],
    default: 'user_wallet'
}
```

### 12.2 ReadSession Extension

```
// New fields on existing ReadSession schema
rewardAwarded: { type: Boolean, default: false },       // existing
rewardAmount: { type: Number, default: 0 },              // existing
fundedByPool: { type: Boolean, default: false },         // new — true if funded from reader pool
isUnfunded: { type: Boolean, default: false },           // new — true if pool was empty
poolPayoutAt: { type: Date },                            // new — when pool sweep paid this
userPendingCount: { type: Number, default: 0 }           // new — user's unfunded count (max 3)
```

### 12.3 AdEvent Metadata Extension

```
metadata: {
    ...existingFields,
    postId: ObjectId,       // populated for post page ads
    publisherId: ObjectId,  // populated for post page ads
    pageType: String,       // 'post' | 'feed'
    slot: String,           // 'article_inline' | 'feed_native' | etc.
    poolDistribution: {     // snapshot of what was distributed
        readerPool: Number,
        publisherPool: Number,
        orgOperational: Number,
        orgReserve: Number
    }
}
```

### 12.4 User Wallet Extension

```
wallet: {
    ...existing fields,
    pendingUnfundedReads: { type: Number, default: 0, max: 3 },
    totalReaderRewards: { type: Number, default: 0 },
    totalPublisherEarnings: { type: Number, default: 0 },
    lastPoolSweepAt: { type: Date }
}
```

---

## 13. Service Layer

### 13.1 `AdRevenueService.js`

```
distributeAdRevenue(adEvent, pageType):
    - Determine splits based on pageType
    - If post page: identify publisher from adEvent.metadata.postId → Post → author
    - Create LedgerEntry records for each pool
    - Store poolDistribution in adEvent.metadata
    - Return array of created LedgerEntry IDs

generatePoolDistribution(adEvent, pageType):
    - Post page: { reader: 0.30, publisher: 0.30, org: 0.40 }
    - Feed page: { reader: 0.30, reserve: 0.70 }
    - Returns object with calculated amounts

getPoolBalance(pool):
    - Aggregates LedgerEntry by pool name
    - Returns current balance (Credit - Debit)
```

### 13.2 `ReaderRewardService.js`

```
payoutReaderReward(readSession):
    - Check reader pool balance
    - If sufficient: debit pool, credit user wallet, create LedgerEntry
    - If insufficient: delegate to handleUnfundedRead
    - Returns { rewarded, amount, poolBalanceAfter }

handleUnfundedRead(readSession):
    - Check user's pendingUnfundedReads < 3
    - Mark session as unfunded
    - Increment user.pendingUnfundedReads
    - Returns { markedUnfunded, pendingCount }

sweepUnfundedReads():
    - Find all unfunded ReadSessions (isUnfunded=true, rewardAwarded=false)
    - Group by user
    - For each group: debit reader pool, credit users, mark funded
    - Returns { usersPaid, sessionsPaid, totalAmount }

getReaderPoolBalance():
    - LedgerEntry.aggregate for pool='reader_pool'
    - Returns sum(credit) - sum(debit)

getDailyAveragePayout():
    - Last 30 days of reader_reward_payout entries
    - Returns average daily amount
```

### 13.3 `OrgReserveService.js`

```
lockRevenue(amount):
    - LedgerEntry.create({ action: 'ad_revenue_reserve', pool: 'org_reserve', ... })
    - Returns LedgerEntry

evaluateUnlockCriteria():
    - Check A: reader pool ≥ 1 day avg payout for 30 consecutive days
    - Check B: publisher settlements on time for 8 weeks
    - Check C: reserve ≥ 30 days avg reader rewards
    - Returns { criteriaA: bool, criteriaB: bool, criteriaC: bool, allMet: bool }

unlockReserve(percentage):
    - Only if evaluateUnlockCriteria().allMet
    - Calculates unlockable amount = reserveBalance * percentage (max 40%)
    - Creates LedgerEntry: reserve_unlock
    - Returns { unlocked: amount, remainingLocked }

getReserveStatus():
    - Returns { lockedBalance, totalDeposited, lastUnlockAt, criteria }

getDailyReserveDeposit():
    - Aggregates past 24h of ad_revenue_reserve entries
```

### 13.4 `PublisherPoolService.js`

```
distributePublisherShare(adEvent, publisherId):
    - LedgerEntry.create({ action: 'ad_revenue_publisher', pool: 'publisher_pool', ... })
    - Metadata includes publisherId
    - Returns LedgerEntry

getPublisherBalance(publisherId):
    - Aggregates all LedgerEntry where pool='publisher_pool' and userId=publisherId
    - Returns current balance

settlePublisherPayout(publisherId, amount):
    - Deduct from publisher pool
    - Credit user wallet
    - Creates LedgerEntry: publisher_settlement
    - Returns { settled: amount, poolBalanceAfter }

getAllPublisherBalances():
    - Aggregates publisher pool across all publishers
    - Returns array of { publisherId, balance }

getPublisherSettlementStatus(publisherId):
    - Last settlement date, amount
    - Current balance
    - Settlement history (last 8 weeks)
```

---

## 14. Ad Placement Template Wiring

### 14.1 Post Page Paragraph Splitting

The article content is split into paragraphs server-side in the route handler:

```javascript
// In routes/pages.js post route handler
function splitIntoParagraphs(html) {
    // Split on </p> or <br> or double newlines
    // Returns array of paragraph HTML strings
}

// Get placements for this page
const placements = AdPlacementService.getPlacementsForPage('post', userContext);
const inlinePlacements = placements.filter(p => p.slot === 'article_inline');
const articleParagraphs = splitIntoParagraphs(post.content);

// Inject ads at configured positions
// "after paragraph 3" = at index 3
// Skip if article has fewer paragraphs than positionConfig.minParagraphs
```

### 14.2 Template Injection Pseudocode

```
<%# post.ejs - Article content with inline ads %>
<% if (articleParagraphs && articleParagraphs.length > 0) { %>
    <article class="post-article-shell">
        <div class="article-content" id="article-content">
            <% articleParagraphs.forEach(function(paragraph, index) { %>
                <%- paragraph %>
                <%# Inject ad after configured paragraph positions %>
                <% if (inlinePlacements.some(p => p.positionConfig.afterParagraph === index + 1)) { %>
                    <div class="ad-inline-slot" data-slot="article_inline">
                        <%- include('../partials/ads/_ad-inline', {
                            adConfig: inlineAdConfig,
                            placement: inlinePlacements.find(p => p.positionConfig.afterParagraph === index + 1)
                        }) %>
                    </div>
                <% } %>
            <% }); %>
        </div>
    </article>
<% } %>
```

### 14.3 Feed Ad Injection

```
<%# In explore-feed.ejs or home-activity-feed.ejs %>
<% posts.forEach(function(post, index) { %>
    <%# Show post card %>
    <%- include('./feed-post-card', { post: post }) %>
    
    <%# Show ad after every 2 posts %>
    <% if ((index + 1) % 2 === 0) { %>
        <div class="ad-feed-slot" data-slot="feed_native">
            <%- include('../ads/_ad-native', {
                adConfig: feedAdConfig,
                placement: feedPlacement
            }) %>
        </div>
    <% } %>
<% }); %>
```

---

## 15. Key Implementation Rules

1. **No inline require()** — all imports at top level
2. **Atomic distributions** — all LedgerEntry records for a single AdEvent created in same transaction (use Mongoose session if available)
3. **No silent failures** — if distribution fails, the AdEvent is still recorded but flagged with `distributionFailed: true` in metadata for manual reconciliation
4. **No breaking changes** — existing models, views, API endpoints unchanged
5. **Hard cap on all pools** — `pool` enum values are fixed; new pools require schema migration
6. **Unfunded reads capped at 3** — per user; when pool is empty, only 3 reads can accumulate before new completions don't count
7. **Daily sweep runs no more than once per 24h** — idempotent, checks last sweep timestamp
8. **Admin reserve unlock never exceeds 40%** — of current locked balance at time of unlock

---

## 16. Test Plan

| Suite | Tests | Scope |
|---|---|---|
| `adRevenueDistribution.test.js` | 15 | Pool split math, page type routing, publisher identification, edge cases |
| `readerRewardPayout.test.js` | 12 | Pool debit, user credit, unfunded read cap, max 3 limit, sweep |
| `dailySweep.test.js` | 8 | Feed revenue aggregation, unfunded sweep, idempotency |
| `orgReserve.test.js` | 10 | Lock accounting, unlock criteria A/B/C, partial unlock, admin-only gate |
| `publisherPool.test.js` | 10 | Per-publisher isolation, settlement, withdrawal from pool |
| `adPlacementService.test.js` | 15 | Page routing, condition evaluation, frequency limits, fallback/no-ad |
| `adminEarningsEndpoint.test.js` | 8 | Aggregation queries, response shape, filters |

---

## 17. Environment Variables

```bash
# Reward System
MAX_REWARD_PER_READ=5               # ₦5 maximum per completed read
MAX_UNFUNDED_READS_PER_USER=3       # Cap on pending unfunded reads
READER_POOL_DAILY_SWEEP_PERCENT=30  # Feed revenue → Reader Pool
RESERVE_UNLOCK_MAX_PERCENT=40       # Max unlock per trigger
ORG_OPERATIONAL_SHARE=0.40          # 40% for post page ads
PUBLISHER_SHARE=0.30                # 30% for post page ads
READER_POOL_SHARE=0.30              # 30% for both post + feed (daily sweep)
RESERVE_SHARE=0.70                  # 70% for feed page ads
```
