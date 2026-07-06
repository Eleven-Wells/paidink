# Supabase Social Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add Google, X (Twitter), and Discord social login via Supabase Auth while keeping MongoDB as the application database.

**Architecture:** Frontend uses `@supabase/supabase-js` for OAuth. Backend verifies tokens via Supabase REST API, upserts MongoDB users linked by `authUserId`, and issues the existing app JWT + cookie.

**Tech Stack:** Fastify, MongoDB/Mongoose, Supabase Auth, @supabase/supabase-js

---

### Task 1: Update User Model

**Files:**
- Modify: `src/models/User.js:1-20`

- [ ] **Step 1: Add authUserId and authProvider fields, make password optional for social users**

Edit `src/models/User.js` to add two new fields and conditionally relax the password requirement:

```js
// After line 5 (const userSchema = new mongoose.Schema({)
// Replace the email and password fields with:
    email: {
        type: String,
        required: [true, 'Email is required'],
        unique: true,
        lowercase: true,
        trim: true,
        match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email']
    },
    password: {
        type: String,
        minlength: [6, 'Password must be at least 6 characters'],
        select: false
    },
    authUserId: {
        type: String,
        sparse: true,
        unique: true
    },
    authProvider: {
        type: String,
        enum: ['email', 'google', 'twitter', 'discord'],
        default: 'email'
    },
```

Then update the pre-save hook to only hash password if it's present (social users won't have one). Find the existing pre-save hook and wrap the hash logic:

```js
// Find this (around line 80-90):
userSchema.pre('save', async function (next) {
    if (!this.isModified('password') || !this.password) return next();
// ...rest stays the same
```

- [ ] **Step 2: Commit**

```bash
git add src/models/User.js
git commit -m "feat: add authUserId and authProvider fields to User model"
```

### Task 2: Add Supabase Auth Route

**Files:**
- Modify: `src/routes/auth.js`
- Create: `src/services/SupabaseAuthService.js`

- [ ] **Step 1: Create SupabaseAuthService**

Create `src/services/SupabaseAuthService.js`:

```js
const axios = require('axios');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

async function verifyAccessToken(accessToken) {
    const { data, error } = await axios.get(`${SUPABASE_URL}/auth/v1/user`, {
        headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${accessToken}`
        }
    });

    return { user: data, error };
}

module.exports = {
    verifyAccessToken
};
```

- [ ] **Step 2: Add supabase route to auth.js**

Add the new route at the end of `src/routes/auth.js` (before the closing `}` of `module.exports`):

```js
    fastify.post('/supabase', async (req, reply) => {
        try {
            const { accessToken } = req.body;
            if (!accessToken) {
                return reply.code(400).send({ success: false, error: 'Access token is required' });
            }

            const { user: supabaseUser, error } = await verifyAccessToken(accessToken);
            if (error || !supabaseUser) {
                return reply.code(401).send({ success: false, error: 'Invalid or expired token' });
            }

            const authUserId = supabaseUser.id;
            const email = supabaseUser.email;
            const metadata = supabaseUser.user_metadata || {};
            const provider = supabaseUser.app_metadata?.provider || 'google';
            const displayName = metadata.name || metadata.full_name || email?.split('@')[0] || 'User';
            const avatar = metadata.avatar_url || metadata.picture || null;

            let user = await User.findOne({ authUserId });

            if (user) {
                user.lastLogin = new Date();
                if (avatar && user.avatar !== avatar) user.avatar = avatar;
                if (displayName && user.displayName !== displayName) user.displayName = displayName;
                await user.save();
            } else {
                const existingEmail = email ? await User.findOne({ email }) : null;
                if (existingEmail) {
                    existingEmail.authUserId = authUserId;
                    existingEmail.authProvider = provider;
                    existingEmail.lastLogin = new Date();
                    existingEmail.email = email;
                    if (avatar) existingEmail.avatar = avatar;
                    if (displayName) existingEmail.displayName = displayName;
                    await existingEmail.save();
                    user = existingEmail;
                } else {
                    user = new User({
                        email: email || `${authUserId}@supabase.auth`,
                        authUserId,
                        authProvider: provider,
                        displayName,
                        avatar,
                        username: `user_${Date.now().toString(36)}`,
                        lastLogin: new Date()
                    });
                    await user.save();
                }
            }

            const token = fastify.jwt.sign({
                id: user._id,
                email: user.email,
                role: user.role
            });

            reply.setCookie('auth_token', token, {
                path: '/',
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax',
                maxAge: 7 * 24 * 60 * 60
            });

            return reply.send({
                success: true,
                data: {
                    user: user.toPublicJSON(),
                    token
                }
            });
        } catch (err) {
            req.log.error(err, 'Supabase auth error');
            return reply.code(500).send({ success: false, error: 'Authentication failed' });
        }
    });
```

- [ ] **Step 3: Wire the service import at the top of auth.js**

Add to the top of `src/routes/auth.js`:

```js
const { verifyAccessToken } = require('../services/SupabaseAuthService');
```

- [ ] **Step 4: Add axios dependency**

```bash
npm install axios
```

- [ ] **Step 5: Commit**

```bash
git add src/services/SupabaseAuthService.js src/routes/auth.js package.json package-lock.json
git commit -m "feat: add supabase auth route and token verification service"
```

### Task 3: Install @supabase/supabase-js and add Supabase init script

**Files:**
- Create: `src/public/js/supabase-client.js`
- Modify: `src/views/pages/login-light.ejs`

- [ ] **Step 1: Install supabase-js**

```bash
npm install @supabase/supabase-js
```

- [ ] **Step 2: Create supabase-client.js**

Create `src/public/js/supabase-client.js`:

```js
(function () {
    if (window.__supabaseClient) return;

    var SUPABASE_URL = window.__SUPABASE_URL;
    var SUPABASE_ANON_KEY = window.__SUPABASE_ANON_KEY;

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        console.warn('Supabase credentials not configured');
        return;
    }

    var supabase = supabaseClient.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    window.__supabase = supabase;

    window.__supabaseSocialLogin = function (provider) {
        supabase.auth.signInWithOAuth({
            provider: provider,
            options: {
                redirectTo: window.location.origin + '/auth/callback'
            }
        });
    };
})();
```

- [ ] **Step 3: Add Supabase CDN script and init to login page**

Add before `</head>` in `src/views/pages/login-light.ejs`:

```ejs
    <script src="https://unpkg.com/@supabase/supabase-js@2"></script>
    <script>
        window.__SUPABASE_URL = '<%= process.env.SUPABASE_URL || "" %>';
        window.__SUPABASE_ANON_KEY = '<%= process.env.SUPABASE_ANON_KEY || "" %>';
    </script>
    <script src="/public/js/supabase-client.js"></script>
```

- [ ] **Step 4: Add social auth buttons to the login page**

Find the form section in `src/views/pages/login-light.ejs` and add before the email form (or after, depending on design preference):

```ejs
            <div class="social-auth-section">
                <p style="text-align: center; margin-bottom: 16px; font-size: 18px; color: rgba(0,0,0,0.6);">Continue with</p>
                <div style="display: flex; gap: 12px; justify-content: center; margin-bottom: 24px;">
                    <button type="button" class="social-auth-btn google-btn" onclick="window.__supabaseSocialLogin('google')" aria-label="Sign in with Google">
                        <svg width="22" height="22" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                        <span>Google</span>
                    </button>
                    <button type="button" class="social-auth-btn x-btn" onclick="window.__supabaseSocialLogin('twitter')" aria-label="Sign in with X">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                        <span>X</span>
                    </button>
                    <button type="button" class="social-auth-btn discord-btn" onclick="window.__supabaseSocialLogin('discord')" aria-label="Sign in with Discord">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="#5865F2"><path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189z"/></svg>
                        <span>Discord</span>
                    </button>
                </div>
                <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 24px;">
                    <hr style="flex: 1; border: none; border-top: 1px solid rgba(0,0,0,0.1);">
                    <span style="color: rgba(0,0,0,0.4); font-size: 16px;">or sign in with email</span>
                    <hr style="flex: 1; border: none; border-top: 1px solid rgba(0,0,0,0.1);">
                </div>
            </div>
```

- [ ] **Step 5: Add social auth button styles**

Add before the closing `</style>` tag in the login page:

```css
        .social-auth-section {
            margin-bottom: 8px;
        }
        .social-auth-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            min-height: 44px;
            padding: 0 18px;
            border-radius: 999px;
            border: 1px solid rgba(0,0,0,0.12);
            background: #fff;
            cursor: pointer;
            font-family: 'Abhaya Libre', serif;
            font-size: 16px;
            font-weight: 600;
            color: #000;
            transition: background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
            flex: 1;
        }
        .social-auth-btn:hover {
            background: #fafafa;
            border-color: rgba(0,0,0,0.2);
            box-shadow: 0 2px 8px rgba(0,0,0,0.06);
        }
        .social-auth-btn svg {
            flex-shrink: 0;
        }
```

- [ ] **Step 6: Commit**

```bash
git add src/public/js/supabase-client.js src/views/pages/login-light.ejs package.json package-lock.json
git commit -m "feat: add supabase client and social login buttons to sign-in page"
```

### Task 4: Create Auth Callback Page

**Files:**
- Create: `src/views/pages/auth-callback.ejs`
- Modify: `src/routes/pages.js`

- [ ] **Step 1: Create callback page template**

Create `src/views/pages/auth-callback.ejs`:

```ejs
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Completing sign in... | Paidink </title>
    <meta name="theme-color" content="#6d0a0a">
    <script src="https://unpkg.com/@supabase/supabase-js@2"></script>
    <script>
        window.__SUPABASE_URL = '<%= process.env.SUPABASE_URL || "" %>';
        window.__SUPABASE_ANON_KEY = '<%= process.env.SUPABASE_ANON_KEY || "" %>';
    </script>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: 'Abhaya Libre', serif;
            background: #fff;
            color: #000;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
        }
        .callback-card {
            text-align: center;
            padding: 48px 32px;
        }
        .spinner {
            width: 40px;
            height: 40px;
            border: 3px solid rgba(109,10,10,0.12);
            border-top-color: #6d0a0a;
            border-radius: 50%;
            animation: spin 0.7s linear infinite;
            margin: 0 auto 24px;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        h1 { font-size: 24px; font-weight: 600; color: #000; }
        p { font-size: 18px; color: rgba(0,0,0,0.5); margin-top: 8px; }
    </style>
</head>
<body>
    <div class="callback-card">
        <div class="spinner"></div>
        <h1>Completing sign in...</h1>
        <p>You'll be redirected momentarily.</p>
    </div>
    <script src="/public/js/supabase-client.js"></script>
    <script>
    (async function () {
        var supabase = window.__supabase;
        if (!supabase) {
            window.location.href = '/login?error=supabase_not_configured';
            return;
        }
        var { data, error } = await supabase.auth.getSession();
        if (error || !data.session) {
            window.location.href = '/login?error=no_session';
            return;
        }
        var accessToken = data.session.access_token;
        try {
            var res = await fetch('/api/auth/supabase', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ accessToken })
            });
            var result = await res.json();
            if (result.success) {
                window.location.href = '/dashboard';
            } else {
                window.location.href = '/login?error=auth_failed';
            }
        } catch (err) {
            window.location.href = '/login?error=server_error';
        }
    })();
    </script>
</body>
</html>
```

- [ ] **Step 2: Add callback route to pages.js**

Find the pages route file and add a new route for `/auth/callback`. Look for where other page routes are defined (around the `/register`, `/login` routes) and add:

```js
    fastify.get('/auth/callback', async (req, reply) => {
        return reply.view('pages/auth-callback.ejs', {
            title: 'Completing sign in...',
            description: 'Completing your sign in to Paidink.'
        });
    });
```

- [ ] **Step 3: Commit**

```bash
git add src/views/pages/auth-callback.ejs src/routes/pages.js
git commit -m "feat: add auth callback page for supabase OAuth redirect"
```

### Task 5: Add social auth to register page

**Files:**
- Modify: `src/views/pages/register-light.ejs`

- [ ] **Step 1: Add Supabase init scripts to register page**

Add before `</head>` in `src/views/pages/register-light.ejs`:

```ejs
    <script src="https://unpkg.com/@supabase/supabase-js@2"></script>
    <script>
        window.__SUPABASE_URL = '<%= process.env.SUPABASE_URL || "" %>';
        window.__SUPABASE_ANON_KEY = '<%= process.env.SUPABASE_ANON_KEY || "" %>';
    </script>
    <script src="/public/js/supabase-client.js"></script>
```

- [ ] **Step 2: Add social buttons + divider to register page** (same HTML as Task 3 Step 4)

- [ ] **Step 3: Add social button CSS** (same CSS as Task 3 Step 5)

- [ ] **Step 4: Commit**

```bash
git add src/views/pages/register-light.ejs
git commit -m "feat: add supabase social login buttons to register page"
```

### Task 6: Add Environment Config and Wire Everything

**Files:**
- Modify: `.env.example` (or create if missing)

- [ ] **Step 1: Add Supabase env vars**

Add to `.env` / `.env.example`:

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
```

- [ ] **Step 2: Final verification check**

```bash
# Verify all files are created/modified
git status

# Check the auth route parses correctly
node -e "require('./src/services/SupabaseAuthService')"
```

- [ ] **Step 3: Push and open PR**

```bash
git push origin feat/supabase-social-auth
gh pr create --base main --head feat/supabase-social-auth --title "feat: supabase social auth (Google, X, Discord)" --body "Adds social signup/login via Google, X (Twitter), and Discord using Supabase Auth as the OAuth provider. See docs/superpowers/specs/2026-06-13-supabase-social-auth-design.md for full spec."
```
