# Nook — Render to Vercel Migration

## Overview

This document tracks the migration of **Nook** from **Render** (container-based hosting) to **Vercel** (serverless + edge hosting). The application is a Fastify 5 + MongoDB + Redis + BullMQ tech news platform with server-side EJS rendering.

### Why This Is Complex

Nook is a **traditional long-running server** — it starts up, opens persistent connections to MongoDB and Redis, registers cron jobs, starts a BullMQ worker, and listens on a port. Vercel is a **serverless platform** — functions are invoked per-request, can't keep long-running processes, and have different constraints around connections, filesystem, and execution duration.

A direct "deploy the same code" approach would fail. This migration requires an **architectural split**: the request-response layer moves to Vercel's serverless functions, while background processing (BullMQ worker + cron jobs) runs on a separate container service.

---

## What Existed Before (Render)

```
┌──────────────────────────────────────────────────┐
│              Render (Single Service)              │
│                                                   │
│  src/server.js                                    │
│  ├── Creates Fastify instance                     │
│  ├── Registers 18 plugins (incl. cron)            │
│  ├── Registers all routes (pages, api, auth...)   │
│  ├── Connects to MongoDB (Mongoose)               │
│  ├── Connects to Redis (ioredis)                  │
│  ├── Starts BullMQ worker (background jobs)       │
│  ├── Starts 7 cron jobs (via fastify-cron)        │
│  ├── Listens on port 5050                         │
│  └── Graceful shutdown handlers                  │
│                                                   │
│  keep-alive-service.js                            │
│  └── Pings /ping and /health every 5 min          │
│      to prevent Render free-tier sleep            │
│                                                   │
│  .github/workflows/deploy.yml                     │
│  └── Deploy to Render (placeholder)               │
└──────────────────────────────────────────────────┘
```

### Render-Specific Dependencies

| Item | File | Description |
|------|------|-------------|
| `keep-alive-service.js` | Root | Prevents free-tier spin-down — useless outside Render |
| Redis port `12427` | `src/config/redis.js:9` | Render's default Redis port |
| `onrender.com` URLs | `src/config/index.js:66` | BASE_URL default |
| Deploy hook placeholder | `.github/workflows/deploy.yml:53` | Render deploy hook URL |

---

## Current Architecture (After Migration Phase 1 & 2)

```
┌─────────────────────────────────────┐     ┌──────────────────────────────┐
│  Vercel (Serverless Functions)       │     │  Worker Service (Container)  │
│                                     │     │                              │
│  api/index.js                       │     │  worker/index.js             │
│  └── Lazy-inits fastify on cold     │     │  ├── Connect MongoDB         │
│      start, routes through it       │     │  ├── Connect Redis (ioredis) │
│                                     │     │  ├── Start BullMQ Worker     │
│  src/app.js (shared)                │     │  └── Start 7 Cron Jobs       │
│  ├── Fastify instance               │     │                              │
│  ├── 17 plugins (NO cron)           │     │  worker/Dockerfile           │
│  ├── All routes (pages, API, auth)  │     │  └── pnpm start:worker       │
│  └── Exports { fastify, buildApp }  │     │                              │
│                                     │     │  src/cron/index.js (shared)  │
│  src/server.js                      │     │  └── 7 standalone functions  │
│  └── Imports from app.js            │     │                              │
│      + cron-plugin + worker + listen│     │  src/worker.js (shared)      │
│                                     │     │  └── BullMQ content worker   │
│  vercel.json                        │     │                              │
│  ├── Node.js 20 runtime             │     │  src/models/ (shared)        │
│  ├── Catch-all rewrites → /api      │     │  src/config/ (shared)        │
│  └── CDN cache headers              │     │  src/services/ (shared)      │
│                                     │     │                              │
│  Static Assets (future: Blob)       │     │  Deploy: Fly.io / Railway    │
│  └── public/ via @fastify/static    │     │  └── docker build -f         │
│                                     │     │      worker/Dockerfile .     │
└─────────────────────────────────────┘     └──────────────────────────────┘
```

---

## File-by-File Changes

### New Files

#### `src/app.js` — Shared Fastify Bootstrap
**Purpose:** Creates the Fastify instance, registers all plugins (except cron) and all routes. Works identically in both container and serverless contexts.

**What it contains:**
- Fastify instance with logger, router options, request ID generation
- 17 plugin registrations: static, view (EJS), cookie, JWT, helmet, rate-limit, CORS, sentry, request-id, validation, cache, admin-auth, admin-session, audit, auth, error-handler, swagger
- All 5 route registrations: pages, API, auth, reads, admin
- Exports `{ fastify, buildApp }` where `buildApp()` initializes everything

**Why:** Previously all this was inside `src/server.js`'s `registerPlugins()` function, which was only called when `start()` ran. Serverless mode needed a way to bootstrap Fastify without calling `.listen()`.

#### `api/index.js` — Vercel Serverless Entry Point
**Purpose:** The single entry point for all Vercel serverless function invocations.

**What it does:**
- On first request (cold start): calls `buildApp()` + `fastify.ready()`
- On subsequent requests: reuses the cached fastify instance
- Emits the request through `fastify.server.emit('request', req, res)`

**Why:** Vercel calls this function per HTTP request. There's no `app.listen()` — instead, we inject the Node.js `req`/`res` objects directly into Fastify's internal HTTP server.

#### `vercel.json` — Vercel Configuration
**Purpose:** Configures Vercel deployment.

**Key settings:**
- Node.js 20 runtime with 30s max duration
- Catch-all rewrite: `/* → /api/index`
- Cache-Control headers for static assets (images: 1 day, others: 1 hour)
- Cron jobs placeholder (empty array — to be populated)

#### `src/cron/index.js` — Standalone Cron Job Functions
**Purpose:** 7 cron job implementations extracted from the Fastify plugin, now framework-agnostic.

**Jobs:**
| Name | Trigger | What it does |
|------|---------|-------------|
| `toolsUpdate` | Configurable | Fetches latest blog content via fetchTools |
| `contentIngestion` | Configurable | Enqueues content jobs from all sources |
| `feedUpdate` | Configurable | Re-enqueues feed content jobs |
| `seoUpdate` | Configurable | Regenerates sitemap + pings search engines |
| `contentCleanup` | Configurable | Deletes job logs older than 30 days |
| `readerPoolSweep` | Configurable | Sweeps feed revenue to reader reward pool |
| `unfundedReadsSweep` | Configurable | Distributes unfunded reader rewards |

**Key difference from before:** These functions no longer depend on `fastifyInstance` for logging. They use `console.log/error` directly, making them runnable in any context (Fastify plugin, standalone worker, Vercel cron).

#### `worker/index.js` — Standalone Worker Entry Point
**Purpose:** Runs the BullMQ worker and all 7 cron jobs as a standalone Node.js process.

**Startup sequence:**
1. Connect to MongoDB (via `src/db.js`)
2. Connect to Redis (via `src/config/redis.js`)
3. Start BullMQ worker (via `src/worker.js`)
4. Schedule 7 cron jobs using the `cron` npm package
5. Register graceful shutdown handlers (SIGTERM/SIGINT)

**Why:** Vercel cannot run long-lived processes. The BullMQ worker and cron jobs need a persistent runtime, so they run in a separate container (Fly.io, Railway, or similar).

#### `worker/Dockerfile` — Worker Container Build
**Purpose:** Multi-stage Docker build for the worker service.

**Stages:**
1. `base`: Node 20 Alpine + pnpm
2. `deps`: Install production dependencies
3. `runner`: Copy deps + source, run `node worker/index.js`

### Modified Files

#### `src/server.js` — Container Entry Point (Refactored)
**Before:** Contained everything — fastify instance creation, plugin registration, route registration, redis/db init, worker start, cron start, listening, shutdown.

**After:** Imports `{ fastify, buildApp }` from `./app.js`, keeps only server-specific concerns:
- `buildApp()` (shared bootstrap)
- `cronPlugin` registration (server-only — not needed in serverless)
- Redis connection
- MongoDB connection
- BullMQ worker start
- Port detection and `fastify.listen()`
- Graceful shutdown (SIGTERM/SIGINT)
- `module.exports = fastify` (preserved for backward compat)

**Net change:** -108 lines (405 → 297)

#### `src/plugins/cron-plugin.js` — Thin Wrapper (Refactored)
**Before:** 171 lines with all 7 cron job implementations inline.

**After:** 53 lines. Imports job functions from `src/cron/index.js`, wraps each with a Fastify-compatible `onTick` handler.

#### `package.json`
- Added `"start:worker": "node worker/index.js"` script
- Removed `"name": "LatestTechNews"` → `"Nook"` (from previous rebranding)

### Deleted Files

#### `keep-alive-service.js`
**What it was:** A script that pinged `/ping` and `/health` every 5 minutes to prevent Render's free tier from spinning down the server.

**Why removed:** Render-specific utility. Vercel serverless functions don't have idle spin-down in the same way. On the worker container (Fly.io/Railway), the service is always active.

---

### Phase 3: Redis — ioredis → @upstash/redis (Completed)

**Problem:** `ioredis` maintains persistent TCP connections. Vercel serverless functions can keep connections alive between invocations, but cold starts create new connections, and connections can drop unexpectedly. Additionally, `ioredis` creates a connection immediately on import (line 53-58: `getRedisConnection()` creates a new `Redis()` client if none exists), which is problematic in serverless where you want lazy initialization.

**Solution:** Added `@upstash/redis` as an HTTP-based Redis client for serverless contexts. The cache and session layers use a unified `getCacheClient()` that returns Upstash when `UPSTASH_REDIS_REST_URL` is set, otherwise falls back to ioredis. The worker service continues using `ioredis` directly (BullMQ requires it for pub/sub and blocking commands).

**Files modified:**

#### `src/config/redis.js`
**Before:** Only exported ioredis functions: `getRedisConnection`, `connectRedis`, `disconnectRedis`, `isRedisConnected`, `createRedisConnection`.

**After:** Added Upstash support alongside existing ioredis:
- Imports `@upstash/redis` as `UpstashRedis` alongside `ioredis`
- `getUpstashClient()` — Lazily creates and returns an Upstash Redis client (only initializes if `UPSTASH_REDIS_REST_URL` env var is set)
- `isUpstashEnabled()` — Returns `true` when `UPSTASH_REDIS_REST_URL` is present
- `getCacheClient()` — **Unified entry point**: returns Upstash client if enabled, otherwise returns ioredis connection with ready-state check. Both contexts use `.get()`, `.set()`, `.del()` identically.

**Key difference:** `getCacheClient()` never calls `new Redis()` (ioredis) unless there's no Upstash config. This avoids creating unnecessary TCP connections in serverless where caching uses HTTP.

#### `src/plugins/cache.js`
**Before:** Used `getRedisConnection()` directly, checked `redis.status === 'ready'`, called `redis.setex()` for TTL sets.

**After:** Uses `getCacheClient()` + `isUpstashEnabled()` helpers from redis config:
- `getCacheClient()` replaces `getRedisConnection()` — returns the right client automatically
- Cache enable check: `!!redis` instead of `redis.status === 'ready'` (Upstash has no `.status`)
- `cacheSet()` helper normalizes the TTL set difference:
  - **ioredis**: `redis.setex(key, ttl, value)`
  - **Upstash**: `redis.set(key, value, { ex: ttl })`

#### `src/plugins/admin-session.js`
**Before:** Used `getRedisConnection()` with `.status !== 'ready'` guards, called `redis.setex()`.

**After:** Same pattern as cache plugin:
- Uses `getCacheClient()` instead of `getRedisConnection()`
- Uses `sessionSet()` helper for TTL writes (same normalization as cache)
- Added `!isUpstashEnabled()` guard before `.status` checks

#### `src/services/HealthService.js`
**Before:** Only checked `isRedisConnected()` (ioredis-specific), then called `redis.ping()` and returned `redis.status === 'ready'`.

**After:** Checks `isUpstashEnabled()` first:
- If Upstash: calls `getUpstashClient()`, pings, returns `connected: true`
- If ioredis: same logic as before
- Both paths test actual connectivity via `.ping()` rather than assuming from status

#### `package.json` / `pnpm-lock.yaml`
Added `@upstash/redis@^1.38.0` dependency.

**How it works at runtime:**

| Context | `UPSTASH_REDIS_REST_URL` | Cache/Session uses | BullMQ uses |
|---------|-------------------------|-------------------|-------------|
| Local dev | Not set | ioredis (localhost:6379) | ioredis |
| Worker container | Not set | ioredis (from env) | ioredis |
| Vercel serverless | **Set** | @upstash/redis (HTTP) | N/A (no worker) |

**Environment variables required for Vercel:**
```
UPSTASH_REDIS_REST_URL=https://<id>.upstash.io
UPSTASH_REDIS_REST_TOKEN=<token>
```

---

### Phase 4: Static Assets — Vercel Edge CDN via Rewrite (Completed)

**Problem:** The app uses `@fastify/static` to serve files from `public/`. On Vercel, serving static files through the serverless function is wasteful — every image/JS/CSS request would invoke the Node.js function instead of being served from the Edge CDN. Additionally, `@fastify/static` registers a prefix `/public/`, so files are served at paths like `/public/css/output.css`.

**Solution:** A two-layer approach:

1. **Vercel Edge CDN** (primary): Files in `public/` are automatically served by Vercel's static file infrastructure at root paths (e.g., `public/css/output.css` → `/css/output.css`). A rewrite rule maps the template's `/public/` paths to the root path, so Vercel serves them from the Edge CDN.
2. **`@fastify/static`** (fallback): In container mode and as a fallback on Vercel, `@fastify/static` continues to serve files at `/public/` prefix.
3. **Asset URL helper** (future-proofing): An `assetUrl()` function is available in all EJS templates. When `ASSETS_URL` env var is set (e.g., pointing to Vercel Blob Storage), the helper returns the CDN URL. Otherwise, it returns the original path.

**Files modified/created:**

#### `vercel.json`
**Before:**
```json
"rewrites": [
    { "source": "/(.*)", "destination": "/api/index" }
]
```
All requests went to the serverless function, including static files.

**After:**
```json
"rewrites": [
    { "source": "/public/(.*)", "destination": "/$1" },
    { "source": "/(.*)", "destination": "/api/index" }
]
```
The `/public/(.*)` rewrite maps static file requests to Vercel's root-path static serving. If the file exists in `public/`, Vercel serves it from the Edge CDN. If not (edge case), it falls through to the serverless function.

**How it works:**
1. Request arrives for `/public/css/output.css`
2. Vercel rewrite matches `/public/(.*)` → rewrites to `/css/output.css`
3. Vercel checks for static file at `public/css/output.css` → found!
4. Served from Edge CDN with Cache-Control headers (images: 1 day, everything else: 1 hour)

#### `src/config/assets.js` (new)
Exports two functions:
- `assetUrl(path)` — If `ASSETS_URL` env var is set, returns `<ASSETS_URL>/<path>` (e.g., `https://blob-store.vercel-storage.com/css/output.css`). Otherwise returns the original path.
- `isUsingRemoteAssets()` — Returns `true` when `ASSETS_URL` is configured.

**Purpose:** Allows templates to optionally use the `assetUrl()` helper. Currently all templates use hardcoded `/public/...` paths (which work via the rewrite). When migrating to Vercel Blob in the future, just set `ASSETS_URL` and update templates to use `<%= assetUrl('/public/css/output.css') %>`.

#### `src/app.js` (modified)
- Imports `assetUrl` from `./config/assets`
- Passes `assetUrl` to EJS view context via `defaultContext`:
  ```js
  defaultContext: { CATEGORY_ENUM, CATEGORY_NAMES, assetUrl }
  ```
- Now available in every EJS template as `<%= assetUrl('/public/images/og-default.png') %>`

#### `scripts/upload-static.mjs` (new)
ES module script that uploads the entire `public/` directory to Vercel Blob Storage at deploy time. Uses `@vercel/blob` SDK.

**Usage in CI/CD:**
```bash
BLOB_READ_WRITE_TOKEN=<token> node scripts/upload-static.mjs
```

After uploading, set `ASSETS_URL` in Vercel environment variables to the Blob base URL.

#### `package.json` / `pnpm-lock.yaml`
Added `@vercel/blob@^2.4.0` as dev dependency.

**How static assets resolve at runtime:**

| Context | `ASSETS_URL` | How assets are served |
|---------|-------------|----------------------|
| Local dev | Not set | `@fastify/static` at `/public/` (unchanged) |
| Container/Railway | Not set | `@fastify/static` at `/public/` (unchanged) |
| Vercel (CDN) | Not set | Vercel Edge CDN via `/public/` → `/$1` rewrite |
| Vercel (Blob) | `https://<store>.public.blob.vercel-storage.com` | Vercel Blob Storage via `assetUrl()` helper |

**Current state:** Vercel serves static files from Edge CDN via the rewrite rule. The `assetUrl()` helper and Blob upload script are ready for future optimization but not yet activated (no `ASSETS_URL` is set).

### Phase 6: Vercel Cron Jobs
**Problem:** The 7 cron jobs currently run via `fastify-cron` in the container. They need to also (or instead) run as Vercel Cron Jobs for the serverless deployment.

**Solution:** Add cron job definitions to `vercel.json` that hit specific API endpoints. These endpoints call the same `src/cron/index.js` functions.

**Files affected:**
- `vercel.json` — Add `"crons": [...]` entries
- New: API routes that trigger cron jobs (e.g., `GET /api/cron/tools-update`)

### Phase 7: CI/CD — Dual Deployment
**Problem:** Current `deploy.yml` has Render deploy hook placeholders.

**Solution:** Split into two deploy jobs — Vercel deploy (API) + container deploy (Worker).

**Files affected:**
- `.github/workflows/deploy.yml` — Full rewrite
- New: GitHub secrets for Vercel + Fly.io/Railway tokens

### Phase 8: Vercel Project Configuration
**Problem:** No Vercel project exists yet.

**Solution:** Create Vercel project, configure 28+ environment variables (the same ones from `.env`), connect domain, set up preview deployments.

**Tools:** Vercel CLI (`vercel link`, `vercel env pull`)

### Phase 9: DNS Cut-over
**Problem:** Traffic currently goes to `nook-app.onrender.com`.

**Solution:** Gradual DNS migration — start with 10% traffic to Vercel preview URL, ramp to 100%, then update the custom domain's DNS records.

---

## How To Run Locally

### Full Stack (Container Mode — Same as Before)
```bash
docker-compose up -d          # Start MongoDB + Redis
pnpm dev                      # Start Fastify with hot reload
```

### Worker Only (For Testing Split)
```bash
docker-compose up -d          # Start MongoDB + Redis
pnpm start:worker             # Start worker + cron standalone
```

### Vercel Mode (For Testing Serverless)
```bash
docker-compose up -d          # Start MongoDB + Redis (still needed)
vercel dev                    # Start Vercel dev server (api/index.js)
```

---

## Key Design Decisions

1. **Why not use `@fastify/aws-lambda`?** Vercel uses standard Node.js HTTP handlers, not AWS Lambda's event format. Direct `req`/`res` injection via `fastify.server.emit()` is simpler and doesn't require additional adapters.

2. **Why extract cron jobs from the plugin?** The cron jobs were tightly coupled to Fastify's `fastifyInstance` for logging. Extracting them to pure functions allows reuse in the standalone worker, Vercel cron endpoints, and the Fastify plugin — all without duplication.

3. **Why not turn the worker into a separate npm package?** The worker shares most of its code (models, config, services) with the main app. A monorepo or separate package would add complexity. Instead, the `worker/` directory imports from `../src/` — simple and effective.

4. **Why keep `ioredis` for the worker?** BullMQ requires a Redis client that supports pub/sub and blocking commands — `@upstash/redis` (HTTP-based) doesn't support these. The worker must use `ioredis`. For the Vercel API, where Redis is used only for caching, `@upstash/redis` is sufficient.

---

## Rollback Plan

If the migration fails at any stage:

1. **DNS rollback**: Update DNS to point back to Render URL
2. **Container rollback**: If worker container fails, `git revert` the last deploy commit and redeploy on Render
3. **Vercel rollback**: Use Vercel dashboard to point production domain to the previous deployment
4. **Full revert**: `git checkout main && git branch -D migrate-to-vercel`
