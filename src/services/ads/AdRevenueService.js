const LedgerEntry = require('../../models/LedgerEntry');
const Post = require('../../models/Post');
const AdEvent = require('../../models/ads/AdEvent');

const SHARES = {
    post: { reader: 0.30, publisher: 0.30, orgOperational: 0.40 },
    feed: { reader: 0.30, orgReserve: 0.70 }
};

function generatePoolDistribution(revenue, pageType) {
    const shares = SHARES[pageType] || SHARES.feed;
    const distribution = {};
    for (const [key, share] of Object.entries(shares)) {
        distribution[key] = Math.round(revenue * share * 1e6) / 1e6;
    }
    return distribution;
}

async function getPoolBalance(pool) {
    const result = await LedgerEntry.aggregate([
        { $match: { pool, status: 'completed' } },
        { $group: { _id: null, balance: { $sum: '$amount' } } }
    ]);
    return result.length > 0 ? result[0].balance : 0;
}

async function getPoolBalanceByUser(pool, userId) {
    const result = await LedgerEntry.aggregate([
        { $match: { pool, user: userId, status: 'completed' } },
        { $group: { _id: null, balance: { $sum: '$amount' } } }
    ]);
    return result.length > 0 ? result[0].balance : 0;
}

async function getDailyPoolChange(pool, days) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const result = await LedgerEntry.aggregate([
        { $match: { pool, status: 'completed', createdAt: { $gte: since } } },
        {
            $group: {
                _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                total: { $sum: '$amount' }
            }
        },
        { $sort: { _id: 1 } }
    ]);
    return result;
}

async function getDailyAveragePayout(pool, days) {
    const daily = await getDailyPoolChange(pool, days);
    if (daily.length === 0) return 0;
    const total = daily.reduce((sum, d) => sum + d.total, 0);
    return total / daily.length;
}

async function getAverageDailyReaderPayout() {
    const result = await LedgerEntry.aggregate([
        { $match: { type: 'reader_reward_payout', status: 'completed' } },
        {
            $group: {
                _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                total: { $sum: { $abs: '$amount' } }
            }
        },
        { $sort: { _id: -1 } },
        { $limit: 30 }
    ]);
    if (result.length === 0) return 0;
    const total = result.reduce((sum, d) => sum + d.total, 0);
    return total / result.length;
}

async function distributeAdRevenue(adEvent) {
    if (!adEvent || !adEvent._id) {
        throw new Error('Invalid adEvent: must have _id');
    }

    const pageType = (adEvent.metadata && adEvent.metadata.pageType) || 'feed';
    const distribution = generatePoolDistribution(adEvent.revenue, pageType);
    const entries = [];
    const now = new Date();

    if (pageType === 'post') {
        const readerPoolBefore = await getPoolBalance('reader_pool');
        entries.push({
            user: null,
            type: 'ad_revenue_reader_pool',
            amount: distribution.reader,
            balanceBefore: readerPoolBefore,
            balanceAfter: readerPoolBefore + distribution.reader,
            status: 'completed',
            fundedBy: 'ad_revenue',
            correlationId: adEvent._id,
            correlationModel: 'AdEvent',
            pool: 'reader_pool',
            metadata: {
                adEventId: adEvent._id,
                adEventType: adEvent.type,
                pageType,
                slot: (adEvent.metadata && adEvent.metadata.slot) || null
            },
            createdAt: now,
            updatedAt: now
        });

        const publisherId = (adEvent.metadata && adEvent.metadata.publisherId) || null;
        if (publisherId) {
            const publisherPoolBefore = await getPoolBalanceByUser('publisher_pool', publisherId);
            entries.push({
                user: publisherId,
                type: 'ad_revenue_publisher',
                amount: distribution.publisher,
                balanceBefore: publisherPoolBefore,
                balanceAfter: publisherPoolBefore + distribution.publisher,
                status: 'completed',
                fundedBy: 'ad_revenue',
                correlationId: adEvent._id,
                correlationModel: 'AdEvent',
                pool: 'publisher_pool',
                metadata: {
                    adEventId: adEvent._id,
                    adEventType: adEvent.type,
                    pageType,
                    slot: (adEvent.metadata && adEvent.metadata.slot) || null,
                    postId: (adEvent.metadata && adEvent.metadata.postId) || null
                },
                createdAt: now,
                updatedAt: now
            });
        }

        const orgOpBefore = 0;
        entries.push({
            user: null,
            type: 'ad_revenue_operational',
            amount: distribution.orgOperational,
            balanceBefore: orgOpBefore,
            balanceAfter: orgOpBefore + distribution.orgOperational,
            status: 'completed',
            fundedBy: 'ad_revenue',
            correlationId: adEvent._id,
            correlationModel: 'AdEvent',
            pool: 'org_operational',
            metadata: {
                adEventId: adEvent._id,
                adEventType: adEvent.type,
                pageType
            },
            createdAt: now,
            updatedAt: now
        });
    } else {
        const reserveBefore = await getPoolBalance('org_reserve');
        entries.push({
            user: null,
            type: 'ad_revenue_reserve',
            amount: distribution.orgReserve,
            balanceBefore: reserveBefore,
            balanceAfter: reserveBefore + distribution.orgReserve,
            status: 'completed',
            fundedBy: 'ad_revenue',
            correlationId: adEvent._id,
            correlationModel: 'AdEvent',
            pool: 'org_reserve',
            metadata: {
                adEventId: adEvent._id,
                adEventType: adEvent.type,
                pageType
            },
            createdAt: now,
            updatedAt: now
        });
    }

    const created = await LedgerEntry.insertMany(entries);

    try {
        await AdEvent.updateOne(
            { _id: adEvent._id },
            {
                $set: {
                    'metadata.poolDistribution': distribution,
                    'metadata.pageType': pageType
                }
            }
        );
    } catch (err) {
        console.error('Failed to update AdEvent with distribution metadata:', err.message);
    }

    return created;
}

module.exports = {
    distributeAdRevenue,
    generatePoolDistribution,
    getPoolBalance,
    getPoolBalanceByUser,
    getDailyPoolChange,
    getDailyAveragePayout,
    getAverageDailyReaderPayout,
    SHARES
};
