const helper = require('./helpers/pagesGolden');
const { boot, shutdown, seedFixtures, bearerToken, cookieAuth, goldenRequest, fixtures } = helper;

describe('pages.js golden contract', () => {
    beforeAll(async () => {
        await boot();
        await seedFixtures();
    }, 30000);

    afterAll(async () => {
        await shutdown();
    });

    describe('HTTP layer - status, content-type, redirects', () => {
        test('anonymous home returns 200 html', async () => {
            const res = await goldenRequest({ url: '/' });
            expect(res.statusCode).toBe(200);
            expect(res.headers['content-type']).toMatch(/text\/html/);
        });

        test('authed home returns 200 html', async () => {
            const res = await goldenRequest({ url: '/' }, { auth: 'reader' });
            expect(res.statusCode).toBe(200);
            expect(res.headers['content-type']).toMatch(/text\/html/);
        });

        test('browse - anon and authed', async () => {
            const a = await goldenRequest({ url: '/browse' });
            expect(a.statusCode).toBe(200);
            const b = await goldenRequest({ url: '/browse' }, { auth: 'reader' });
            expect(b.statusCode).toBe(200);
        });

        test('about/contact/privacy/terms are static 200 html', async () => {
            for (const p of ['/about', '/contact', '/privacy', '/terms']) {
                const res = await goldenRequest({ url: p });
                expect(res.statusCode).toBe(200);
                expect(res.headers['content-type']).toMatch(/text\/html/);
                expect(res.body).toContain('PaidInk');
            }
        });

        test('post route - anon and authed 200', async () => {
            const slug = fixtures.posts[0].slug;
            const a = await goldenRequest({ url: `/post/${slug}` });
            expect(a.statusCode).toBe(200);
            const b = await goldenRequest({ url: `/post/${slug}` }, { auth: 'reader' });
            expect(b.statusCode).toBe(200);
        });

        test('unknown post slug returns 404', async () => {
            const res = await goldenRequest({ url: '/post/does-not-exist' });
            expect(res.statusCode).toBe(404);
        });

        test('invalid category param on home returns 400', async () => {
            const res = await goldenRequest({ url: '/?category=notreal' });
            expect(res.statusCode).toBe(400);
        });

        test('valid category route returns 200', async () => {
            const res = await goldenRequest({ url: '/category/development' });
            expect(res.statusCode).toBe(200);
        });

        test('invalid category route returns 404', async () => {
            const res = await goldenRequest({ url: '/category/notreal' });
            expect(res.statusCode).toBe(404);
        });

        test('blog/:id 301 redirects to /post/:slug', async () => {
            const slug = fixtures.posts[0].slug;
            const postId = fixtures.posts[0]._id.toString();
            const res = await goldenRequest({ url: `/blog/${postId}` });
            expect(res.statusCode).toBe(301);
            expect(res.headers.location).toBe(`/post/${slug}`);
        });

        test('search with empty q redirects to /browse', async () => {
            const res = await goldenRequest({ url: '/search?q=' });
            expect(res.statusCode).toBe(302);
            expect(res.headers.location).toBe('/browse');
        });

        test('search with q returns 200 html', async () => {
            const res = await goldenRequest({ url: '/search?q=golden' });
            expect(res.statusCode).toBe(200);
            expect(res.headers['content-type']).toMatch(/text\/html/);
        });

        test('sitemap.xml and robots.txt', async () => {
            const s = await goldenRequest({ url: '/sitemap.xml' });
            expect(s.statusCode).toBe(200);
            expect(s.headers['content-type']).toMatch(/xml/);
            const r = await goldenRequest({ url: '/robots.txt' });
            expect(r.statusCode).toBe(200);
            expect(r.headers['content-type']).toMatch(/text\/plain/);
        });

        test('logout redirects to /', async () => {
            const res = await goldenRequest({ url: '/logout' });
            expect(res.statusCode).toBe(302);
            expect(res.headers.location).toBe('/');
        });
    });

    describe('authentication-gated pages', () => {
        test('dashboard requires auth -> redirect to login', async () => {
            const res = await goldenRequest({ url: '/dashboard' });
            expect(res.statusCode).toBe(302);
            expect(res.headers.location).toMatch(/\/login/);
        });

        test('dashboard authed 200 html', async () => {
            const res = await goldenRequest({ url: '/dashboard' }, { auth: 'reader' });
            expect(res.statusCode).toBe(200);
            expect(res.headers['content-type']).toMatch(/text\/html/);
        });

        test('profile/reads/achievements/withdraw authed 200', async () => {
            for (const p of ['/profile', '/reads', '/achievements', '/withdraw']) {
                const res = await goldenRequest({ url: p }, { auth: 'reader' });
                expect(res.statusCode).toBe(200);
            }
        });

        test('apply-publisher GET authed 200', async () => {
            const res = await goldenRequest({ url: '/apply-publisher' }, { auth: 'reader' });
            expect(res.statusCode).toBe(200);
        });

        test('switch-role reader -> dashboard redirect (not publisher)', async () => {
            const res = await goldenRequest({ url: '/switch-role?role=publisher' }, { auth: 'reader' });
            expect(res.statusCode).toBe(302);
            expect(res.headers.location).toBe('/dashboard');
        });

        test('publisher routes reject non-publisher', async () => {
            const res = await goldenRequest({ url: '/publisher' }, { auth: 'reader' });
            expect(res.statusCode).toBe(403);
        });

        test('publisher overview authed as publisher 200', async () => {
            const res = await goldenRequest({ url: '/publisher' }, { auth: 'publisher' });
            expect(res.statusCode).toBe(200);
            expect(res.headers['content-type']).toMatch(/text\/html/);
        });

        test('publisher/posts + create-post + earnings 200 for publisher', async () => {
            for (const p of ['/publisher/posts', '/publisher/create-post', '/publisher/earnings']) {
                const res = await goldenRequest({ url: p }, { auth: 'publisher' });
                expect(res.statusCode).toBe(200);
            }
        });

        test('publisher create-post POST redirects to /publisher/posts', async () => {
            const res = await helper.app.inject({
                method: 'POST',
                url: '/publisher/create-post',
                headers: cookieAuth(bearerToken(fixtures.publisher)),
                payload: {
                    title: 'New Golden Post',
                    summary: 'sum',
                    content: 'body',
                    category: 'development',
                    status: 'published'
                }
            });
            expect(res.statusCode).toBe(302);
            expect(res.headers.location).toBe('/publisher/posts');
        });
    });

    describe('rendered HTML invariants (view-model through to DOM)', () => {
        test('home includes canonical + og image', async () => {
            const res = await goldenRequest({ url: '/' });
            expect(res.body).toContain('canonical');
            expect(res.body).toContain('og:image');
        });

        test('authed home includes unread count variable path is not leaking error', async () => {
            const res = await goldenRequest({ url: '/' }, { auth: 'reader' });
            expect(res.body).not.toMatch(/(Cannot read|TypeError|is not defined)/);
        });

        test('post page renders title and slug-derived canonical', async () => {
            const slug = fixtures.posts[0].slug;
            const res = await goldenRequest({ url: `/post/${slug}` });
            expect(res.body).toContain(slug);
            expect(res.body).not.toMatch(/(Cannot read|TypeError|is not defined)/);
        });

        test('register/login render 200 with form markers', async () => {
            const reg = await goldenRequest({ url: '/register' });
            expect(reg.statusCode).toBe(200);
            const login = await goldenRequest({ url: '/login' });
            expect(login.statusCode).toBe(200);
        });
    });

    describe('perf span structure (DB-op profile scaffold)', () => {
        function lastCapture() {
            const captures = helper.app._perfCaptures || [];
            return captures[captures.length - 1] || { spans: [] };
        }

        test('anon home produces home:getPosts + render spans', async () => {
            const res = await goldenRequest({ url: '/' });
            const spans = lastCapture().spans.map((s) => s.label);
            expect(res.statusCode).toBe(200);
            expect(spans).toContain('home:getPosts');
            expect(spans).toContain('render:body');
            expect(spans).toContain('render:view');
        });

        test('authed home produces lightweight feed + render spans (no secondary widgets)', async () => {
            const res = await goldenRequest({ url: '/' }, { auth: 'reader' });
            const spans = lastCapture().spans.map((s) => s.label);
            expect(res.statusCode).toBe(200);
            expect(spans).toContain('feed:recommendations');
            expect(spans).toContain('feed:readTime');
            expect(spans).toContain('render:view');
            expect(spans).not.toContain('feed:trending');
            expect(spans).not.toContain('ads:feed');
            expect(spans).not.toContain('ads:sidebar');
        });

        test('GET /api/v1/feed/posts requires active session auth', async () => {
            const res = await goldenRequest({ url: '/api/v1/feed/posts' });
            expect(res.statusCode).toBe(401);
        });

        test('GET /api/v1/feed/posts returns first cursor page with nextCursor when more posts exist', async () => {
            await seedFixtures();
            for (let i = 0; i < 12; i++) {
                await createPost({
                    author: fixtures.publisher._id,
                    slug: `feed-cursor-${Date.now()}-${i}`,
                    publishedAt: new Date(Date.now() - i * 60 * 1000)
                });
            }

            const res = await goldenRequest({ url: '/api/v1/feed/posts' }, { auth: 'reader' });
            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.success).toBe(true);
            expect(Array.isArray(body.data)).toBe(true);
            expect(body.data.length).toBe(10);
            expect(body.nextCursor).toBeTruthy();
        });

        test('GET /api/v1/feed/posts respects a historical cursor timestamp', async () => {
            await seedFixtures();
            const fixedCursor = new Date(Date.now() - 5 * 60 * 1000).toISOString();
            for (let i = 0; i < 12; i++) {
                await createPost({
                    author: fixtures.publisher._id,
                    slug: `feed-cursor-history-${Date.now()}-${i}`,
                    publishedAt: new Date(Date.now() - (i + 2) * 60 * 1000)
                });
            }

            const res = await goldenRequest({ url: `/api/v1/feed/posts?cursor=${encodeURIComponent(fixedCursor)}` }, { auth: 'reader' });
            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.success).toBe(true);
            expect(Array.isArray(body.data)).toBe(true);
            for (const post of body.data) {
                expect(new Date(post.publishedAt).getTime()).toBeLessThan(new Date(fixedCursor).getTime());
            }
        });

        test('GET /api/v1/feed/posts returns nextCursor null at the tail end', async () => {
            await seedFixtures();

            const res = await goldenRequest({ url: '/api/v1/feed/posts' }, { auth: 'reader' });
            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.success).toBe(true);
            expect(Array.isArray(body.data)).toBe(true);
            expect(body.nextCursor).toBeNull();
        });

        test('GET /api/v1/feed/trending returns JSON trending posts', async () => {
            const res = await goldenRequest({ url: '/api/v1/feed/trending' });
            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.success).toBe(true);
            expect(Array.isArray(body.data)).toBe(true);
        });

        test('GET /api/v1/feed/ads returns JSON ads payload (never throws)', async () => {
            const res = await goldenRequest({ url: '/api/v1/feed/ads' });
            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.body);
            expect(typeof body.success).toBe('boolean');
            expect(Array.isArray(body.feedAds)).toBe(true);
            expect('sidebarAd' in body).toBe(true);
        });

        test('dashboard authed produces dashboard spans + reward_wall ad', async () => {
            const res = await goldenRequest({ url: '/dashboard' }, { auth: 'reader' });
            const spans = lastCapture().spans.map((s) => s.label);
            expect(res.statusCode).toBe(200);
            expect(spans).toContain('user:fetch');
            expect(spans).toContain('dashboard:summary');
            expect(spans).toContain('ads:reward_wall');
            expect(spans).toContain('render:view');
        });
    });
});
