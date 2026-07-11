# Ads Engine — Provider-Agnostic Architecture

## Status

Approved. Implementation-ready.

## Objective

Replace the current ad-serving surface (`AdPlacementService` + `AdSimulationService` ad-hoc wiring) with a provider-agnostic Ads Engine. The revenue/distribution pipeline (`AdRevenueService`, `PublisherPoolService`, `ReaderRewardService`, `OrgReserveService`) and existing ad models (`AdEvent`, `AdConfig`, `AdPlacement`, `ABTest`, `FrequencyRule`) are preserved.

## Scope

- Rewrite ad-serving path through a provider interface
- Keep revenue/distribution pipeline untouched
- Preserve backward compatibility for all EJS templates and route handlers
- New providers can be added later without frontend changes

## Directory Structure

All new files follow the project's existing `src/services/`, `src/routes/`, `src/config/` layout.

```
src/
  services/
    ads/
      index.js                       # barrel export (updated)
      ProviderService.js             # NEW — central orchestrator
      AnalyticsService.js            # NEW — aggregation queries
      providers/
        AdProviderInterface.js       # NEW — interface contract
        MockProvider.js              # NEW — refactored from AdPlacementService
        ProviderFactory.js           # NEW — env-based selection
        RotationStrategy.js          # NEW — rotation strategies
        CacheManager.js              # NEW — optional caching
      AdRevenueService.js            # KEPT
      AdSimulationService.js         # KEPT (used internally by MockProvider)
      PublisherPoolService.js        # KEPT
      ReaderRewardService.js         # KEPT
      OrgReserveService.js           # KEPT
  routes/
    ads.js                           # NEW — API endpoints
  config/
    ads.js                           # NEW — environment config
  models/
    ads/                             # ALL KEPT (AdEvent, AdConfig, etc.)
```

## Provider Interface

Each provider implements `AdProviderInterface`:

| Method | Params | Returns |
|---|---|---|
| `get name` | — | `'mock'` |
| `getAds(options)` | `{ placement, user, sessionId, count, pageType }` | `Ad[]` |
| `recordImpression(data)` | `{ adId, provider, placement, userId, sessionId, device, browser, country }` | `void` |
| `recordClick(data)` | `{ adId, provider, placement, userId, destination, referrer, device }` | `void` |

## Return Shape

Backward-compatible with all existing EJS partials (which check `ad.served`):

```js
{
  served: true,             // existing — EJS gate
  adType: 'banner',         // existing
  imageUrl: '...',          // existing
  clickUrl: '...',          // existing
  impressionId: '...',      // existing
  adConfigId: '...',        // existing
  slot: 'feed_native',      // existing
  placement: 'feed',        // new — for API consumers
  provider: 'mock',         // new — for analytics
  nativeAd: {               // new — optional, for native feed ads
    title: '...',
    description: '...',
    image: '...',
    cta: '...',
    sponsored: true
  }
}
```

## MockProvider

Refactors the current `AdPlacementService` logic:

- Slot→placement mapping (`AD_SLOT_MAP`) becomes MockProvider internal
- `getAds()` calls `AdSimulationService.triggerAdForUser()` for real simulated ads
- Falls back to `getDemoAd()` (placeholder SVGs from `getAdImageUrl()`) — same as today
- `recordImpression()` / `recordClick()` delegate to `AdSimulationService` which creates `AdEvent` docs and triggers revenue distribution

## ProviderService (Orchestrator)

Main entry point for all ad requests:

1. **Role check** — Guest/Registered → enabled; Premium/Admin → disabled (configurable via `ADS_DISABLE_FOR_ROLES`)
2. **Cache check** — If `ADS_CACHE_ENABLED`, return cached response keyed by `placement+provider+device+locale`
3. **Provider selection** — Factory returns active provider (respecting rotation strategy)
4. **Failover** — If provider throws, log error, fall back to MockProvider
5. **Return** — Standardized ad object to caller

### Rotation Strategies

| Strategy | Behavior |
|---|---|
| `none` | Always use `ADS_PROVIDER` (default) |
| `random` | Random pick from configured list |
| `round-robin` | Sequential cycling |
| `weighted` | Probability-weighted (e.g. Mock 70%, Monetag 20%) |

Config-only. Only MockProvider exists now.

## API Endpoints

Registered at `/api/ads`:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/ads?placement=X&count=1` | Get ads for placement |
| `GET` | `/api/ads/:placement?count=1` | Get ads for named placement |
| `POST` | `/api/ads/:id/impression` | Record impression |
| `POST` | `/api/ads/:id/click` | Record click |

All return JSON. EJS templates fetch ads server-side (via `ProviderService.getAd()`) and render through existing partials.

## Tracking

Impressions and clicks go through the provider interface. For MockProvider:

- `recordImpression()` calls `AdSimulationService.simulateImpression()` → creates `AdEvent` doc
- `recordClick()` calls `AdSimulationService.simulateClick()` → creates `AdEvent` doc
- Revenue distribution happens downstream via existing `AdRevenueService` (unchanged)

## AnalyticsService

Aggregation queries on `AdEvent` using MongoDB `aggregate()`:

- `getDailyImpressions(from, to)`
- `getDailyClicks(from, to)`
- `getCTR(from, to)`
- `getTopAds(limit)`
- `getWorstAds(limit)`
- `getProviderStats()`
- `getPlacementStats()`

No new models. Operators only. Dashboard not required.

## Native Feed Ads

MockProvider returns a `nativeAd` payload alongside standard fields. The existing `ad-feed.ejs` partial renders feed-native cards. The `nativeAd` object enriches the card with `title`, `description`, `image`, `cta`, and a `Sponsored` badge.

## Sponsored Content Architecture

Placeholder model files only (no routes, no services, no frontend):

- `src/models/ads/SponsoredArticle.js` — future sponsored posts
- `src/models/ads/SponsoredCampaign.js` — future campaign management

## Configuration

```env
ADS_ENABLED=true                       # master toggle
ADS_PROVIDER=mock                      # active provider
ADS_ROTATION=none                      # rotation strategy
ADS_CACHE_ENABLED=false                # enable caching
ADS_CACHE_TTL=300                      # cache TTL in seconds
ADS_TRACK_IMPRESSIONS=true             # enable impression tracking
ADS_TRACK_CLICKS=true                  # enable click tracking
ADS_DISABLE_FOR_ROLES=premium,administrator
```

Loading from `src/config/ads.js` following the existing config pattern.

## Backward Compatibility

- EJS partials check `typeof ad !== 'undefined' && ad && ad.served` — unchanged
- `served`, `imageUrl`, `clickUrl`, `adType`, `slot`, `impressionId`, `adConfigId` all preserved
- Route handlers call `ProviderService.getAd({ placement, ... })` instead of `getAdForSlot(slotName, ...)`
- Existing `ad-feed.ejs`, `ad-sidebar.ejs`, `ad-inline.ejs`, `ad-banner.ejs`, `ad-rewarded.ejs` all work unmodified
