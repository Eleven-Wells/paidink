const { triggerAdForUser } = require('./AdSimulationService');

const AD_SLOT_MAP = {
    article_inline: { placement: 'article_inline', pageType: 'post', fallbackSlot: 'banner' },
    article_endcap: { placement: 'article_endcap', pageType: 'post', fallbackSlot: 'banner' },
    post_sidebar: { placement: 'post_sidebar', pageType: 'post', fallbackSlot: 'sidebar' },
    feed_native: { placement: 'feed_native', pageType: 'feed', fallbackSlot: 'feed' },
    feed_banner: { placement: 'feed_banner', pageType: 'feed', fallbackSlot: 'banner' },
    sidebar: { placement: 'sidebar', pageType: 'feed', fallbackSlot: 'sidebar' },
    interstitial: { placement: 'interstitial', pageType: 'feed', fallbackSlot: 'interstitial' },
    reward_wall: { placement: 'reward_wall', pageType: 'feed', fallbackSlot: 'rewarded' },
    feed: { placement: 'feed', pageType: 'feed', fallbackSlot: 'banner' },
    banner: { placement: 'banner', pageType: 'feed', fallbackSlot: null }
};

async function getAdForSlot(userId, slotName, sessionId) {
    const slot = AD_SLOT_MAP[slotName];
    if (!slot) return null;

    let result = await triggerAdForUser(userId, slot.placement, sessionId, {
        pageType: slot.pageType
    });
    let usedPlacement = slot.placement;
    let usedSlotName = slotName;

    if (!result.served && slot.fallbackSlot && AD_SLOT_MAP[slot.fallbackSlot]) {
        const fallback = AD_SLOT_MAP[slot.fallbackSlot];
        result = await triggerAdForUser(userId, fallback.placement, sessionId, {
            pageType: fallback.pageType
        });
        if (result.served) {
            usedPlacement = fallback.placement;
            usedSlotName = slotName;
            try {
                console.debug('AdPlacementService: ad served via fallback slot', { userId, slot: slotName, fallback: slot.fallbackSlot });
            } catch (e) {
                console.debug('AdPlacementService: debug log failed', e && e.message ? e.message : e);
            }
        }
    }

    if (!result.served) {
        // Log why ad wasn't served for debugging (non-fatal)
        try {
            console.debug('AdPlacementService: no ad served', { userId, slot: slotName, result });
        } catch (e) {
            console.debug('AdPlacementService: debug log failed', e && e.message ? e.message : e);
        }
        return getDemoAd(slotName);
    }

    return {
        served: true,
        adType: result.adConfig?.type || 'banner',
        imageUrl: getAdImageUrl(result.adConfig?.type),
        clickUrl: result.impression?._id ? `/api/ads/click/${result.impression._id}` : '#',
        impressionId: result.impression?._id?.toString(),
        adConfigId: result.adConfig?._id?.toString(),
        abTest: result.abTest,
        abVariant: result.abVariant,
        slot: usedSlotName,
        placement: usedPlacement
    };
}

function getDemoAd(slotName) {
    const imageType = slotName.startsWith('article') ? 'banner' : 'native';
    return {
        served: true,
        adType: imageType,
        imageUrl: getAdImageUrl(imageType),
        clickUrl: 'https://nook.com/?utm_source=nook_demo_ad',
        impressionId: null,
        adConfigId: null,
        abTest: null,
        abVariant: null,
        slot: slotName
    };
}

async function getFeedAds(userId, sessionId, count = 2) {
    const ads = [];
    for (let i = 0; i < count; i++) {
        const ad = await getAdForSlot(userId, 'feed_native', sessionId);
        if (ad) ads.push(ad);
    }
    return ads;
}

function getAdImageUrl(adType) {
    const images = {
        banner: '/public/images/ads/banner-placeholder.svg',
        native: '/public/images/ads/native-placeholder.svg',
        video: '/public/images/ads/video-placeholder.svg',
        interstitial: '/public/images/ads/interstitial-placeholder.svg',
        rewarded: '/public/images/ads/rewarded-placeholder.svg'
    };
    return images[adType] || images.banner;
}

function getAdStyle(adData) {
    if (!adData) return '';
    switch (adData.slot) {
        case 'feed_native':
            return 'feed-ad-card';
        case 'sidebar':
            return 'sidebar-ad-widget';
        case 'article_inline':
            return 'inline-ad-container';
        case 'article_endcap':
            return 'endcap-ad-container';
        default:
            return 'generic-ad-container';
    }
}

module.exports = {
    getAdForSlot,
    getFeedAds,
    getAdImageUrl,
    getAdStyle,
    AD_SLOT_MAP
};
