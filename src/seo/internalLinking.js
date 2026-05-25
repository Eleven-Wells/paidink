const Post = require('../models/Post');

/**
 * Finds related posts based on tags and category
 * @param {string} currentPostId - ID of current post
 * @param {Array} tags - Tags of current post
 * @param {string} category - Category of current post
 * @param {number} limit - Number of related posts to return
 * @returns {Array} - Array of related posts
 */
async function getRelatedPosts(currentPostId, tags, category, limit = 3) {
    try {
        if (!tags || tags.length === 0) {
            // Fallback to category-based related posts
            const relatedPosts = await Post.find({
                _id: { $ne: currentPostId },
                category: category
            })
            .select('title slug summary publishedAt')
            .sort({ publishedAt: -1 })
            .limit(limit);

            return relatedPosts;
        }

        // Find posts with matching tags
        const relatedPosts = await Post.find({
            _id: { $ne: currentPostId },
            $or: [
                { tags: { $in: tags } },
                { category: category }
            ]
        })
        .select('title slug summary publishedAt tags category')
        .sort({ publishedAt: -1 })
        .limit(limit * 2); // Get more to filter

        // Score and sort by relevance
        const scoredPosts = relatedPosts.map(post => {
            let score = 0;

            // Same category bonus
            if (post.category === category) score += 3;

            // Matching tags
            const matchingTags = post.tags.filter(tag => tags.includes(tag));
            score += matchingTags.length * 2;

            // Recency bonus (posts from last 30 days)
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            if (post.publishedAt > thirtyDaysAgo) score += 1;

            return { post, score };
        });

        // Sort by score and return top results
        scoredPosts.sort((a, b) => b.score - a.score);

        return scoredPosts.slice(0, limit).map(item => item.post);

    } catch (error) {
        console.error('Error finding related posts:', error);
        return [];
    }
}

/**
 * Generates internal links HTML for related posts
 * @param {Array} relatedPosts - Array of related post objects
 * @returns {string} - HTML string with related posts links
 */
function generateRelatedPostsHtml(relatedPosts) {
    if (!relatedPosts || relatedPosts.length === 0) {
        return '';
    }

    const linksHtml = relatedPosts.map(post => `
        <li>
            <a href="/post/${post.slug}"
               style="color: #6d0a0a; text-decoration: none; font-weight: 500;">
                ${post.title}
            </a>
            <p style="font-size: 0.875rem; color: #5f5a58; margin-top: 0.25rem;">${post.summary.substring(0, 100)}...</p>
        </li>
    `).join('');

    return `
        <div style="margin-top: 3rem; padding: 1.5rem; background: rgba(109,10,10,0.04); border-radius: 0.75rem;">
            <h3 style="font-size: 1.125rem; font-weight: 600; color: #181211; margin: 0 0 1rem;">Related Articles</h3>
            <ul style="list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 1rem;">
                ${linksHtml}
            </ul>
        </div>
    `;
}

/**
 * Adds internal linking suggestions to post content
 * @param {string} content - Original post content
 * @param {Array} relatedPosts - Array of related posts
 * @returns {string} - Content with internal links added
 */
function addInternalLinks(content, relatedPosts) {
    if (!content || !relatedPosts || relatedPosts.length === 0) {
        return content;
    }

    let enhancedContent = content;

    // Add links to related posts in content where relevant
    relatedPosts.forEach(post => {
        const keywords = extractKeywordsFromTitle(post.title);

        keywords.forEach(keyword => {
            // Only add links if keyword appears and isn't already linked
            const regex = new RegExp(`\\b${keyword}\\b(?![^<]*>|[^<>]*</a>)`, 'gi');

            if (regex.test(enhancedContent)) {
                enhancedContent = enhancedContent.replace(regex,
                    `<a href="/post/${post.slug}" style="color: #6d0a0a; text-decoration: underline; text-decoration-color: rgba(109,10,10,0.3);">$&</a>`,
                    1 // Only replace first occurrence
                );
            }
        });
    });

    return enhancedContent;
}

/**
 * Extracts keywords from post title for linking
 * @param {string} title - Post title
 * @returns {Array} - Array of keywords
 */
function extractKeywordsFromTitle(title) {
    if (!title) return [];

    // Extract relevant keywords from post titles for linking
    const commonKeywords = [
        // Tech terms (kept for tech category)
        'JavaScript', 'Node.js', 'React', 'Python', 'Docker', 'Kubernetes',
        'MongoDB', 'PostgreSQL', 'Redis', 'GraphQL', 'REST', 'API',
        'DevOps', 'CI/CD', 'AWS', 'Azure', 'Git', 'TypeScript',
        // News/Current events
        'Election', 'Vote', 'Government', 'Policy', 'Court', 'Law',
        // Sports
        'Championship', 'Tournament', 'League', 'Olympics', 'World Cup',
        'Premier League', 'NFL', 'NBA', 'MLB', 'NHL',
        // Entertainment
        'Movie', 'Film', 'Actor', 'Actress', 'Director', 'Award',
        'Oscars', 'Grammys', 'Emmy', 'Streaming',
        // Business/Finance
        'Stock', 'Market', 'Economy', 'Finance', 'Investment', 'Startup',
        'Funding', 'IPO', 'Revenue', 'Profit',
        // Health
        'Health', 'Medical', 'Doctor', 'Hospital', 'Research', 'Study',
        'Treatment', 'Vaccine', 'Fitness', 'Nutrition',
        // Lifestyle
        'Lifestyle', 'Travel', 'Food', 'Recipe', 'Cooking', 'Fashion',
        'Style', 'Home', 'Garden', 'Parenting'
    ];

    return commonKeywords.filter(term =>
        title.toLowerCase().includes(term.toLowerCase())
    );
}

module.exports = {
    getRelatedPosts,
    generateRelatedPostsHtml,
    addInternalLinks
};