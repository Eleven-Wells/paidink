const mongoose = require('mongoose');
require('dotenv').config();

async function cleanupDatabase() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        const db = mongoose.connection.db;
        const collection = db.collection('blogs');

        // Check current indexes
        const indexes = await collection.indexes();
        console.log('Current indexes:', indexes.map(idx => idx.name));

        // Remove documents with null slugs
        const nullSlugCount = await collection.countDocuments({ slug: null });
        console.log(`Found ${nullSlugCount} documents with null slugs`);

        if (nullSlugCount > 0) {
            await collection.deleteMany({ slug: null });
            console.log('Removed documents with null slugs');
        }

        // Drop the problematic slug index if it exists
        try {
            await collection.dropIndex('slug_1');
            console.log('Dropped slug_1 index');
        } catch (err) {
            console.log('slug_1 index not found or already dropped');
        }

        // Verify cleanup
        const newIndexes = await collection.indexes();
        console.log('Indexes after cleanup:', newIndexes.map(idx => idx.name));

        const remainingNullSlugs = await collection.countDocuments({ slug: null });
        console.log(`Remaining documents with null slugs: ${remainingNullSlugs}`);

        await mongoose.disconnect();
        console.log('Database cleanup completed successfully');
    } catch (err) {
        console.error('Error during cleanup:', err);
        process.exit(1);
    }
}

cleanupDatabase();