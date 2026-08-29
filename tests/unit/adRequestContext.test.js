const adRequestContext = require('../../src/services/ads/AdRequestContext');

describe('AdRequestContext memoize', () => {
    it('memoizes by key within a context and shares the same resolved value', async () => {
        let calls = 0;
        await adRequestContext.run(new Map(), async () => {
            const [a, b] = await Promise.all([
                adRequestContext.memoize('key', async () => { calls += 1; return 42; }),
                adRequestContext.memoize('key', async () => { calls += 1; return 99; })
            ]);
            expect(a).toBe(42);
            expect(b).toBe(42);
            expect(calls).toBe(1);
        });
    });

    it('does not memoize when no request context is active', async () => {
        let calls = 0;
        await adRequestContext.memoize('key', async () => { calls += 1; return 1; });
        await adRequestContext.memoize('key', async () => { calls += 1; return 1; });
        expect(calls).toBe(2);
    });

    it('isolates memo stores between concurrent contexts', async () => {
        const [a, b] = await Promise.all([
            adRequestContext.run(new Map(), () => adRequestContext.memoize('key', async () => 'A')),
            adRequestContext.run(new Map(), () => adRequestContext.memoize('key', async () => 'B'))
        ]);
        expect(a).toBe('A');
        expect(b).toBe('B');
    });

    it('distinguishes different keys within one context', async () => {
        await adRequestContext.run(new Map(), async () => {
            const [a, b] = await Promise.all([
                adRequestContext.memoize('a', async () => 1),
                adRequestContext.memoize('b', async () => 2)
            ]);
            expect(a).toBe(1);
            expect(b).toBe(2);
        });
    });

    it('reuses a rejected producer consistently within a context', async () => {
        await adRequestContext.run(new Map(), async () => {
            const [a, b] = await Promise.all([
                adRequestContext.memoize('fail', async () => { throw new Error('boom'); }).catch(e => e.message),
                adRequestContext.memoize('fail', async () => { throw new Error('other'); }).catch(e => e.message)
            ]);
            expect(a).toBe('boom');
            expect(b).toBe('boom');
        });
    });
});
