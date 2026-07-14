# Ads Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current ad-serving path (AdPlacementService + ad-hoc wiring) with a provider-agnostic Ads Engine.

**Architecture:** Provider interface (MockProvider, future DirectProvider/MonetagProvider) + ProviderService orchestrator (role rules, frequency capping, rotation, failover, caching) + EventBus (decouples tracking from serving) + AdvertisementRenderer (decouples ad type from EJS partial).

**Tech Stack:** Fastify, Jest (test: `jest`), EJS, Mongoose, CommonJS

---

## Files Overview

### New files to create (15):
| File | Purpose |
|---|---|
| `src/config/ads.js` | AD_EVENTS enum, PLACEMENTS enum, ads config loading |
| `src/services/ads/EventBus.js` | Typed pub/sub singleton |
| `src/services/ads/providers/AdProviderInterface.js` | Interface contract |
| `src/services/ads/providers/CacheManager.js` | In-memory cache for provider responses |
| `src/services/ads/providers/RotationStrategy.js` | Picks provider name (none/random/round-robin/weighted) |
| `src/services/ads/providers/ProviderFactory.js` | Registry-based factory (creates instance from name) |
| `src/services/ads/providers/MockProvider.js` | Refactored from AdPlacementService |
| `src/services/ads/ProviderService.js` | Orchestrator |
| `src/services/ads/AnalyticsService.js` | Aggregation queries + operational metrics |
| `src/views/renderers/AdvertisementRenderer.js` | Maps ad type → EJS partial |
| `src/routes/ads.js` | API endpoints (`GET /api/ads`, `POST .../impression`, `POST .../click`) |
| `src/services/ads/__tests__/EventBus.test.js` | Tests for EventBus |
| `src/services/ads/providers/__tests__/ProviderFactory.test.js` | Tests for ProviderFactory |
| `src/services/ads/providers/__tests__/RotationStrategy.test.js` | Tests for RotationStrategy |
| `src/services/ads/providers/__tests__/MockProvider.test.js` | Tests for MockProvider |
| `src/services/ads/__tests__/ProviderService.test.js` | Tests for ProviderService |

### Existing files to modify (7):
| File | Change |
|---|---|
| `src/services/ads/index.js` | Add exports for new services |
| `src/services/ads/AdSimulationService.js` | Add `subscribeToEventBus()`, keep all existing exports for test compat |
| `src/routes/pages.js` | Replace 4 `getAdForSlot`/`getFeedAds` calls with `ProviderService.getAds()` |
| `src/app.js` | Register `/api/ads` routes, wire EventBus + ProviderFactory at startup |
| `src/server.js` | Wire provider registration at startup |
| `tests/unit/adSimulation.test.js` | No changes needed (all existing exports preserved) |

### Files to remove (1):
| File | Reason |
|---|---|
| `src/services/ads/AdPlacementService.js` | Logic moved into MockProvider |

---

### Task 1: Configuration constants

**Files:**
- Create: `src/config/ads.js`

- [ ] **Step 1: Create config file**

```js
// src/config/ads.js
const path = require('path');

const AD_EVENTS = Object.freeze({
    SERVED: 'ad.served',
    CLICKED: 'ad.clicked',
    IMPRESSION: 'ad.impression',
    PROVIDER_FAILED: 'provider.failed',
    PROVIDER_SELECTED: 'provider.selected'
});

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

function loadAdConfig() {
    return Object.freeze({
        enabled: process.env.ADS_ENABLED !== 'false',
        provider: process.env.ADS_PROVIDER || 'mock',
        rotation: process.env.ADS_ROTATION || 'none',
        providers: (process.env.ADS_PROVIDERS || 'mock').split(',').map(s => s.trim()),
        providerWeights: parseWeights(process.env.ADS_PROVIDER_WEIGHTS || ''),
        healthCheckTTL: parseInt(process.env.ADS_HEALTH_CHECK_TTL || '60', 10),
        cacheEnabled: process.env.ADS_CACHE_ENABLED === 'true',
        cacheTTL: parseInt(process.env.ADS_CACHE_TTL || '300', 10),
        trackImpressions: process.env.ADS_TRACK_IMPRESSIONS !== 'false',
        trackClicks: process.env.ADS_TRACK_CLICKS !== 'false',
        disableForRoles: (process.env.ADS_DISABLE_FOR_ROLES || 'premium,administrator').split(',').map(s => s.trim())
    });
}

function parseWeights(raw) {
    if (!raw) return {};
    const weights = {};
    raw.split(',').forEach(pair => {
        const [name, weight] = pair.split('=').map(s => s.trim());
        if (name && weight) weights[name] = parseInt(weight, 10);
    });
    return weights;
}

module.exports = { AD_EVENTS, PLACEMENTS, loadAdConfig };
```

- [ ] **Step 2: Commit**

```bash
git add src/config/ads.js
git commit -m "feat(ads): add AD_EVENTS, PLACEMENTS constants and config loader"
```

---

### Task 2: EventBus

**Files:**
- Create: `src/services/ads/EventBus.js`
- Create: `src/services/ads/__tests__/EventBus.test.js`

- [ ] **Step 1: Write the failing test**

```js
// src/services/ads/__tests__/EventBus.test.js
const EventBus = require('../EventBus');

describe('EventBus', () => {
    let bus;

    beforeEach(() => {
        bus = new EventBus();
    });

    it('should emit and receive events', () => {
        const handler = jest.fn();
        bus.on('test.event', handler);
        bus.emit('test.event', { key: 'value' });
        expect(handler).toHaveBeenCalledWith({ key: 'value' });
    });

    it('should support multiple handlers per event', () => {
        const h1 = jest.fn();
        const h2 = jest.fn();
        bus.on('test.event', h1);
        bus.on('test.event', h2);
        bus.emit('test.event', {});
        expect(h1).toHaveBeenCalledTimes(1);
        expect(h2).toHaveBeenCalledTimes(1);
    });

    it('should not fail when emitting unregistered events', () => {
        expect(() => bus.emit('nonexistent', {})).not.toThrow();
    });

    it('should support removeHandler', () => {
        const handler = jest.fn();
        bus.on('test.event', handler);
        bus.removeHandler('test.event', handler);
        bus.emit('test.event', {});
        expect(handler).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/services/ads/__tests__/EventBus.test.js --no-cache`
Expected: FAIL — "Cannot find module '../EventBus'" or "EventBus is not defined"

- [ ] **Step 3: Implement EventBus**

```js
// src/services/ads/EventBus.js
class EventBus {
    constructor() {
        this._handlers = {};
    }

    on(event, handler) {
        if (!this._handlers[event]) {
            this._handlers[event] = [];
        }
        this._handlers[event].push(handler);
    }

    removeHandler(event, handler) {
        const handlers = this._handlers[event];
        if (!handlers) return;
        this._handlers[event] = handlers.filter(h => h !== handler);
    }

    emit(event, payload) {
        const handlers = this._handlers[event];
        if (!handlers) return;
        handlers.forEach(handler => {
            try {
                handler(payload);
            } catch (err) {
                console.error(`EventBus: handler error for event "${event}":`, err);
            }
        });
    }
}

module.exports = EventBus;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/services/ads/__tests__/EventBus.test.js --no-cache`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/services/ads/EventBus.js src/services/ads/__tests__/EventBus.test.js
git commit -m "feat(ads): add EventBus with typed pub/sub"
```

---

### Task 3: AdProviderInterface

**Files:**
- Create: `src/services/ads/providers/AdProviderInterface.js`

- [ ] **Step 1: Create the interface**

```js
// src/services/ads/providers/AdProviderInterface.js
class AdProviderInterface {
    get name() {
        throw new Error('Provider must implement get name()');
    }

    async getAds(context) {
        throw new Error('Provider must implement getAds(context)');
    }

    async recordImpression(data) {
        throw new Error('Provider must implement recordImpression(data)');
    }

    async recordClick(data) {
        throw new Error('Provider must implement recordClick(data)');
    }

    async healthCheck() {
        throw new Error('Provider must implement healthCheck()');
    }
}

module.exports = AdProviderInterface;
```

- [ ] **Step 2: Commit**

```bash
git add src/services/ads/providers/AdProviderInterface.js
git commit -m "feat(ads): add AdProviderInterface contract"
```

---

### Task 4: CacheManager

**Files:**
- Create: `src/services/ads/providers/CacheManager.js`

- [ ] **Step 1: Create CacheManager**

```js
// src/services/ads/providers/CacheManager.js
class CacheManager {
    constructor(ttlSeconds = 300) {
        this._cache = new Map();
        this._ttl = ttlSeconds * 1000;
    }

    _cacheKey(context) {
        const { placement, provider, locale, device, pageType, count, user } = context;
        const role = user?.role || 'guest';
        return `${placement}|${provider}|${locale || ''}|${device || ''}|${pageType || ''}|${count || 1}|${role}`;
    }

    get(context) {
        const key = this._cacheKey(context);
        const entry = this._cache.get(key);
        if (!entry) return null;
        if (Date.now() - entry.timestamp > this._ttl) {
            this._cache.delete(key);
            return null;
        }
        return entry.data;
    }

    set(context, data) {
        const key = this._cacheKey(context);
        this._cache.set(key, { data, timestamp: Date.now() });
    }

    invalidate(placement) {
        if (!placement) {
            this._cache.clear();
            return;
        }
        for (const key of this._cache.keys()) {
            if (key.startsWith(placement + '|')) {
                this._cache.delete(key);
            }
        }
    }

    get size() {
        return this._cache.size;
    }
}

module.exports = CacheManager;
```

- [ ] **Step 2: Commit**

```bash
git add src/services/ads/providers/CacheManager.js
git commit -m "feat(ads): add CacheManager for provider response caching"
```

---

### Task 5: RotationStrategy

**Files:**
- Create: `src/services/ads/providers/RotationStrategy.js`
- Create: `src/services/ads/providers/__tests__/RotationStrategy.test.js`

- [ ] **Step 1: Write the failing test**

```js
// src/services/ads/providers/__tests__/RotationStrategy.test.js
const RotationStrategy = require('../RotationStrategy');

describe('RotationStrategy', () => {
    it('should return the only provider for "none" strategy', () => {
        const result = RotationStrategy.pick('none', ['mock']);
        expect(result).toBe('mock');
    });

    it('should return a provider from the list for "random" strategy', () => {
        const result = RotationStrategy.pick('random', ['mock', 'monetag']);
        expect(['mock', 'monetag']).toContain(result);
    });

    it('should cycle through providers for "round-robin" strategy', () => {
        const state = { roundRobinIndex: {} };
        const providers = ['mock', 'monetag', 'medianet'];
        const results = [];
        for (let i = 0; i < 6; i++) {
            results.push(RotationStrategy.pick('round-robin', providers, state));
        }
        expect(results).toEqual(['mock', 'monetag', 'medianet', 'mock', 'monetag', 'medianet']);
    });

    it('should respect weights for "weighted" strategy', () => {
        const weights = { mock: 70, monetag: 30 };
        const counts = { mock: 0, monetag: 0 };
        const iterations = 1000;
        for (let i = 0; i < iterations; i++) {
            const result = RotationStrategy.pick('weighted', ['mock', 'monetag'], null, weights);
            counts[result]++;
        }
        const mockRatio = counts.mock / iterations;
        expect(mockRatio).toBeGreaterThan(0.5);
        expect(mockRatio).toBeLessThan(0.9);
    });

    it('should throw for unknown strategy', () => {
        expect(() => RotationStrategy.pick('unknown', ['mock'])).toThrow('Unknown rotation strategy');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/services/ads/providers/__tests__/RotationStrategy.test.js --no-cache`
Expected: FAIL

- [ ] **Step 3: Implement RotationStrategy**

```js
// src/services/ads/providers/RotationStrategy.js
function pick(strategy, providers, state, weights) {
    switch (strategy) {
        case 'none':
            return providers[0];

        case 'random':
            return providers[Math.floor(Math.random() * providers.length)];

        case 'round-robin': {
            if (!state) state = { roundRobinIndex: {} };
            const key = providers.join(',');
            if (!state.roundRobinIndex[key]) state.roundRobinIndex[key] = 0;
            const idx = state.roundRobinIndex[key];
            state.roundRobinIndex[key] = (idx + 1) % providers.length;
            return providers[idx];
        }

        case 'weighted': {
            if (!weights) return providers[0];
            const total = Object.values(weights).reduce((a, b) => a + b, 0);
            let rand = Math.random() * total;
            for (const provider of providers) {
                rand -= weights[provider] || 0;
                if (rand <= 0) return provider;
            }
            return providers[providers.length - 1];
        }

        default:
            throw new Error(`Unknown rotation strategy: ${strategy}`);
    }
}

module.exports = { pick };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/services/ads/providers/__tests__/RotationStrategy.test.js --no-cache`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/services/ads/providers/RotationStrategy.js src/services/ads/providers/__tests__/RotationStrategy.test.js
git commit -m "feat(ads): add RotationStrategy (none/random/round-robin/weighted)"
```

---

### Task 6: ProviderFactory

**Files:**
- Create: `src/services/ads/providers/ProviderFactory.js`
- Create: `src/services/ads/providers/__tests__/ProviderFactory.test.js`

- [ ] **Step 1: Write the failing test**

```js
// src/services/ads/providers/__tests__/ProviderFactory.test.js
const ProviderFactory = require('../ProviderFactory');

describe('ProviderFactory', () => {
    afterEach(() => {
        ProviderFactory.clear();
    });

    it('should register and create a provider', () => {
        class MockProvider { get name() { return 'mock'; } }
        ProviderFactory.register('mock', MockProvider);
        const instance = ProviderFactory.create('mock');
        expect(instance.name).toBe('mock');
    });

    it('should throw for unknown provider', () => {
        expect(() => ProviderFactory.create('unknown')).toThrow('Unknown provider');
    });

    it('should return registered provider names', () => {
        class MockProvider { get name() { return 'mock'; } }
        ProviderFactory.register('mock', MockProvider);
        expect(ProviderFactory.getRegistered()).toEqual(['mock']);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/services/ads/providers/__tests__/ProviderFactory.test.js --no-cache`
Expected: FAIL

- [ ] **Step 3: Implement ProviderFactory**

```js
// src/services/ads/providers/ProviderFactory.js
const registry = {};

function register(name, ProviderClass) {
    registry[name] = ProviderClass;
}

function create(name, options) {
    const ProviderClass = registry[name];
    if (!ProviderClass) {
        throw new Error(`Unknown provider: ${name}`);
    }
    return new ProviderClass(options);
}

function getRegistered() {
    return Object.keys(registry);
}

function clear() {
    Object.keys(registry).forEach(key => delete registry[key]);
}

module.exports = { register, create, getRegistered, clear };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/services/ads/providers/__tests__/ProviderFactory.test.js --no-cache`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/services/ads/providers/ProviderFactory.js src/services/ads/providers/__tests__/ProviderFactory.test.js
git commit -m "feat(ads): add ProviderFactory with registry pattern"
```

---

### Task 7: MockProvider

**Files:**
- Create: `src/services/ads/providers/MockProvider.js`
- Modify: `src/services/ads/providers/__tests__/MockProvider.test.js` (create)

- [ ] **Step 1: Write the failing test**

```js
// src/services/ads/providers/__tests__/MockProvider.test.js
const MockProvider = require('../MockProvider');

describe('MockProvider', () => {
    let provider;

    beforeEach(() => {
        provider = new MockProvider();
    });

    it('should have name "mock"', () => {
        expect(provider.name).toBe('mock');
    });

    it('should return ads from getAds', async () => {
        const context = {
            placement: 'sidebar',
            user: { role: 'user' },
            session: null
        };
        const ads = await provider.getAds(context);
        expect(Array.isArray(ads)).toBe(true);
        expect(ads.length).toBeGreaterThanOrEqual(0);
        if (ads.length > 0) {
            expect(ads[0].served).toBe(true);
            expect(ads[0].type).toBeDefined();
            expect(ads[0].slot).toBeDefined();
        }
    });

    it('should return healthy from healthCheck', async () => {
        const healthy = await provider.healthCheck();
        expect(healthy).toBe(true);
    });

    it('should not throw on recordImpression', async () => {
        await expect(provider.recordImpression({ adId: 'test' })).resolves.not.toThrow();
    });

    it('should not throw on recordClick', async () => {
        await expect(provider.recordClick({ adId: 'test' })).resolves.not.toThrow();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/services/ads/providers/__tests__/MockProvider.test.js --no-cache`
Expected: FAIL

- [ ] **Step 3: Implement MockProvider**

```js
// src/services/ads/providers/MockProvider.js
const AdProviderInterface = require('./AdProviderInterface');
const { triggerAdForUser } = require('../AdSimulationService');

const AD_SLOT_MAP = {
    article_inline: { placement: 'article_inline', pageType: 'post', fallbackSlot: 'banner' },
    article_endcap: { placement: 'article_endcap', pageType: 'post', fallbackSlot: 'banner' },
    post_sidebar: { placement: 'post_sidebar', pageType: 'post', fallbackSlot: 'sidebar' },
    feed_native: { placement: 'feed_native', pageType: 'feed', fallbackSlot: 'feed' },
    feed_banner: { placement: 'feed_banner', pageType: 'feed', fallbackSlot: 'banner' },
    sidebar: { placement: 'sidebar', pageType: 'feed', fallbackSlot: 'sidebar' },
    interstitial: { placement: 'interstitial', pageType: 'feed', fallbackSlot: 'interstitial' },
    reward_wall: { placement: 'reward_wall', pageType: 'feed', fallbackSlot: 'rewarded' },
    feed: { placement: 'feed', pageType: 'feed', fallbackSlot: 'banner' },
    banner: { placement: 'banner', pageType: 'feed', fallbackSlot: null }
};

function getAdImageUrl(adType) {
    const images = {
        banner: '/public/images/ads/banner-placeholder.svg',
        native: '/public/images/ads/native-placeholder.svg',
        video: '/public/images/ads/video-placeholder.svg',
        interstitial: '/public/images/ads/interstitial-placeholder.svg',
        rewarded: '/public/images/ads/rewarded-placeholder.svg'
    };
    return images[adType] || images.banner;
}

function getDemoAd(slotName) {
    const imageType = slotName.startsWith('article') ? 'banner' : 'native';
    return {
        served: true,
        type: imageType,
        imageUrl: getAdImageUrl(imageType),
        clickUrl: '/api/ads/click/demo',
        impressionId: null,
        adConfigId: null,
        slot: slotName,
        provider: 'mock',
        content: null
    };
}

class MockProvider extends AdProviderInterface {
    get name() {
        return 'mock';
    }

    async getAds(context) {
        const { placement, user, session, count = 1 } = context;
        const userId = user?.id || null;
        const sessionId = session?.id || null;
        const slot = AD_SLOT_MAP[placement];

        const results = [];
        for (let i = 0; i < count; i++) {
            let ad;
            if (slot) {
                let result = await triggerAdForUser(userId, slot.placement, sessionId, {
                    pageType: slot.pageType
                });

                if (result.served) {
                    ad = {
                        served: true,
                        type: result.adConfig?.type || 'banner',
                        imageUrl: getAdImageUrl(result.adConfig?.type),
                        clickUrl: result.impression?._id ? `/api/ads/click/${result.impression._id}` : '#',
                        impressionId: result.impression?._id?.toString(),
                        adConfigId: result.adConfig?._id?.toString(),
                        slot: placement,
                        placement: slot.placement,
                        provider: 'mock',
                        content: null
                    };
                }

                if (!ad && slot.fallbackSlot && AD_SLOT_MAP[slot.fallbackSlot]) {
                    const fallback = AD_SLOT_MAP[slot.fallbackSlot];
                    result = await triggerAdForUser(userId, fallback.placement, sessionId, {
                        pageType: fallback.pageType
                    });
                    if (result.served) {
                        ad = {
                            served: true,
                            type: result.adConfig?.type || 'banner',
                            imageUrl: getAdImageUrl(result.adConfig?.type),
                            clickUrl: result.impression?._id ? `/api/ads/click/${result.impression._id}` : '#',
                            impressionId: result.impression?._id?.toString(),
                            adConfigId: result.adConfig?._id?.toString(),
                            slot: placement,
                            placement: fallback.placement,
                            provider: 'mock',
                            content: null
                        };
                    }
                }

                if (!ad) {
                    ad = getDemoAd(placement);
                    ad.provider = 'mock';
                }
            } else {
                ad = getDemoAd(placement);
                ad.provider = 'mock';
            }
            results.push(ad);
        }
        return results;
    }

    async recordImpression(data) {
        // Impressions are recorded by AdSimulationService via EventBus
        // MockProvider's triggerAdForUser already creates the AdEvent
    }

    async recordClick(data) {
        // Clicks are recorded by AdSimulationService via EventBus
    }

    async healthCheck() {
        return true;
    }
}

module.exports = MockProvider;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/services/ads/providers/__tests__/MockProvider.test.js --no-cache`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/services/ads/providers/MockProvider.js src/services/ads/providers/__tests__/MockProvider.test.js
git commit -m "feat(ads): add MockProvider (refactored from AdPlacementService)"
```

---

### Task 8: ProviderService (Orchestrator)

**Files:**
- Create: `src/services/ads/ProviderService.js`
- Create: `src/services/ads/__tests__/ProviderService.test.js`

- [ ] **Step 1: Write the failing test**

```js
// src/services/ads/__tests__/ProviderService.test.js
const EventBus = require('../EventBus');
const ProviderFactory = require('../providers/ProviderFactory');
const CacheManager = require('../providers/CacheManager');
const { loadAdConfig } = require('../../config/ads');

jest.mock('../../config/ads', () => ({
    loadAdConfig: jest.fn()
}));

jest.mock('../EventBus');

describe('ProviderService', () => {
    let ProviderService;
    let eventBus;

    beforeAll(async () => {
        // Register MockProvider for tests
        const MockProvider = require('../providers/MockProvider');
        ProviderFactory.register('mock', MockProvider);
        ProviderService = require('../ProviderService');
    });

    beforeEach(() => {
        loadAdConfig.mockReturnValue({
            enabled: true,
            provider: 'mock',
            rotation: 'none',
            providers: ['mock'],
            providerWeights: {},
            healthCheckTTL: 60,
            cacheEnabled: false,
            cacheTTL: 300,
            trackImpressions: true,
            trackClicks: true,
            disableForRoles: ['premium', 'administrator']
        });
        eventBus = new EventBus();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should return empty array when ads are disabled', async () => {
        loadAdConfig.mockReturnValue({ enabled: false });
        const result = await ProviderService.getAds({ placement: 'sidebar' }, eventBus);
        expect(result).toEqual([]);
    });

    it('should return empty array for disabled roles', async () => {
        const result = await ProviderService.getAds({
            placement: 'sidebar',
            user: { role: 'premium' }
        }, eventBus);
        expect(result).toEqual([]);
    });

    it('should return ads for allowed roles', async () => {
        const result = await ProviderService.getAds({
            placement: 'sidebar',
            user: { role: 'user' }
        }, eventBus);
        expect(Array.isArray(result)).toBe(true);
    });

    it('should emit served event when ads are returned', async () => {
        const emitSpy = jest.spyOn(eventBus, 'emit');
        await ProviderService.getAds({
            placement: 'sidebar',
            user: { role: 'user' }
        }, eventBus);
        expect(emitSpy).toHaveBeenCalledWith('ad.served', expect.any(Object));
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/services/ads/__tests__/ProviderService.test.js --no-cache`
Expected: FAIL — "Cannot find module '../ProviderService'"

- [ ] **Step 3: Implement ProviderService**

```js
// src/services/ads/ProviderService.js
const { loadAdConfig, AD_EVENTS } = require('../../config/ads');
const ProviderFactory = require('./providers/ProviderFactory');
const RotationStrategy = require('./providers/RotationStrategy');
const CacheManager = require('./providers/CacheManager');

const cacheManager = new CacheManager();
const healthCache = new Map();

const FrequencyRule = require('../../models/ads/FrequencyRule');

function isRoleAllowed(user, config) {
    if (!user || !user.role) return true;
    return !config.disableForRoles.includes(user.role);
}

async function isFrequencyCapped(context) {
    if (!context.user || !context.user.id) return false;
    try {
        const rule = await FrequencyRule.findOne({ slot: context.placement, active: true });
        if (!rule) return false;
        const { AdEvent } = require('../../models/ads/AdEvent');
        const since = new Date(Date.now() - (rule.minIntervalSeconds || 30) * 1000);
        const recent = await AdEvent.countDocuments({
            user: context.user.id,
            type: 'impression',
            createdAt: { $gte: since }
        });
        return recent >= (rule.maxPerSession || 10);
    } catch (err) {
        console.error('ProviderService: frequency check error:', err);
        return false; // don't block ads on frequency check failure
    }
}

async function getAds(context, eventBus) {
    const config = loadAdConfig();

    if (!config.enabled) return [];

    if (!isRoleAllowed(context.user, config)) return [];

    if (await isFrequencyCapped(context)) return [];

    if (config.cacheEnabled) {
        const cached = cacheManager.get(context);
        if (cached) return cached;
    }

    const providerName = RotationStrategy.pick(
        config.rotation,
        config.providers,
        null,
        config.providerWeights
    );

    const provider = ProviderFactory.create(providerName);

    const healthy = await checkHealth(provider, config, providerName);
    if (!healthy) {
        console.error(`ProviderService: provider "${providerName}" unhealthy, falling back to mock`);
        const fallback = ProviderFactory.create('mock');
        const ads = await callProvider(fallback, context, eventBus);
        if (config.cacheEnabled) cacheManager.set(context, ads);
        return ads;
    }

    const ads = await callProvider(provider, context, eventBus);
    if (config.cacheEnabled) cacheManager.set(context, ads);
    return ads;
}

async function checkHealth(provider, config, providerName) {
    const cached = healthCache.get(providerName);
    if (cached && Date.now() - cached.timestamp < config.healthCheckTTL * 1000) {
        return cached.healthy;
    }
    try {
        const healthy = await provider.healthCheck();
        healthCache.set(providerName, { healthy, timestamp: Date.now() });
        return healthy;
    } catch (err) {
        console.error(`ProviderService: health check failed for "${providerName}":`, err);
        healthCache.set(providerName, { healthy: false, timestamp: Date.now() });
        return false;
    }
}

async function callProvider(provider, context, eventBus) {
    try {
        const ads = await provider.getAds(context);
        if (eventBus) {
            eventBus.emit(AD_EVENTS.SERVED, { ads, context, provider: provider.name });
        }
        return ads;
    } catch (err) {
        console.error(`ProviderService: provider "${provider.name}" failed:`, err);
        if (eventBus) {
            eventBus.emit(AD_EVENTS.PROVIDER_FAILED, { provider: provider.name, error: err.message });
        }
        if (provider.name !== 'mock') {
            console.error('ProviderService: falling back to mock');
            const fallback = ProviderFactory.create('mock');
            return callProvider(fallback, context, eventBus);
        }
        return [];
    }
}

module.exports = { getAds };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/services/ads/__tests__/ProviderService.test.js --no-cache`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/services/ads/ProviderService.js src/services/ads/__tests__/ProviderService.test.js
git commit -m "feat(ads): add ProviderService orchestrator with role rules, health check, failover"
```

---

### Task 9: AdvertisementRenderer

**Files:**
- Create: `src/views/renderers/AdvertisementRenderer.js`

- [ ] **Step 1: Create the renderer**

```js
// src/views/renderers/AdvertisementRenderer.js
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

module.exports = new AdvertisementRenderer();
```

- [ ] **Step 2: Commit**

```bash
git add src/views/renderers/AdvertisementRenderer.js
git commit -m "feat(ads): add AdvertisementRenderer with registry-based partial selection"
```

---

### Task 10: AnalyticsService

**Files:**
- Create: `src/services/ads/AnalyticsService.js`

- [ ] **Step 1: Create AnalyticsService**

```js
// src/services/ads/AnalyticsService.js
const AdEvent = require('../../models/ads/AdEvent');
const { AD_EVENTS } = require('../../config/ads');

let providerFailures = {};
let providerLatencies = {};
let cacheHits = 0;
let cacheMisses = 0;

function subscribeToEventBus(eventBus) {
    eventBus.on(AD_EVENTS.SERVED, ({ ads, context, provider }) => {
        // Record served events for aggregate queries
    });

    eventBus.on(AD_EVENTS.PROVIDER_FAILED, ({ provider, error }) => {
        if (!providerFailures[provider]) providerFailures[provider] = [];
        providerFailures[provider].push({ timestamp: new Date(), error });
    });
}

async function getDailyImpressions(from, to) {
    return AdEvent.countDocuments({
        type: 'impression',
        createdAt: { $gte: from, $lte: to }
    });
}

async function getDailyClicks(from, to) {
    return AdEvent.countDocuments({
        type: 'click',
        createdAt: { $gte: from, $lte: to }
    });
}

async function getCTR(from, to) {
    const [impressions, clicks] = await Promise.all([
        getDailyImpressions(from, to),
        getDailyClicks(from, to)
    ]);
    return impressions > 0 ? (clicks / impressions) * 100 : 0;
}

async function getTopAds(limit = 10) {
    return AdEvent.aggregate([
        { $match: { type: 'click' } },
        { $group: { _id: '$adConfig', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: limit }
    ]);
}

async function getWorstAds(limit = 10) {
    return AdEvent.aggregate([
        { $match: { type: 'impression' } },
        { $group: { _id: '$adConfig', count: { $sum: 1 } } },
        { $sort: { count: 1 } },
        { $limit: limit }
    ]);
}

async function getProviderStats() {
    return { providerFailures, providerLatencies };
}

async function getPlacementStats() {
    return AdEvent.aggregate([
        { $group: { _id: '$placement', impressions: { $sum: 1 } } },
        { $sort: { impressions: -1 } }
    ]);
}

function recordProviderFailure(providerName, error) {
    if (!providerFailures[providerName]) providerFailures[providerName] = [];
    providerFailures[providerName].push({ timestamp: new Date(), error });
}

function recordProviderLatency(providerName, durationMs) {
    if (!providerLatencies[providerName]) providerLatencies[providerName] = [];
    providerLatencies[providerName].push(durationMs);
    if (providerLatencies[providerName].length > 1000) {
        providerLatencies[providerName] = providerLatencies[providerName].slice(-500);
    }
}

function recordCacheHit(placement) {
    cacheHits++;
}

function recordCacheMiss(placement) {
    cacheMisses++;
}

function getCacheStats() {
    return { hits: cacheHits, misses: cacheMisses, ratio: cacheHits + cacheMisses > 0 ? cacheHits / (cacheHits + cacheMisses) : 0 };
}

module.exports = {
    subscribeToEventBus,
    getDailyImpressions,
    getDailyClicks,
    getCTR,
    getTopAds,
    getWorstAds,
    getProviderStats,
    getPlacementStats,
    recordProviderFailure,
    recordProviderLatency,
    recordCacheHit,
    recordCacheMiss,
    getCacheStats
};
```

- [ ] **Step 2: Commit**

```bash
git add src/services/ads/AnalyticsService.js
git commit -m "feat(ads): add AnalyticsService with aggregate queries and operational metrics"
```

---

### Task 11: AdSimulationService EventBus subscription

**Files:**
- Modify: `src/services/ads/AdSimulationService.js`

- [ ] **Step 1: Read the current file to find the right insertion point**

Run: `grep -n "module.exports" src/services/ads/AdSimulationService.js`
Expected: find the exports line

- [ ] **Step 2: Add subscribeToEventBus function and update exports**

Add to the end of `src/services/ads/AdSimulationService.js`, before `module.exports`:

```js
const { AD_EVENTS } = require('../../config/ads');

/**
 * Subscribes to EventBus for impression and click tracking.
 * Compatible with existing triggerAdForUser which still creates AdEvents directly.
 * This enables external API routes to also record events through EventBus.
 */
function subscribeToEventBus(eventBus) {
    eventBus.on(AD_EVENTS.IMPRESSION, async (data) => {
        if (process.env.ADS_TRACK_IMPRESSIONS === 'false') return;
        try {
            await simulateImpression(data.adConfigId, data.userId, data.placement, data.sessionId);
        } catch (err) {
            console.error('AdSimulationService: EventBus impression handler error:', err);
        }
    });

    eventBus.on(AD_EVENTS.CLICKED, async (data) => {
        if (process.env.ADS_TRACK_CLICKS === 'false') return;
        try {
            await simulateClick(data.impressionId);
        } catch (err) {
            console.error('AdSimulationService: EventBus click handler error:', err);
        }
    });
}
```

Then add `subscribeToEventBus` to the exports:

```js
module.exports = {
    triggerAdForUser,
    triggerRewardedAd,
    simulateImpression,
    simulateClick,
    simulateRewardedAd,
    getAdAnalytics,
    getGlobalAdAnalytics,
    seedDefaultData,
    computeRevenue,
    computeUserReward,
    simulateCTR,
    subscribeToEventBus,
    AD_TYPE_REVENUE,
    REWARD_RATES
};
```

- [ ] **Step 3: Run existing tests to make sure nothing broke**

Run: `npx jest tests/unit/adSimulation.test.js --no-cache`
Expected: PASS (all existing tests)

- [ ] **Step 4: Commit**

```bash
git add src/services/ads/AdSimulationService.js
git commit -m "feat(ads): add subscribeToEventBus to AdSimulationService for EventBus-based tracking"
```

---

### Task 12: (Prerequisite read)

- [ ] **Step 1: Read the current barrel export**

Read `src/services/ads/index.js` and find the current exports. Read `src/app.js` (the route registration section). Read `src/server.js` (the ad seeding section).

- [ ] **Step 2: Commit (info only — no code changes)**

```bash
git add -A
git commit -m "chore: snapshot current state before barrel export and wiring changes"
```
(This step can be skipped if preferred — it's just a reference checkpoint.)

---

### Task 13: Barrel export update

**Files:**
- Modify: `src/services/ads/index.js`

- [ ] **Step 1: Update barrel export**

```js
// src/services/ads/index.js
const AdSimulationService = require('./AdSimulationService');
const AdRevenueService = require('./AdRevenueService');
const ReaderRewardService = require('./ReaderRewardService');
const PublisherPoolService = require('./PublisherPoolService');
const OrgReserveService = require('./OrgReserveService');
const ProviderService = require('./ProviderService');
const AnalyticsService = require('./AnalyticsService');
const EventBus = require('./EventBus');

module.exports = {
    AdSimulationService,
    AdRevenueService,
    ReaderRewardService,
    PublisherPoolService,
    OrgReserveService,
    ProviderService,
    AnalyticsService,
    EventBus
};
```

Note: `AdPlacementService` is intentionally removed. It will be deleted in a later task.

- [ ] **Step 2: Commit**

```bash
git add src/services/ads/index.js
git commit -m "feat(ads): update barrel export — add ProviderService, AnalyticsService, EventBus; remove AdPlacementService"
```

---

### Task 14: API routes for ads

**Files:**
- Create: `src/routes/ads.js`

- [ ] **Step 1: Create API routes**

```js
// src/routes/ads.js
const ProviderService = require('../services/ads/ProviderService');
const { AD_EVENTS, PLACEMENTS } = require('../config/ads');

let eventBus = null;

function setEventBus(bus) {
    eventBus = bus;
}

async function adsRoutes(fastify) {
    fastify.get('/ads', async (req, reply) => {
        const { placement, count = 1 } = req.query;
        if (!placement) {
            return reply.status(400).send({ error: 'placement query parameter is required' });
        }
        const context = buildContext(req, placement, parseInt(count, 10) || 1);
        const ads = await ProviderService.getAds(context, eventBus);
        return { success: true, ads };
    });

    fastify.get('/ads/:placement', async (req, reply) => {
        const { placement } = req.params;
        const count = parseInt(req.query.count || '1', 10);
        const context = buildContext(req, placement, count);
        const ads = await ProviderService.getAds(context, eventBus);
        return { success: true, ads };
    });

    fastify.post('/ads/:id/impression', async (req, reply) => {
        if (eventBus) {
            eventBus.emit(AD_EVENTS.IMPRESSION, {
                adId: req.params.id,
                userId: req.currentUser?.id,
                placement: req.body?.placement,
                sessionId: req.body?.sessionId,
                device: req.headers['user-agent'],
                browser: req.headers['user-agent'],
                country: req.headers['cf-ipcountry'] || null
            });
        }
        return { success: true };
    });

    fastify.post('/ads/:id/click', async (req, reply) => {
        if (eventBus) {
            eventBus.emit(AD_EVENTS.CLICKED, {
                impressionId: req.params.id,
                adId: req.params.id,
                userId: req.currentUser?.id,
                placement: req.body?.placement,
                destination: req.body?.destination,
                referrer: req.headers.referer,
                device: req.headers['user-agent']
            });
        }
        return { success: true };
    });

    fastify.get('/ads/placements', async (req, reply) => {
        return { success: true, placements: Object.values(PLACEMENTS) };
    });
}

function buildContext(req, placement, count) {
    return {
        placement,
        count,
        user: req.currentUser ? { id: req.currentUser.id, role: req.currentUser.role } : { role: 'guest' },
        session: req.session ? { id: req.session } : null,
        request: req,
        locale: req.headers['accept-language'] || 'en-US',
        page: req.url,
        route: req.routeOptions?.url || '',
        tags: req.pageTags || [],
        category: req.pageCategory || ''
    };
}

module.exports = adsRoutes;
module.exports.setEventBus = setEventBus;
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/ads.js
git commit -m "feat(ads): add /api/ads/* API routes with impression/click tracking"
```

---

### Task 15: Update route handlers in pages.js

**Files:**
- Modify: `src/routes/pages.js`

- [ ] **Step 1: Read each call site with context**

Read around lines 276-284, 1030-1048, 1195-1212, 1458-1470 in `src/routes/pages.js`.

- [ ] **Step 2: Replace dashboard route ad call (around line 280)**

Change from:
```js
const { getAdForSlot } = require('../services/ads/AdPlacementService');
rewardedAd = await getAdForSlot(userId, 'reward_wall', null);
```

To:
```js
const { getAds: getAd } = require('../services/ads/ProviderService');
const rewardedAds = await getAd({ placement: 'reward_wall', user: { id: userId }, session: null }, null);
rewardedAd = rewardedAds.length > 0 ? rewardedAds[0] : null;
```

- [ ] **Step 3: Replace home-logged-in route ad call (around line 1036)**

Change from:
```js
const { getFeedAds, getAdForSlot } = require('../services/ads/AdPlacementService');
feedAds = await getFeedAds(currentUserId, null);
sidebarAd = await getAdForSlot(currentUserId, 'sidebar', null);
```

To:
```js
const { getAds: getAd } = require('../services/ads/ProviderService');
feedAds = await getAd({ placement: 'feed_native', user: { id: currentUserId }, session: null, count: 2 }, null);
const sidebarAds = await getAd({ placement: 'sidebar', user: { id: currentUserId }, session: null }, null);
sidebarAd = sidebarAds.length > 0 ? sidebarAds[0] : null;
```

- [ ] **Step 4: Replace explore route ad call (around line 1201)**

Change from:
```js
const { getFeedAds, getAdForSlot } = require('../services/ads/AdPlacementService');
feedAds = await getFeedAds(currentUserId, null);
sidebarAd = await getAdForSlot(currentUserId, 'sidebar', null);
```

To:
```js
const { getAds: getAd } = require('../services/ads/ProviderService');
feedAds = await getAd({ placement: 'feed_native', user: { id: currentUserId }, session: null, count: 2 }, null);
const sidebarAds = await getAd({ placement: 'sidebar', user: { id: currentUserId }, session: null }, null);
sidebarAd = sidebarAds.length > 0 ? sidebarAds[0] : null;
```

- [ ] **Step 5: Replace post route ad call (around line 1463)**

Change from:
```js
const { getAdForSlot } = require('../services/ads/AdPlacementService');
adInline = await getAdForSlot(req.currentUser?.id || null, 'article_inline', null);
adBanner = await getAdForSlot(req.currentUser?.id || null, 'article_endcap', null);
```

To:
```js
const { getAds: getAd } = require('../services/ads/ProviderService');
const inlineAds = await getAd({ placement: 'article_inline', user: { id: req.currentUser?.id || null }, session: null }, null);
adInline = inlineAds.length > 0 ? inlineAds[0] : null;
const bannerAds = await getAd({ placement: 'article_endcap', user: { id: req.currentUser?.id || null }, session: null }, null);
adBanner = bannerAds.length > 0 ? bannerAds[0] : null;
```

- [ ] **Step 6: Run existing tests**

Run: `npx jest tests/ --no-cache` (or relevant test suites)
Expected: All existing tests pass (ad services are lazy-loaded so import changes shouldn't break tests)

- [ ] **Step 7: Commit**

```bash
git add src/routes/pages.js
git commit -m "feat(ads): update pages.js route handlers to use ProviderService.getAds()"
```

---

### Task 16: Wire startup in app.js and server.js

**Files:**
- Modify: `src/app.js`
- Modify: `src/server.js`

- [ ] **Step 1: Add route registration in app.js**

After the existing route registrations (around line 265), add:
```js
const adsRoutes = require('./routes/ads');
fastify.register(require('./routes/ads'), { prefix: '/api/ads' });
```

Also create EventBus singleton and wire it to ads routes:
```js
// Near the top of the buildApp function, after other requires:
const EventBus = require('./services/ads/EventBus');
const eventBus = new EventBus();
```

After route registration:
```js
// Wire EventBus to ads routes for tracking
adsRoutes.setEventBus(eventBus);
```

- [ ] **Step 2: Wire provider registration and EventBus subscription in server.js**

After the database connection and before `seedDefaultData()` call, add:

```js
// Provider registration
const ProviderFactory = require('./services/ads/providers/ProviderFactory');
const MockProvider = require('./services/ads/providers/MockProvider');
ProviderFactory.register('mock', MockProvider);
// DirectProvider placeholder — reserved for Phase 2 (self-served sponsored content)
const AdProviderInterface = require('./services/ads/providers/AdProviderInterface');
class DirectProvider extends AdProviderInterface {
    get name() { return 'direct'; }
    async getAds() { return []; }
    async recordImpression() {}
    async recordClick() {}
    async healthCheck() { return true; }
}
ProviderFactory.register('direct', DirectProvider);

// EventBus and Analytics wiring
const EventBus = require('./services/ads/EventBus');
const AnalyticsService = require('./services/ads/AnalyticsService');
const AdSimulationService = require('./services/ads/AdSimulationService');

const eventBus = new EventBus();
AdSimulationService.subscribeToEventBus(eventBus);
AnalyticsService.subscribeToEventBus(eventBus);
```

- [ ] **Step 3: Commit**

```bash
git add src/app.js src/server.js
git commit -m "feat(ads): wire EventBus, ProviderFactory, and route registration at startup"
```

---

### Task 17: Remove AdPlacementService

**Files:**
- Delete: `src/services/ads/AdPlacementService.js`

- [ ] **Step 1: Verify no remaining references**

Run: `rg "AdPlacementService" src/ --include='*.js'`
Expected: Only occurrences are in `docs/` and git history, not in any active `src/` file.

Run: `rg "getAdForSlot" src/ --include='*.js'`
Expected: None.

Run: `rg "getFeedAds" src/ --include='*.js'`
Expected: None.

- [ ] **Step 2: Delete the file**

```bash
git rm src/services/ads/AdPlacementService.js
```

- [ ] **Step 3: Run tests to confirm nothing broke**

Run: `npx jest tests/ --no-cache --passWithNoTests`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(ads): remove AdPlacementService (replaced by MockProvider + ProviderService)"
```

---

### Task 18: Final verification

- [ ] **Step 1: Run all tests**

```bash
npx jest --no-cache --passWithNoTests
```

Expected: All tests pass.

- [ ] **Step 2: Check for any remaining references to old API**

Run: `rg "getAdForSlot\|getFeedAds\|AdPlacementService" src/ --include='*.js' --include='*.ejs'`
Expected: No matches in `src/` (docs references are fine).

- [ ] **Step 3: Verify EJS partials still work**

All 5 partials check `ad.served`. The new ProviderService returns ads with `served: true`, `type`, `imageUrl`, `clickUrl`, `slot` — all fields the partials reference.

No EJS template changes needed (partials are selected by name from page templates, which remain unchanged).

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: final cleanup and verification after ads engine refactor"
```
