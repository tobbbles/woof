# Setup and deployment

This guide walks through deploying Woof to your Cloudflare account. The whole process takes about 10 minutes.

## Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [Yarn](https://yarnpkg.com/) v4 (included via corepack)
- A [Cloudflare account](https://dash.cloudflare.com/sign-up) with Workers enabled
- A domain (zone) managed in your Cloudflare account

## Quick setup

The interactive setup wizard handles most of the configuration:

```sh
git clone https://github.com/tobbbles/woof.git && cd woof
yarn install
yarn setup
```

The wizard walks you through:

1. **Domain** — Choose the subdomain for your instance (e.g., `flags.example.com`)
2. **DNS** — Creates a proxied DNS record pointing to Workers (if your API token has DNS permissions)
3. **KV namespace** — Creates the `FLAGS` namespace for flag storage
4. **D1 database** — Creates the `woof-audit` database for audit history and applies migrations
5. **Cloudflare Access** — Configures your team domain and application audience tag for SSO

Once setup completes:

```sh
yarn deploy
```

This builds and deploys both Workers. Verify with:

```sh
curl https://flags.example.com/healthz
# {"ok":true}
```

## Manual setup

If you prefer to configure things yourself, or the wizard doesn't cover your environment, follow these steps.

### 1. Create a KV namespace

```sh
cd packages/service
npx wrangler kv namespace create FLAGS
```

Copy the output `id` into `packages/service/wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "FLAGS"
id = "<your-namespace-id>"
```

For local development, also create a preview namespace:

```sh
npx wrangler kv namespace create FLAGS --preview
```

Add the `preview_id` to the same block:

```toml
[[kv_namespaces]]
binding = "FLAGS"
id = "<your-namespace-id>"
preview_id = "<your-preview-id>"
```

### 2. Create a D1 database

The audit log is stored in a Cloudflare D1 (SQLite) database.

```sh
cd packages/service
npx wrangler d1 create woof-audit
```

Copy the output `database_id` into `packages/service/wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "woof-audit"
database_id = "<your-database-id>"
migrations_dir = "migrations"
```

Then apply the schema migration:

```sh
npx wrangler d1 migrations apply woof-audit --remote
```

For local development, migrations are applied automatically when you run `wrangler dev`.

### 3. Configure routes

Both Workers need route patterns pointing to your subdomain.

**`packages/service/wrangler.toml`** — API routes:

```toml
[[routes]]
pattern = "flags.example.com/api/v1/*"
zone_name = "example.com"

[[routes]]
pattern = "flags.example.com/ofrep/v1/*"
zone_name = "example.com"

[[routes]]
pattern = "flags.example.com/healthz"
zone_name = "example.com"
```

**`packages/admin-ui/wrangler.toml`** — catch-all for the UI:

```toml
[[routes]]
pattern = "flags.example.com/*"
zone_name = "example.com"
```

Cloudflare evaluates routes most-specific-first, so the API routes always match before the catch-all.

### 4. Create a DNS record

Workers routes require a DNS record on the subdomain. Create a proxied AAAA record:

```sh
# Via the Cloudflare dashboard, or:
curl -X POST "https://api.cloudflare.com/client/v4/zones/<zone-id>/dns_records" \
  -H "Authorization: Bearer <api-token>" \
  -H "Content-Type: application/json" \
  -d '{"type":"AAAA","name":"flags","content":"100::","proxied":true}'
```

The `100::` address is a placeholder — Cloudflare intercepts the request at the edge and routes it to your Worker.

### 5. Configure Cloudflare Access

Woof uses [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/) to protect admin routes with SSO. No passwords or API keys to manage.

Access policies operate at the application level, not per-path within a policy. This means you need **separate Access applications** for public and protected routes.

#### a. Add an identity provider

In the [Zero Trust dashboard](https://one.dash.cloudflare.com/), go to **Settings > Authentication > Login methods** and add your identity provider (Google, GitHub, Okta, any SAML/OIDC provider).

#### b. Create Access applications

You need two Access applications. Access evaluates more-specific paths first, so the public bypass will match before the admin gate.

**Application 1 — Woof Public (OFREP + health check)**

1. Go to **Access > Applications > Add an application > Self-hosted**
2. Application domain: `flags.example.com`, Path: `ofrep/v1`
3. Add a second domain entry: `flags.example.com`, Path: `healthz`
4. Add a **Bypass** policy — Action: Bypass, Include: Everyone

This keeps evaluation routes and health checks open for SDK consumers.

**Application 2 — Woof Admin (protected)**

1. Add another Self-hosted application
2. Application domain: `flags.example.com` (no path — catch-all for admin API + UI)
3. Add an **Allow** policy — e.g., emails ending in `@yourcompany.com`, or a specific IdP group

Access evaluates applications with more specific paths first, so the OFREP and healthz bypasses take priority over the catch-all admin gate.

#### c. Get the Application Audience (AUD) tag

From the **Admin** application (Application 2), find the 64-character hex AUD tag under **Applications > your app > Overview**. This is used by the API Worker to verify that incoming JWTs were issued for this application.

#### d. Set secrets on the API Worker

```sh
cd packages/service

npx wrangler secret put ACCESS_TEAM_DOMAIN
# Enter: https://<your-team>.cloudflareaccess.com

npx wrangler secret put ACCESS_AUD
# Enter: the AUD tag from step (c)
```

For local development, put these in `packages/service/.dev.vars`:

```
ACCESS_TEAM_DOMAIN=https://myteam.cloudflareaccess.com
ACCESS_AUD=your-application-audience-tag
```

### 6. (Optional) Secure OFREP endpoints

By default, OFREP evaluation endpoints are public. To require authentication, set an API key:

```sh
cd packages/service
npx wrangler secret put OFREP_API_KEY
# Enter a strong random key
```

Clients must then include the key in requests via either:

- `Authorization: Bearer <key>`
- `X-API-Key: <key>`

When `OFREP_API_KEY` is not set, evaluation endpoints remain open.

### 7. Configure CORS

Browser-based applications (e.g., using the `@openfeature/ofrep-web-provider`) need CORS headers to call the evaluation API cross-origin. Set the `CORS_ORIGINS` environment variable to a comma-separated list of allowed origins:

```sh
cd packages/service
npx wrangler secret put CORS_ORIGINS
# Enter: https://app.example.com,https://staging.example.com
```

Or set it as a plaintext var in `packages/service/wrangler.toml`:

```toml
[vars]
CORS_ORIGINS = "https://app.example.com,https://staging.example.com"
```

For local development, add it to `packages/service/.dev.vars`:

```
CORS_ORIGINS=http://localhost:3000,http://localhost:5173
```

When `CORS_ORIGINS` is not set, cross-origin requests are rejected. Server-side SDKs (Node.js, Go, etc.) are not affected since they don't use CORS.

### 8. Deploy

```sh
yarn deploy
```

### 9. Verify

```sh
# Health check
curl https://flags.example.com/healthz

# Evaluate a flag (after creating one in the admin UI)
curl -X POST https://flags.example.com/ofrep/v1/evaluate/flags/my-flag \
  -H "Content-Type: application/json" \
  -d '{"context":{"targetingKey":"user-123"}}'
```

Open `https://flags.example.com` in your browser to access the admin UI (you'll be redirected through SSO).

## Local development

```sh
# Install dependencies
yarn install

# Build shared packages
yarn build

# Run the API service locally (uses .dev.vars for secrets)
yarn workspace @woof/service dev

# In another terminal, run the admin UI dev server
yarn workspace @woof/admin-ui dev
```

The API service runs on `http://localhost:8787` by default. When Access secrets aren't configured, the service runs in dev mode — all admin requests are allowed with a `dev@localhost` identity.

## Updating

Pull the latest changes and redeploy:

```sh
git pull
yarn install
yarn deploy
```

If there are new D1 migrations, apply them before deploying:

```sh
cd packages/service
npx wrangler d1 migrations apply woof-audit --remote
```

Or re-run `yarn setup` which will detect the existing database and offer to apply pending migrations.

KV data (flags, rules, segments) and D1 data (audit history) are preserved across deployments.
