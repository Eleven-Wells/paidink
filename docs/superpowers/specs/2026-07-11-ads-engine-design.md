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

```
src/
  services/
    ads/
      index.js                       # barrel export (updated)
      ProviderService.js             # NEW — orchestrator (serving, role rules,
                                     #         frequency capping, failover, events)
      AnalyticsService.js            # NEW — subscribes to EventBus, aggregate queries,
                                     #         provider latency/failure recording
      EventBus.js                    # NEW — typed pub/sub with AD_EVENTS constants
      providers/
        AdProviderInterface.js       # NEW — interface / base contract
        MockProvider.js              # NEW — refactored from AdPlacementService
        ProviderFactory.js           # NEW — registry-based factory (receives name from
                                     #         RotationStrategy, creates instance)
        RotationStrategy.js          # NEW — picks a provider name (random/round-robin/weighted)
        CacheManager.js              # NEW — caches provider responses only
      AdRevenueService.js            # KEPT
      AdSimulationService.js         # KEPT — now subscribes to EventBus for tracking
      PublisherPoolService.js        # KEPT
      ReaderRewardService.js         # KEPT
      OrgReserveService.js           # KEPT
  routes/
    ads.js                           # NEW — API endpoints
  config/
    ads.js                           # NEW — environment config, PLACEMENTS enum, AD_EVENTS
  views/
    renderers/
      AdvertisementRenderer.js       # NEW — selects EJS partial by ad type (registry pattern)
  models/
    ads/                             # ALL KEPT (AdEvent, AdConfig, etc.)
```

## Ad Context

Providers receive a rich context object so future contextual ad networks (Monetag, Media.net) have page metadata without interface changes:

```js
{
  placement: PLACEMENTS.SIDEBAR,           // constant
  page: '/post/my-article',                // current URL path
  route: 'post',                           // route name
  article: { title, tags, category },       // if on an article page
  tags: ['writing', 'ai'],                  // article tags
  category: 'technology',                   // article or feed category
  author: { id, username },                 // page author
  user: { id, role, locale },              // requesting user
  locale: 'en-US',
  request: { ip, headers, device, country, referrer },
  session: { id }
}
```

`request` is the raw Fastify request object. Providers derive `locale`, `ip`, `country`, `device`, `headers`, `consent`, `referrer` from it.

## Placements (Constants)

Frozen enum in `config/ads.js` to prevent typo bugs:

```js
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
| `getAds(context)` | AdContext (see above) | `Ad[]` |
| `recordImpression(data)` | `{ adId, provider, placement, userId, sessionId, device, browser, country }` | `void` |
| `recordClick(data)` | `{ adId, provider, placement, userId, destination, referrer, device }` | `void` |
| `healthCheck()` | — | `Promise<boolean>` |

No mutable `isHealthy` property. `ProviderService` calls `healthCheck()` and caches the result with a TTL.

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
  placement: 'feed',        // for API consumers
  provider: 'mock',         // for analytics
  content: {                // first-class content field
    title: '...',           //   present for native/feed ads
    description: '...',
    image: '...',
    cta: '...',
    sponsored: true         //   shows "Sponsored" badge
  }
}
```

Future ad formats add keys to `content` without changing the root shape:
- `content.videoUrl` for video ads
- `content.survey` for survey ads
- `content.carousel` for carousel ads

## MockProvider

Refactors the current `AdPlacementService` logic:

- Slot→placement mapping (`AD_SLOT_MAP`) becomes MockProvider internal
- `getAds()` calls `AdSimulationService.triggerAdForUser()` for real simulated ads
- Falls back to `getDemoAd()` (placeholder SVGs) — same as today
- Does NOT directly call `AdSimulationService` for tracking. Instead, tracking events flow through EventBus (see EventBus section below).

## ProviderFactory (Registry Pattern)

Internal registry — no switch/case:

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
ProviderFactory.register('direct', DirectProvider);     // reserved — Phase 2
// ProviderFactory.register('monetag', MonetagProvider);   // Phase 3
// ProviderFactory.register('medianet', MediaNetProvider); // Phase 4
```

## Rotation Strategy → ProviderFactory

`RotationStrategy` decides **which provider name** to use. It passes that name to `ProviderFactory` which creates the instance.

```
RotationStrategy.pick(providers, weights, state)
       ↓ returns provider name (e.g. 'mock')
ProviderFactory.create(name)
       ↓ returns provider instance
```

Strategies:

| Strategy | Behavior |
|---|---|
| `none` | Always returns configured `ADS_PROVIDER` name |
| `random` | Random pick from `ADS_PROVIDERS` list |
| `round-robin` | Sequential cycling (tracked in memory) |
| `weighted` | Probability-weighted (`ADS_PROVIDER_WEIGHTS`) |

## ProviderService (Orchestrator)

Main entry point. Always returns an array:

```
getAds(context)
```

Flow:

1. **Master toggle** — `ADS_ENABLED=false` → return `[]`
2. **Role check** — Guest/Registered → enabled; Premium/Admin → disabled (check against `ADS_DISABLE_FOR_ROLES`)
3. **Frequency capping** — Check `FrequencyRule`; if capped, return `[]`
4. **Cache check** — If `ADS_CACHE_ENABLED`, return cached response. Cache key: `placement + provider + locale + device + pageType + count + role`. Tracking data is never cached.
5. **Provider selection** — `RotationStrategy.pick()` → `ProviderFactory.create()`
6. **Health check** — `await provider.healthCheck()`; cache healthy result with TTL; skip unhealthy providers, fall back to MockProvider
7. **Provider call** — `provider.getAds(context)` — if it throws, log error, emit `AD_EVENTS.PROVIDER_FAILED`, fall back to MockProvider
8. **Return** — Standardized ad array
9. **Emit event** — `eventBus.emit(AD_EVENTS.SERVED, { ads, context, provider: name })` (async, non-blocking)

## EventBus

Typed event constants in `config/ads.js`:

```js
const AD_EVENTS = Object.freeze({
    SERVED: 'ad.served',
    CLICKED: 'ad.clicked',
    IMPRESSION: 'ad.impression',
    PROVIDER_FAILED: 'provider.failed',
    PROVIDER_SELECTED: 'provider.selected'
});
```

Simple pub/sub:

```js
class EventBus {
    on(event, handler) { }
    emit(event, payload) { }
}
```

**ProviderService** emits:
- `AD_EVENTS.SERVED` — after ads are returned
- `AD_EVENTS.CLICKED` — on click (from API route)
- `AD_EVENTS.IMPRESSION` — on impression (from API route)
- `AD_EVENTS.PROVIDER_FAILED` — on provider error
- `AD_EVENTS.PROVIDER_SELECTED` — on rotation pick

**AdSimulationService** (subscriber):
- Listens to `AD_EVENTS.IMPRESSION` and `AD_EVENTS.CLICKED`
- Creates `AdEvent` docs and triggers revenue distribution via `AdRevenueService`

**AnalyticsService** (subscriber):
- Listens to all events for metrics

This removes the direct `MockProvider → AdSimulationService` dependency. Tracking flows through the event bus.

## AdvertisementRenderer

Located in `src/views/renderers/AdvertisementRenderer.js` — a presentation concern, not a service.

Uses a registry instead of a switch statement:

```js
const renderers = {
    banner: 'partials/ad-banner.ejs',
    native: 'partials/ad-feed.ejs',
    sidebar: 'partials/ad-sidebar.ejs',
    inline: 'partials/ad-inline.ejs',
    rewarded: 'partials/ad-rewarded.ejs'
};

class AdvertisementRenderer {
    getPartialPath(ad) {
        return renderers[ad.type] || renderers.banner;
    }

    render(ad) {
        return { partial: this.getPartialPath(ad), data: ad };
    }
}
```

Adding a new ad format means adding one entry to `renderers` and one partial — no page templates touched. Route handlers call `renderer.render(ad)` instead of hardcoding an EJS partial path.

## API Endpoints

Registered at `/api/ads`:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/ads?placement=X&count=1` | Get ads for placement |
| `GET` | `/api/ads/:placement?count=1` | Get ads for named placement |
| `POST` | `/api/ads/:id/impression` | Record impression |
| `POST` | `/api/ads/:id/click` | Record click |

All return JSON. EJS templates fetch ads server-side (via `ProviderService.getAds(context)`) and render through `AdvertisementRenderer`.

## Tracking

Tracking is asynchronous. API routes emit events to `EventBus` and respond immediately:

```
POST /api/ads/:id/impression  →  emit AD_EVENTS.IMPRESSION  →  respond 200
POST /api/ads/:id/click       →  emit AD_EVENTS.CLICKED     →  respond 200
```

AdSimulationService (subscriber) picks up the events, creates `AdEvent` docs, and triggers revenue distribution via `AdRevenueService` — all unchanged from today's logic.

## AnalyticsService

Subscribes to EventBus events. Provides aggregate queries on `AdEvent`:

- `getDailyImpressions(from, to)`
- `getDailyClicks(from, to)`
- `getCTR(from, to)`
- `getTopAds(limit)`
- `getWorstAds(limit)`
- `getProviderStats()`
- `getPlacementStats()`

Exposes operational metrics for provider management:

- `recordProviderFailure(providerName, error)` — count failures
- `recordProviderLatency(providerName, durationMs)` — track response times
- `recordCacheHit(placement)` — cache efficiency
- `recordCacheMiss(placement)` — cache efficiency

## Health Checks

ProviderService calls `await provider.healthCheck()` and caches the result. No mutable `isHealthy` property on providers. Cached health status expires after a configurable interval (`ADS_HEALTH_CHECK_TTL`). Unhealthy providers are skipped; MockProvider is used as fallback.

## Sponsored Content Architecture

Placeholder model files only (no routes, no services, no frontend):

- `src/models/ads/SponsoredArticle.js` — future sponsored posts
- `src/models/ads/SponsoredCampaign.js` — future campaign management

## DirectProvider (Reserved)

Registered in ProviderFactory but not implemented. Stub that returns `[]` with a descriptive log message. Reserved for Phase 2 (self-served sponsored posts, featured writers, featured communities — Nook's highest-value ad inventory).

## Configuration

```env
ADS_ENABLED=true                          # master toggle
ADS_PROVIDER=mock                         # default provider
ADS_ROTATION=none                         # rotation strategy
ADS_PROVIDERS=mock                        # comma-separated for rotation
ADS_PROVIDER_WEIGHTS=                     # e.g. mock=70,monetag=20
ADS_HEALTH_CHECK_TTL=60                   # seconds to cache health status
ADS_CACHE_ENABLED=false                   # cache provider responses only
ADS_CACHE_TTL=300                         # cache TTL in seconds
ADS_TRACK_IMPRESSIONS=true                # enable impression tracking
ADS_TRACK_CLICKS=true                     # enable click tracking
ADS_DISABLE_FOR_ROLES=premium,administrator
```

Loading from `src/config/ads.js` following the existing config pattern. Exports `PLACEMENTS` and `AD_EVENTS` frozen enums.

## Backward Compatibility

- EJS partials check `typeof ad !== 'undefined' && ad && ad.served` — unchanged
- `served`, `imageUrl`, `clickUrl`, `type` (was `adType`), `slot`, `impressionId`, `adConfigId` all preserved
- Route handlers call `ProviderService.getAds({ placement, request, user, session })` instead of `getAdForSlot(slotName, userId, sessionId)`
- Existing `ad-feed.ejs`, `ad-sidebar.ejs`, `ad-inline.ejs`, `ad-banner.ejs`, `ad-rewarded.ejs` all work — now selected by `AdvertisementRenderer` instead of hardcoded in page templates
- EJS partials reference `ad.type` instead of `ad.adType` — only template surface change

## Implementation Roadmap

| Phase | Provider | Source | Revenue Model |
|---|---|---|---|
| 1 | MockProvider | Placeholder SVGs + simulation | Internal testing |
| 2 | DirectProvider | Database (sponsored posts, featured writers) | Direct sales (highest margin) |
| 3 | MonetagProvider | Monetag network | Fill unused inventory |
| 4 | MediaNetProvider | Media.net | Fill unused inventory |
| 5 | Waterfall | Direct → Monetag → Media.net → Mock | Maximize fill rate |

## Checklist

- [x] Existing mock ads still work
- [x] Providers switchable via config
- [x] No frontend changes when switching providers
- [x] User-role rules work
- [x] Frequency capping via existing FrequencyRule
- [x] Impressions and clicks recorded (via EventBus)
- [x] Placement-based ads work
- [x] Analytics methods exist (aggregate + operational metrics)
- [x] Native feed ads supported
- [x] Sponsored content architecture ready
- [x] Event-driven decoupling (no direct provider→simulation dependency)
- [x] AdvertisementRenderer in presentation layer (`views/renderers/`)
- [x] Renderer uses registry, not switch
- [x] ProviderFactory uses registry, not switch/case
- [x] RotationStrategy picks name, ProviderFactory creates instance
- [x] `getAds()` always returns array
- [x] Tracking is non-blocking
- [x] Provider health checks (no mutable state, cached result)
- [x] Rich AdContext passed to providers
- [x] Content field is first-class (`ad.content` not `ad.nativeAd`)
- [x] Event names are typed constants (`AD_EVENTS`)
- [x] Cache key includes `role`
- [x] DirectProvider reserved for Phase 2
- [x] Production-ready for future provider integrations
