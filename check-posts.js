const Post = require('./src/models/Post');
const mongoose = require('mongoose');

async function checkPosts() {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/simpleblog');
        const posts = await Post.find({ category: 'devops' }).sort({ createdAt: -1 }).limit(5);
        console.log('Recent GitHub posts:');
        posts.forEach(post => {
            console.log(`- ${post.title}: ${post.content.length} chars`);
        });
        await mongoose.disconnect();
    } catch (error) {
        console.error('Error:', error);
    }
}

checkPosts();