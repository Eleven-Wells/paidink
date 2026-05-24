function assetUrl(path) {
    const base = process.env.ASSETS_URL || '';
    if (base) {
        const cleanPath = path.startsWith('/') ? path.slice(1) : path;
        return `${base}/${cleanPath}`;
    }
    return path;
}

function isUsingRemoteAssets() {
    return !!process.env.ASSETS_URL;
}

module.exports = { assetUrl, isUsingRemoteAssets };
