const contentQueue = require('./queue/contentQueue');

async function testWorker() {
    try {
        console.log('Testing worker queue...');

        // Add a test job
        const job = await contentQueue.add('generate-post', {
            sourceUrl: 'https://dev.to/feed',
            category: 'javascript',
            type: 'rss'
        });

        console.log('Job added to queue:', job.id);
        console.log('Worker system is working!');

    } catch (error) {
        console.error('Worker test failed:', error.message);
    }
}

testWorker();