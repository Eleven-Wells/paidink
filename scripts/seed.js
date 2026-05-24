const mongoose = require('mongoose');
const Post = require('../src/models/Post');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const samplePosts = [
    {
        title: 'Getting Started with Node.js and Fastify',
        slug: 'getting-started-nodejs-fastify',
        content: `<h2>Introduction</h2>
<p>Fastify is a fast and low overhead web framework for Node.js. It's perfect for building APIs and web applications that need high performance.</p>
<h2>Why Fastify?</h2>
<p>Fastify offers several advantages over other frameworks:</p>
<ul>
<li><strong>Performance</strong> - One of the fastest Node.js frameworks</li>
<li><strong>Developer Experience</strong> - Great TypeScript support and excellent documentation</li>
<li><strong>Extensibility</strong> - Plugin system for easy code organization</li>
</ul>
<h2>Getting Started</h2>
<p>To create your first Fastify application, follow these steps:</p>
<pre><code class="language-javascript">const fastify = require('fastify')({ logger: true });
await fastify.listen({ port: 3000 });</code></pre>
<p>That's it! You now have a running server.</p>`,
        summary: 'Learn how to build high-performance web applications with Fastify, the fast and low overhead web framework for Node.js.',
        category: 'backend',
        tags: ['nodejs', 'fastify', 'javascript', 'api'],
        image: 'https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=800&h=400&fit=crop',
        imageMetadata: {
            source: 'unsplash',
            alt_text: 'Node.js code on a computer screen'
        },
        metaDescription: 'Learn how to build high-performance web applications with Fastify, the fast and low overhead web framework for Node.js.',
        publishedAt: new Date()
    },
    {
        title: 'Modern JavaScript Features You Should Know in 2026',
        slug: 'modern-javascript-features-2026',
        content: `<h2>JavaScript Evolution</h2>
<p>JavaScript continues to evolve with new features that make code more readable and maintainable. Here are the features you should know.</p>
<h2>Key Features</h2>
<h3>1. Optional Chaining</h3>
<p>Access nested properties safely without explicit checks:</p>
<pre><code class="language-javascript">const name = user?.profile?.name ?? 'Anonymous';</code></pre>
<h3>2. Private Class Fields</h3>
<p>Use the # prefix for truly private fields:</p>
<pre><code class="language-javascript">class Counter {
  #count = 0;
  increment() { this.#count++; }
}</code></pre>
<h3>3. Top-Level Await</h3>
<p>Use await at the top level without async functions:</p>
<pre><code class="language-javascript">const data = await fetch('/api/data');</code></pre>
<h2>Conclusion</h2>
<p>These features make JavaScript more expressive and help you write cleaner code.</p>`,
        summary: 'Explore the modern JavaScript features that will help you write cleaner, more efficient code in 2026.',
        category: 'javascript',
        tags: ['javascript', 'es2026', 'programming'],
        image: 'https://images.unsplash.com/photo-1579468118864-1b9ea3c0db4a?w=800&h=400&fit=crop',
        imageMetadata: {
            source: 'unsplash',
            alt_text: 'JavaScript code on screen'
        },
        metaDescription: 'Explore the modern JavaScript features that will help you write cleaner, more efficient code in 2026.',
        publishedAt: new Date(Date.now() - 86400000)
    },
    {
        title: 'Web Performance Optimization: A Complete Guide',
        slug: 'web-performance-optimization-guide',
        content: `<h2>Why Performance Matters</h2>
<p>Performance directly impacts user experience, conversion rates, and SEO rankings. A 1-second delay can reduce conversions by 7%.</p>
<h2>Core Web Vitals</h2>
<p>Google measures performance through Core Web Vitals:</p>
<ul>
<li><strong>LCP</strong> (Largest Contentful Paint) - Loading performance</li>
<li><strong>FID</strong> (First Input Delay) - Interactivity</li>
<li><strong>CLS</strong> (Cumulative Layout Shift) - Visual stability</li>
</ul>
<h2>Optimization Techniques</h2>
<h3>1. Minimize Critical Rendering Path</h3>
<p>Reduce the number of render-blocking resources and inline critical CSS.</p>
<h3>2. Optimize Images</h3>
<p>Use modern formats like WebP, implement lazy loading, and specify dimensions.</p>
<h3>3. Implement Caching</h3>
<p>Use service workers and CDN for aggressive caching strategies.</p>
<h2>Tools for Testing</h2>
<p>Lighthouse, WebPageTest, and Chrome DevTools are essential for measuring and debugging performance.</p>`,
        summary: 'Master web performance optimization with this comprehensive guide covering Core Web Vitals, optimization techniques, and best practices.',
        category: 'performance',
        tags: ['performance', 'web', 'optimization', 'seo'],
        image: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800&h=400&fit=crop',
        imageMetadata: {
            source: 'unsplash',
            alt_text: 'Website analytics dashboard'
        },
        metaDescription: 'Master web performance optimization with this comprehensive guide covering Core Web Vitals and best practices.',
        publishedAt: new Date(Date.now() - 172800000)
    },
    {
        title: 'Building AI-Powered Applications with OpenAI API',
        slug: 'building-ai-powered-applications',
        content: `<h2>The AI Revolution</h2>
<p>AI is transforming how we build applications. With the OpenAI API, you can integrate powerful language models into your projects.</p>
<h2>Getting Started</h2>
<p>First, get your API key from the OpenAI dashboard. Then, make your first request:</p>
<pre><code class="language-javascript">const response = await openai.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Hello!' }]
});</code></pre>
<h2>Use Cases</h2>
<ul>
<li><strong>Content Generation</strong> - Automated blog posts, product descriptions</li>
<li><strong>Code Assistance</strong> - Code review, debugging, explanations</li>
<li><strong>Customer Support</strong> - AI-powered chatbots</li>
<li><strong>Data Analysis</strong> - Natural language queries on databases</li>
</ul>
<h2>Best Practices</h2>
<p>Always implement rate limiting, handle errors gracefully, and sanitize user inputs before sending to the API.</p>`,
        summary: 'Learn how to integrate OpenAI API into your applications for AI-powered features like content generation and smart assistants.',
        category: 'ai-tools',
        tags: ['ai', 'openai', 'gpt', 'api'],
        image: 'https://images.unsplash.com/photo-1677442136019-21780ecad995?w=800&h=400&fit=crop',
        imageMetadata: {
            source: 'unsplash',
            alt_text: 'AI and machine learning visualization'
        },
        metaDescription: 'Learn how to integrate OpenAI API into your applications for AI-powered features.',
        publishedAt: new Date(Date.now() - 259200000)
    },
    {
        title: 'DevOps Best Practices for Modern Development',
        slug: 'devops-best-practices',
        content: `<h2>What is DevOps?</h2>
<p>DevOps bridges the gap between development and operations teams, enabling faster, more reliable software delivery.</p>
<h2>Key Principles</h2>
<h3>1. Infrastructure as Code</h3>
<p>Manage infrastructure using code for consistency and version control.</p>
<pre><code class="language-yaml"># docker-compose.yml
version: '3.8'
services:
  app:
    build: .
    ports:
      - '3000:3000'</code></pre>
<h3>2. CI/CD Pipelines</h3>
<p>Automate testing and deployment to reduce human error and speed up releases.</p>
<h3>3. Monitoring and Logging</h3>
<p>Implement comprehensive observability to catch issues before users do.</p>
<h2>Tools of the Trade</h2>
<p>Docker, Kubernetes, GitHub Actions, Terraform, and Prometheus are essential DevOps tools.</p>`,
        summary: 'Discover DevOps best practices including CI/CD, infrastructure as code, and monitoring for modern development teams.',
        category: 'devops',
        tags: ['devops', 'docker', 'kubernetes', 'ci-cd'],
        image: 'https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=800&h=400&fit=crop',
        imageMetadata: {
            source: 'unsplash',
            alt_text: 'DevOps pipeline visualization'
        },
        metaDescription: 'Discover DevOps best practices including CI/CD, infrastructure as code, and monitoring.',
        publishedAt: new Date(Date.now() - 345600000)
    },
    {
        title: 'Career Growth: From Junior to Senior Developer',
        slug: 'career-growth-junior-to-senior',
        content: `<h2>The Developer Career Path</h2>
<p>Growing from a junior to senior developer requires more than just technical skills. Here's what you need to know.</p>
<h2>Technical Skills That Matter</h2>
<ul>
<li><strong>System Design</strong> - Understanding how components interact</li>
<li><strong>Code Quality</strong> - Writing maintainable, testable code</li>
<li><strong>Debugging</strong> - Finding and fixing issues quickly</li>
</ul>
<h2>Soft Skills</h2>
<p>Communication, mentorship, and collaboration become increasingly important as you advance.</p>
<h3>1. Teaching Others</h3>
<p>Share your knowledge through code reviews, documentation, and pair programming.</p>
<h3>2. Making Decisions</h3>
<p>Senior developers make informed decisions with incomplete information.</p>
<h2>Continuous Learning</h2>
<p>The tech industry evolves constantly. Stay current with blogs, podcasts, and hands-on projects.</p>`,
        summary: 'Navigate your developer career from junior to senior level with insights on technical and soft skills growth.',
        category: 'career',
        tags: ['career', 'development', 'growth', 'soft-skills'],
        image: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800&h=400&fit=crop',
        imageMetadata: {
            source: 'unsplash',
            alt_text: 'Team collaboration at work'
        },
        metaDescription: 'Navigate your developer career from junior to senior level with insights on technical and soft skills growth.',
        publishedAt: new Date(Date.now() - 432000000)
    }
];

async function seedDatabase() {
    try {
        if (!process.env.MONGO_URI) {
            console.error('MONGO_URI not set');
            process.exit(1);
        }

        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');

        let created = 0;
        let skipped = 0;

        for (const postData of samplePosts) {
            const existing = await Post.findOne({ slug: postData.slug });
            if (existing) {
                skipped++;
                console.log(`Skipped: ${postData.title}`);
                continue;
            }

            const post = new Post(postData);
            await post.save();
            created++;
            console.log(`Created: ${postData.title}`);
        }

        console.log(`\nSeed complete: ${created} created, ${skipped} skipped`);
        console.log(`Total posts in database: ${await Post.countDocuments()}`);

        await mongoose.connection.close();
        console.log('Database connection closed');
    } catch (error) {
        console.error('Seed failed:', error.message);
        process.exit(1);
    }
}

seedDatabase();
