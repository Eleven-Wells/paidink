const AdConfig = require('../../models/ads/AdConfig');
const AdPlacement = require('../../models/ads/AdPlacement');
const AdEvent = require('../../models/ads/AdEvent');
const FrequencyRule = require('../../models/ads/FrequencyRule');
const ABTest = require('../../models/ads/ABTest');
const User = require('../../models/User');
const ReadSession = require('../../models/ReadSession');
const { distributeAdRevenue } = require('./AdRevenueService');
const { AD_EVENTS } = require('../../config/ads');

const AD_TYPE_REVENUE = {
    banner: { baseCpm: 2, baseCpc: 0.1 },
    interstitial: { baseCpm: 5, baseCpc: 0.25 },
    native: { baseCpm: 4, baseCpc: 0.15 },
    rewarded: { baseCpm: 10, baseCpc: 0.5 },
    video: { baseCpm: 8, baseCpc: 0.3 }
};

const REWARD_RATES = {
    rewarded: 0.10,
    interstitial: 0.02,
    video: 0.05
};

function randomBetween(min, max) {
    return Math.random() * (max - min) + min;
}

function simulateViewability() {
    return randomBetween(0.55, 0.95);
}

function simulateCTR(adType) {
    const rates = {
        banner: randomBetween(0.005, 0.02),
        interstitial: randomBetween(0.02, 0.06),
        native: randomBetween(0.015, 0.04),
        rewarded: randomBetween(0.08, 0.20),
        video: randomBetween(0.03, 0.08)
    };
    return rates[adType] || 0.01;
}

function simulateConversion(adType) {
    return Math.random() < (adType === 'rewarded' ? 0.25 : 0.05) ? 1 : 0;
}

function computeRevenue(adType, eventType) {
    const config = AD_TYPE_REVENUE[adType] || { baseCpm: 2, baseCpc: 0.1 };
    if (eventType === 'impression') {
        return (config.baseCpm / 1000) * randomBetween(0.8, 1.2);
    }
    if (eventType === 'click') {
        return config.baseCpc * randomBetween(0.8, 1.2);
    }
    if (eventType === 'conversion') {
        return config.baseCpc * 5 * randomBetween(0.8, 1.2);
    }
    return 0;
}

function computeUserReward(adType) {
    return REWARD_RATES[adType] || 0.01;
}

async function getActiveABTestForUser(userId) {
    const test = await ABTest.findOne({ status: 'running' }).lean();
    if (!test) return null;

    const variant = selectVariant(test.variants);
    return { test, variant };
}

function selectVariant(variants) {
    let cumulative = 0;
    const rand = Math.random() * 100;
    for (const v of variants) {
        cumulative += v.trafficPercentage;
        if (rand <= cumulative) return v;
    }
    return variants[0];
}

async function selectAdConfig(slot, variant = null) {
    const query = { active: true, network: 'simulated', testMode: false };
    if (variant && variant.adConfigIds && variant.adConfigIds.length > 0) {
        query._id = { $in: variant.adConfigIds };
    }

    const configs = await AdConfig.find(query).lean();
    if (configs.length === 0) return null;

    const totalWeight = configs.reduce((sum, c) => sum + (c.weight || 1), 0);
    let rand = Math.random() * totalWeight;
    for (const config of configs) {
        rand -= (config.weight || 1);
        if (rand <= 0) return config;
    }
    return configs[0];
}

async function checkFrequencyLimit(userId, slot, sessionId) {
    const rule = await FrequencyRule.findOne({ slot, active: true }).lean();
    if (!rule) return true;

    const thirtySecondsAgo = new Date(Date.now() - (rule.minIntervalSeconds * 1000));
    const recentEvents = await AdEvent.aggregate([
        { $match: {
            user: userId,
            createdAt: { $gte: thirtySecondsAgo },
            type: { $in: ['impression', 'view'] }
        }},
        { $lookup: {
            from: 'adplacements',
            localField: 'placement',
            foreignField: '_id',
            as: 'placementDoc'
        }},
        { $match: { 'placementDoc.slot': slot } },
        { $count: 'count' }
    ]);
    const recentCount = recentEvents[0]?.count || 0;

    if (recentCount > 0 && rule.minIntervalSeconds > 0) return false;

    const sessionEvents = await AdEvent.aggregate([
        { $match: {
            user: userId,
            session: sessionId,
            type: { $in: ['impression', 'view'] }
        }},
        { $lookup: {
            from: 'adplacements',
            localField: 'placement',
            foreignField: '_id',
            as: 'placementDoc'
        }},
        { $match: { 'placementDoc.slot': slot } },
        { $count: 'count' }
    ]);
    const sessionEventCount = sessionEvents[0]?.count || 0;
    if (sessionEventCount >= rule.maxPerSession) return false;

    if (rule.excludeAfterRewardClaim) {
        const rewardClaimed = await AdEvent.findOne({
            user: userId,
            session: sessionId,
            type: 'reward_claimed'
        }).lean();
        if (rewardClaimed) return false;
    }

    return true;
}

async function getPlacementsForSlot(slot) {
    return AdPlacement.find({ slot, active: true }).sort({ position: 1 }).lean();
}

async function simulateImpression(userId, adConfig, placement, sessionId, metadata = {}) {
    const adType = adConfig.type;
    const viewable = simulateViewability();

    const event = await AdEvent.create({
        user: userId,
        adConfig: adConfig._id,
        placement: placement._id,
        session: sessionId,
        type: 'impression',
        revenue: computeRevenue(adType, 'impression'),
        metadata: {
            viewability: viewable,
            simulated: true,
            ...metadata
        }
    });

    try { await distributeAdRevenue(event); } catch (err) { console.error('Ad revenue distribution failed (impression):', err.message); }

    if (viewable > 0.6) {
        const viewEvent = await AdEvent.create({
            user: userId,
            adConfig: adConfig._id,
            placement: placement._id,
            session: sessionId,
            type: 'view',
            revenue: computeRevenue(adType, 'impression') * 0.3,
            metadata: { viewability: viewable, simulated: true, ...metadata }
        });
        try { await distributeAdRevenue(viewEvent); } catch (err) { console.error('Ad revenue distribution failed (view):', err.message); }
    }

    return event;
}

async function simulateClick(userId, adConfig, placement, sessionId, metadata = {}) {
    const adType = adConfig.type;
    const ctr = simulateCTR(adType);

    const event = await AdEvent.create({
        user: userId,
        adConfig: adConfig._id,
        placement: placement._id,
        session: sessionId,
        type: 'click',
        revenue: computeRevenue(adType, 'click'),
        metadata: {
            simulatedCTR: ctr,
            simulated: true,
            ...metadata
        }
    });

    try { await distributeAdRevenue(event); } catch (err) { console.error('Ad revenue distribution failed (click):', err.message); }

    if (Math.random() < 0.1) {
        const conversion = await AdEvent.create({
            user: userId,
            adConfig: adConfig._id,
            placement: placement._id,
            session: sessionId,
            type: 'conversion',
            revenue: computeRevenue(adType, 'conversion'),
            metadata: { simulated: true, ...metadata }
        });
        try { await distributeAdRevenue(conversion); } catch (err) { console.error('Ad revenue distribution failed (conversion):', err.message); }
        return { clickEvent: event, conversionEvent: conversion };
    }

    return { clickEvent: event, conversionEvent: null };
}

async function simulateRewardedAd(userId, adConfig, placement, sessionId, metadata = {}) {
    const userReward = computeUserReward(adConfig.type);
    const enrichedMeta = { pageType: 'post', ...metadata };

    const impression = await AdEvent.create({
        user: userId,
        adConfig: adConfig._id,
        placement: placement._id,
        session: sessionId,
        type: 'impression',
        revenue: computeRevenue(adConfig.type, 'impression'),
        metadata: { simulated: true, adType: 'rewarded', ...enrichedMeta }
    });

    try { await distributeAdRevenue(impression); } catch (err) { console.error('Ad revenue distribution failed (rewarded impression):', err.message); }

    const view = await AdEvent.create({
        user: userId,
        adConfig: adConfig._id,
        placement: placement._id,
        session: sessionId,
        type: 'view',
        revenue: computeRevenue(adConfig.type, 'impression') * 0.5,
        metadata: { simulated: true, viewDuration: randomBetween(25, 35), completed: true, ...enrichedMeta }
    });

    try { await distributeAdRevenue(view); } catch (err) { console.error('Ad revenue distribution failed (rewarded view):', err.message); }

    const click = await AdEvent.create({
        user: userId,
        adConfig: adConfig._id,
        placement: placement._id,
        session: sessionId,
        type: 'click',
        revenue: computeRevenue(adConfig.type, 'click'),
        metadata: { simulated: true, adType: 'rewarded', ...enrichedMeta }
    });

    try { await distributeAdRevenue(click); } catch (err) { console.error('Ad revenue distribution failed (rewarded click):', err.message); }

    const rewardClaimed = await AdEvent.create({
        user: userId,
        adConfig: adConfig._id,
        placement: placement._id,
        session: sessionId,
        type: 'reward_claimed',
        revenue: computeRevenue(adConfig.type, 'click') * 2,
        metadata: { simulated: true, rewardAmount: userReward, ...enrichedMeta }
    });

    try { await distributeAdRevenue(rewardClaimed); } catch (err) { console.error('Ad revenue distribution failed (reward_claimed):', err.message); }

    return {
        impression,
        view,
        click,
        rewardClaimed,
        userReward
    };
}

async function triggerAdForUser(userId, slot, sessionId, userMetadata = {}) {
    const activeTest = await getActiveABTestForUser(userId);
    const test = activeTest?.test || null;
    const variant = activeTest?.variant || null;
    if (!await checkFrequencyLimit(userId, slot, sessionId)) {
        return { served: false, reason: 'frequency_limit' };
    }

    const placements = await getPlacementsForSlot(slot);
    if (placements.length === 0) {
        return { served: false, reason: 'no_placement' };
    }

    const adConfig = await selectAdConfig(slot, variant);
    if (!adConfig) {
        return { served: false, reason: 'no_config' };
    }

    const placement = placements[0];
    const impression = await simulateImpression(userId, adConfig, placement, sessionId, userMetadata);

    const shouldClick = Math.random() < simulateCTR(adConfig.type);
    let clickResult = null;
    if (shouldClick) {
        clickResult = await simulateClick(userId, adConfig, placement, sessionId, userMetadata);
    }

    return {
        served: true,
        adConfig,
        placement,
        impression,
        clickResult,
        abTest: test ? test.name : null,
        abVariant: variant ? variant.name : null
    };
}

async function triggerRewardedAd(userId, slot, sessionId, userMetadata = {}) {
    const activeTest = await getActiveABTestForUser(userId);
    const test = activeTest?.test || null;
    const variant = activeTest?.variant || null;
    if (!await checkFrequencyLimit(userId, slot, sessionId)) {
        return { served: false, reason: 'frequency_limit' };
    }

    const adConfig = await selectAdConfig(slot, variant);
    if (!adConfig) {
        return { served: false, reason: 'no_config' };
    }

    const placements = await getPlacementsForSlot(slot);
    const placement = placements[0] || { _id: null };

    const result = await simulateRewardedAd(userId, adConfig, placement, sessionId, userMetadata);

    if (result.userReward > 0 && userId) {
        try {
            const UserModel = require('../models/User');
            const user = await UserModel.findById(userId);
            if (user) {
                await user.addReward(result.userReward, 'ad_reward', 'Rewarded ad completion');
            }
        } catch (err) {
            console.error('Failed to credit ad reward:', err.message);
        }
    }

    return {
        served: true,
        adConfig,
        placement,
        ...result,
        abTest: test ? test.name : null,
        abVariant: variant ? variant.name : null
    };
}

async function getAdAnalytics(userId, startDate, endDate) {
    const match = { user: userId };
    if (startDate || endDate) {
        match.createdAt = {};
        if (startDate) match.createdAt.$gte = startDate;
        if (endDate) match.createdAt.$lte = endDate;
    }

    const [totals, byType, recent, revenue] = await Promise.all([
        AdEvent.aggregate([
            { $match: match },
            { $group: { _id: null, impressions: { $sum: { $cond: [{ $eq: ['$type', 'impression'] }, 1, 0] } }, views: { $sum: { $cond: [{ $eq: ['$type', 'view'] }, 1, 0] } }, clicks: { $sum: { $cond: [{ $eq: ['$type', 'click'] }, 1, 0] } }, conversions: { $sum: { $cond: [{ $eq: ['$type', 'conversion'] }, 1, 0] } } } }
        ]),
        AdEvent.aggregate([
            { $match: match },
            { $group: { _id: '$type', count: { $sum: 1 }, revenue: { $sum: '$revenue' } } }
        ]),
        AdEvent.find({ user: userId }).sort({ createdAt: -1 }).limit(20).lean(),
        AdEvent.aggregate([
            { $match: match },
            { $group: { _id: null, totalRevenue: { $sum: '$revenue' } } }
        ])
    ]);

    const t = totals[0] || { impressions: 0, views: 0, clicks: 0, conversions: 0 };
    return {
        impressions: t.impressions,
        views: t.views,
        clicks: t.clicks,
        conversions: t.conversions,
        ctr: t.impressions > 0 ? ((t.clicks / t.impressions) * 100).toFixed(2) + '%' : '0%',
        byType,
        totalRevenue: revenue[0]?.totalRevenue || 0,
        recent
    };
}

async function getGlobalAdAnalytics(startDate, endDate) {
    const match = {};
    if (startDate || endDate) {
        match.createdAt = {};
        if (startDate) match.createdAt.$gte = startDate;
        if (endDate) match.createdAt.$lte = endDate;
    }

    const [totals, byConfig, byPlacement, bySlot, dailyRevenue, abTestResults] = await Promise.all([
        AdEvent.aggregate([
            { $match: match },
            { $group: { _id: null, impressions: { $sum: { $cond: [{ $eq: ['$type', 'impression'] }, 1, 0] } }, views: { $sum: { $cond: [{ $eq: ['$type', 'view'] }, 1, 0] } }, clicks: { $sum: { $cond: [{ $eq: ['$type', 'click'] }, 1, 0] } }, revenue: { $sum: '$revenue' } } }
        ]),
        AdEvent.aggregate([
            { $match: match },
            { $lookup: { from: 'adconfigs', localField: 'adConfig', foreignField: '_id', as: 'config' } },
            { $unwind: '$config' },
            { $group: { _id: '$config.name', impressions: { $sum: 1 }, clicks: { $sum: { $cond: [{ $eq: ['$type', 'click'] }, 1, 0] } }, revenue: { $sum: '$revenue' } } }
        ]),
        AdEvent.aggregate([
            { $match: match },
            { $lookup: { from: 'adplacements', localField: 'placement', foreignField: '_id', as: 'placementDoc' } },
            { $unwind: { path: '$placementDoc', preserveNullAndEmptyArrays: true } },
            { $group: { _id: '$placementDoc.name', impressions: { $sum: 1 }, revenue: { $sum: '$revenue' } } }
        ]),
        AdEvent.aggregate([
            { $match: match },
            { $lookup: { from: 'adplacements', localField: 'placement', foreignField: '_id', as: 'placementDoc' } },
            { $unwind: { path: '$placementDoc', preserveNullAndEmptyArrays: true } },
            { $group: { _id: '$placementDoc.slot', impressions: { $sum: 1 }, revenue: { $sum: '$revenue' } } }
        ]),
        AdEvent.aggregate([
            { $match: match },
            { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, revenue: { $sum: '$revenue' }, impressions: { $sum: 1 } } },
            { $sort: { _id: 1 } }
        ]),
        ABTest.find({ status: { $in: ['running', 'completed'] } }).lean()
    ]);

    const t = totals[0] || { impressions: 0, views: 0, clicks: 0, revenue: 0 };
    return {
        impressions: t.impressions,
        views: t.views,
        clicks: t.clicks,
        revenue: t.revenue,
        ctr: t.impressions > 0 ? ((t.clicks / t.impressions) * 100).toFixed(2) + '%' : '0%',
        byConfig,
        byPlacement,
        bySlot,
        dailyRevenue,
        abTestResults
    };
}

async function seedDefaultData() {
    const [banner, interstitial, native, rewarded] = await Promise.all([
        AdConfig.findOneAndUpdate(
            { name: 'Simulated Banner' },
            { $setOnInsert: { name: 'Simulated Banner', network: 'simulated', type: 'banner', weight: 3, cpm: 2, cpc: 0.1, payoutRate: 0.01, active: true, testMode: false } },
            { upsert: true, new: true }
        ),
        AdConfig.findOneAndUpdate(
            { name: 'Simulated Interstitial' },
            { $setOnInsert: { name: 'Simulated Interstitial', network: 'simulated', type: 'interstitial', weight: 2, cpm: 5, cpc: 0.25, payoutRate: 0.02, active: true, testMode: false } },
            { upsert: true, new: true }
        ),
        AdConfig.findOneAndUpdate(
            { name: 'Simulated Native' },
            { $setOnInsert: { name: 'Simulated Native', network: 'simulated', type: 'native', weight: 2, cpm: 4, cpc: 0.15, payoutRate: 0.015, active: true, testMode: false } },
            { upsert: true, new: true }
        ),
        AdConfig.findOneAndUpdate(
            { name: 'Simulated Rewarded' },
            { $setOnInsert: { name: 'Simulated Rewarded', network: 'simulated', type: 'rewarded', weight: 1, cpm: 10, cpc: 0.5, payoutRate: 0.10, active: true, testMode: false } },
            { upsert: true, new: true }
        )
    ]);

    const slots = ['banner', 'sidebar', 'feed', 'interstitial', 'native', 'rewarded'];
    for (const slot of slots) {
        await AdPlacement.findOneAndUpdate(
            { name: slot + '_default' },
            { $setOnInsert: { name: slot + '_default', slot, position: 1, active: true, minSessionAge: 0, minReadsBeforeShow: 0 } },
            { upsert: true, new: true }
        );

        await FrequencyRule.findOneAndUpdate(
            { name: slot + '_default' },
            {
                $setOnInsert: {
                    name: slot + '_default',
                    slot,
                    maxPerSession: slot === 'rewarded' ? 3 : 10,
                    minIntervalSeconds: slot === 'rewarded' ? 120 : 30,
                    dailyLimit: slot === 'rewarded' ? 5 : null,
                    excludeAfterRewardClaim: slot !== 'rewarded',
                    active: true
                }
            },
            { upsert: true, new: true }
        );
    }

    await ABTest.findOneAndUpdate(
        { name: 'ad_placement_test_v1' },
        {
            $setOnInsert: {
                name: 'ad_placement_test_v1',
                status: 'running',
                startDate: new Date(),
                primaryMetric: 'ctr',
                variants: [
                    { name: 'control', trafficPercentage: 50, metadata: {} },
                    { name: 'variant_a', trafficPercentage: 50, metadata: { position: 2 } }
                ],
                targetSampleSize: 10000,
                minSampleSize: 1000
            }
        },
        { upsert: true, new: true }
    );

    return { banner, interstitial, native, rewarded };
}

function subscribeToEventBus(eventBus) {
    eventBus.on(AD_EVENTS.IMPRESSION, async (data) => {
        if (process.env.ADS_TRACK_IMPRESSIONS === 'false') return;
        try {
            await simulateImpression(data.adConfigId, data.userId, data.placement, data.sessionId);
        } catch (err) {
            console.error('AdSimulationService: EventBus impression handler error:', err);
        }
    });

    eventBus.on(AD_EVENTS.CLICKED, async (data) => {
        if (process.env.ADS_TRACK_CLICKS === 'false') return;
        try {
            await simulateClick(data.impressionId);
        } catch (err) {
            console.error('AdSimulationService: EventBus click handler error:', err);
        }
    });
}

module.exports = {
    subscribeToEventBus,
    triggerAdForUser,
    triggerRewardedAd,
    simulateImpression,
    simulateClick,
    simulateRewardedAd,
    getAdAnalytics,
    getGlobalAdAnalytics,
    seedDefaultData,
    AD_TYPE_REVENUE,
    REWARD_RATES,
    simulateViewability,
    simulateCTR,
    computeRevenue,
    computeUserReward
};