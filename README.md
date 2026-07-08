# Paidink

A modern community platform for reading, writing, and engaging with stories across all topics. Readers discover content through personalized feeds, categories, and search. Writers publish and grow their audience.

## Features

- **Read & Earn** - Earn credits for reading, commenting, and engaging with content
- **Personalized Feeds** - Recommendation engine tailors content to your interests
- **Category Browsing** - Explore stories across 8 categories
- **Writer Tools** - Create and manage posts with a dedicated publisher dashboard
- **Admin Dashboard** - Full content management, analytics, and moderation
- **SEO Optimized** - Automatic sitemap generation and search engine ping
- **Dark/Light Theme** - System preference detection with manual toggle
- **Newsletter Subscription** - Email collection with validation
- **RESTful API** - Full API documentation with OpenAPI spec
- **Responsive Design** - Mobile-first layout
- **Internationalization** - EN/ES language support

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           PaidInk Architecture                                │
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
│  ┌───────────────┐     ┌──────────────┐     ┌───────────────┐             │
│  │   MongoDB    │     │    Redis     │     │  BullMQ       │             │
│  │  (Posts,     │     │  (Jobs,      │     │  (Background  │             │
│  │   Users)     │     │   Cache)     │     │   Workers)    │             │
│  └───────────────┘     └──────────────┘     └───────────────┘             │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────┐         │
│  │                     Scheduled Jobs (Cron)                       │         │
│  │  Co-read Mining │ Feed Update │ SEO Update │ Cleanup            │         │
│  └────────────────────────────────────────────────────────────────┘         │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Backend** | Node.js, Fastify |
| **Database** | MongoDB (Mongoose ODM) |
| **Cache/Queue** | Redis, BullMQ |
| **Frontend** | EJS, Tailwind CSS, Vanilla JS |
| **Deployment** | Docker, Vercel |

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
| `MONGO_URI` | MongoDB connection string | `mongodb://admin:password@localhost:27017/nook` |
| `ADMIN_API_KEY` | API key for admin endpoints (generate: `openssl rand -hex 32`) | `a1b2c3...` |

### Optional API Keys

| Variable | Description | Where to Get |
|----------|-------------|--------------|
| `UNSPLASH_ACCESS_KEY` | Unsplash API key for images | [unsplash.com/developers](https://unsplash.com/developers) |
| `NEWS_API_KEY` | NewsAPI key for news articles | [newsapi.org](https://newsapi.org) |
| `OPENAI_API_KEY` | OpenAI API key (optional, for AI-assisted features) | [platform.openai.com](https://platform.openai.com) |

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

### Content Settings (AI-Assisted Features)

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

## Content Sources (Optional)

The platform can optionally fetch content from external sources via RSS and APIs. Content is queued for processing by background workers.

```javascript
// Example: Add a custom content source
const ContentSource = require('./src/models/ContentSource');
await ContentSource.create({
  name: 'My Feed',
  url: 'https://example.com/feed/',
  type: 'rss',
  category: 'development',
  active: true
});
```

## Project Structure

```
Nook/
├── src/
│   ├── config/           # Configuration modules
│   │   ├── index.js      # Main config with validation
│   │   └── redis.js      # Redis connection
│   ├── models/           # Mongoose schemas
│   │   ├── Post.js       # Blog post model
│   │   ├── User.js       # User accounts
│   │   ├── Tool.js       # Tools/blog model
│   │   ├── Subscriber.js # Newsletter subscribers
│   │   ├── Credit.js     # Reader credit system
│   │   ├── AuditLog.js   # Audit trail
│   │   └── ContentSource.js
│   ├── routes/           # Fastify routes
│   │   ├── api.js        # API endpoints
│   │   ├── pages.js      # Page routes
│   │   ├── admin.js      # Admin panel routes
│   │   ├── reads.js      # Read tracking routes
│   │   └── recommendations.js
│   ├── services/         # Business logic
│   │   ├── PostService.js
│   │   ├── SearchService.js
│   │   ├── RecommendationService.js
│   │   ├── InterestProfileService.js
│   │   ├── CreditService.js
│   │   └── ...
│   ├── views/            # EJS templates
│   │   ├── pages/        # Full page templates
│   │   ├── partials/     # Reusable fragments
│   │   └── layouts/      # Layout wrappers
│   ├── queue/            # BullMQ job definitions
│   ├── public/           # Static assets (CSS, JS, images)
│   ├── server.js         # Main entry point
│   ├── worker.js         # Background worker
│   └── cron.js           # Cron job handlers
├── tests/                # Test files
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── scripts/              # Utility scripts
├── docs/                 # Documentation
└── package.json
```

## Troubleshooting

### Common Issues

#### 4. Database Connection Failed

**Error**: `MongoDB connection failed`

**Solutions**:
```bash
# Check if MongoDB is running
docker-compose ps mongodb

# Check connection string in .env
# Format: mongodb://user:password@host:27017/database

# Test connection
mongosh "mongodb://localhost:27017/nook"
```

#### 5. Redis Connection Failed

**Error**: `Worker not initialized - Redis connection failed`

**Solutions**:
```bash
# Check if Redis is running
docker-compose ps redis

# Test connection
redis-cli ping

# Check REDIS_HOST and REDIS_PORT in .env
```

#### 3. Port Already in Use

**Error**: `EADDRINUSE: address already in use :::5050`

**Solutions**:
```bash
# Find process using port
lsof -i :5050

# Kill process
kill -9 <PID>

# Or change PORT in .env
```

#### 4. Rate Limit Exceeded

**Error**: `Rate limit exceeded`

**Solutions**:
```bash
# Wait 1 minute (default window)

# Increase limits in .env
ADMIN_RATE_LIMIT_MAX=200
ADMIN_RATE_LIMIT_WINDOW=60000
```

#### 5. Images Not Loading

**Error**: `Failed to fetch image`

**Solutions**:
```bash
# Verify Unsplash API key
echo $UNSPLASH_ACCESS_KEY

# Check Unsplash rate limits
# Free tier: 50 requests/hour
```

#### 6. Worker Not Processing Jobs

**Solutions**:
```bash
# Check worker is running
curl http://localhost:5050/api/health

# Check Redis for queued jobs
redis-cli LLEN bullmq:content-generation

# View worker logs
pnpm start
```

#### 7. Build CSS Fails

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
docker build -t nook .

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
