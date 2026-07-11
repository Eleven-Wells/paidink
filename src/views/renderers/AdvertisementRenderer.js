const renderers = {
    banner: 'partials/ad-banner.ejs',
    native: 'partials/ad-feed.ejs',
    sidebar: 'partials/ad-sidebar.ejs',
    inline: 'partials/ad-inline.ejs',
    rewarded: 'partials/ad-rewarded.ejs'
};

class AdvertisementRenderer {
    getPartialPath(ad) {
        return renderers[ad.type] || renderers.banner;
    }

    render(ad) {
        return { partial: this.getPartialPath(ad), data: ad };
    }
}

module.exports = new AdvertisementRenderer();
