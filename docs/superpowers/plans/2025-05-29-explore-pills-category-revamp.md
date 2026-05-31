# Explore Pills & Category Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make explore page category pills functional and unify the Post category enum with the config CATEGORY_ENUM to support a generalized content platform.

**Architecture:** Update data layer (Post model + config) first, then update all consumers (forms, services, seeds, tests), add a migration script for existing posts, then wire the explore pills UI and backend route with the new two-zone pill layout.

**Tech Stack:** MongoDB/Mongoose, Fastify, EJS, Node.js

---

### Task 1: Update config CATEGORY_ENUM and CATEGORY_NAMES

**Files:**
- Modify: `src/config/index.js:4-27`

- [ ] **Step 1: Update CATEGORY_ENUM and CATEGORY_NAMES**

Replace line 4 with:
```js
const CATEGORY_ENUM = ['development', 'business', 'health', 'lifestyle', 'news', 'sports', 'entertainment', 'politics'];
```

Replace lines 6-27 with:
```js
const CATEGORY_NAMES = {
    en: {
        development: 'Development',
        business: 'Business',
        health: 'Health',
        lifestyle: 'Lifestyle',
        news: 'News',
        sports: 'Sports',
        entertainment: 'Entertainment',
        politics: 'Politics'
    },
    es: {
        development: 'Desarrollo',
        business: 'Negocios',
        health: 'Salud',
        lifestyle: 'Estilo de Vida',
        news: 'Noticias',
        sports: 'Deportes',
        entertainment: 'Entretenimiento',
        politics: 'Política'
    }
};
```

- [ ] **Step 2: Commit**

```bash
git add src/config/index.js
git commit -m "feat: update CATEGORY_ENUM to generalized categories"
```

---

### Task 2: Update Post model category enum

**Files:**
- Modify: `src/models/Post.js:27-32`

- [ ] **Step 1: Update enum array**

Change line 30 from:
```js
enum: ['backend', 'javascript', 'performance', 'ai-tools', 'devops', 'career'],
```
to:
```js
enum: ['development', 'business', 'health', 'lifestyle', 'news', 'sports', 'entertainment', 'politics'],
```

- [ ] **Step 2: Commit**

```bash
git add src/models/Post.js
git commit -m "feat: update Post category enum to match generalized categories"
```

---

### Task 3: Update admin create-post form

**Files:**
- Modify: `src/views/admin/pages/create-post.ejs:60-69`

- [ ] **Step 1: Replace hardcoded category options**

Replace lines 62-68:
```html
<select name="category" class="input-dark w-full" required data-custom-select>
    <option value="">Select category</option>
    <option value="javascript" <%= typeof post !== 'undefined' && post.category === 'javascript' ? 'selected' : '' %>>JavaScript</option>
    <option value="backend" <%= typeof post !== 'undefined' && post.category === 'backend' ? 'selected' : '' %>>Backend</option>
    <option value="ai-tools" <%= typeof post !== 'undefined' && post.category === 'ai-tools' ? 'selected' : '' %>>AI Tools</option>
    <option value="devops" <%= typeof post !== 'undefined' && post.category === 'devops' ? 'selected' : '' %>>DevOps</option>
    <option value="performance" <%= typeof post !== 'undefined' && post.category === 'performance' ? 'selected' : '' %>>Performance</option>
    <option value="career" <%= typeof post !== 'undefined' && post.category === 'career' ? 'selected' : '' %>>Career</option>
</select>
```
with:
```html
<select name="category" class="input-dark w-full" required data-custom-select>
    <option value="">Select category</option>
    <option value="development" <%= typeof post !== 'undefined' && post.category === 'development' ? 'selected' : '' %>>Development</option>
    <option value="business" <%= typeof post !== 'undefined' && post.category === 'business' ? 'selected' : '' %>>Business</option>
    <option value="health" <%= typeof post !== 'undefined' && post.category === 'health' ? 'selected' : '' %>>Health</option>
    <option value="lifestyle" <%= typeof post !== 'undefined' && post.category === 'lifestyle' ? 'selected' : '' %>>Lifestyle</option>
    <option value="news" <%= typeof post !== 'undefined' && post.category === 'news' ? 'selected' : '' %>>News</option>
    <option value="sports" <%= typeof post !== 'undefined' && post.category === 'sports' ? 'selected' : '' %>>Sports</option>
    <option value="entertainment" <%= typeof post !== 'undefined' && post.category === 'entertainment' ? 'selected' : '' %>>Entertainment</option>
    <option value="politics" <%= typeof post !== 'undefined' && post.category === 'politics' ? 'selected' : '' %>>Politics</option>
</select>
```

- [ ] **Step 2: Commit**

```bash
git add src/views/admin/pages/create-post.ejs
git commit -m "feat: update admin create-post form categories"
```

---

### Task 4: Update ContentService CATEGORY_MAP

**Files:**
- Modify: `src/services/ContentService.js:44-51,166-168`

- [ ] **Step 1: Update CATEGORY_MAP and mapCategory default**

Replace lines 44-51:
```js
const CATEGORY_MAP = {
    'Backend Development': 'backend',
    'JavaScript': 'javascript',
    'Web Performance': 'performance',
    'AI for Developers': 'ai-tools',
    'DevOps': 'devops',
    'Career & Learning': 'career'
};
```
with:
```js
const CATEGORY_MAP = {
    'Development': 'development',
    'Business': 'business',
    'Health': 'health',
    'Lifestyle': 'lifestyle',
    'News': 'news',
    'Sports': 'sports',
    'Entertainment': 'entertainment',
    'Politics': 'politics'
};
```

Change line 167 from:
```js
return CATEGORY_MAP[aiCategory] || 'backend';
```
to:
```js
return CATEGORY_MAP[aiCategory] || 'development';
```

- [ ] **Step 2: Commit**

```bash
git add src/services/ContentService.js
git commit -m "feat: update ContentService category map"
```

---

### Task 5: Update seed script

**Files:**
- Modify: `scripts/seed.js:24,55,87,118,150,180`

- [ ] **Step 1: Update seed categories**

Line 24: `category: 'backend',` → `category: 'development',`
Line 55: `category: 'javascript',` → `category: 'development',`
Line 87: `category: 'performance',` → `category: 'development',`
Line 118: `category: 'ai-tools',` → `category: 'development',`
Line 150: `category: 'devops',` → `category: 'development',`
Line 180: `category: 'career',` → `category: 'lifestyle',`

- [ ] **Step 2: Commit**

```bash
git add scripts/seed.js
git commit -m "feat: update seed script categories to new enum"
```

---

### Task 6: Update validation test

**Files:**
- Modify: `tests/unit/validation.test.js:76-89`

- [ ] **Step 1: Rewrite test expectations**

Replace lines 76-89:
```js
describe('CATEGORY_ENUM', () => {
    test('should contain all expected categories', () => {
        expect(CATEGORY_ENUM).toContain('backend');
        expect(CATEGORY_ENUM).toContain('javascript');
        expect(CATEGORY_ENUM).toContain('performance');
        expect(CATEGORY_ENUM).toContain('ai-tools');
        expect(CATEGORY_ENUM).toContain('devops');
        expect(CATEGORY_ENUM).toContain('career');
    });

    test('should have exactly 6 categories', () => {
        expect(CATEGORY_ENUM.length).toBe(6);
    });
});
```
with:
```js
describe('CATEGORY_ENUM', () => {
    test('should contain all expected categories', () => {
        expect(CATEGORY_ENUM).toContain('development');
        expect(CATEGORY_ENUM).toContain('business');
        expect(CATEGORY_ENUM).toContain('health');
        expect(CATEGORY_ENUM).toContain('lifestyle');
        expect(CATEGORY_ENUM).toContain('news');
        expect(CATEGORY_ENUM).toContain('sports');
        expect(CATEGORY_ENUM).toContain('entertainment');
        expect(CATEGORY_ENUM).toContain('politics');
    });

    test('should have exactly 8 categories', () => {
        expect(CATEGORY_ENUM.length).toBe(8);
    });
});
```

- [ ] **Step 2: Run test**

```bash
npx jest tests/unit/validation.test.js --no-coverage
```
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/unit/validation.test.js
git commit -m "test: update category enum test expectations"
```

---

### Task 7: Update browse.ejs fallback

**Files:**
- Modify: `src/views/pages/browse.ejs:1,20`

- [ ] **Step 1: Remove hardcoded fallback array**

Change the variable declarations at lines 1 and 20 from:
```js
<% var categoriesList = (typeof CATEGORY_ENUM !== 'undefined') ? CATEGORY_ENUM : ['tech', 'news', 'sports', 'entertainment', 'politics', 'business', 'health', 'lifestyle']; %>
```
to:
```js
<% var categoriesList = (typeof CATEGORY_ENUM !== 'undefined') ? CATEGORY_ENUM : []; %>
```

- [ ] **Step 2: Commit**

```bash
git add src/views/pages/browse.ejs
git commit -m "fix: remove hardcoded fallback in browse.ejs"
```

---

### Task 8: Create migration script

**Files:**
- Create: `scripts/migrate-categories.js`

- [ ] **Step 1: Write migration script**

Create `scripts/migrate-categories.js`:
```js
/**
 * Migration script: Update Post categories from old tech-focused enum
 * to new generalized enum.
 *
 * Run: node scripts/migrate-categories.js
 *
 * Old → New mapping:
 *   backend/javascript/performance/ai-tools/devops → development
 *   career → lifestyle
 *
 * Run against a backup first!
 */
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/nook';

const CATEGORY_MAP = {
    backend: 'development',
    javascript: 'development',
    performance: 'development',
    'ai-tools': 'development',
    devops: 'development',
    career: 'lifestyle'
};

async function migrate() {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    const Post = mongoose.model('Post', new mongoose.Schema({}, { strict: false, collection: 'posts' }));

    const oldCategories = Object.keys(CATEGORY_MAP);
    const total = await Post.countDocuments({ category: { $in: oldCategories } });
    console.log(`Found ${total} posts with old categories`);

    if (total === 0) {
        console.log('No posts to migrate.');
        await mongoose.disconnect();
        return;
    }

    for (const [oldCat, newCat] of Object.entries(CATEGORY_MAP)) {
        const result = await Post.updateMany(
            { category: oldCat },
            { $set: { category: newCat } }
        );
        if (result.modifiedCount > 0) {
            console.log(`  ${oldCat} → ${newCat}: ${result.modifiedCount} posts updated`);
        }
    }

    const remaining = await Post.countDocuments({ category: { $in: oldCategories } });
    console.log(`Remaining posts with old categories: ${remaining}`);
    console.log('Migration complete.');

    await mongoose.disconnect();
}

migrate().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
```

- [ ] **Step 2: Commit**

```bash
git add scripts/migrate-categories.js
git commit -m "feat: add category migration script"
```

---

### Task 9: Update explore-top-nav with two-zone layout

**Files:**
- Modify: `src/views/partials/explore-top-nav.ejs`

- [ ] **Step 1: Rewrite explore-top-nav.ejs**

Replace the entire file content with:
```ejs
<nav class="explore-top-nav" aria-labelledby="explore-nav-label" style="display: flex; align-items: center; gap: 0; width: 100%; padding: 8px 0;">
    <span id="explore-nav-label" class="sr-only">Content categories</span>
    <% var currentTab = typeof activeTab !== 'undefined' && activeTab ? activeTab : 'explore'; %>

    <!-- View pills (fixed, no scroll) -->
    <div class="view-pills" style="display: flex; align-items: center; gap: clamp(6px, 1.2vw, 12px); flex-shrink: 0;">
        <% var viewTabs = [
            { slug: 'explore', label: 'Explore' },
            { slug: 'for-you', label: 'For you' },
            { slug: 'trending', label: 'Trending' },
            { slug: 'latest', label: 'Latest' }
        ]; %>
        <% viewTabs.forEach(function(tab) { %>
            <a href="/browse?tab=<%= tab.slug %>"
               role="button"
               aria-pressed="<%= tab.slug === currentTab %>"
               class="explore-view-btn"
               style="display: flex; height: clamp(36px, 5vw, 52px); align-items: center; justify-content: center; padding: clamp(6px, 1vw, 10px) clamp(12px, 2vw, 20px); border-radius: clamp(18px, 3vw, 58px); border: 1px solid <%= tab.slug === currentTab ? '#6d0a0a' : '#999' %>; background: <%= tab.slug === currentTab ? '#6d0a0a' : 'transparent' %>; cursor: pointer; transition: all 0.2s ease; text-decoration: none; flex-shrink: 0;">
                <span style="font-family: 'Abhaya Libre', serif; font-weight: 400; font-size: clamp(13px, 1.6vw, 18px); text-align: center; white-space: nowrap; text-transform: uppercase; letter-spacing: 0.05em; color: <%= tab.slug === currentTab ? '#fff' : '#666' %>;">
                    <%= tab.label %>
                </span>
            </a>
        <% }); %>
    </div>

    <!-- Divider -->
    <div class="pills-divider" style="width: 1px; height: 32px; background: #ccc; margin: 0 clamp(8px, 1.5vw, 16px); flex-shrink: 0;"></div>

    <!-- Category pills (scrollable) -->
    <div class="category-pills" style="display: flex; align-items: center; gap: clamp(6px, 1.2vw, 12px); overflow-x: auto; flex-shrink: 1; scrollbar-width: none; -ms-overflow-style: none; padding: 4px 0;">
        <% var categoryTabs = [
            { slug: 'development', label: 'Development' },
            { slug: 'business', label: 'Business' },
            { slug: 'health', label: 'Health' },
            { slug: 'lifestyle', label: 'Lifestyle' },
            { slug: 'news', label: 'News' },
            { slug: 'sports', label: 'Sports' },
            { slug: 'entertainment', label: 'Entertainment' },
            { slug: 'politics', label: 'Politics' }
        ]; %>
        <% categoryTabs.forEach(function(tab) { %>
            <a href="/browse?tab=<%= tab.slug %>"
               role="button"
               aria-pressed="<%= tab.slug === currentTab %>"
               class="explore-tab-btn"
               style="display: flex; height: clamp(36px, 5vw, 52px); align-items: center; justify-content: center; padding: clamp(6px, 1vw, 10px) clamp(12px, 2vw, 20px); border-radius: clamp(18px, 3vw, 58px); border: 1px solid <%= tab.slug === currentTab ? 'transparent' : '#6d0a0a' %>; background: <%= tab.slug === currentTab ? '#6d0a0a' : 'transparent' %>; cursor: pointer; transition: all 0.2s ease; text-decoration: none; flex-shrink: 0;">
                <span style="font-family: 'Abhaya Libre', serif; font-weight: 400; font-size: clamp(14px, 1.8vw, 20px); text-align: center; white-space: nowrap; color: <%= tab.slug === currentTab ? '#fff' : '#000' %>;">
                    <%= tab.label %>
                </span>
            </a>
        <% }); %>
    </div>
</nav>

<style>
    .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
    }
    .category-pills::-webkit-scrollbar {
        display: none;
    }
    .explore-tab-btn:hover, .explore-view-btn:hover {
        opacity: 0.85;
    }
    @media (max-width: 640px) {
        .explore-top-nav {
            padding: 6px 0 !important;
        }
        .explore-tab-btn, .explore-view-btn {
            height: 32px !important;
            padding: 4px 10px !important;
        }
        .explore-tab-btn span, .explore-view-btn span {
            font-size: 13px !important;
        }
        .pills-divider {
            height: 24px !important;
        }
    }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/views/partials/explore-top-nav.ejs
git commit -m "feat: two-zone explore pills layout with view/category split"
```

---

### Task 10: Wire /browse backend route to filter by tab

**Files:**
- Modify: `src/routes/pages.js:1009-1118`

- [ ] **Step 1: Update the /browse route**

The current `/browse` route (line 1009) always shows the latest 5 posts. Replace the Post query section with filtering logic.

After line 1011 (`const { tab } = req.query;`), add:
```js
const VIEW_TABS = ['explore', 'for-you', 'trending', 'latest'];
const CATEGORY_TABS = CATEGORY_ENUM; // ['development', 'business', ...]

let sortField = { publishedAt: -1 };
let filterQuery = {};

if (tab) {
    if (CATEGORY_TABS.includes(tab)) {
        filterQuery.category = tab;
    } else if (tab === 'trending') {
        sortField = { 'stats.views': -1 };
    }
    // for-you and latest use default sort, explore is default
}
```

Then replace the Post query (lines 1024-1028):
```js
const posts = await Post.find()
    .sort({ publishedAt: -1 })
    .limit(5)
    .populate('author', 'displayName avatar role')
    .lean();
```
with:
```js
const posts = await Post.find(filterQuery)
    .sort(sortField)
    .limit(5)
    .populate('author', 'displayName avatar role')
    .lean();
```

Also update the `activeTab` assignment at line 1100:
```js
activeTab: tab || 'explore',
```
(keep as-is — already works)

- [ ] **Step 2: Commit**

```bash
git add src/routes/pages.js
git commit -m "feat: wire /browse route to filter by tab query param"
```

---

### Task 11: Verify everything works end-to-end

- [ ] **Step 1: Run the tests**

```bash
npx jest tests/unit/validation.test.js --no-coverage
```
Expected: PASS

- [ ] **Step 2: Check for any other tests that reference old category values**

```bash
grep -rn "category.*backend\|category.*javascript\|category.*ai-tools\|category.*devops\|category.*career\|category.*performance" src/ tests/ scripts/ --include="*.js"
```
Expected: No remaining references in source code (seed.js and ContentService should have been updated in Tasks 4-5).

- [ ] **Step 3: Verify the app starts**

```bash
node -e "require('./src/config')" 2>&1 | head -5
```
Expected: No errors.

```bash
node -e "
const Post = require('./src/models/Post');
console.log('Post model loaded successfully');
" 2>&1
```
Expected: "Post model loaded successfully" (may show a deprecation warning, that's fine).

- [ ] **Step 4: Commit any remaining changes**

```bash
git add -A && git commit -m "chore: cleanup after category revamp"
```

---

### Execution Notes

1. **Migration script** (`scripts/migrate-categories.js`) must be run once against the production database after deployment. It's safe to run multiple times (idempotent — second run finds 0 posts to migrate).
2. The Post model enum change means **new Mongoose validation** will reject old category values on save. Run the migration **before** any new post is created after deploy.
3. **No revert script** is provided — if you need to roll back, restore from backup and re-deploy.
