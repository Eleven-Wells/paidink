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
