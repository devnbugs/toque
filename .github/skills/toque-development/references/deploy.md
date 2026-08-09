# Deployment Guide

Deployment builds a Docker image, pushes it to Cloudflare's managed registry,
patches `wrangler.jsonc` with the new image reference, and deploys the Worker.

## Prerequisites

- Docker (or Colima) running locally
- `CLOUDFLARE_API_TOKEN` env var set (or `npx wrangler login`)
- `WORKER_API_TOKEN` secret set: `npx wrangler secret put WORKER_API_TOKEN`
- (Optional) `TEAM_DOMAIN`, `POLICY_AUD`, `TOQUE_API_KEY` secrets for auth
- npm dependencies installed (`npm ci`)

## Commands

```bash
npm run deploy              # build + push + deploy (full)
npm run deploy:build-only   # build + push, no Worker deploy
npm run deploy:dev          # local dev mode (wrangler dev)
npm run deploy:rollback -- <image-ref>  # deploy existing image
npm run containers:list     # list running containers
npm run containers:images   # list container images
npm run containers:ssh      # SSH into running container
```

## What the Deploy Script Does

`scripts/deploy.sh`:
1. Checks Docker is running and dependencies are present.
2. Builds the image with `npx wrangler containers build -p -t <name>:<tag> .`
   — the tag is the short git SHA (7 chars).
3. Extracts the registry URI from the build output
   (`registry.cloudflare.com/<ACCOUNT_ID>/<NAME>:<TAG>`).
4. Patches `wrangler.jsonc` — sets `containers[0].image` to the new URI.
   The patcher strips JSONC comments safely (char-by-char, tracking string
   literals) before parsing.
5. Deploys the Worker with `npx wrangler deploy`.

The CloakBrowser stealth Chromium binary is pre-downloaded during the Docker
build so the first request doesn't pay the ~200MB download cost.

## CI Auto-Deploy

`.github/workflows/deploy.yml` auto-deploys on push to `dev` (when
`src/`, `bin/`, `test/`, `Dockerfile`, `package*.json`, `wrangler.jsonc`, or
the workflow file itself changes). It can also be triggered manually via
`workflow_dispatch` with optional `ref` and `rollback_image` inputs.

- Concurrency group `deploy-${{ github.ref_name }}` queues pushes (no cancel).
- Build job builds and pushes the image, outputs the registry URI.
- Deploy job deploys the Worker, gated by an environment named after the
  branch.

## Rollback

```bash
npm run deploy:rollback -- registry.cloudflare.com/<account>/toque:<tag>
```

Or via CI: trigger `workflow_dispatch` with `rollback_image` set to the
existing image URI. This skips the build job.

The last pushed image is saved to `.last-image` for reference.

## Secrets

Set via `npx wrangler secret put <NAME>`:

| Secret | Purpose |
|---|---|
| `WORKER_API_TOKEN` | Required bearer token for autha-worker reads |
| `TEAM_DOMAIN` | Cloudflare Access team domain (enables JWT auth) |
| `POLICY_AUD` | Cloudflare Access app AUD tag |
| `TOQUE_API_KEY` | Shared secret for `X-API-Key` header auth |
| `CAPSOLVER_API_KEY` | CapSolver API key for `captcha solve` |

## Local Dev

`npm run deploy:dev` runs `wrangler dev` for local Worker development. The
container server can be run standalone with `npm run container`
(`node src/server.js`), which listens on `PORT` (default 8080).

## Setup Auth (One-Time)

```bash
# Automated
CLOUDFLARE_API_TOKEN=your-token ./scripts/setup-access-oauth.sh

# Manual
npx wrangler secret put TEAM_DOMAIN
npx wrangler secret put POLICY_AUD
```

The setup script creates a Cloudflare Access application for the Worker's
custom domain, enables Managed OAuth, and sets `TEAM_DOMAIN`/`POLICY_AUD`.
