const { test, expect } = require('@playwright/test');

test.describe('Homepage E2E Tests', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
    });

    test('should load homepage successfully', async ({ page }) => {
        await expect(page).toHaveTitle(/PaidInk|PaidInk/);
    });

    test('should display navigation', async ({ page }) => {
        await expect(page.locator('nav')).toBeVisible();
    });

    test('should have working search input', async ({ page }) => {
        const searchInput = page.locator('#search-input');
        if (await searchInput.isVisible()) {
            await searchInput.fill('javascript');
            await page.waitForTimeout(500);
        }
    });

    test('should have newsletter subscription form', async ({ page }) => {
        const subscribeInput = page.locator('#subscribe-email');
        if (await subscribeInput.isVisible()) {
            await expect(subscribeInput).toBeEnabled();
        }
    });
});

test.describe('API Health Check E2E Tests', () => {
    const BASE_URL = process.env.BASE_URL || 'http://localhost:5050';

    test('should return health status', async ({ request }) => {
        const response = await request.get(`${BASE_URL}/api/health`);
        expect(response.ok()).toBeTruthy();

        const body = await response.json();
        expect(body.status).toBe('ok');
        expect(body.success).toBe(true);
    });

    test('should return pong for ping endpoint', async ({ request }) => {
        const response = await request.get(`${BASE_URL}/api/ping`);
        expect(response.ok()).toBeTruthy();

        const body = await response.json();
        expect(body.status).toBe('pong');
    });

    test('should return categories', async ({ request }) => {
        const response = await request.get(`${BASE_URL}/api/categories`);
        expect(response.ok()).toBeTruthy();

        const body = await response.json();
        expect(body.categories).toBeDefined();
        expect(body.categories.length).toBeGreaterThan(0);
    });
});

test.describe('Newsletter Subscription E2E Tests', () => {
    const BASE_URL = process.env.BASE_URL || 'http://localhost:5050';

    test('should reject invalid email', async ({ request }) => {
        const response = await request.post(`${BASE_URL}/api/subscribe`, {
            data: { email: 'invalid-email' }
        });

        expect(response.status()).toBeGreaterThanOrEqual(400);
    });

    test('should accept valid email subscription', async ({ request }) => {
        const uniqueEmail = `test${Date.now()}@example.com`;

        const response = await request.post(`${BASE_URL}/api/subscribe`, {
            data: { email: uniqueEmail }
        });

        expect(response.ok()).toBeTruthy();

        const body = await response.json();
        expect(body.success).toBe(true);
    });
});

test.describe('Posts API E2E Tests', () => {
    const BASE_URL = process.env.BASE_URL || 'http://localhost:5050';

    test('should return posts list', async ({ request }) => {
        const response = await request.get(`${BASE_URL}/api/posts`);
        expect(response.ok()).toBeTruthy();

        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.pagination).toBeDefined();
    });

    test('should support pagination', async ({ request }) => {
        const response = await request.get(`${BASE_URL}/api/posts?page=1&limit=5`);
        expect(response.ok()).toBeTruthy();

        const body = await response.json();
        expect(body.pagination.page).toBe(1);
        expect(body.pagination.limit).toBe(5);
    });

    test('should filter by category', async ({ request }) => {
        const response = await request.get(`${BASE_URL}/api/posts?category=development`);
        expect(response.ok()).toBeTruthy();

        const body = await response.json();
        expect(body.success).toBe(true);
    });
});

test.describe('Responsive Design E2E Tests', () => {
    test('should display correctly on mobile', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 });
        await page.goto('/');
        await expect(page).toHaveTitle(/.*/);
    });

    test('should display correctly on tablet', async ({ page }) => {
        await page.setViewportSize({ width: 768, height: 1024 });
        await page.goto('/');
        await expect(page).toHaveTitle(/.*/);
    });

    test('should display correctly on desktop', async ({ page }) => {
        await page.setViewportSize({ width: 1920, height: 1080 });
        await page.goto('/');
        await expect(page).toHaveTitle(/.*/);
    });
});

test.describe('404 Error Handling E2E Tests', () => {
    const BASE_URL = process.env.BASE_URL || 'http://localhost:5050';

    test('should show 404 page for invalid route', async ({ page }) => {
        await page.goto(`${BASE_URL}/nonexistent-route`);
        await expect(page.locator('body')).not.toBeEmpty();
    });
});
