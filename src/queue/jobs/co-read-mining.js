const ReadSession = require('../../models/ReadSession');
const coreadService = require('../../services/CoreadService');

async function runCoReadMining() {
    console.log('[CoReadMining] Starting co-read matrix computation...');

    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);

    const sessions = await ReadSession.find({
        completed: true,
        endedAt: { $gte: thirtyDaysAgo }
    })
    .populate('post', '_id')
    .sort({ user: 1, endedAt: 1 })
    .lean();

    const userReads = {};
    for (const session of sessions) {
        if (!session.post) continue;
        const userId = session.user.toString();
        const postId = session.post._id.toString();

        if (!userReads[userId]) userReads[userId] = [];
        userReads[userId].push({
            postId,
            weight: (session.timeSpentSeconds / 60) * (session.completed ? 1 : 0.5)
        });
    }

    let pairsProcessed = 0;
    for (const reads of Object.values(userReads)) {
        if (reads.length < 2) continue;

        for (let i = 0; i < reads.length; i++) {
            for (let j = i + 1; j < reads.length; j++) {
                const weight = (reads[i].weight + reads[j].weight) / 2;
                await coreadService.setRelated(reads[i].postId, reads[j].postId, weight);
                await coreadService.setRelated(reads[j].postId, reads[i].postId, weight);
                pairsProcessed++;
            }
        }
    }

    console.log(`[CoReadMining] Done. Processed ${pairsProcessed} co-read pairs across ${Object.keys(userReads).length} users.`);
}

module.exports = { runCoReadMining };
