# TechMedia Rewards - System Architecture

## 1. Core Concept

**TechMedia Rewards** - A reward-based content platform where users earn money by reading content and engaging with ads, while content creators monetize their articles.

```
┌─────────────────────────────────────────────────────────────────┐
│                         PLATFORM                                  │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐  │
│  │  USERS  │───▶│  CONTENT │◀───│PUBLISHERS│◀───│    ADS   │  │
│  │ (Read & │    │  READS   │    │ (Create) │    │  VIEWS   │  │
│  │  Earn)  │    │          │    │          │    │          │  │
│  └────┬─────┘    └────┬─────┘    └────┬─────┘    └────┬─────┘  │
│       │               │               │               │         │
│       ▼               ▼               ▼               ▼         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    WALLET SYSTEM                         │   │
│  │  User Earns ─────▶ Wallet ─────▶ Withdrawal Request      │   │
│  │                       │                                   │   │
│  │         ┌─────────────┴─────────────┐                    │   │
│  │         ▼                           ▼                    │   │
│  │  ┌────────────┐           ┌────────────┐               │   │
│  │  │ Ad Revenue │           │ Publisher   │               │   │
│  │  │   Pool     │           │   Pool      │               │   │
│  │  │  (70%)    │           │   (30%)    │               │   │
│  │  └────────────┘           └────────────┘               │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## 2. User Roles & Flows

### 2.1 User Roles

| Role | Description | Actions |
|------|-------------|---------|
| **Reader** | Consumes content, earns rewards | Read, view ads, withdraw |
| **Publisher** | Creates content, earns from views | Write, publish, withdraw, view stats |
| **Admin** | Platform management | Moderate content, manage payouts |

### 2.2 User Flows

#### Reader Flow
```
Register → Verify Email → Complete Profile
    │
    ▼
Read Article → View Ad (5-30 sec) → Earn Points
    │
    ▼
Accumulate Points → Request Withdrawal
    │
    ▼
Pending → Approved → Receive Payment
```

#### Publisher Flow
```
Register → Apply for Publisher Status → Get Approved
    │
    ▼
Write Article → Set Reward Rate → Publish
    │
    ▼
Readers View Content → Ad Plays → Revenue Generated
    │
    ▼
Check Earnings → Request Payout
```

## 3. Database Models

### 3.1 User Model
```javascript
{
  _id: ObjectId,
  email: String,              // unique, indexed
  passwordHash: String,
  role: Enum['reader', 'publisher', 'admin'],
  
  // Profile
  username: String,           // unique, for @mentions
  displayName: String,
  avatar: String,
  bio: String,
  country: String,            // For payment localization
  phone: String,              // For withdrawals
  
  // Rewards
  wallet: {
    balance: Number,          // Current withdrawable balance (in Naira/kobo)
    pendingBalance: Number,   // Awaiting verification
    lifetimeEarned: Number,   // Total ever earned
    lifetimeWithdrawn: Number
  },
  
  // Stats
  stats: {
    totalReads: Number,
    totalAdsViewed: Number,
    streak: Number,           // Consecutive days
    lastReadDate: Date
  },
  
  // Verification
  isEmailVerified: Boolean,
  isPhoneVerified: Boolean,
  
  // Payout
  payoutSettings: {
    method: Enum['bank', 'mpesa', 'airtime'],
    bankAccount: String,     // Encrypted
    mpesaNumber: String
  },
  
  // Security
  referralCode: String,       // For referral system
  referredBy: ObjectId,       // User who referred
  
  createdAt: Date,
  updatedAt: Date
}
```

### 3.2 Article Model
```javascript
{
  _id: ObjectId,
  slug: String,               // unique, URL-friendly
  
  // Publisher
  author: ObjectId,           // Ref: User
  
  // Content
  title: String,
  summary: String,            // 150-200 chars
  content: String,            // HTML/Markdown
  coverImage: String,
  category: String,           // e.g., 'tech', 'ai', 'business'
  tags: [String],
  
  // Reward Settings
  rewardSettings: {
    rewardPerRead: Number,    // Points per completed read
    adFrequency: Number,      // Show ad every N paragraphs
    isFree: Boolean,         // If true, no reward but free access
    premium: Boolean         // Paid content
  },
  
  // Stats
  stats: {
    views: Number,
    uniqueReads: Number,
    avgReadTime: Number,
    completionRate: Number,   // % who read to end
    adViews: Number
  },
  
  // Earnings
  earnings: {
    total: Number,           // Lifetime earnings from this article
    thisMonth: Number,
    pendingPayout: Number
  },
  
  // Status
  status: Enum['draft', 'pending', 'published', 'rejected', 'archived'],
  rejectionReason: String,
  publishedAt: Date,
  
  // SEO
  metaTitle: String,
  metaDescription: String,
  
  createdAt: Date,
  updatedAt: Date
}
```

### 3.3 Read Session Model
```javascript
{
  _id: ObjectId,
  
  // Who & What
  user: ObjectId,            // Ref: User
  post: ObjectId,            // Ref: Post
  
  // Session Data
  startedAt: Date,
  endedAt: Date,
  timeSpentSeconds: Number,   // seconds
  scrollProgress: Number,     // 0-100%
  completed: Boolean,        // Reached end of article
  
  // Reward
  rewardAwarded: Boolean,
  rewardAmount: Number,       // ₦5 per completed read
  
  createdAt: Date,
  updatedAt: Date
}
```

**Implementation Notes:**
- Minimum read time: 30 seconds
- Reward amount: ₦5 per completed article
- Reward is awarded when user scrolls to 90%+ of article

### 3.4 Wallet Transaction Model
```javascript
{
  _id: ObjectId,
  
  user: ObjectId,            // Ref: User
  
  type: Enum[
    'ad_reward',              // Earned from viewing ad
    'article_reward',         // Earned from reading article
    'referral_bonus',        // Bonus from referred user
    'streak_bonus',          // Daily streak reward
    'withdrawal',            // Money out
    'bonus',                 // Platform bonus
    'correction'             // Adjustments
  ],
  
  amount: Number,             // Positive = credit, negative = debit
  
  // Balance after this transaction
  balanceBefore: Number,
  balanceAfter: Number,
  
  // Details
  reference: String,          // External reference (for withdrawals)
  description: String,
  relatedRead: ObjectId,      // Ref: ReadSession (if applicable)
  
  // Status
  status: Enum['completed', 'pending', 'failed', 'reversed'],
  
  metadata: Object,           // Flexible data storage
  
  createdAt: Date
}
```

### 3.5 Withdrawal Request Model
```javascript
{
  _id: ObjectId,
  
  user: ObjectId,            // Ref: User
  
  amount: Number,            // Requested amount (in Naira)
  fee: Number,               // Platform fee deducted
  netAmount: Number,         // Amount user receives
  
  method: Enum['bank', 'mpesa', 'airtime'],
  
  // Payment Details (encrypted)
  paymentDetails: {
    bankName: String,
    accountNumber: String,
    accountName: String,
    // OR
    mpesaNumber: String
  },
  
  status: Enum['pending', 'processing', 'completed', 'failed', 'cancelled'],
  
  // Processing
  processedBy: ObjectId,     // Admin who processed
  processedAt: Date,
  failureReason: String,
  
  // External Reference
  externalReference: String, // From payment provider
  
  createdAt: Date,
  updatedAt: Date
}
```

### 3.6 Ad Impression Model
```javascript
{
  _id: ObjectId,
  
  // Ad Source
  adNetwork: String,         // 'google_adsense', 'custom', 'affiliate'
  adUnitId: String,
  adType: String,            // 'banner', 'video', 'native'
  
  // Context
  user: ObjectId,           // Ref: User (can be null for anonymous)
  article: ObjectId,         // Ref: Article
  readSession: ObjectId,     // Ref: ReadSession
  
  // Impression Data
  impression: {
    servedAt: Date,
    viewedAt: Date,          // When user actually saw it
    viewDuration: Number,     // Seconds viewed
    clicked: Boolean,
    clickedAt: Date
  },
  
  // Revenue
  revenue: {
    cpm: Number,             // Cost per 1000 impressions
    earned: Number,          // Platform earned from this impression
    publisherShare: Number,  // Amount to pay publisher
    userReward: Number       // Amount to reward user
  },
  
  // Fraud Check
  isValid: Boolean,
  invalidReason: String,
  
  createdAt: Date
}
```

### 3.7 Daily Stats Model (Aggregated)
```javascript
{
  _id: ObjectId,
  
  date: Date,                // Day this stat is for
  
  // User Stats
  users: {
    newRegistrations: Number,
    activeUsers: Number,    // Users who read at least 1 article
    totalReads: Number,
    totalAdViews: Number,
    totalWithdrawals: Number,
    withdrawalAmount: Number
  },
  
  // Revenue Stats
  revenue: {
    adRevenue: Number,
    platformEarnings: Number,
    publisherPayouts: Number,
    userPayouts: Number
  },
  
  // Top Content
  topArticles: [{
    article: ObjectId,
    reads: Number,
    earnings: Number
  }],
  
  createdAt: Date
}
```

## 4. API Endpoints

### 4.1 Authentication
```
POST   /api/auth/register          - Register new user
POST   /api/auth/login             - Login
POST   /api/auth/logout            - Logout
POST   /api/auth/verify-email      - Verify email
POST   /api/auth/forgot-password   - Request password reset
POST   /api/auth/reset-password    - Reset password
GET    /api/auth/me               - Get current user
```

### 4.2 User/Profile
```
GET    /api/users/:id             - Get user profile (public)
PATCH  /api/users/:id             - Update profile
GET    /api/users/:id/stats       - Get user stats
GET    /api/users/:id/articles    - Get user's articles (publisher)
GET    /api/users/:id/earnings    - Get user's earnings (publisher)
```

### 4.3 Wallet
```
GET    /api/wallet               - Get wallet balance & history
GET    /api/wallet/transactions  - Get transaction history
POST   /api/wallet/withdraw      - Request withdrawal
GET    /api/wallet/pending       - Get pending rewards
```

### 4.4 Articles
```
GET    /api/articles             - List articles (paginated, filterable)
GET    /api/articles/:slug      - Get single article
POST   /api/articles             - Create article (publisher)
PATCH  /api/articles/:id        - Update article (publisher)
DELETE /api/articles/:id        - Delete article (publisher)
POST   /api/articles/:id/publish - Publish article
```

### 4.5 Read Sessions
```
POST   /api/reads/start          - Start read session
POST   /api/reads/:id/heartbeat - Send heartbeat (user is still reading)
POST   /api/reads/:id/complete   - Complete read session
POST   /api/reads/:id/ad-viewed  - Report ad was viewed
```

### 4.6 Ads
```
GET    /api/ads/serve            - Get ad for article
POST   /api/ads/impression       - Report ad impression
POST   /api/ads/click            - Report ad click
```

### 4.7 Admin
```
GET    /api/admin/users          - List all users
PATCH  /api/admin/users/:id      - Update user (role, status)
GET    /api/admin/articles       - List all articles
PATCH  /api/admin/articles/:id   - Moderate article
GET    /api/admin/withdrawals    - List withdrawal requests
PATCH  /api/admin/withdrawals/:id - Process withdrawal
GET    /api/admin/stats          - Platform statistics
GET    /api/admin/stats/daily    - Daily statistics
```

### 4.8 Publisher Dashboard
```
GET    /api/publisher/dashboard  - Dashboard overview
GET    /api/publisher/articles   - List own articles
GET    /api/publisher/earnings   - Earnings breakdown
GET    /api/publisher/analytics  - Detailed analytics
POST   /api/publisher/payout    - Request payout
```

## 5. Reward Calculation Logic

### 5.1 Point System
```
1 Point = ₦1 (Naira) for withdrawal

Reading Reward = Base Rate × Completion Bonus × Streak Multiplier
Ad Reward = (Ad CPM / 1000) × View Duration Factor
```

### 5.2 Reward Formulas
```javascript
// Article Reading
readReward = article.rewardPerRead 
  * (session.scrollDepth >= 80 ? 1.2 : 1)          // Completion bonus
  * (user.streak >= 7 ? 1.5 : user.streak >= 3 ? 1.2 : 1)  // Streak bonus

// Ad Viewing (simplified)
adReward = (ad.cpm / 1000) * 0.7 * viewDurationFactor
// 70% of ad revenue goes to user pool

// Publisher Earnings
publisherShare = adRevenue * 0.30  // 30% of platform ad revenue
perArticle = publisherShare * (article.views / totalViews)
```

### 5.3 Withdrawal Tiers
```
Minimum Withdrawal: ₦1,000
Processing Time: 24-72 hours
Fee: ₦50 flat (for bank transfers)
```

## 6. Ad Integration

### 6.1 Ad Flow
```
User Loads Article
       │
       ▼
┌─────────────────┐
│ Show Header Ad  │
│ (Auto-load)    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Read Content    │◀──────────────┐
│  (3-5 mins)     │               │
└────────┬────────┘               │
         │                        │
         ▼                        │
┌─────────────────┐               │
│ Show Mid Ad     │               │
│ (After 3 paras) │               │
└────────┬────────┘               │
         │                        │
         ▼                        │
┌─────────────────┐               │
│ Continue to End  │───────────────┘
│                 │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Show Footer Ad  │
│ (End of article)│
└─────────────────┘
```

### 6.2 Ad Networks
```
Priority 1: Google AdSense (high fill rate)
Priority 2: Amazon Associates (affiliate)
Priority 3: Direct advertisers (highest RPM)
Priority 4: Nigerian ad networks (e.g., Edukey)
```

## 7. Fraud Prevention

### 7.1 Detection Methods
```javascript
// Behavioral Analysis
fraudScore = {
  // Too fast reading
  avgReadTime < 10 seconds: +30 points,
  
  // Same IP patterns
  sameIPDifferentAccounts: +50 points,
  
  // Impossible scroll speed
  scrollSpeed > 1000px/sec: +40 points,
  
  // Ad skip patterns
  consecutiveAdSkips > 3: +25 points,
  
  // Device fingerprint
  fingerprintMatch: +35 points,
  
  // Geographic anomaly
  vpnDetected: +40 points,
  
  // Time patterns
  alwaysReadAtSameTime: +10 points
}

// Threshold: Score > 100 = Flag for review
```

### 7.2 Prevention Measures
```
- Browser fingerprinting
- IP rate limiting per article
- Device binding (max 2 devices per account)
- Human verification (hCaptcha on suspicious activities)
- Delayed reward payout (48-hour hold for verification)
- Randomized reading verification (ask "did you finish this article?")
```

## 8. System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENTS                                   │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────────────┐   │
│  │   Web   │  │   PWA   │  │ Mobile  │  │  Admin Panel    │   │
│  │ (Next.js)│ │         │  │ (React  │  │                 │   │
│  │         │  │         │  │ Native) │  │                 │   │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────────┬────────┘   │
└───────┼───────────┼───────────┼─────────────────┼──────────────┘
        │           │           │                 │
        └───────────┴─────┬─────┴─────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                        API GATEWAY                               │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    Rate Limiter                          │    │
│  │                    CORS Handler                          │    │
│  │                    Auth Middleware                        │    │
│  │                    Request Logger                         │    │
│  └─────────────────────────────────────────────────────────┘    │
└────────────────────────────┬────────────────────────────────────┘
                             │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│  Auth Service │    │ Content Service│    │  Wallet Service│
│               │    │               │    │               │
│ - JWT tokens  │    │ - CRUD articles│    │ - Balance calc│
│ - Session mgmt│    │ - Read tracking│    │ - Transactions│
│ - Password    │    │ - Search       │    │ - Withdrawals │
└───────────────┘    └───────┬───────┘    └───────┬───────┘
                             │                     │
                             ▼                     ▼
                    ┌─────────────────┐    ┌───────────────┐
                    │    MongoDB      │    │    Redis      │
                    │  (Documents)    │    │ (Cache/Session│
                    └─────────────────┘    └───────────────┘
                            
                            
        ┌─────────────────────────────────────────────────┐
        │                  EXTERNAL SERVICES               │
        │  ┌──────────┐  ┌──────────┐  ┌──────────────┐ │
        │  │ AdSense  │  │  Paystack │  │   SendGrid   │ │
        │  │ API      │  │   API     │  │   (Email)    │ │
        │  └──────────┘  └──────────┘  └──────────────┘ │
        └─────────────────────────────────────────────────┘
```

## 9. Tech Stack

### Current (Keep)
```
- Backend: Node.js + Fastify
- Database: MongoDB (Mongoose)
- Cache: Redis
- Templates: EJS (can convert to React later)
- Styling: Tailwind CSS
- Queue: BullMQ + Redis
```

### For Scale Version
```
- Frontend: React/Next.js (for real-time features)
- API: Continue with Fastify or move to NestJS
- Database: MongoDB Atlas (or self-hosted)
- Cache: Redis (Upstash for serverless)
- Auth: NextAuth.js or Auth.js
- Payments: Paystack (Nigeria) + M-Pesa integration
- Ads: Google AdSense + custom ad management
- Hosting: Fly.io (current) or AWS/Vercel
```

## 10. Phased Implementation

### Phase 1: MVP (Current System + Core)
- [x] Content management (posts, categories)
- [ ] User authentication
- [ ] Basic wallet (earn, withdraw)
- [ ] Ad integration
- [ ] Publisher dashboard

### Phase 2: Rewards System
- [ ] Point calculation engine
- [ ] Ad impression tracking
- [ ] Read session validation
- [ ] Withdrawal processing

### Phase 3: Fraud Prevention
- [ ] Fingerprinting
- [ ] Behavioral analysis
- [ ] Rate limiting
- [ ] Admin moderation tools

### Phase 4: Polish & Scale
- [ ] Real-time notifications
- [ ] PWA support
- [ ] Mobile app
- [ ] Referral system
- [ ] Gamification (streaks, badges)

## 11. Security Considerations

```
Authentication:
- JWT with short expiry (15 min) + refresh tokens
- Password hashing: bcrypt (cost factor 12)
- Rate limiting: 5 attempts, then lockout
- 2FA for withdrawals (optional but recommended)

Data Protection:
- Encrypt PII (bank details) at rest
- TLS for all connections
- CORS restricted to known domains
- Input sanitization for XSS prevention

API Security:
- HMAC signatures for webhooks
- Request signing for mobile apps
- API key rotation

Compliance:
- GDPR: Data export/delete functionality
- NDPR: Consent management
- Ad policy compliance
```

## 12. Environment Variables Needed

```bash
# Database
MONGO_URI=mongodb://...

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Auth
JWT_SECRET=...
JWT_REFRESH_SECRET=...
SESSION_SECRET=...

# Payments
PAYSTACK_SECRET_KEY=...
PAYSTACK_WEBHOOK_SECRET=...
MPESA_CONSUMER_KEY=...
MPESA_CONSUMER_SECRET=...

# Ads
ADSENSE_PUBLISHER_ID=...
ADSENSE_AD_CLIENT=...

# Email
SENDGRID_API_KEY=...

# Platform
PLATFORM_FEE_PERCENT=30
MIN_WITHDRAWAL_AMOUNT=1000
WITHDRAWAL_FEE=50
```
