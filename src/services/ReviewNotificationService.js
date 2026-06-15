const axios = require('axios');

const DISCORD_MAX_FIELD_LENGTH = 1024;

function truncate(value, maxLength = DISCORD_MAX_FIELD_LENGTH) {
    const text = String(value || '').trim();
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength - 3)}...`;
}

function starRating(rating) {
    const safeRating = Math.max(1, Math.min(5, Number(rating) || 0));
    return `${safeRating}/5`;
}

function getReviewerName(user) {
    if (!user) return 'Unknown tester';
    const display = user.displayName || user.username || user.email;
    return display || 'Unknown tester';
}

async function sendReviewToDiscord(review, user) {
    const webhookUrl = process.env.DISCORD_REVIEW_WEBHOOK_URL;
    if (!webhookUrl) {
        return { status: 'skipped', error: '' };
    }

    const baseUrl = process.env.BASE_URL || '';
    const adminReviewUrl = baseUrl ? `${baseUrl.replace(/\/$/, '')}/admin/reviews` : '';
    const reviewer = getReviewerName(user || review.user);
    const handle = user?.username ? `@${user.username}` : user?.email || '';

    const payload = {
        username: 'Nook Reviews',
        embeds: [{
            title: 'New Nook beta review',
            color: review.rating >= 4 ? 0x22c55e : review.rating === 3 ? 0xf59e0b : 0xef4444,
            fields: [
                {
                    name: 'Rating',
                    value: starRating(review.rating),
                    inline: true
                },
                {
                    name: 'Reviewer',
                    value: truncate(handle ? `${reviewer} (${handle})` : reviewer, 256),
                    inline: true
                },
                {
                    name: 'Page',
                    value: truncate(review.context?.path || 'Unknown page', 256),
                    inline: true
                },
                {
                    name: 'Feedback',
                    value: truncate(review.feedback, DISCORD_MAX_FIELD_LENGTH)
                }
            ],
            timestamp: new Date(review.createdAt || Date.now()).toISOString()
        }]
    };

    if (adminReviewUrl) {
        payload.embeds[0].url = adminReviewUrl;
    }

    try {
        await axios.post(webhookUrl, payload, {
            timeout: 5000,
            headers: {
                'Content-Type': 'application/json'
            }
        });

        return { status: 'sent', error: '' };
    } catch (error) {
        return {
            status: 'failed',
            error: truncate(error.response?.data?.message || error.message || 'Discord webhook failed', 500)
        };
    }
}

module.exports = {
    sendReviewToDiscord
};
