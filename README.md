# Woof — Workers on Open Feature

A self-service feature flag service built on Cloudflare Workers. Stores flag definitions in Cloudflare KV, exposes an [OFREP](https://openfeature.dev/docs/reference/technologies/server/ofrep)-compliant evaluation API, and ships an admin UI for managing flags.

Teams deploy their own instance to their Cloudflare account. Authentication is handled by [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/) (Zero Trust SSO).

## Getting started

```sh
git clone https://github.com/<your-org>/woof.git
cd woof
yarn install
yarn setup
```

`yarn setup` is the single entrypoint for configuring Woof. The interactive CLI walks you through everything:

1. **Domain & routes** — picks your subdomain, writes `wrangler.toml` for both Workers
2. **DNS** — creates the proxied DNS record (if your API token has DNS permissions)
3. **KV namespaces** — provisions production and preview namespaces for flag storage
4. **Cloudflare Access** — configures SSO secrets for admin authentication
5. **CORS** — sets allowed origins for browser-based OFREP consumers

On first run, the wizard bootstraps `wrangler.toml` from the checked-in `.example` templates. On subsequent runs it detects your existing configuration and uses those values as defaults, so you can re-run it at any time to update a single setting.

Once setup is complete:

```sh
yarn deploy            # deploy both Workers
curl https://woof.example.com/healthz   # verify
```

## Architecture

Woof deploys as **two Workers** on the same subdomain, split by route:

```
woof.example.com
├── /ofrep/v1/*   → woof-api Worker   (flag evaluation, open)
├── /api/v1/*     → woof-api Worker   (admin API, Access-protected)
├── /healthz      → woof-api Worker   (health check, open)
└── /*            → woof-admin Worker (Remix UI, Access-protected)
```

Cloudflare routes the more specific paths (`/api/v1/*`, `/ofrep/v1/*`) to the API Worker. Everything else falls through to the admin UI Worker.

## Packages

| Package | Description |
|---|---|
| `@woof/types` | Shared TypeScript types — flag data model, OFREP shapes, admin API contracts |
| `@woof/evaluation` | Pure flag evaluation engine (no I/O, no Worker deps) |
| `@woof/service` | Cloudflare Worker — Hono app with OFREP + admin API, backed by KV |
| `@woof/admin-ui` | Cloudflare Worker — Remix app for flag management |
| `@woof/cli` | Interactive setup wizard (`yarn setup`) |

## Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [Yarn](https://yarnpkg.com/) (v4, enabled via `corepack enable`)
- A [Cloudflare account](https://dash.cloudflare.com/sign-up) with Workers enabled
- A domain (zone) in your Cloudflare account

## Configuration

### How `yarn setup` works

The repo ships `wrangler.toml.example` files with placeholder values. These are tracked in git. Your real `wrangler.toml` files (containing actual KV IDs, domains, and secrets) are gitignored.

When you run `yarn setup`:
- If `wrangler.toml` doesn't exist, the wizard copies it from `.example` automatically
- If it does exist, the wizard reads your current values and offers them as defaults
- Secrets like `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` are written to `packages/service/.dev.vars` for local dev and set as Worker secrets for production

### Manual setup

If you prefer to skip the wizard, copy the templates and edit them directly:

```sh
cp packages/service/wrangler.toml.example packages/service/wrangler.toml
cp packages/admin-ui/wrangler.toml.example packages/admin-ui/wrangler.toml
cp packages/service/.dev.vars.example packages/service/.dev.vars
```

Then fill in your domain, KV namespace IDs, and Access credentials. See the sections below for details.

### KV namespace

```sh
cd packages/service
npx wrangler kv namespace create FLAGS
npx wrangler kv namespace create FLAGS --preview
```

Copy the output IDs into `packages/service/wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "FLAGS"
id = "<your-namespace-id>"
preview_id = "<your-preview-namespace-id>"
```

### Routes

Both Workers need route patterns pointing to your subdomain. Update the `wrangler.toml` in each package:

**`packages/service/wrangler.toml`** — API routes:

```toml
[[routes]]
pattern = "woof.example.com/api/v1/*"
zone_name = "example.com"

[[routes]]
pattern = "woof.example.com/ofrep/v1/*"
zone_name = "example.com"

[[routes]]
pattern = "woof.example.com/healthz"
zone_name = "example.com"
```

**`packages/admin-ui/wrangler.toml`** — catch-all for the UI:

```toml
[[routes]]
pattern = "woof.example.com/*"
zone_name = "example.com"
```

Cloudflare evaluates routes most-specific-first, so the API routes will always match before the catch-all.

### Cloudflare Access

Woof uses [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/) to authenticate admin users via SSO. No passwords or API keys to manage — your team logs in with their existing identity provider.

#### a. Set up an identity provider

In the [Cloudflare Zero Trust dashboard](https://one.dash.cloudflare.com/):

1. Go to **Integrations > Identity providers**
2. Add your identity provider (Google, GitHub, Okta, any SAML/OIDC provider, etc.)

See [Cloudflare's IdP setup guides](https://developers.cloudflare.com/cloudflare-one/identity/idp-integration/) for provider-specific instructions.

#### b. Create Access applications

You need to protect the admin API and admin UI while leaving OFREP evaluation routes and health checks open. Access policies operate at the application level (not per-path within a policy), so you need **separate applications** for public and protected routes.

Create two self-hosted applications in **Access > Applications > Add an application**:

| Application | Domain | Path(s) | Policy |
|---|---|---|---|
| Woof Public | `woof.example.com` | `ofrep/v1` and `healthz` | **Bypass** — Include: Everyone |
| Woof Admin | `woof.example.com` | *(empty — catch-all)* | **Allow** — e.g., emails ending in `@yourcompany.com` |

The Woof Public application has two domain entries (same domain, different paths). Access evaluates more-specific paths first, so the bypass takes priority over the admin catch-all.

#### c. Find the Application Audience (AUD) tag

From the **Woof Admin** application (the protected catch-all), find the auto-generated audience tag (a 64-character hex string):

1. Go to **Access controls > Applications**
2. Click **Configure** on your Admin application
3. On the **Basic information** tab, copy the **Application Audience (AUD) Tag**

This value is used by the API Worker to verify that incoming JWTs were issued for *this* Access application specifically.

#### d. Set the Access secrets

Your team domain is your Zero Trust organization URL, visible at the top of the Zero Trust dashboard or under **Settings > Custom Pages**. It looks like `https://myteam.cloudflareaccess.com`.

```sh
cd packages/service
npx wrangler secret put ACCESS_TEAM_DOMAIN
# Enter: https://<your-team>.cloudflareaccess.com

npx wrangler secret put ACCESS_AUD
# Enter: the AUD tag from step (c)
```

For local development, add these to `packages/service/.dev.vars`:

```
ACCESS_TEAM_DOMAIN=https://myteam.cloudflareaccess.com
ACCESS_AUD=your-application-audience-tag
```

### Deploy and verify

```sh
yarn deploy

# Health check
curl https://woof.example.com/healthz

# Evaluate via OFREP (no auth required)
curl -X POST https://woof.example.com/ofrep/v1/evaluate/flags/dark-mode \
  -H "Content-Type: application/json" \
  -d '{"context":{"targetingKey":"user-123"}}'
```

To create flags, log into the admin UI at `https://woof.example.com` or use the admin API through a browser session with Access authentication.

## Using with OpenFeature SDKs

Woof implements the OFREP standard, so you can use the off-the-shelf OpenFeature OFREP providers.

### Server-side (Node.js)

```sh
npm install @openfeature/server-sdk @openfeature/ofrep-provider
```

```typescript
import { OpenFeature } from "@openfeature/server-sdk";
import { OFREPProvider } from "@openfeature/ofrep-provider";

OpenFeature.setProvider(
  new OFREPProvider({ baseUrl: "https://woof.example.com" }),
);

const client = OpenFeature.getClient();
const darkMode = await client.getBooleanValue("dark-mode", false, {
  targetingKey: "user-123",
});
```

### Client-side (Web)

```sh
npm install @openfeature/web-sdk @openfeature/ofrep-web-provider
```

```typescript
import { OpenFeature } from "@openfeature/web-sdk";
import { OFREPWebProvider } from "@openfeature/ofrep-web-provider";

await OpenFeature.setProviderAndWait(
  new OFREPWebProvider({ baseUrl: "https://woof.example.com" }),
);

const client = OpenFeature.getClient();
const darkMode = client.getBooleanValue("dark-mode", false);
```

## How auth works

```
                    woof.example.com
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
   /ofrep/v1/*       /api/v1/*            /*
   /healthz               │                 │
        │                 │                 │
   Woof Public       Woof Admin        Woof Admin
    (Bypass)          (Allow)           (Allow)
        │                 │                 │
        ▼            JWT added         JWT added
   woof-api          by Access          by Access
    Worker                │                 │
    (open)                ▼                 ▼
                     woof-api          woof-admin
                      Worker             Worker
                  (JWT validated)     (serves UI)
```

Two Access applications control access. Access evaluates more-specific paths first:

- **OFREP evaluation routes** — A dedicated Access app with a Bypass policy allows all requests through. SDK consumers call these directly.
- **Admin API routes** — Protected by the Admin Access app. After SSO login, Access injects a signed JWT (`Cf-Access-Jwt-Assertion`) that the API Worker validates as a defense-in-depth check.
- **Admin UI** — Also covered by the Admin Access app (catch-all). The Remix app serves the management interface. API calls from the UI carry the Access cookie (`CF_Authorization`) automatically since both Workers share the same domain.

## Development

```sh
# Install dependencies
yarn install

# Build all packages
yarn build

# Run the API service locally
yarn workspace @woof/service dev

# Run the admin UI dev server
yarn workspace @woof/admin-ui dev
```

## Project structure

```
packages/
  types/                    Shared TypeScript types
  evaluation/               Flag evaluation engine (pure logic)
  service/                  Cloudflare Worker — woof-api (Hono + KV)
    src/
      auth/                 Cloudflare Access JWT validation
      admin/                Admin API routes (CRUD)
      ofrep/                OFREP evaluation routes
      store/                KV-backed flag storage
    wrangler.toml.example   Template config (tracked in git)
    wrangler.toml           Your config (gitignored, created by yarn setup)
    .dev.vars.example       Template local secrets
  admin-ui/                 Cloudflare Worker — woof-admin (Remix)
    app/                    Remix app source
    wrangler.toml.example   Template config (tracked in git)
    wrangler.toml           Your config (gitignored, created by yarn setup)
  cli/                      Interactive setup wizard (yarn setup)
    src/
      setup.ts              Guided configuration flow
```

## License

[MIT](LICENSE)
