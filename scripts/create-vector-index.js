const mongoose = require('mongoose');
require('dotenv').config();

async function createVectorIndex() {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        console.error('MONGODB_URI environment variable is required');
        process.exit(1);
    }

    await mongoose.connect(uri);
    const db = mongoose.connection.db;

    const indexName = process.env.VECTOR_SEARCH_INDEX || 'auto-embedding-index';

    try {
        const result = await db.collection('posts').createSearchIndex({
            name: indexName,
            type: 'vectorSearch',
            definition: {
                fields: [
                    {
                        type: 'autoEmbedding',
                        path: 'embedding',
                        numDimensions: 1024,
                        similarity: 'cosine',
                        embedding: {
                            model: 'voyage-4'
                        },
                        fieldMappings: [
                            { path: 'title' },
                            { path: 'summary' },
                            { path: 'tags' },
                            { path: 'category' }
                        ]
                    }
                ]
            }
        });
        console.log('Vector search index created:', result);
    } catch (err) {
        if (err.code === 68) {
            console.log('Index already exists (code 68), skipping creation.');
        } else {
            console.error('Failed to create index:', err);
            process.exit(1);
        }
    }

    await mongoose.disconnect();
}

createVectorIndex();
