const fetchLatestBlog = require('./src/utils/fetchTools');

async function testFetch() {
    console.log('Testing fetchLatestBlog...');
    const result = await fetchLatestBlog();
    console.log('Result:', result);
}

testFetch().catch(console.error);