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
      ProviderService.js             # NEW — orchestrator (serving, role rules,
                                     #         frequency capping, failover)
      AnalyticsService.js            # NEW — aggregation queries, subscribes
                                     #         to events emitted by ProviderService
      EventBus.js                    # NEW — simple pub/sub for ad events
      AdvertisementRenderer.js       # NEW — selects EJS partial by ad type
      providers/
        AdProviderInterface.js       # NEW — interface contract
        MockProvider.js              # NEW — refactored from AdPlacementService
        ProviderFactory.js           # NEW — registry-based factory
        RotationStrategy.js          # NEW — rotation strategies
        CacheManager.js              # NEW — caches provider responses only
      AdRevenueService.js            # KEPT
      AdSimulationService.js         # KEPT (used internally by MockProvider)
      PublisherPoolService.js        # KEPT
      ReaderRewardService.js         # KEPT
      OrgReserveService.js           # KEPT
  routes/
    ads.js                           # NEW — API endpoints
  config/
    ads.js                           # NEW — environment config, placement enum
  models/
    ads/                             # ALL KEPT (AdEvent, AdConfig, etc.)
```

## Placements (Constants)

Named placements as a frozen enum to prevent typo bugs:

```js
// config/ads.js
const PLACEMENTS = Object.freeze({
  HOME_FEED_TOP: 'home_feed_top',
  HOME_FEED_INLINE: 'home_feed_inline',
  HOME_FEED_BOTTOM: 'home_feed_bottom',
  ARTICLE_HEADER: 'article_header',
  ARTICLE_MIDDLE: 'article_middle',
  ARTICLE_END: 'article_end',
  SIDEBAR: 'sidebar',
  PROFILE: 'profile',
  SEARCH: 'search',
  TRENDING: 'trending'
});
```

Templates reference `PLACEMENTS.SIDEBAR` instead of raw strings.

## Provider Interface

Each provider implements `AdProviderInterface`:

| Method | Params | Returns |
|---|---|---|
| `get name` | — | `'mock'` |
| `get isHealthy` | — | `true` / `false` |
| `getAds(context)` | `{ placement, request, user, session, count }` | `Ad[]` |
| `recordImpression(data)` | `{ adId, provider, placement, userId, sessionId, device, browser, country }` | `void` |
| `recordClick(data)` | `{ adId, provider, placement, userId, destination, referrer, device }` | `void` |
| `healthCheck()` | — | `Promise<boolean>` |

`getAds` receives a `request` context object so providers can access `locale`, `ip`, `country`, `device`, `headers`, `consent`, `referrer` without interface changes later.

## Return Shape

Backward-compatible with all existing EJS partials (which check `ad.served`):

```js
{
  served: true,             // existing — EJS gate
  type: 'banner',           // existing (was adType) — always present
  imageUrl: '...',          // existing
  clickUrl: '...',          // existing
  impressionId: '...',      // existing
  adConfigId: '...',        // existing
  slot: 'feed_native',      // existing
  placement: 'feed',        // new — for API consumers
  provider: 'mock',         // new — for analytics
  content: {                // new — first-class content field
    title: '...',           //   present for native/feed ads
    description: '...',
    image: '...',
    cta: '...',
    sponsored: true         //   shows "Sponsored" badge
  }
}
```

`type` replaces `adType` (same values: `banner`, `native`, `video`, `interstitial`, `rewarded`) — the EJS partials reference it and will be updated to match.

`content` is a first-class field. Future ad formats add keys here without changing the root shape:
- `content.videoUrl` for video ads
- `content.survey` for survey ads
- `content.carousel` for carousel ads

## MockProvider

Refactors the current `AdPlacementService` logic:

- Slot→placement mapping (`AD_SLOT_MAP`) becomes MockProvider internal
- `getAds()` calls `AdSimulationService.triggerAdForUser()` for real simulated ads
- Falls back to `getDemoAd()` (placeholder SVGs from `getAdImageUrl()`) — same as today
- `recordImpression()` / `recordClick()` delegate to `AdSimulationService` which creates `AdEvent` docs and triggers revenue distribution

## ProviderFactory (Registry Pattern)

Uses an internal registry instead of a switch/case:

```js
const registry = {};

function register(name, ProviderClass) {
    registry[name] = ProviderClass;
}

function create(name, options) {
    const ProviderClass = registry[name];
    if (!ProviderClass) throw new Error(`Unknown provider: ${name}`);
    return new ProviderClass(options);
}
```

Registration:

```js
ProviderFactory.register('mock', MockProvider);
// ProviderFactory.register('monetag', MonetagProvider);  // future
// ProviderFactory.register('medianet', MediaNetProvider); // future
```

Adding a provider requires zero factory logic changes — just `register()` at startup.

## ProviderService (Orchestrator)

Main entry point for all ad requests. Always returns an array (`getAds` not `getAd`):

```
getAds(context)
```

Flow:

1. **Master toggle** — `ADS_ENABLED=false` → return `[]`
2. **Role check** — Guest/Registered → enabled; Premium/Admin → disabled (`ADS_DISABLE_FOR_ROLES`)
3. **Frequency capping** — Check `FrequencyRule` before calling any provider; if capped, return `[]`
4. **Cache check** — If `ADS_CACHE_ENABLED`, return cached response. Cache key: `placement + provider + locale + device + pageType + count`. Tracking data is never cached.
5. **Provider selection** — Factory returns active provider (respecting rotation strategy)
6. **Health check** — Skip unhealthy providers (`provider.isHealthy === false` or `healthCheck()` fails)
7. **Failover** — If provider throws, log error, emit `provider.failed` event, fall back to MockProvider
8. **Return** — Standardized ad array to caller
9. **Event emission** — Emit `ad.served` event (async, non-blocking)

### Rotation Strategies

| Strategy | Behavior |
|---|---|
| `none` | Always use configured `ADS_PROVIDER` (default) |
| `random` | Random pick from configured provider list |
| `round-robin` | Sequential cycling |
| `weighted` | Probability-weighted (e.g. Mock 70%, Monetag 20%) |

Config-only. Only MockProvider exists now.

## AdvertisementRenderer

Decouples the ad type → EJS partial mapping from page templates:

```js
class AdvertisementRenderer {
    getPartialPath(ad) {
        switch (ad.type) {
            case 'native':   return 'partials/ad-feed.ejs';
            case 'banner':   return 'partials/ad-banner.ejs';
            case 'sidebar':  return 'partials/ad-sidebar.ejs';
            case 'inline':    return 'partials/ad-inline.ejs';
            case 'rewarded': return 'partials/ad-rewarded.ejs';
            default:         return 'partials/ad-banner.ejs';
        }
    }

    render(ad) {
        return { partial: this.getPartialPath(ad), data: ad };
    }
}
```

Route handlers call `renderer.render(ad)` instead of hardcoding `ad-sidebar.ejs` in the template. Future ad formats only need a new partial and a renderer entry — no page template changes.

## API Endpoints

Registered at `/api/ads`:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/ads?placement=X&count=1` | Get ads for placement |
| `GET` | `/api/ads/:placement?count=1` | Get ads for named placement |
| `POST` | `/api/ads/:id/impression` | Record impression |
| `POST` | `/api/ads/:id/click` | Record click |

All return JSON. EJS templates fetch ads server-side (via `ProviderService.getAds(context)`) and render through `AdvertisementRenderer`.

## Tracking (Async)

Impressions and clicks are tracked asynchronously — the response is sent before tracking completes:

- `POST /api/ads/:id/impression` and `POST /api/ads/:id/click` return immediately
- The tracking work is delegated to the provider via non-blocking call (Fastify `reply.then` or `setImmediate`)
- For MockProvider: `recordImpression()` calls `AdSimulationService.simulateImpression()` → creates `AdEvent` doc
- `recordClick()` calls `AdSimulationService.simulateClick()` → creates `AdEvent` doc
- Revenue distribution happens downstream via existing `AdRevenueService` (unchanged)

## EventBus

Simple pub/sub decoupling ProviderService from analytics consumers:

```js
// EventBus.js
class EventBus {
    on(event, handler) { }
    emit(event, payload) { }
}

// Events emitted by ProviderService:
eventBus.emit('ad.served', { ad, placement, provider, user, request });
eventBus.emit('ad.clicked', { adId, provider, placement, userId, destination });
eventBus.emit('ad.failed', { provider, placement, error });
eventBus.emit('provider.failed', { provider, error });
eventBus.emit('provider.selected', { provider, strategy });
```

AnalyticsService subscribes at startup. Revenue services can subscribe to impression events independently.

## AnalyticsService

Subscribes to EventBus events. Also provides aggregate queries on `AdEvent` using MongoDB `aggregate()`:

- `getDailyImpressions(from, to)`
- `getDailyClicks(from, to)`
- `getCTR(from, to)`
- `getTopAds(limit)`
- `getWorstAds(limit)`
- `getProviderStats()`
- `getPlacementStats()`

No new models. Operators only. Dashboard not required.

## Sponsored Content Architecture

Placeholder model files only (no routes, no services, no frontend):

- `src/models/ads/SponsoredArticle.js` — future sponsored posts
- `src/models/ads/SponsoredCampaign.js` — future campaign management

## Configuration

```env
ADS_ENABLED=true                       # master toggle
ADS_PROVIDER=mock                      # active provider
ADS_ROTATION=none                      # rotation strategy
ADS_PROVIDERS=mock                     # comma-separated for rotation
ADS_PROVIDER_WEIGHTS=                  # e.g. mock=70,monetag=20,medianet=10
ADS_CACHE_ENABLED=false                # enable caching (provider responses only)
ADS_CACHE_TTL=300                      # cache TTL in seconds
ADS_TRACK_IMPRESSIONS=true             # enable impression tracking
ADS_TRACK_CLICKS=true                  # enable click tracking
ADS_DISABLE_FOR_ROLES=premium,administrator
```

Loading from `src/config/ads.js` following the existing config pattern. Also exports `PLACEMENTS` frozen enum.

## Backward Compatibility

- EJS partials check `typeof ad !== 'undefined' && ad && ad.served` — unchanged
- `served`, `imageUrl`, `clickUrl`, `type` (was `adType`), `slot`, `impressionId`, `adConfigId` all preserved
- Route handlers call `ProviderService.getAds({ placement, request, user, session })` instead of `getAdForSlot(slotName, userId, sessionId)`
- Existing `ad-feed.ejs`, `ad-sidebar.ejs`, `ad-inline.ejs`, `ad-banner.ejs`, `ad-rewarded.ejs` all work — but are now selected by `AdvertisementRenderer` instead of hardcoded in page templates
- EJS partials reference `ad.type` instead of `ad.adType` — this is the only template change

## Checklist

- [x] Existing mock ads still work
- [x] Providers switchable via config
- [x] No frontend changes when switching providers
- [x] User-role rules work
- [x] Impressions and clicks recorded
- [x] Placement-based ads work
- [x] Analytics methods exist
- [x] Native feed ads supported
- [x] Sponsored content architecture ready
- [x] Event-driven decoupling
- [x] AdvertisementRenderer isolates partial selection
- [x] ProviderFactory uses registry (no switch/case)
- [x] Frequency capping via existing FrequencyRule
- [x] `getAds()` always returns array
- [x] Tracking is non-blocking
- [x] Provider health checks
- [x] Request context passed to providers
- [x] Content field is first-class (`ad.content` not `ad.nativeAd`)
- [x] Production-ready for future provider integrations
