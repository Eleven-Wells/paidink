# TechMedia - AI-Powered Tech News Platform

A modern, SEO-optimized blog platform that automatically generates content using AI, sources articles from RSS feeds, and manages everything through background workers.

## Features

- **AI Content Generation** - OpenAI GPT-powered blog post generation
- **RSS Content Sourcing** - Automatic content ingestion from multiple feeds
- **Background Processing** - BullMQ job queue for reliable content processing
- **SEO Optimized** - Automatic sitemap generation and search engine ping
- **Dark/Light Theme** - System preference detection with manual toggle
- **Newsletter Subscription** - Email collection with validation
- **RESTful API** - Full API documentation with OpenAPI spec
- **Responsive Design** - Mobile-first Tailwind CSS
- **Internationalization** - EN/ES language support
- **Real-time Updates** - Polling for new content

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           TechMedia Architecture                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                    │
│  │   Client    │    │   Client     │    │   Client     │                    │
│  │  (Browser)  │    │  (Mobile)    │    │    (API)     │                    │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘                    │
│         │                   │                   │                             │
│         └───────────────────┼───────────────────┘                             │
│                             │                                                 │
│                             ▼                                                 │
│  ┌────────────────────────────────────────────────────────────────┐         │
│  │                      Fastify Server (Node.js)                    │         │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────────────┐     │         │
│  │  │ Routes  │  │ Plugins │  │  Views  │  │  API Endpoints  │     │         │
│  │  │ (Pages) │  │  Auth  │  │  (EJS)  │  │  /api/posts    │     │         │
│  │  │  /post/ │  │  Rate  │  │         │  │  /api/search   │     │         │
│  │  │  /cat/  │  │  Limit │  │         │  │  /api/health  │     │         │
│  │  └────┬────┘  └─────────┘  └─────────┘  └────────┬───────┘     │         │
│  └───────┼──────────────────────────────────────────┼─────────────┘         │
│          │                                          │                       │
│          │         ┌───────────────────────────────┘                       │
│          │         │                                                       │
│          ▼         ▼                                                       │
│  ┌───────────────┐     ┌───────────────┐     ┌───────────────┐             │
│  │   MongoDB    │     │    Redis     │     │  BullMQ      │             │
│  │  (Posts,     │     │  (Jobs,      │     │  (Worker)    │             │
│  │   Audit)     │     │   Cache)      │     │              │             │
│  └───────────────┘     └───────────────┘     └───────┬───────┘             │
│                                                   │                       │
│                                                   ▼                       │
│                              ┌────────────────────────────────┐           │
│                              │      External Services          │           │
│                              │  ┌──────────┐ ┌──────────┐   │           │
│                              │  │ OpenAI   │ │ Unsplash │   │           │
│                              │  │ (GPT-4) │ │ (Images) │   │           │
│                              │  └──────────┘ └──────────┘   │           │
│                              │  ┌──────────┐ ┌──────────┐   │           │
│                              │  │ Dev.to   │ │ GitHub   │   │           │
│                              │  │  (RSS)   │ │ (API)    │   │           │
│                              │  └──────────┘ └──────────┘   │           │
│                              └────────────────────────────────┘           │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────┐         │
│  │                     Scheduled Jobs (Cron)                       │         │
│  │  Content Ingestion (6h) │ Feed Update (2h) │ SEO Update (3AM)  │         │
│  └────────────────────────────────────────────────────────────────┘         │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Backend** | Node.js, Fastify |
| **Database** | MongoDB (Mongoose ODM) |
| **Queue** | BullMQ, Redis |
| **AI** | OpenAI GPT-4o-mini |
| **Images** | Unsplash API |
| **Frontend** | EJS, Tailwind CSS, Vanilla JS |
| **Deployment** | Docker, Render |

## Quick Start

### Prerequisites

- Node.js 18+
- Docker and Docker Compose
- MongoDB 6+
- Redis 7+

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd Latest-Tech-News

# Install dependencies
pnpm install

# Set up environment variables
cp .env.example .env
# Edit .env with your API keys

# Start infrastructure
docker-compose up -d

# Start the application
pnpm dev
```

### Access the Application

- **Web App**: http://localhost:5050
- **API Docs**: http://localhost:5050/api/docs

## Environment Variables

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `MONGO_URI` | MongoDB connection string | `mongodb://admin:password@localhost:27017/simpleblog` |
| `OPENAI_API_KEY` | OpenAI API key for content generation | `sk-...` |
| `ADMIN_API_KEY` | API key for admin endpoints (generate: `openssl rand -hex 32`) | `a1b2c3...` |

### Optional API Keys

| Variable | Description | Where to Get |
|----------|-------------|--------------|
| `UNSPLASH_ACCESS_KEY` | Unsplash API key for images | [unsplash.com/developers](https://unsplash.com/developers) |
| `NEWS_API_KEY` | NewsAPI key for news articles | [newsapi.org](https://newsapi.org) |

### Server Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `5050` | Server port |
| `NODE_ENV` | `development` | Environment mode |
| `BASE_URL` | `http://localhost:5050` | Base URL for sitemaps |

### Security Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `ADMIN_ALLOWED_IPS` | _(none)_ | Comma-separated IP whitelist |
| `API_KEY_ROTATION_ENABLED` | `false` | Enable API key rotation |
| `ADMIN_RATE_LIMIT_MAX` | `100` | Max requests per window per API key |
| `ADMIN_RATE_LIMIT_WINDOW` | `60000` | Rate limit window (ms) |
| `CSRF_ENABLED` | `false` | Enable CSRF protection |
| `CSRF_SECRET` | _(none)_ | CSRF secret (required if enabled) |
| `ALLOWED_ORIGINS` | `http://localhost:5050,http://localhost:3000` | CORS origins |

### Error Tracking

| Variable | Description |
|----------|-------------|
| `SENTRY_DSN` | Sentry DSN for error tracking |

### Logging

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `info` | Log level: debug, info, warn, error, fatal |

### Content Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_CONTENT_LENGTH` | `5000` | Max AI content length |
| `AI_MODEL` | `gpt-4o-mini` | OpenAI model |
| `AI_SUMMARY_LENGTH` | `300` | Summary length |
| `AI_REWRITE_LENGTH` | `800` | Rewrite length |

### Cron Schedule Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `CONTENT_INGESTION_SCHEDULE` | `0 */6 * * *` | Content fetch schedule |
| `FEED_UPDATE_SCHEDULE` | `0 */2 * * *` | Feed update schedule |
| `SEO_UPDATE_SCHEDULE` | `0 3 * * *` | Sitemap update schedule |
| `CLEANUP_SCHEDULE` | `0 4 * * 0` | Job log cleanup (weekly) |

## API Documentation

### Base URL

```
http://localhost:5050/api
```

### Authentication

Admin endpoints require the `X-Api-Key` header:

```bash
curl -H "X-Api-Key: your-admin-api-key" \
  http://localhost:5050/api/update
```

### Endpoints

#### Health & Status

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Server health status |
| GET | `/api/ping` | Uptime ping |

#### Posts

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/posts` | List posts (paginated) |
| GET | `/api/latest-posts` | Get latest posts |
| GET | `/api/post/:id` | Get post by ID |
| GET | `/api/categories` | List all categories |

#### Search

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/search?q=query` | Search posts |

#### Subscription

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/subscribe` | Subscribe email |

#### Admin (Protected)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/update` | Trigger content update |
| POST | `/api/retry-connection` | Retry DB connection |

### Response Format

All API responses follow this structure:

```json
{
  "success": true,
  "data": { ... },
  "requestId": "req_abc123..."
}
```

### Error Response

```json
{
  "success": false,
  "error": {
    "code": "ERR_001",
    "message": "Error description",
    "statusCode": 400,
    "timestamp": "2026-04-15T12:00:00.000Z",
    "requestId": "req_abc123..."
  }
}
```

## Content Sources

The platform automatically fetches content from:

1. **Dev.to RSS** - Latest JavaScript articles
2. **GitHub Trending** - Top starred repositories
3. **NewsAPI** (optional) - Technology news

### Adding Custom Sources

```javascript
// Add to ContentSource collection
const ContentSource = require('./src/models/ContentSource');
await ContentSource.create({
  name: 'TechCrunch',
  url: 'https://techcrunch.com/feed/',
  type: 'rss',
  category: 'tech-news',
  active: true
});
```

## Project Structure

```
Latest-Tech-News/
├── src/
│   ├── config/           # Configuration modules
│   │   ├── index.js      # Main config with validation
│   │   └── redis.js      # Redis connection
│   ├── models/           # Mongoose schemas
│   │   ├── Post.js       # Blog post model
│   │   ├── Tool.js       # Tools/blog model
│   │   ├── Subscriber.js # Newsletter subscribers
│   │   ├── JobLog.js     # Job execution logs
│   │   ├── AuditLog.js   # Audit trail
│   │   └── ContentSource.js
│   ├── routes/           # Fastify routes
│   │   ├── api.js        # API endpoints
│   │   └── pages.js      # Page routes
│   ├── utils/            # Utility functions
│   │   ├── ai.js         # OpenAI integration
│   │   ├── fetchTools.js  # Content fetching
│   │   ├── contentSourcer.js
│   │   ├── imageFetcher.js
│   │   ├── contentSanitizer.js
│   │   ├── internalLinking.js
│   │   ├── seoManager.js
│   │   └── errors.js     # Error classes
│   ├── plugins/           # Fastify plugins
│   │   ├── admin-auth.js
│   │   ├── audit.js
│   │   ├── cache.js
│   │   ├── error-handler.js
│   │   ├── logger.js
│   │   ├── request-id.js
│   │   ├── sentry.js
│   │   ├── swagger.js
│   │   ├── validation.js
│   │   └── cron-plugin.js
│   ├── views/             # EJS templates
│   ├── server.js          # Main entry
│   ├── worker.js          # Background worker
│   ├── cron.js           # Cron job handlers
│   └── db.js             # Database connection
├── queue/
│   └── contentQueue.js   # BullMQ queue config
├── public/                # Static assets
│   ├── css/
│   └── js/
├── tests/                # Test files
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── .github/
│   └── workflows/        # CI/CD pipelines
├── docker-compose.yml
├── jest.config.js
├── playwright.config.js
└── package.json
```

## Troubleshooting

### Common Issues

#### 1. Database Connection Failed

**Error**: `MongoDB connection failed`

**Solutions**:
```bash
# Check if MongoDB is running
docker-compose ps mongodb

# Check connection string in .env
# Format: mongodb://user:password@host:27017/database

# Test connection
mongosh "mongodb://localhost:27017/simpleblog"
```

#### 2. Redis Connection Failed

**Error**: `Worker not initialized - Redis connection failed`

**Solutions**:
```bash
# Check if Redis is running
docker-compose ps redis

# Test connection
redis-cli ping

# Check REDIS_HOST and REDIS_PORT in .env
```

#### 3. OpenAI API Errors

**Error**: `AI content generation failed`

**Solutions**:
```bash
# Verify API key is set
echo $OPENAI_API_KEY

# Check OpenAI credits
# Visit: https://platform.openai.com/account/usage

# Check rate limits
# Free tier: 3 RPM, 200 RPM
```

#### 4. Port Already in Use

**Error**: `EADDRINUSE: address already in use :::5050`

**Solutions**:
```bash
# Find process using port
lsof -i :5050

# Kill process
kill -9 <PID>

# Or change PORT in .env
```

#### 5. Rate Limit Exceeded

**Error**: `Rate limit exceeded`

**Solutions**:
```bash
# Wait 1 minute (default window)

# Increase limits in .env
ADMIN_RATE_LIMIT_MAX=200
ADMIN_RATE_LIMIT_WINDOW=60000
```

#### 6. Images Not Loading

**Error**: `Failed to fetch image`

**Solutions**:
```bash
# Verify Unsplash API key
echo $UNSPLASH_ACCESS_KEY

# Check Unsplash rate limits
# Free tier: 50 requests/hour
```

#### 7. Worker Not Processing Jobs

**Solutions**:
```bash
# Check worker is running
curl http://localhost:5050/api/health

# Check Redis for queued jobs
redis-cli LLEN bullmq:content-generation

# View worker logs
pnpm start
```

#### 8. Build CSS Fails

**Error**: Tailwind CSS build errors

**Solutions**:
```bash
# Reinstall dependencies
pnpm install

# Rebuild CSS
pnpm run build:css
```

### Debug Mode

Enable verbose logging:

```bash
LOG_LEVEL=debug pnpm start
```

### Health Check

```bash
# Server health
curl http://localhost:5050/api/health

# Queue status
curl http://localhost:5050/api/health | jq '.queue'
```

## Deployment

### Docker

```bash
# Build image
docker build -t techmedia .

# Run with docker-compose
docker-compose -f docker-compose.prod.yml up -d
```

### Environment Variables for Production

```bash
NODE_ENV=production
LOG_LEVEL=warn
ADMIN_ALLOWED_IPS=203.0.113.0/24
CSRF_ENABLED=true
SENTRY_DSN=https://...@sentry.io/...
```

## Testing

```bash
# Run all tests
pnpm test

# Unit tests only
pnpm test -- --testPathPattern=unit

# Integration tests
pnpm test -- --testPathPattern=integration

# E2E tests
pnpm test:e2e

# With coverage
pnpm test:coverage
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## License

ISC License

## Support

For issues and feature requests, please open a GitHub issue.
