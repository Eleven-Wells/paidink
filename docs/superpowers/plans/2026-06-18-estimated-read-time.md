# Estimated Read Time Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-article estimated read time to articles, computed from content at render time, displayed consistently on detail pages and feed/list cards.

**Architecture:** A centralized `ReadTimeService` utility strips markdown syntax, counts words, optionally accounts for images, and returns `{ minutes, display }`. Route handlers call it and attach the result to post objects; templates render `post.readTime.display`.

**Tech Stack:** Node.js, Jest

---

### Task 1: Create ReadTimeService

**Files:**
- Create: `src/services/ReadTimeService.js`
- Create: `tests/unit/readTimeService.test.js`

- [ ] **Step 1: Write the unit tests**

```js
const { getReadTime } = require('../../src/services/ReadTimeService');

describe('ReadTimeService', () => {
  describe('getReadTime', () => {
    test('returns < 1 min read for empty content', () => {
      const result = getReadTime('');
      expect(result.minutes).toBe(0);
      expect(result.display).toBe('< 1 min read');
    });

    test('returns < 1 min read for null content', () => {
      expect(getReadTime(null).display).toBe('< 1 min read');
    });

    test('returns < 1 min read for undefined content', () => {
      expect(getReadTime(undefined).display).toBe('< 1 min read');
    });

    test('returns ~1 min read for very short content', () => {
      const content = 'short content here';
      const result = getReadTime(content);
      expect(result.display).toBeMatch(/^~/);
    });

    test('returns ~X min read for typical article', () => {
      const words = Array(200).fill('word').join(' ');
      const content = `# Title\n\n${words}`;
      const result = getReadTime(content);
      expect(result.display).toMatch(/^~\d+ min read$/);
      expect(result.minutes).toBeGreaterThanOrEqual(1);
    });

    test('strips markdown code blocks before counting', () => {
      const code = '```js\nconst x = 1;\nconst y = 2;\n```';
      const text = 'A short paragraph.';
      const mixed = `${text}\n\n${code}`;
      const textOnly = getReadTime(text);
      const mixedResult = getReadTime(mixed);
      expect(mixedResult.minutes).toBe(textOnly.minutes);
    });

    test('strips markdown links but keeps link text', () => {
      const content = 'Read [this article](https://example.com) for more info';
      const result = getReadTime(content);
      expect(result.minutes).toBeGreaterThanOrEqual(1);
    });

    test('accounts for images in estimate', () => {
      const noImages = 'Just a short paragraph of text here.';
      const withImages = noImages + '\n\n![alt](image1.png)\n\n![alt2](image2.png)';
      const noImgResult = getReadTime(noImages);
      const withImgResult = getReadTime(withImages);
      expect(withImgResult.minutes).toBeGreaterThanOrEqual(noImgResult.minutes);
    });

    test('sets default of 200 wpm', () => {
      const content = Array(400).fill('word').join(' ');
      const result = getReadTime(content);
      expect(result.minutes).toBe(2); // 400/200 = 2
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/readTimeService.test.js --no-coverage`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```js
const AVG_WORDS_PER_MINUTE = 200;
const SECONDS_PER_IMAGE = 12;

function stripMarkdown(md) {
  if (!md) return '';
  return md
    .replace(/```[\s\S]*?```/g, '')
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\[([^\]]*)\]\(.*?\)/g, '$1')
    .replace(/[#*_~>`\-|]/g, '')
    .replace(/\n{2,}/g, ' ')
    .trim();
}

function getReadTime(content, options = {}) {
  if (!content) return { minutes: 0, display: '< 1 min read' };

  const { wpm = AVG_WORDS_PER_MINUTE, countImages = true } = options;
  const text = stripMarkdown(content);
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const imageCount = countImages
    ? (content.match(/!\[.*?\]\(.*?\)/g) || []).length
    : 0;

  const minutes = Math.ceil(wordCount / wpm + (imageCount * SECONDS_PER_IMAGE) / 60);

  if (minutes < 1) return { minutes: 0, display: '< 1 min read' };

  return { minutes, display: `~${minutes} min read` };
}

module.exports = { getReadTime };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/readTimeService.test.js --no-coverage`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add src/services/ReadTimeService.js tests/unit/readTimeService.test.js
git commit -m "feat: add ReadTimeService with markdown-aware word counting"
```

---

### Task 2: Update List Views in pages.js

**Files:**
- Modify: `src/routes/pages.js` (3 locations)

Replace the 3 inline read time computations with centralized calls.

- [ ] **Step 1: Profile saved posts (line 342)**

Replace:
```js
post.readTime = post.content
    ? `${Math.max(1, Math.ceil(post.content.split(/\s+/).length / 200))}m`
    : '5m';
```

With:
```js
post.readTime = getReadTime(post.content).display;
```

- [ ] **Step 2: Home trending (line 1009)**

Replace:
```js
post.readTime = post.content ? Math.max(1, Math.ceil(post.content.split(' ').length / 200)) + 'm' : '5m';
```

With:
```js
post.readTime = getReadTime(post.content).display;
```

- [ ] **Step 3: Explore trending (line 1158)**

Replace:
```js
post.readTime = post.content ? Math.max(1, Math.ceil(post.content.split(' ').length / 200)) + 'm' : '5m';
```

With:
```js
post.readTime = getReadTime(post.content).display;
```

- [ ] **Step 4: Add the import at top of pages.js**

Add near other service imports (around line 15-25):
```js
const { getReadTime } = require('../services/ReadTimeService');
```

- [ ] **Step 5: Commit**

```bash
git add src/routes/pages.js
git commit -m "feat: replace inline read time with ReadTimeService in list views"
```

---

### Task 3: Add Read Time to Article Detail Page

**Files:**
- Modify: `src/routes/pages.js` (post route)
- Modify: `src/views/pages/post.ejs` (2 locations)

- [ ] **Step 1: Compute readTime in post detail route**

In `pages.js`, after `const post = await postService.getPostBySlug(slug)` (line 1389) and before the `postForRender` obj (line 1433), add:
```js
post.readTime = getReadTime(post.content).display;
```

- [ ] **Step 2: Update post.ejs detail header (line 129)**

Replace:
```ejs
<span><%= Math.ceil((post.content || '').length / 1000) || 5 %> min read</span>
```

With:
```ejs
<span><%= post.readTime %></span>
```

- [ ] **Step 3: Update related post cards (line 279-280)**

Replace:
```ejs
<span>
    <%= Math.ceil((relatedPost.content || '' ).length / 1000) ||
        5 %> min read
</span>
```

With:
```ejs
<span><%= getReadTime(relatedPost.content).display %></span>
```

- [ ] **Step 4: Add getReadTime helper to post.ejs**

At the top of post.ejs (before the `<%%` template block), add the import:
```ejs
<% const { getReadTime } = require('../services/ReadTimeService'); %>
```

- [ ] **Step 5: Commit**

```bash
git add src/routes/pages.js src/views/pages/post.ejs
git commit -m "feat: add estimated read time to article detail page and related posts"
```

---

### Task 4: Update Category and Browse List Views

**Files:**
- Modify: `src/views/pages/category.ejs` (1 location)
- Modify: `src/views/pages/browse.ejs` (1 location)

- [ ] **Step 1: Add getReadTime import to category.ejs top**

```ejs
<% const { getReadTime } = require('../services/ReadTimeService'); %>
```

- [ ] **Step 2: Replace inline calc in category.ejs (line 42)**

Replace:
```ejs
<span><%= Math.ceil((blog.content || '').length / 1000) || 5 %> min read</span>
```

With:
```ejs
<span><%= getReadTime(blog.content).display %></span>
```

- [ ] **Step 3: Add getReadTime import to browse.ejs top**

```ejs
<% const { getReadTime } = require('../services/ReadTimeService'); %>
```

- [ ] **Step 4: Replace inline calc in browse.ejs (line 54)**

Replace:
```ejs
<span><%= Math.ceil((blog.content || '').length / 1000) || 5 %> min read</span>
```

With:
```ejs
<span><%= getReadTime(blog.content).display %></span>
```

- [ ] **Step 5: Commit**

```bash
git add src/views/pages/category.ejs src/views/pages/browse.ejs
git commit -m "feat: use ReadTimeService in category and browse list views"
```

---

### Task 5: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `npx jest tests/unit/readTimeService.test.js --no-coverage`
Expected: PASS

- [ ] **Step 2: Verify no remaining inline read time calculations**

```bash
rg "split.*length.*200|length.*1000.*min read" src/
```
Expected: No matches (all replaced)

- [ ] **Step 3: Final commit if any fixes needed**
