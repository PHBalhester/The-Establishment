# Infrastructure Cost Analysis 2026

**Date:** February 20, 2026
**Purpose:** Comprehensive cost breakdown for Dr. Fraudsworth Solana DeFi protocol infrastructure

## Table of Contents

1. [Solana RPC Provider Comparison](#solana-rpc-provider-comparison)
2. [Usage Modeling](#usage-modeling)
3. [Other Infrastructure Costs](#other-infrastructure-costs)
4. [Total Cost Projections](#total-cost-projections)
5. [Recommendations](#recommendations)

---

## Solana RPC Provider Comparison

### 1. Helius (Current Provider)

**Free Tier:**
- **Credits:** 1M credits/month
- **Rate Limit:** 10 RPS
- **Webhooks:** 1 webhook included
- **DAS API:** ✅ Included (standard RPC calls = 1 credit each)
- **Features:** All core features included

**Paid Tiers:**
- **Developer:** $49/month
  - 10M credits/month
  - 50 RPS
  - Multiple webhooks
  - Enhanced WebSockets (metered at 3 credits per 0.1 MB for new users after Oct 2025)

- **Business:** Custom pricing
  - Enhanced WebSockets included
  - Higher RPS

- **Professional:** Custom pricing (likely $100-500+/month)
  - LaserStream access (3 credits per 0.1 MB)
  - Data Add-Ons (5TB-100TB data allowances)
  - Extra 100 RPS available for $100/month

**Credit Costs:**
- Standard RPC calls: 1 credit (getAccountInfo, getProgramAccounts, etc.)
- sendTransaction: 1 credit (included, no extra cost)
- Enhanced WebSockets: 3 credits per 0.1 MB
- LaserStream: 3 credits per 0.1 MB
- Sender (transaction routing to Jito + Helius): No credits, SOL tips only

**Solana-Specific Features:**
- ✅ DAS (Digital Asset Standard) API
- ✅ Webhooks (monitor up to 100k addresses per webhook)
- ✅ Priority fee estimation
- ✅ Staked connections (all paid plans)
- ✅ Transaction optimization via Sender

**Links:**
- [Helius Pricing](https://www.helius.dev/pricing)
- [Helius Plans Documentation](https://www.helius.dev/docs/billing/plans)

---

### 2. QuickNode

**Free Tier:**
- **Credits:** 1M credits/month
- **Rate Limit:** 10 RPS
- **DAS API:** ✅ Available as add-on (pricing not specified)
- **Webhooks:** Not specified for free tier

**Paid Tiers:**
- **Developer:** $49/month
  - 10M credits
  - 50 RPS

- **Business:** $499/month
  - 100M credits
  - 200 RPS

- **Professional:** $999/month
  - 200M credits
  - 500 RPS

- **Enterprise:** Custom pricing

**Credit System:**
- Plan tiers with flat usage rate for credits
- Credit-based billing per chain and method type
- WebSocket responses are metered

**Solana-Specific Features:**
- ✅ JSON-RPC methods
- ✅ WebSocket subscriptions
- ✅ Metaplex DAS API (add-on)
- ✅ Jito bundles (add-on)
- ✅ Priority Fee API (add-on)
- ✅ Jupiter V6 swap routing (add-on)
- ✅ Yellowstone gRPC (high-performance data pipelines)

**Links:**
- [QuickNode Pricing](https://www.quicknode.com/pricing)
- [QuickNode Solana Overview](https://www.quicknode.com/docs/solana)
- [Metaplex DAS API Add-on](https://marketplace.quicknode.com/add-on/metaplex-digital-asset-standard-api)

---

### 3. Alchemy

**Free Tier:**
- **Compute Units:** 30M CUs/month (roughly 1.8M simple RPC requests)
- **Rate Limit:** Not specified
- **DAS API:** ❌ Not confirmed for Solana
- **Webhooks:** Included (number not specified)

**Paid Tiers:**
- **Pay As You Go:** Usage-based
  - $0.45 per 1M CUs (up to 300M CUs/month)
  - $0.40 per 1M CUs (beyond 300M CUs/month)
  - More apps and webhooks included
  - Higher throughput

**Compute Unit Model:**
- Different RPC methods consume different CU amounts
- Simple reads may be 1 CU, complex queries higher
- Roughly 1.8M simple requests = 30M CUs (for estimation)

**Solana-Specific Features:**
- ✅ Standard Solana RPC methods
- ⚠️ DAS API not confirmed (contact Alchemy support)
- ✅ Webhooks
- ❌ Limited Solana-specific tooling compared to Helius/QuickNode

**Links:**
- [Alchemy Pricing](https://www.alchemy.com/pricing)
- [Alchemy Solana Platform](https://www.alchemy.com/solana)

---

### 4. Triton (RPC Pool)

**Pricing Model:**
- No public free tier advertised
- Dedicated or Hybrid plans (custom pricing)
- **Hybrid Plan:** Fastest Triton RPC for frontend + dedicated backend server geolocated near your data center

**Rate Limits:**
- Applied based on IP and other parameters
- HTTP 429 response when rate limit hit
- Check limits at: `https://<endpoint>.rpcpool.com/ratelimits`
- HTTP headers `X-Ratelimit-XYZ` provided in responses (shared pools)

**Solana-Specific Features:**
- ✅ Customizable shared or dedicated RPC pools
- ✅ Unlimited capacity to scale
- ✅ Geolocated backend servers for automated traffic
- ✅ High-performance infrastructure

**Use Case:**
- Best for high-volume production apps with custom requirements
- Likely overkill for early-stage projects

**Links:**
- [Triton Website](https://triton.one/)
- [Triton Rate Limits Documentation](https://docs.triton.one/rpc-pool/ratelimits)

---

### 5. Shyft

**Pricing Model:**
- **Dedicated Nodes:** Starting at $1,800/month
- Unlimited usage (no credit consumption)
- No overage charges
- Proxy with health tracking + automatic backup pool routing

**Features:**
- ✅ Best infrastructure without credit worries
- ✅ Dedicated nodes with proxy failover
- ✅ Can switch plans anytime (prorated billing via Stripe)
- ✅ Legacy "Old RPC Plans" still available

**Use Case:**
- Best for high-volume production apps with predictable costs
- Not cost-effective for early-stage projects (way too expensive)

**Links:**
- [Shyft RPC/gRPC Pricing](https://www.shyft.to/solana-rpc-grpc-pricing)
- [Shyft RPCs Documentation](https://docs.shyft.to/solana-rpcs-das-api/shyft-rpcs)

---

## RPC Provider Comparison Table

| Provider | Free Tier | Entry Paid Tier | DAS API | Webhooks | Priority Fees | Best For |
|----------|-----------|-----------------|---------|----------|---------------|----------|
| **Helius** | 1M credits, 10 RPS, 1 webhook | $49/mo (10M credits, 50 RPS) | ✅ Included | ✅ Yes (100k addresses) | ✅ Yes | Solana-native apps, DeFi protocols |
| **QuickNode** | 1M credits, 10 RPS | $49/mo (10M credits, 50 RPS) | ✅ Add-on | ✅ Available | ✅ Yes | Multi-chain apps, add-on ecosystem |
| **Alchemy** | 30M CUs (~1.8M calls) | $0.45/1M CUs | ⚠️ Unclear | ✅ Yes | ⚠️ Limited | General-purpose, multi-chain |
| **Triton** | ❌ None | Custom (Hybrid/Dedicated) | ❓ Unknown | ❓ Unknown | ✅ Yes | High-volume production |
| **Shyft** | ❌ None | $1,800/mo (dedicated) | ✅ Yes | ✅ Yes | ✅ Yes | Enterprise/high-volume |

---

## Usage Modeling

### Protocol Components

#### 1. Crank Bot (24/7 Background Worker)

**Per Epoch (~5 minutes / 750 slots):**
- State reads (epoch state, pool reserves, staking info): ~3 RPC calls = 3 credits
- Transactions (VRF crank, epoch advance, carnage triggers): ~4 TX sends = 4 credits
- Transaction confirmations: ~4 RPC calls = 4 credits
- Total per epoch: **~11 credits**

**Daily:**
- Epochs per day: 24 hours × 60 min/hour ÷ 5 min/epoch = **288 epochs/day**
- Credits per day: 288 × 11 = **3,168 credits/day**
- Credits per month: 3,168 × 30 = **95,040 credits/month**

#### 2. Frontend User Activity

**Assumptions per user session:**
- Page loads per session: 5
- RPC calls per page load: 8 (wallet balance, pool reserves, epoch state, staking info, token metadata, etc.)
- Transactions per session: 2 (swaps, stakes, unstakes)
- RPC calls per transaction: 3 (simulate, send, confirm)

**Credits per user session:**
- Page loads: 5 × 8 = 40 credits
- Transactions: 2 × 3 = 6 credits
- Total: **46 credits/session**

**Assuming 1 session per DAU:**

---

### Monthly RPC Usage by User Tier

| Metric | 10 DAU | 100 DAU | 1,000 DAU | 10,000 DAU |
|--------|--------|---------|-----------|------------|
| **Crank Bot** | 95,040 | 95,040 | 95,040 | 95,040 |
| **User Sessions/Month** | 300 | 3,000 | 30,000 | 300,000 |
| **User Credits** | 13,800 | 138,000 | 1,380,000 | 13,800,000 |
| **Total Credits** | 108,840 | 233,040 | 1,475,040 | 13,895,040 |
| **% of Helius Free Tier** | 11% | 23% | 148% | 1,390% |

---

### Cost Breakdown by User Tier

#### 10 DAU (Early Launch)
- **Total Credits:** 108,840/month
- **Helius Plan:** ✅ Free tier (1M credits) - fits comfortably
- **Cost:** $0/month

#### 100 DAU (Growing)
- **Total Credits:** 233,040/month
- **Helius Plan:** ✅ Free tier (1M credits) - still fits
- **Cost:** $0/month

#### 1,000 DAU (Significant Traction)
- **Total Credits:** 1,475,040/month
- **Helius Plan:** ⚠️ Free tier exceeded
- **Recommended Plan:** Developer ($49/month, 10M credits)
- **Cost:** $49/month

#### 10,000 DAU (Major Success)
- **Total Credits:** 13,895,040/month
- **Helius Plan:** ⚠️ Developer tier exceeded
- **Recommended Plan:** Business or Professional (custom pricing, likely $200-500/month)
- **Cost:** ~$200-500/month (estimate)

---

## Other Infrastructure Costs

### Railway (Next.js App + Background Worker)

**Pricing Model:**
- Usage-based billing
- Credits included with plan ($5 Hobby, $20 Pro)
- Charges based on actual resource consumption (CPU, memory, network)

**Typical Costs:**
- **Small Node.js app:** $2-5/month
- **Next.js app (low traffic):** $5-10/month
- **Next.js app (moderate traffic) + background worker:** $10-20/month
- **High-traffic app:** $20-50+/month

**Plans:**
- **Hobby:** $5/month (includes $5 credit)
- **Pro:** $20/month (includes $20 credit)

**For Dr. Fraudsworth:**
- Next.js frontend + crank bot worker
- Low to moderate traffic initially
- **Estimated cost:** $5-15/month (early stage), $15-30/month (1,000 DAU), $30-60/month (10,000 DAU)

**Links:**
- [Railway Pricing](https://railway.com/pricing)
- [Railway Pricing Documentation](https://docs.railway.com/reference/pricing/plans)

---

### PostgreSQL (Drizzle ORM)

**Railway PostgreSQL:**
- Included in Railway usage-based billing
- Pay for actual resource usage (memory, CPU, storage)
- **Small database (low traffic):** ~$0.50-1/month
- **Medium database (moderate traffic):** ~$2-5/month
- **High database (high traffic):** $10-20+/month

**For Dr. Fraudsworth:**
- Likely storing user preferences, transaction history, analytics
- **Estimated cost:** $1-3/month (early stage), $3-8/month (1,000 DAU), $8-20/month (10,000 DAU)

**Alternative:**
- Could use external managed PostgreSQL (Supabase, Neon) if Railway becomes expensive
- Neon free tier: 0.5 GB storage, 512 MB RAM (likely sufficient for early stage)

**Links:**
- [Railway PostgreSQL Pricing](https://www.oploy.eu/blog/postgresql-railway/)

---

### Sentry (Error Monitoring)

**Free Tier:**
- **Events:** 5,000 errors/month
- **Users:** 1 user
- **Data Retention:** 30 days
- **Free forever**

**Paid Tiers:**
- **Team:** $26/month
  - 50,000 errors/month
  - Multiple users
  - Advanced features

- **Business:** $80/month
  - 50,000 errors/month
  - Business features (uptime monitoring, etc.)

**Overage Pricing:**
- $0.000290 per error event beyond quota

**For Dr. Fraudsworth:**
- Free tier should be sufficient for early stage (5k errors/month)
- Upgrade to Team if error volume exceeds 5k/month
- **Estimated cost:** $0/month (early stage), $26/month if needed

**Links:**
- [Sentry Pricing](https://sentry.io/pricing/)
- [Sentry Pricing Documentation](https://docs.sentry.io/pricing/)

---

### Domain Name

**Typical Costs:**
- **.com domain:** $10-20/year
  - Registration: ~$7.79
  - Renewal: ~$9.69-12/year

- **.io domain:** $40-60/year
  - Registration: ~$41.27
  - Renewal: ~$56.87/year

**For Dr. Fraudsworth:**
- Likely .com or .io domain
- **Estimated cost:** $10-20/year (.com) or $40-60/year (.io)

**Note:** Watch for renewal pricing (often higher than initial registration)

**Links:**
- [Domain Name Cost Guide](https://www.shopify.com/blog/domain-price)
- [Namecheap Domain Pricing](https://www.namecheap.com/domains/)

---

### Helius Webhooks

**Included in RPC Plans:**
- Free tier: 1 webhook
- Developer/Business/Professional: Multiple webhooks
- Can monitor up to 100,000 addresses per webhook

**No Extra Cost:**
- Webhooks are included in your Helius plan
- No additional charge beyond standard RPC credits

**For Dr. Fraudsworth:**
- Could use webhooks to monitor:
  - Pool state changes
  - Token transfers
  - Staking events
  - Carnage triggers
- **Estimated cost:** $0 (included in RPC plan)

**Links:**
- [Helius Webhooks](https://www.helius.dev/solana-webhooks-websockets)
- [Helius Plans](https://www.helius.dev/docs/billing/plans)

---

## Total Cost Projections

### Cost Summary Table

| Component | 10 DAU | 100 DAU | 1,000 DAU | 10,000 DAU |
|-----------|--------|---------|-----------|------------|
| **Helius RPC** | $0 | $0 | $49 | $200-500 |
| **Railway (App + Worker)** | $5-10 | $8-15 | $15-30 | $30-60 |
| **PostgreSQL** | $1-3 | $1-3 | $3-8 | $8-20 |
| **Sentry** | $0 | $0 | $0-26 | $26 |
| **Domain** | $1-2 | $1-2 | $1-2 | $1-2 |
| **Total/Month** | **$7-15** | **$10-20** | **$68-115** | **$265-608** |
| **Total/Year** | **$84-180** | **$120-240** | **$816-1,380** | **$3,180-7,296** |

---

### Milestone-Based Upgrade Path

| Milestone | Monthly Cost | Trigger | Infrastructure Changes |
|-----------|--------------|---------|------------------------|
| **Launch (0-100 DAU)** | $7-20 | Initial deployment | Helius free tier, Railway Hobby, Sentry free |
| **Growing (100-1,000 DAU)** | $10-50 | ~200-300 DAU or 1M credits exceeded | Consider upgrading Railway to Pro ($20/mo) |
| **Traction (1,000-5,000 DAU)** | $68-200 | ~1M RPC credits/month exceeded | Upgrade Helius to Developer ($49/mo) |
| **Success (5,000-10,000 DAU)** | $150-400 | ~10M RPC credits/month exceeded | Upgrade Helius to Business/Professional |
| **Major Success (10,000+ DAU)** | $265-608+ | ~10k DAU or error volume exceeds 5k/mo | Consider Sentry Team, scale Railway resources |

---

## Recommendations

### Starting Configuration (0-500 DAU)

**RPC Provider:** Helius Free Tier
- 1M credits/month covers crank bot (95k) + 500 DAU (23k credits) comfortably
- Full DAS API access
- 1 webhook included
- Solana-native features (priority fees, transaction optimization)

**Hosting:** Railway Hobby ($5/month)
- Next.js frontend + background crank worker
- PostgreSQL included
- Should handle low traffic with $5 credit

**Error Monitoring:** Sentry Free Tier
- 5,000 errors/month sufficient for early stage
- Custom integration (no npm packages due to Turbopack issues - see MEMORY.md)

**Domain:** .com ($10-20/year)
- Lower cost, professional
- Save .io for potential rebrand/upgrade

**Total Starting Cost:** $7-15/month ($84-180/year)

---

### Upgrade Triggers

#### Trigger 1: ~200-300 DAU
- **Symptom:** Railway approaching credit limit or performance degradation
- **Action:** Upgrade Railway to Pro ($20/month)
- **New cost:** $22-25/month

#### Trigger 2: ~400-600 DAU
- **Symptom:** Helius approaching 1M credits/month (RPC rate limiting or credit warnings)
- **Action:** Upgrade Helius to Developer ($49/month, 10M credits)
- **New cost:** $68-100/month

#### Trigger 3: ~5,000-8,000 DAU
- **Symptom:** Helius approaching 10M credits/month
- **Action:** Upgrade Helius to Business/Professional (custom pricing, ~$200-500/month)
- **New cost:** $265-600/month

#### Trigger 4: Error volume exceeds 5,000/month
- **Symptom:** Sentry free tier exceeded, errors dropped
- **Action:** Upgrade Sentry to Team ($26/month, 50k errors)
- **New cost:** +$26/month

---

### Single Provider vs. Split Strategy

**Recommended: Single Provider (Helius) for RPC**

**Reasons:**
1. **Simplicity:** One dashboard, one bill, one integration
2. **Cost efficiency:** Free tier covers both crank bot AND frontend traffic initially
3. **Solana-native:** Best DAS API, webhooks, priority fees out of the box
4. **Monitoring:** Easier to track total RPC usage in one place
5. **Support:** Single point of contact for issues

**When to consider splitting:**
- If crank bot consumes too many credits (dedicate Helius to users, use cheaper provider for bot)
- If you need QuickNode-specific add-ons (Jito bundles, Yellowstone gRPC)
- If you hit rate limits on shared endpoint (move crank bot to dedicated endpoint)

**Not recommended:**
- Splitting prematurely adds complexity without cost savings at small scale
- Free tiers from multiple providers don't help if you need to pay for one anyway

---

### Cost Optimization Tips

1. **RPC Call Batching:**
   - Batch multiple `getAccountInfo` calls into `getMultipleAccounts`
   - Reduces credits from N calls to 1 call

2. **Caching:**
   - Cache pool reserves, epoch state on frontend (refresh every 30s instead of per page load)
   - Reduces RPC calls by 50-70%

3. **WebSocket Subscriptions:**
   - Use WebSocket subscriptions for real-time data instead of polling
   - Helius Enhanced WebSockets on Business+ plan (metered)

4. **Railway Optimization:**
   - Set appropriate resource limits (don't over-provision)
   - Use sleep mode for low-traffic services (Railway auto-sleeps inactive services)
   - Monitor Railway usage dashboard to right-size resources

5. **Sentry Optimization:**
   - Filter out noisy errors (network timeouts, expected errors)
   - Sample at lower rates if error volume is high
   - Use release tracking to batch errors by version

6. **DNS/Domain:**
   - Use Cloudflare for free DNS (faster than registrar DNS)
   - Consider Cloudflare CDN for static assets (Railway has CDN built-in though)

---

### Alternative Providers (If Costs Escalate)

**If Helius becomes too expensive at scale:**

1. **QuickNode Business ($499/month for 100M credits)**
   - More credits per dollar at high volume
   - Strong add-on ecosystem
   - Multi-chain support if you expand

2. **Triton Hybrid**
   - Custom pricing for dedicated + shared hybrid
   - Best for 10,000+ DAU with high RPC volume
   - Dedicated backend for crank bot, shared for frontend

3. **Self-hosted RPC (Advanced)**
   - Run your own Solana validator + RPC node
   - High upfront cost ($500-2000/month server + devops time)
   - Only makes sense at 50,000+ DAU or $1,000+/month RPC costs

**If Railway becomes too expensive:**

1. **Vercel (Free tier for hobby projects)**
   - Free for Next.js frontend (bandwidth limits apply)
   - Would need separate hosting for crank bot worker

2. **Fly.io**
   - Similar pricing to Railway
   - Good for background workers

3. **AWS/GCP/Azure**
   - Much cheaper at scale (EC2, Cloud Run, etc.)
   - Requires significant devops expertise
   - Overkill for <10,000 DAU

---

## Key Takeaways

1. **Start cheap:** $7-15/month covers you for 0-500 DAU
2. **Scale gradually:** Upgrade when you hit 80% of tier limits, not before
3. **Helius is ideal for Solana DeFi:** DAS API, webhooks, Solana-native features
4. **Railway is cost-effective:** Usage-based billing means you only pay for what you use
5. **Monitor usage:** Set up alerts in Helius/Railway dashboards to avoid surprise overages
6. **Free tiers are generous:** You can run a functional DeFi protocol for <$20/month initially
7. **Scale is expensive:** 10,000 DAU could cost $265-608/month, but revenue should justify it by then

---

## Monitoring & Alerts

### Helius Dashboard
- Set alert at 80% of credit limit (800k for free tier, 8M for Developer)
- Monitor credit consumption trends weekly
- Track which endpoints consume most credits (optimize those first)

### Railway Dashboard
- Set budget alert at $15/month (Hobby), $35/month (Pro)
- Monitor memory/CPU usage trends
- Identify which service consumes most resources

### Sentry Dashboard
- Set alert at 4,000 errors/month (80% of free tier)
- Review top errors weekly to fix root causes
- Filter out noisy errors to stay under limit

---

## Appendix: Research Sources

### Solana RPC Providers
- [Helius Pricing](https://www.helius.dev/pricing)
- [Helius Plans and Pricing Documentation](https://www.helius.dev/docs/billing/plans)
- [Helius RPC Provider Overview 2026](https://chainstack.com/helius-rpc-provider-a-practical-overview/)
- [QuickNode Pricing](https://www.quicknode.com/pricing)
- [QuickNode Solana Documentation](https://www.quicknode.com/docs/solana)
- [Alchemy Pricing](https://www.alchemy.com/pricing)
- [Alchemy Pricing Plans Documentation](https://www.alchemy.com/docs/reference/pricing-plans)
- [Triton Rate Limits](https://docs.triton.one/rpc-pool/ratelimits)
- [Shyft RPC/gRPC Pricing](https://www.shyft.to/solana-rpc-grpc-pricing)
- [Complete Guide to Solana RPC Providers 2026](https://sanctum.so/blog/complete-guide-solana-rpc-providers-2026)

### Infrastructure Hosting
- [Railway Pricing](https://railway.com/pricing)
- [Railway Pricing Documentation](https://docs.railway.com/reference/pricing/plans)
- [Railway PostgreSQL Pricing](https://www.oploy.eu/blog/postgresql-railway/)
- [Railway vs Render 2026](https://northflank.com/blog/railway-vs-render)

### Error Monitoring
- [Sentry Pricing](https://sentry.io/pricing/)
- [Sentry Pricing Documentation](https://docs.sentry.io/pricing/)
- [Understanding Sentry Pricing](https://signoz.io/guides/sentry-pricing/)

### Domain Registration
- [Domain Name Cost Guide](https://www.shopify.com/blog/domain-price)
- [How Much Does a Domain Name Cost 2026](https://elementor.com/blog/how-much-does-a-domain-name-cost/)

### Solana DeFi Usage Data
- [Best Solana RPC Providers 2026](https://learn.backpack.exchange/articles/best-solana-rpc-providers)
- [10 Best Solana RPC for DApp Development 2026](https://www.cherryservers.com/blog/solana-rpc-for-dapp-development)
- [Solana Credits and Rate Limits](https://docs.solanatracker.io/solana-rpc/credits-and-rate-limits)

---

**Document Version:** 1.0
**Last Updated:** February 20, 2026
**Author:** Research compiled from public sources (see Appendix)
