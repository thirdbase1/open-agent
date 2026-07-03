# open-agent → Vercel Deployment Plan

Verified against live Vercel docs/blog on 2026-07-03 (dockerfile-on-vercel, bring-your-dockerfile-to-vercel-functions,
vercel-services, service-bindings, 5GB functions, sandbox sdk-reference). Repo analyzed structurally end-to-end:
every package under `packages/*/*`, every Cargo.toml, every Dockerfile, the job queue, the websocket layer, and
all copilot provider/tool code touched during the SDK7 + sandbox migration.

## 1. What this repo actually is

- Yarn workspaces monorepo (fork of AFFiNE), workspaces: `.`, `blocksuite/**/*`, `packages/*/*`, `tools/*`.
- **`packages/backend/server`** (`@afk/server`) — NestJS app. Single process, two flavors selected by
  `env.flavors.script`: normal boot runs `server.ts` (HTTP + GraphQL + Socket.io via `SocketIoAdapter`),
  script/CLI boot runs `cli.ts` via `nest-commander` (migrations, one-off jobs).
  Also starts BullMQ workers **in the same process** (`base/job/queue/executor.ts` — no separate worker
  process exists today).
- **`packages/backend/native`** (`@afk/server-native`) — Rust NAPI addon (Cargo.toml at repo root, native/,
  common/native/). Prebuilt per-arch `.node` binaries (`x64`/`arm64`/`armv7`), falls back to compiling from
  source in `rust:1.88.0-bookworm` if no prebuilt binary matches `$TARGETARCH`.
- **`packages/frontend/app`** (`@afk/app`) — the web client, built with **rspack** (`rspack build` → `dist/`),
  not a Vercel-auto-detected framework.
- **`packages/frontend/electron`** — desktop wrapper, out of scope for a web deploy.
- **`packages/common/*`** — shared graphql/env/error/debug libs consumed by both frontend and backend.
- Existing `.docker/Dockerfile` already does the correct multi-stage build: compile/fetch the Rust native
  module → `yarn workspace @afk/app build` → `yarn workspace @afk/server build` (+ prisma generate) →
  merge server `dist/` + `node_modules` + the frontend's `dist/` (served as `./static` by the Nest app) into
  one slim `node:22-bookworm-slim` runtime image. Port is `3010`, controlled by env var
  `OPEN_AGENT_SERVER_PORT` (see `core/config/config.ts`), not hardcoded elsewhere.
- Copilot (AI) layer already migrated in this pass: AI SDK 7 across all providers, AI Gateway on by default
  with automatic `VERCEL_OIDC_TOKEN` fallback, and the Python sandbox tool replaced with a persistent
  per-chat Vercel Sandbox + custom kernel (see §4).

## 2. Deployment mechanism — confirmed from Vercel's own docs

- **`Dockerfile.vercel`** at a project (or service) root: Vercel builds it, stores the image in your
  project's Container Registry, deploys it on **Fluid compute**, autoscales, and gives every commit its own
  preview URL. Container just needs to listen on `$PORT` (defaults to 80). Any stack works — this is not
  classic serverless-with-a-timeout, it's a long-lived process, so **Socket.io and BullMQ workers in the same
  process are fine** — this was the open question from earlier in the migration and it's resolved.
- Same capability is also described as **"Bring your Dockerfile to Vercel Functions"** — OCI/Containerfile
  images become Vercel Functions with active-CPU pricing, autoscaling, and observability in the same
  dashboard as everything else.
- **Vercel Services** (`vercel.json` → `"services"` key): multiple frameworks/backends in *one* Vercel
  project, atomic deploy/rollback together, one shared preview URL, own routing table via `rewrites`.
- **Service bindings**: a service can declare `"bindings": [{ "type": "service", "service": "other", "format": "url", "env": "OTHER_INTERNAL_URL" }]` — injects a private URL as an env var, traffic never leaves
  Vercel's network (no public route needed for internal-only services).
- **Large Functions (beta)**: Node/Python functions up to 5GB package size (20x the old 250MB cap) — opt in
  via `VERCEL_SUPPORT_LARGE_FUNCTIONS=1`. Relevant if we ever move the Rust/native-module server off Docker
  and onto a plain Function — not needed for the Docker path, but useful to know it exists.
- **Vercel Connect**: short-lived, scoped tokens for agents/apps to reach external systems (DBs, internal
  tools) securely. Relevant later for the Postgres/Redis connection story; not required for the first deploy.

## 3. Recommended plan — two phases, ordered by risk

### Phase 1 (do this first — fully verified, lowest risk)

Single `Dockerfile.vercel` at repo root, adapted directly from `.docker/Dockerfile`:
- Same multi-stage build (rust-builder → builder → merge → production).
- Only change: `EXPOSE $PORT` and the entrypoint sets `OPEN_AGENT_SERVER_PORT=${PORT:-3010}` before
  `node dist/main.mjs`, since Vercel injects `$PORT` and the app reads its own env var name.
- This keeps the current architecture exactly as-is (one process serves API + GraphQL + Socket.io + BullMQ
  workers + the built frontend as static files) — it's the same shape as the existing Docker Compose setup,
  just running on Fluid compute instead of your own host.
- `vercel.json` declares this as a single `"server"` service so it shows up properly in the Services/Logs UI
  from day one, even though it's only one service for now.
- I've already created both `Dockerfile.vercel` and `vercel.json` in this commit (see below) — this phase is
  ready to deploy as soon as env vars/secrets (`DATABASE_URL`, Redis connection, `AI_GATEWAY_API_KEY` or
  reliance on auto `VERCEL_OIDC_TOKEN`, OAuth provider keys, etc.) are set in the Vercel project.

### Phase 2 (worth doing, but has one open question — verify before investing time)

Split into two Vercel Services for independent deploys/scaling:
- `web`: `packages/frontend/app`, built with `rspack build` → `dist/` (needs an explicit `buildCommand`/
  `outputDirectory` in `vercel.json` since rspack isn't zero-config detected).
- `server`: the NestJS app, still via its own `Dockerfile.vercel`.
- `web` binds to `server` via a service binding (private `SERVER_INTERNAL_URL`), `rewrites` send
  `/api/*`, `/graphql`, `/socket.io/*` to `server` and everything else to `web`.
- **Open question I have not been able to confirm from the docs I read**: whether a per-service Dockerfile's
  build context is scoped to that service's `root`, or the whole repo. Our backend build currently does
  `COPY . .` and relies on yarn workspace resolution across the *entire* monorepo (native module, common
  libs, frontend workspace for the `dist/` it embeds). If per-service build context is restricted to
  `packages/backend/server`, this split needs a build-context workaround (e.g. a docker `context` override,
  or pre-building artifacts in CI and copying only the built output into the service root) before it'll work.
  Don't attempt Phase 2 until this is verified against current Vercel docs or a support answer — Phase 1 has
  no such risk and should be the actual production path first.

## 4. Sandbox + custom kernel — confirmed against Vercel Sandbox docs

- Sandboxes are **persistent by default**: filesystem auto-snapshots on `stop()`, auto-restores on the next
  `Sandbox.get({ name })` — no snapshot IDs to track manually. `Sandbox.create({ name, ... })` only needed
  the first time; every later call for the same chat resumes by name.
  This matches what's implemented in `vercel-python-sandbox.ts` — one sandbox per chat, keyed by a hash of
  `sessionId`.
- `sandbox.domain(port)` gives a public HTTPS URL for a port registered at creation time (`ports: [...]`) —
  confirmed this is how the custom kernel is reached from the Node backend. Because it's a **public** URL,
  the kernel requires a bearer token (generated once, persisted inside the sandbox filesystem at
  `.oa_kernel_token` so it survives restarts) — without this, anyone who found the URL could execute
  arbitrary code.
- **What the custom kernel actually gives you, honestly:**
  - Real persistent Python `globals()` across tool calls in the same chat — while the sandbox stays warm
    (timeout extended by 30 min on every call). This is a genuine upgrade over the old e2b tool, which was
    fully stateless per call.
  - Jupyter-style automatic capture: the last expression's value (`repr()`, like `Out[]`), plus any
    matplotlib figures still open when the code finishes — no explicit `savefig`/print needed.
  - `!shell command` lines work like Jupyter shell-escapes (e.g. `!pip install pandas`) — and since pip
    installs land on the sandbox's persistent filesystem, they survive even if the kernel process itself
    restarts.
  - **Real limitations, not glossed over:** it's a single `ThreadingHTTPServer` with one shared globals dict
    — concurrent calls into the *same* chat's sandbox are not properly isolated from each other (fine for
    the normal one-call-at-a-time chat pattern, not fine if the framework ever parallelizes tool calls). No
    per-call execution timeout or cancel button — a hung/infinite loop in one exec blocks that HTTP request
    indefinitely. No preinstalled data/AI libraries (stdlib only) — first use of pandas/numpy/matplotlib in
    a chat pays a one-time pip-install cost. And if a chat goes quiet long enough that Vercel cools the
    sandbox down, the *filesystem* survives (files, installed packages) but in-memory variables reset — same
    tradeoff as restarting a real Jupyter kernel.

## 5. Still open / needs your input before Phase 1 goes live

- Where does Postgres/Redis live? Options: keep your current managed instances and pass `DATABASE_URL`/
  Redis URL as Vercel env vars, or move to a Vercel Marketplace add-on (e.g. Upstash Redis). Either works
  with Phase 1 as-is; Vercel Connect is a nicer long-term answer if these become internal-only.
  need `AI_GATEWAY_API_KEY` set (they don't, on Vercel), since it falls back to `VERCEL_OIDC_TOKEN`
  automatically — already handled in this migration.
- Confirm which OAuth/provider secrets need to move from your local `config.example.json` into the Vercel
  project's environment variables before first deploy.
