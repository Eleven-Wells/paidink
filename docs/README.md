# Nook Documentation

## Reward System

The Nook reward system pays users (readers and publishers) from platform ad revenue. All financial values are stored in **kobo** (1 NGN = 100 kobo).

### Key Documents

| Document | Description |
|----------|-------------|
| [`AD_REVENUE_SYSTEM.md`](./AD_REVENUE_SYSTEM.md) | Full technical architecture — revenue splits, pool system, ledger, ad placements |
| [`REWARD_SUSTAINABILITY_AUDIT.md`](./REWARD_SUSTAINABILITY_AUDIT.md) | Audit of financial flaws found and fixes applied (May 2026) |
| [`superpowers/specs/2026-06-18-dynamic-reward-rate-design.md`](./superpowers/specs/2026-06-18-dynamic-reward-rate-design.md) | Design spec for replacing fixed reward rate with dynamic 7-day rolling rate |
| [`superpowers/plans/2026-06-18-dynamic-reward-rate.md`](./superpowers/plans/2026-06-18-dynamic-reward-rate.md) | Implementation plan for the dynamic reward rate feature |

### System Overview

```
Ad Revenue
    │
    ├── 30% → reader_pool → dynamic per-read rate (10-2000 kobo)
    ├── 30% → publisher_pool → per-publisher settlement
    └── 40% → org_operational → platform costs + team
```

Reader rewards are no longer fixed at 500 kobo/read. The rate adjusts hourly based on a rolling 7-day window of ad revenue divided by total reads.

### Core Files

| File | Role |
|------|------|
| `src/services/ads/ReaderRewardService.js` | Reader pool payouts and sweep |
| `src/services/ads/AdRevenueService.js` | Ad revenue distribution to pools |
| `src/services/ads/AdSimulationService.js` | Simulated ad events (for testing) |
| `src/services/RewardRateService.js` | **NEW** — Dynamic rate calculation |
| `src/models/ReadSession.js` | Read tracking, reward calculation |
| `src/models/User.js` | Wallet schema (balance, lifetimeEarned, etc.) |
| `src/models/LedgerEntry.js` | Immutable financial audit trail |
| `src/models/Transaction.js` | User-facing transaction records |

### Architecture

```
src/
├── services/
│   └── ads/
│       ├── AdRevenueService.js      — Revenue distribution
│       ├── ReaderRewardService.js    — Reader pool payouts
│       ├── AdSimulationService.js    — Test ad events
│       ├── PublisherPoolService.js   — Publisher earnings
│       └── OrgReserveService.js      — Locked reserve management
│   ├── RewardRateService.js          — Dynamic rate computation (NEW)
│   ├── PaystackService.js            — Withdrawal integration
│   └── NotificationService.js        — Reward notifications
├── models/
│   ├── ReadSession.js                — Read tracking + reward logic
│   ├── User.js                       — Wallet schema
│   ├── LedgerEntry.js                — Audit trail
│   └── Transaction.js                — User-facing records
├── routes/
│   ├── reads.js                      — Read session API
│   ├── api.js                        — Rewards rate endpoint
│   └── admin.js                      — Pool admin dashboard
└── views/
    ├── pages/dashboard.ejs           — User dashboard (rate display)
    └── admin/                        — Admin pool overview
```
