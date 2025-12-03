# Environment Variables Configuration

Copy the relevant sections below to create `.env` files for each service.

---

## Database (All Services)

```bash
DATABASE_URL="postgresql://user:password@localhost:5432/gitterm"
```

**Required by:** server, listener, proxy, worker

---

## Authentication (Better Auth)

```bash
# Secret for signing auth tokens (generate with: openssl rand -base64 32)
BETTER_AUTH_SECRET="your-auth-secret-here"

# Base domain for cross-subdomain cookies
BASE_DOMAIN="gitterm.dev"
```

**Required by:** server, listener, proxy

---

## Internal API Authentication

```bash
# API key for service-to-service communication (generate with: openssl rand -hex 32)
INTERNAL_API_KEY="your-internal-api-key-here"
```

**Required by:** server, proxy, worker

---

## Frontend URLs (Next.js Web App)

```bash
# Public-facing API server URL
NEXT_PUBLIC_SERVER_URL="https://api.gitterm.dev"

# Listener service URL for real-time events
NEXT_PUBLIC_LISTENER_URL="https://listener.gitterm.dev"
```

**Required by:** web

---

## Internal Service URLs

```bash
# Server URL for internal communication (Railway private networking)
SERVER_URL="http://server.railway.internal:3002"
```

**Required by:** proxy, worker

---

## Railway Configuration

```bash
# Railway API token (from Railway dashboard)
RAILWAY_API_TOKEN="your-railway-token-here"

# Railway API endpoint
RAILWAY_API_URL="https://backboard.railway.app/graphql/v2"

# Railway project ID where workspaces are deployed
RAILWAY_PROJECT_ID="your-project-id"

# Railway environment ID (usually production environment)
RAILWAY_ENVIRONMENT_ID="your-environment-id"
```

**Required by:** server

---

## Optional Configuration

```bash
# CORS origin for production (defaults to BASE_DOMAIN)
CORS_ORIGIN="https://gitterm.dev"

# Node environment
NODE_ENV="development"

# Enable debug logging
DEBUG="true"

# Service ports (have defaults, usually not needed)
# PORT=3002  # server
# PORT=3001  # listener  
# PORT=3000  # proxy
# PORT=3003  # worker
```

---

## Per-Service Environment Variable Matrix

| Variable | server | listener | proxy | worker | web |
|----------|--------|----------|-------|--------|-----|
| DATABASE_URL | ✅ | ✅ | ✅ | ✅ | ❌ |
| BETTER_AUTH_SECRET | ✅ | ❌ | ✅ | ❌ | ❌ |
| BASE_DOMAIN | ✅ | ✅ | ✅ | ❌ | ❌ |
| INTERNAL_API_KEY | ✅ | ❌ | ✅ | ✅ | ❌ |
| SERVER_URL | ❌ | ❌ | ✅ | ✅ | ❌ |
| RAILWAY_API_TOKEN | ✅ | ❌ | ❌ | ❌ | ❌ |
| RAILWAY_API_URL | ✅ | ❌ | ❌ | ❌ | ❌ |
| RAILWAY_PROJECT_ID | ✅ | ❌ | ❌ | ❌ | ❌ |
| RAILWAY_ENVIRONMENT_ID | ✅ | ❌ | ❌ | ❌ | ❌ |
| NEXT_PUBLIC_SERVER_URL | ❌ | ❌ | ❌ | ❌ | ✅ |
| NEXT_PUBLIC_LISTENER_URL | ❌ | ❌ | ❌ | ❌ | ✅ |
| CORS_ORIGIN | ❌ | Optional | ❌ | ❌ | ❌ |

---

## Quick Setup Templates

### Local Development `.env`

```bash
# Database
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/gitterm"

# Auth
BETTER_AUTH_SECRET="local-dev-secret-change-in-production"
BASE_DOMAIN="localhost"

# Internal
INTERNAL_API_KEY="local-dev-internal-key"
SERVER_URL="http://localhost:3002"

# Railway (get from Railway dashboard)
RAILWAY_API_TOKEN="your-railway-token"
RAILWAY_API_URL="https://backboard.railway.app/graphql/v2"
RAILWAY_PROJECT_ID="your-project-id"
RAILWAY_ENVIRONMENT_ID="your-env-id"

# Frontend
NEXT_PUBLIC_SERVER_URL="http://localhost:3002"
NEXT_PUBLIC_LISTENER_URL="http://localhost:3001"

# Dev settings
NODE_ENV="development"
DEBUG="true"
```

### Production Railway Environment Variables

Set these in each Railway service:

**Server:**
- DATABASE_URL (from Railway Postgres plugin)
- BETTER_AUTH_SECRET
- BASE_DOMAIN=gitterm.dev
- INTERNAL_API_KEY
- RAILWAY_API_TOKEN
- RAILWAY_API_URL
- RAILWAY_PROJECT_ID
- RAILWAY_ENVIRONMENT_ID
- NODE_ENV=production

**Listener:**
- DATABASE_URL
- BASE_DOMAIN=gitterm.dev

**Proxy:**
- DATABASE_URL
- BETTER_AUTH_SECRET
- BASE_DOMAIN=gitterm.dev
- INTERNAL_API_KEY
- SERVER_URL=http://server.railway.internal:3002

**Worker (both idle-reaper and daily-reset):**
- DATABASE_URL
- INTERNAL_API_KEY
- SERVER_URL=http://server.railway.internal:3002

**Web:**
- NEXT_PUBLIC_SERVER_URL=https://api.gitterm.dev
- NEXT_PUBLIC_LISTENER_URL=https://listener.gitterm.dev

---

## Security Notes

1. **Never commit `.env` files to git**
2. **Generate strong secrets:**
   ```bash
   # For BETTER_AUTH_SECRET
   openssl rand -base64 32
   
   # For INTERNAL_API_KEY
   openssl rand -hex 32
   ```
3. **Rotate keys regularly** in production
4. **Use Railway's secret management** for sensitive values

