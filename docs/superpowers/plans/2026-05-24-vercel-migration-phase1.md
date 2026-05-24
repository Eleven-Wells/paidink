# Vercel Migration — Phase 1: Fastify Serverless Bootstrap

> **For agentic workers:** Inline execution.

**Goal:** Extract shared Fastify app bootstrap so the same code runs in both container mode (local/Render/Railway) and Vercel serverless functions.

**Architecture:** Fastify instance + plugin registration + route registration moves to `src/app.js`. Server mode (listening, cron, worker) stays in `src/server.js`. Vercel mode wraps the shared app in a serverless handler at `api/index.js`.

**Tech Stack:** Fastify 5, Node.js 20, Vercel Serverless Functions

---

### Task 1: Remove Render-specific keep-alive service

- [x] Delete `keep-alive-service.js`
- [x] Delete `.kilo/worktrees/golden-echinacea/keep-alive-service.js`
- [x] Verify nothing imports it

### Task 2: Create shared app bootstrap (`src/app.js`)

**Create:** `src/app.js`

- [ ] Create `src/app.js` with fastify instance creation, all plugin registrations (except cron), route registrations, and a `buildApp()` export

**Modify:** `src/server.js`

- [ ] Refactor to import from `./app`, keep only server-specific logic (cron plugin, redis/db init, worker start, listening, graceful shutdown)

### Task 3: Create Vercel serverless entry point (`api/index.js`)

**Create:** `api/index.js`

- [ ] Serverless handler that calls `buildApp()` on first request, then routes through fastify

### Task 4: Create Vercel configuration (`vercel.json`)

**Create:** `vercel.json`

- [ ] Node.js runtime config, rewrites, headers, cron stubs for later

### Task 5: Verify

- [ ] `node src/server.js` still works locally
- [ ] `git status` clean
- [ ] Commit and push
