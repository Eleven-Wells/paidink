const ReadSession = require('../models/ReadSession');

const DAILY_READ_CAP = 100;
const POST_READ_COOLDOWN_HOURS = 24;
const MIN_SESSION_GAP_SECONDS = 3;
const MIN_READ_SPEED_FRACTION = 0.10;
const WORDS_PER_MINUTE = 200;

async function enforceDailyCap(userId, cap) {
    const todayReads = await ReadSession.getTodayReads(userId);
    return todayReads < cap;
}

async function enforcePostCooldown(userId, postId, cooldownHours) {
    const existing = await ReadSession.findOne({
        user: userId, post: postId, completed: true
    }).sort({ createdAt: -1 });

    if (!existing) return true;

    const createdAt = existing.createdAt || existing._doc?.createdAt;
    const hoursSince = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60);
    return hoursSince >= cooldownHours;
}

function enforceSessionGap(lastSessionStart, minGapSeconds) {
    if (!lastSessionStart) return true;
    const secondsSince = (Date.now() - new Date(lastSessionStart).getTime()) / 1000;
    return secondsSince >= minGapSeconds;
}

function enforceReadSpeed(timeSpentSeconds, wordCount, wpm, minFraction) {
    const expectedSeconds = (wordCount / wpm) * 60;
    const minimumSeconds = Math.max(expectedSeconds * minFraction, 1);
    return timeSpentSeconds >= minimumSeconds;
}

module.exports = {
    DAILY_READ_CAP,
    POST_READ_COOLDOWN_HOURS,
    MIN_SESSION_GAP_SECONDS,
    MIN_READ_SPEED_FRACTION,
    WORDS_PER_MINUTE,
    enforceDailyCap,
    enforcePostCooldown,
    enforceSessionGap,
    enforceReadSpeed
};
