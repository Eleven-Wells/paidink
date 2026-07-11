const AdProviderInterface = require('./AdProviderInterface');
const { triggerAdForUser } = require('../AdSimulationService');

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

function getDemoAd(slotName) {
    const imageType = slotName.startsWith('article') ? 'banner' : 'native';
    return {
        served: true,
        type: imageType,
        imageUrl: getAdImageUrl(imageType),
        clickUrl: '/api/ads/click/demo',
        impressionId: null,
        adConfigId: null,
        slot: slotName,
        provider: 'mock',
        content: null
    };
}

class MockProvider extends AdProviderInterface {
    get name() {
        return 'mock';
    }

    async getAds(context) {
        const { placement, user, session, count = 1 } = context;
        const userId = user?.id || null;
        const sessionId = session?.id || null;
        const slot = AD_SLOT_MAP[placement];

        const results = [];
        for (let i = 0; i < count; i++) {
            let ad;
            if (slot) {
                const result = await triggerAdForUser(userId, slot.placement, sessionId, {
                    pageType: slot.pageType
                });

                if (result.served) {
                    ad = {
                        served: true,
                        type: result.adConfig?.type || 'banner',
                        imageUrl: getAdImageUrl(result.adConfig?.type),
                        clickUrl: result.impression?._id ? `/api/ads/click/${result.impression._id}` : '#',
                        impressionId: result.impression?._id?.toString(),
                        adConfigId: result.adConfig?._id?.toString(),
                        slot: placement,
                        placement: slot.placement,
                        provider: 'mock',
                        content: null
                    };
                }

                if (!ad && slot.fallbackSlot && AD_SLOT_MAP[slot.fallbackSlot]) {
                    const fallback = AD_SLOT_MAP[slot.fallbackSlot];
                    const fbResult = await triggerAdForUser(userId, fallback.placement, sessionId, {
                        pageType: fallback.pageType
                    });
                    if (fbResult.served) {
                        ad = {
                            served: true,
                            type: fbResult.adConfig?.type || 'banner',
                            imageUrl: getAdImageUrl(fbResult.adConfig?.type),
                            clickUrl: fbResult.impression?._id ? `/api/ads/click/${fbResult.impression._id}` : '#',
                            impressionId: fbResult.impression?._id?.toString(),
                            adConfigId: fbResult.adConfig?._id?.toString(),
                            slot: placement,
                            placement: fallback.placement,
                            provider: 'mock',
                            content: null
                        };
                    }
                }

                if (!ad) {
                    ad = getDemoAd(placement);
                    ad.provider = 'mock';
                    ad.placement = slot.placement;
                }
            } else {
                ad = getDemoAd(placement);
                ad.provider = 'mock';
            }
            results.push(ad);
        }
        return results;
    }

    async recordImpression() {}

    async recordClick() {}

    async healthCheck() {
        return true;
    }
}

module.exports = MockProvider;
