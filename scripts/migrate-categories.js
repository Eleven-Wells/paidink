/**
 * Migration script: Update Post categories from old tech-focused enum
 * to new generalized enum.
 *
 * Run: node scripts/migrate-categories.js
 *
 * Old → New mapping:
 *   backend/javascript/performance/ai-tools/devops → development
 *   career → lifestyle
 *
 * Run against a backup first!
 */
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/nook';

const CATEGORY_MAP = {
    backend: 'development',
    javascript: 'development',
    performance: 'development',
    'ai-tools': 'development',
    devops: 'development',
    career: 'lifestyle'
};

async function migrate() {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    const Post = mongoose.model('Post', new mongoose.Schema({}, { strict: false, collection: 'posts' }));

    const oldCategories = Object.keys(CATEGORY_MAP);
    const total = await Post.countDocuments({ category: { $in: oldCategories } });
    console.log(`Found ${total} posts with old categories`);

    if (total === 0) {
        console.log('No posts to migrate.');
        await mongoose.disconnect();
        return;
    }

    for (const [oldCat, newCat] of Object.entries(CATEGORY_MAP)) {
        const result = await Post.updateMany(
            { category: oldCat },
            { $set: { category: newCat } }
        );
        if (result.modifiedCount > 0) {
            console.log(`  ${oldCat} → ${newCat}: ${result.modifiedCount} posts updated`);
        }
    }

    const remaining = await Post.countDocuments({ category: { $in: oldCategories } });
    console.log(`Remaining posts with old categories: ${remaining}`);
    console.log('Migration complete.');

    await mongoose.disconnect();
}

migrate().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
