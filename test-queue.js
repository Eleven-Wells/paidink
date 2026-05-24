const fetchLatestBlog = require('./src/utils/fetchTools');

async function testFetch() {
    console.log('Testing updated fetchLatestBlog...');
    try {
        const result = await fetchLatestBlog();
        console.log('Result:', result);
    } catch (error) {
        console.error('Error:', error);
    }
}

testFetch();