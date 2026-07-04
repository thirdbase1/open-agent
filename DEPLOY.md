# open-agent — Vercel Docker Deployment Guide

> **Purpose**: This document is a complete, self-contained guide that any
> AI agent or human can follow to deploy the open-agent repository to Vercel
> using Docker container deployment. It covers the current Vercel Services
> API (Beta, updated June 2026), multi-service architecture, env vars,
> storage migration, and post-deploy configuration.
>
> **Last verified**: July 2026 against official Vercel docs at
> https://vercel.com/docs/services and https://vercel.com/kb/guide/docker

---

## Architecture Overview

open-agent is a Node/TypeScript monorepo (fork of AFFiNE) with:
- **Backend**: NestJS server (packages/backend/server) with Rust native modules
- **Frontend**: React + rspack (packages/frontend/app)
- **Database**: PostgreSQL with Prisma ORM (requires pgvector extension)
- **Queue**: BullMQ with Redis
- **Storage**: S3 / R2 for file uploads
- **AI**: Multiple providers via Vercel AI Gateway

The backend and frontend are built together into a single Docker image that
serves both the API and static frontend assets from one port.

---

## Phase 1 — Single-Service Docker Deployment (CURRENT)

### How it works

Vercel detects `Dockerfile.vercel` at the project root, builds it as an OCI
container image, stores it in Vercel Container Registry (VCR), and serves it
as an autoscaling Vercel Function on Fluid Compute. The function scales to
zero when idle, and you're billed only for active CPU usage.

### Key files

1. **Dockerfile.vercel** — Multi-stage build:
   - Stage 1 (`rust-builder`): Builds Rust native modules for the target arch
   - Stage 2 (`builder`): Installs yarn deps, builds frontend (rspack) + backend (NestJS)
   - Stage 3 (`merge`): Combines backend dist + frontend static + node_modules
   - Stage 4 (`production`): Slim runtime with openssl + jemalloc, maps `$PORT`

2. **vercel.json** — Vercel Services configuration:
   ```json
   {
     "services": {
       "server": {
         "root": ".",
         "runtime": "container"
       }
     },
     "rewrites": [
       { "source": "/(.*)", "destination": { "service": "server" } }
     ]
   }
   ```
   - `runtime: "container"` tells Vercel to build this service as a Docker image
   - The rewrite routes ALL public traffic to the `server` service
   - Without the rewrite, the service is internal-only (no public access)

3. **.dockerignore** — Excludes node_modules, .git, test files, etc.
   - IMPORTANT: `blocksuite/` and `tools/` must NOT be excluded (they're
     yarn workspace roots that other packages depend on)
   - `Cargo.lock` must NOT be excluded (needed for Rust build reproducibility)

4. **packages/backend/server/.env.vercel** — Complete env var reference

### Deployment steps

#### Step 1: Create Vercel infrastructure add-ons

In your Vercel project dashboard, go to Storage → Add:

1. **Upstash Redis** (Vercel Marketplace)
   - Creates `REDIS_URL` env var automatically (rediss:// format)
   - The app auto-detects `REDIS_URL`, `UPSTASH_REDIS_URL`, or `KV_URL`
   - TLS is enabled automatically when protocol is `rediss://`
   - Key-prefix isolation replaces database index selection (Upstash = db 0 only)

2. **Aurora PostgreSQL** (Vercel AWS Marketplace) OR **Neon** OR **Supabase**
   - Creates `DATABASE_URL` env var automatically
   - For Aurora: `DIRECT_URL` must be set to the same value (no separate pooler)
   - For Supabase: `DATABASE_URL` = pooled connection (port 6543),
     `DIRECT_URL` = direct connection (port 5432)
   - Run `CREATE EXTENSION vector;` on the database before first deploy
     (the Prisma schema requires pgvector)

3. **S3 Bucket** (via AWS, or use Vercel Blob as alternative)
   - Create an S3 bucket in your AWS account
   - Set the 4 S3 env vars manually (see env var list below)

#### Step 2: Set environment variables

In Vercel project settings → Environment Variables, set these for
Production AND Preview environments:

**[REQUIRED — app won't start without these]**
```
DATABASE_URL          = postgresql://user:pass@host:port/dbname
DIRECT_URL            = postgresql://user:pass@host:port/dbname
REDIS_URL             = rediss://default:pass@cluster.upstash.io:6379
AWS_S3_ACCESS_KEY_ID  = your-aws-access-key
AWS_S3_SECRET_ACCESS_KEY = your-aws-secret-key
AWS_S3_BUCKET         = open-agent-storage
AWS_S3_REGION         = us-east-1
OPEN_AGENT_PRIVATE_KEY = <generate with: openssl rand -base64 32>
```

**[OPTIONAL — can add later via admin API or env vars]**
```
# AI providers (gateway auth is automatic on Vercel via VERCEL_OIDC_TOKEN)
OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY,
PERPLEXITY_API_KEY, MORPH_API_KEY

# Copilot tools
UNSPLASH_ACCESS_KEY, PARALLEL_API_KEY, FIRECRAWL_API_KEY, AGENT_BROWSER_COMMAND

# OAuth social login
OAUTH_GOOGLE_CLIENT_ID, OAUTH_GOOGLE_CLIENT_SECRET,
OAUTH_GITHUB_CLIENT_ID, OAUTH_GITHUB_CLIENT_SECRET,
OAUTH_OIDC_CLIENT_ID, OAUTH_OIDC_CLIENT_SECRET, OAUTH_OIDC_ISSUER

# Email SMTP
MAILER_HOST, MAILER_PORT, MAILER_USER, MAILER_PASSWORD, MAILER_SENDER, MAILER_IGNORE_TLS

# Server (usually auto-detected on Vercel)
OPEN_AGENT_SERVER_EXTERNAL_URL, OPEN_AGENT_SERVER_HOST,
OPEN_AGENT_SERVER_HTTPS, OPEN_AGENT_SERVER_PORT, OPEN_AGENT_SERVER_SUB_PATH
```

**[VERCEL-AUTO — do NOT set these manually]**
```
PORT              — injected by Vercel, Dockerfile maps to OPEN_AGENT_SERVER_PORT
VERCEL_OIDC_TOKEN — used for AI Gateway authentication automatically
NODE_ENV          — set to "production" by Vercel
```

See `packages/backend/server/.env.vercel` for the complete annotated list.

#### Step 3: Import the repository

1. Go to https://vercel.com/new
2. Import the GitHub repository (thirdbase1/open-agent)
3. Vercel auto-detects `Dockerfile.vercel` and `vercel.json`
4. Framework preset should show "Other" (Docker container)
5. Root directory: leave as `.` (repo root)
6. Build Command: leave empty (Dockerfile handles the build)
7. Output Directory: leave empty (Dockerfile serves everything)

#### Step 4: Deploy

Click Deploy. The first build will:
- Build Rust native modules (~3-5 min)
- Install yarn dependencies (~2-3 min)
- Build frontend with rspack (~1-2 min)
- Build backend with NestJS (~30 sec)
- Package the production image (~30 sec)

Total first build: ~10-15 minutes. Subsequent builds use Docker layer caching.

#### Step 5: Run database migrations

After the first successful deploy, run Prisma migrations:

Option A — Via Vercel CLI:
```bash
vercel env pull .env.local
npx prisma migrate deploy --schema packages/backend/server/schema.prisma
```

Option B — Via the app's predeploy script (if configured):
The Dockerfile's CMD runs `node dist/main.mjs` which handles startup.
For migrations, the app has a `predeploy` script flavor:
```bash
SERVER_FLAVOR=script yarn workspace @afk/server predeploy
```

#### Step 6: Configure OAuth redirect URLs

After deploy, update your OAuth provider settings with the Vercel URL:

- Google: https://console.cloud.google.com/apis/credentials
  - Authorized redirect: `https://your-app.vercel.app/api/oauth/callback/google`
- GitHub: https://github.com/settings/developers
  - Authorization callback: `https://your-app.vercel.app/api/oauth/callback/github`

#### Step 7: Set server external URL

Set `OPEN_AGENT_SERVER_EXTERNAL_URL` to your Vercel domain:
```
OPEN_AGENT_SERVER_EXTERNAL_URL = https://your-app.vercel.app
OPEN_AGENT_SERVER_HOST = your-app.vercel.app
OPEN_AGENT_SERVER_HTTPS = true
```

---

## Phase 2 — Multi-Service Split (FUTURE, not yet implemented)

Vercel Services allows deploying multiple backends and frontends in a single
project with shared routing, env vars, and a unique domain.

### When to split

The current single-service setup works but bundles frontend + backend in one
container. Splitting into two services allows:
- Independent scaling (frontend = static CDN, backend = Fluid Compute)
- Faster builds (frontend build is separate from backend)
- Different runtime configs per service

### How to split (reference only — do not attempt yet)

```json
{
  "services": {
    "frontend": {
      "root": "packages/frontend/app/",
      "framework": null,
      "buildCommand": "yarn workspace @afk/app build",
      "outputDirectory": "dist"
    },
    "backend": {
      "root": ".",
      "runtime": "container",
      "entrypoint": "Dockerfile.vercel"
    }
  },
  "rewrites": [
    { "source": "/api/(.*)", "destination": { "service": "backend" } },
    { "source": "/(.*)", "destination": { "service": "frontend" } }
  ]
}
```

### Service bindings (internal communication)

If the frontend needs to call the backend internally (without going through
public internet), declare a service binding:

```json
{
  "services": {
    "frontend": {
      "root": "packages/frontend/app/",
      "bindings": [
        { "type": "service", "service": "backend", "format": "url", "env": "BACKEND_URL" }
      ]
    },
    "backend": {
      "root": ".",
      "runtime": "container"
    }
  }
}
```

The binding injects `BACKEND_URL` as an env var into the frontend service.
Frontend code reads it: `fetch(process.env.BACKEND_URL + '/api/health')`

### Why Phase 2 is on hold

The monorepo's build system (yarn workspaces + rspack + Rust native modules)
makes it complex to split the Docker build context per service. The frontend
build depends on workspace packages from `blocksuite/` and `tools/` which
live at the repo root. A separate frontend Dockerfile would need to copy
the entire repo anyway, negating the build-time savings. This should be
revisited after the monorepo is restructured or when Vercel adds better
monorepo support for container services.

---

## Vercel Docker behavior reference

| Behavior | What to expect |
|----------|----------------|
| Port resolution | Container serves on port 80 by default; override with `$PORT` env var (Dockerfile maps to `OPEN_AGENT_SERVER_PORT`) |
| Scale-in | No traffic for 5 min (production) / 30 sec (preview) → scale down. SIGTERM with 30s grace period. |
| Observability | stdout/stderr logs broadcast to inflight requests. Vercel Observability metrics work normally. |
| Pricing | Active CPU pricing model — billed only when code is actively executing. Scales to zero when idle. |
| VERCEL_OIDC_TOKEN | Automatically injected at runtime. Used for AI Gateway auth, Container Registry auth, and service bindings. |

---

## Troubleshooting

### Build fails: "Cannot find module @blocksuite/affine"
The `.dockerignore` is excluding `blocksuite/`. Remove it from `.dockerignore`
— `blocksuite/` is a yarn workspace root that other packages depend on.

### Build fails: "Cannot find module @afk-tools/cli"
Same issue — `tools/` is excluded from `.dockerignore`. Remove the exclusion.

### Build fails: Rust compilation error
Ensure `Cargo.lock` is NOT excluded in `.dockerignore`. It's needed for
reproducible Rust builds. The `rust-toolchain.toml` file pins the Rust version.

### Runtime: "Database connection failed"
Check that `DATABASE_URL` uses the correct format. For Supabase, the pooled
connection uses port 6543. For Aurora, use the writer endpoint.

### Runtime: "Redis connection failed"
Ensure `REDIS_URL` uses `rediss://` (with double s) for TLS. Upstash requires
TLS. The app auto-detects the protocol and enables TLS accordingly.

### Runtime: "Session token invalid after deploy"
`OPEN_AGENT_PRIVATE_KEY` is not set or changed between deploys. Generate a
stable key with `openssl rand -base64 32` and set it as a Vercel env var.

### AI features not working
On Vercel, AI Gateway auth is automatic via `VERCEL_OIDC_TOKEN`. If running
outside Vercel, set `AI_GATEWAY_API_KEY` manually. If you want direct-to-vendor
calls instead of the gateway, set the provider's API key and disable the
gateway via the admin config API after deploy.

### Browser automation not working
agent-browser runs inside a Vercel Sandbox microVM, not in the Docker container.
On Vercel, sandbox auth is automatic via OIDC. For faster startup (sub-second
vs ~30s), create a sandbox snapshot and set `AGENT_BROWSER_SNAPSHOT_ID` as an
env var. See https://agent-browser.dev/next for details.

### FUNCTION_INVOCATION_FAILED (container crash at runtime)
Check the Vercel Logs tab for the actual error. Common causes:
1. Missing DATABASE_URL or REDIS_URL env vars (app falls back to localhost)
2. DATABASE_URL with special chars in password — ensure the connection string
   is properly URL-encoded (we removed strict .url() validation but Prisma
   still needs a valid connection string)
3. Port mismatch — the Dockerfile maps $PORT (Vercel default: 80) to
   OPEN_AGENT_SERVER_PORT. Do not set PORT manually in Vercel settings
4. Native module loading failure — the Rust .node binary must match the
   container architecture (amd64). The Dockerfile builds from source if
   a pre-built binary is not found

### Build warnings: "apt does not have a stable CLI interface"
This is a harmless warning from apt-get in the Dockerfile. We set
`DEBIAN_FRONTEND=noninteractive` to suppress interactive prompts. The
apt operations complete successfully despite the warning.

### Build warnings: "debconf: delaying package configuration"
We added `apt-utils` to the install list to resolve this. It is cosmetic
and does not affect the build output.

---

## File reference

| File | Purpose |
|------|---------|
| `Dockerfile.vercel` | Multi-stage Docker build for Vercel container deployment |
| `vercel.json` | Vercel Services config (single service + rewrite) |
| `.dockerignore` | Excludes non-essential files from Docker context |
| `packages/backend/server/.env.vercel` | Complete env var reference (all 40+ vars) |
| `packages/backend/server/schema.prisma` | Prisma schema (PostgreSQL + pgvector) |
| `entry.md` | Architecture notes and migration documentation |
| `DEPLOY.md` | This file |
