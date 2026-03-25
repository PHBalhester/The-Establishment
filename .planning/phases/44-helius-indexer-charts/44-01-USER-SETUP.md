# Phase 44 Plan 01: User Setup

**Service:** Helius Webhook + Postgres Database

## Environment Variables

Add these to `app/.env.local`:

```bash
# Postgres connection string
# Option A: Local Postgres (via Homebrew or Docker)
DATABASE_URL="postgres://user:password@localhost:5432/drfraudsworth"

# Option B: Railway Postgres (provisioned in Railway dashboard)
# DATABASE_URL will be auto-populated by Railway when you add a Postgres plugin

# Helius webhook auth secret (generated during webhook registration)
# Optional for local testing -- if unset, auth check is skipped
HELIUS_WEBHOOK_SECRET="Bearer your-random-secret-here"
```

## Setup Steps

### 1. Local Postgres Database

**Option A: Homebrew Postgres**
```bash
brew install postgresql@16
brew services start postgresql@16
createdb drfraudsworth
```

**Option B: Docker Postgres**
```bash
docker run --name drfraudsworth-db -e POSTGRES_PASSWORD=password -e POSTGRES_DB=drfraudsworth -p 5432:5432 -d postgres:16
```

Set `DATABASE_URL` accordingly:
- Homebrew: `postgres://$(whoami)@localhost:5432/drfraudsworth`
- Docker: `postgres://postgres:password@localhost:5432/drfraudsworth`

### 2. Generate and Run Migrations

Once DATABASE_URL is set:

```bash
cd app
npm run db:generate   # Generates SQL migration files from schema.ts
npm run db:migrate    # Applies migrations to the database
npm run db:studio     # (Optional) Browse tables in Drizzle Studio
```

### 3. Register Helius Webhook (after Railway deployment)

The webhook endpoint needs a public URL. Once deployed to Railway:

```bash
# Generate a random secret
WEBHOOK_SECRET=$(openssl rand -base64 32)
echo "Set HELIUS_WEBHOOK_SECRET=$WEBHOOK_SECRET in Railway env vars"

# Register webhook via Helius API (uses existing API key)
curl -X POST "https://api.helius.xyz/v0/webhooks?api-key=[REDACTED-DEVNET-HELIUS-KEY]" \
  -H "Content-Type: application/json" \
  -d '{
    "webhookURL": "https://your-app.up.railway.app/api/webhooks/helius",
    "webhookType": "rawDevnet",
    "accountAddresses": [
      "DRjNCjt4tfTisSJXD1VrAduKbgA7KHuGPoYwxrUQN8uj",
      "G6dmJTdC36VRqqi57QhWH444Ju7ieCzHZW9yhH7TpUhz"
    ],
    "authHeader": "'$WEBHOOK_SECRET'"
  }'
```

## Verification

```bash
# Check Postgres connection
cd app && npx drizzle-kit studio
# Should open Drizzle Studio showing 4 tables: swap_events, candles, epoch_events, carnage_events

# Test webhook locally (no auth)
curl -X POST http://localhost:3000/api/webhooks/helius \
  -H "Content-Type: application/json" \
  -d '[]'
# Should return: {"ok":true,"processed":{"transactions":0,"swaps":0,"epochs":0,"carnages":0}}
```
