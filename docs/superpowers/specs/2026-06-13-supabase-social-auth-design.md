# Supabase Social Auth Integration

## Overview
Add social signup/login via Google, X (Twitter), and Discord using Supabase Auth as the OAuth provider, while keeping MongoDB as the application database.

## Architecture

```
Browser                          Fastify Server               MongoDB / Supabase
──────                          ──────────────               ─────────────────
Login page                          │                              │
(supabase-js OAuth)                 │                              │
  │                                 │                              │
  ├── Sign in with Google ──────────► Supabase Auth ──────────────► Google OAuth
  │    (redirect)                    │                              │
  │                                 │                              │
  ◄── Redirect back to /auth/callback                               │
  │    (session in URL hash)        │                              │
  │                                 │                              │
  ├── POST /api/auth/supabase ──────► Verify token via             │
  │    { accessToken }               Supabase Admin API             │
  │                                 │                              │
  │                                 ├── Upsert MongoDB user ──────► Users
  │                                 │    (authUserId, provider,     │
  │                                 │     email, displayName,       │
  │                                 │     avatar)                   │
  │                                 │                              │
  │                                 ├── Sign app JWT               │
  │                                 ├── Set auth_token cookie      │
  │                                 │                              │
  ◄── Redirect to /dashboard ──────►                               │
```

## Changes

### 1. Environment Variables
- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_ANON_KEY` — anon/public key (frontend)
- `SUPABASE_SERVICE_ROLE_KEY` — service role key (backend token verification)

### 2. User Model (`src/models/User.js`)
- Add field: `authUserId: { type: String, sparse: true, unique: true }`
- Add field: `authProvider: { type: String, enum: ['email', 'google', 'twitter', 'discord'], default: 'email' }`
- Make `password` conditional: not required when `authProvider !== 'email'`

### 3. New Route: `POST /api/auth/supabase`
- Accepts `{ accessToken }` from the frontend
- Verifies token via Supabase REST API: `GET ${SUPABASE_URL}/auth/v1/user` with `apikey` + `Authorization: Bearer ${accessToken}`
- Extracts: `sub` (authUserId), `email`, `user_metadata.name`, `user_metadata.avatar_url`
- Upserts MongoDB user by `authUserId`, creates with `authProvider` if new
- Signs app JWT with `{ id, email, role }`, sets `auth_token` cookie (same as existing login)

### 4. Frontend — Supabase Client
- Initialize `@supabase/supabase-js` in the login page `<head>` or as a shared partial
- Add three social buttons to login and register pages
- Callback page/route at `/auth/callback` that:
  - Reads session via `supabase.auth.getSession()` on mount
  - Sends access token to `POST /api/auth/supabase`
  - Redirects to `/dashboard` on success

### 5. New Dependency
- `@supabase/supabase-js` — Supabase client library

### 6. No Changes Needed
- Auth middleware (`src/plugins/auth.js`) — our JWT payload is unchanged
- Session cookie mechanism — same `auth_token` cookie
- Existing email/password login — untouched

## Error Handling
- If Supabase token verification fails, return 401 with `{ success: false, error: 'Invalid token' }`
- If MongoDB upsert fails, log error and return 500
- Frontend shows an error toast on failure
