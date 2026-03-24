# Woof

**Woof** (Workers on Open Feature) is a feature flag service that runs entirely on [Cloudflare Workers](https://workers.cloudflare.com/). It stores flag definitions in Cloudflare KV, evaluates them via an [OFREP](https://openfeature.dev)-compliant API, and includes an admin UI for managing flags, targeting rules, and user segments.

Each team deploys their own isolated instance to their Cloudflare account. There are no shared servers, no third-party data processors, and no per-seat pricing — just your flags on your infrastructure.

## How it works

Woof deploys as two Workers on the same subdomain:

```
woof.example.com
├── /ofrep/v1/*   -> woof-api   (flag evaluation)
├── /api/v1/*     -> woof-api   (admin API, SSO-protected)
├── /healthz      -> woof-api   (health check)
└── /*            -> woof-admin  (management UI, SSO-protected)
```

Your application evaluates flags by calling the OFREP endpoints — either directly via HTTP or through any [OpenFeature SDK](https://openfeature.dev/ecosystem) with an OFREP provider. The admin UI lets your team create flags, define targeting rules, and review an audit log of every change.

## Key concepts

### Flags

A flag has a **key** (unique identifier), a **type** (boolean, string, integer, number, or object), and a set of **variants** (named values the flag can resolve to). One variant is designated as the **default**, served when no targeting rules match.

Flags can be **enabled** or **disabled**. When disabled, evaluation returns the first variant with a `DISABLED` reason, allowing clients to handle the off-state gracefully.

### Rules

Rules add conditional logic to flag evaluation. Each rule targets a specific flag and contains a **condition group** — a tree of conditions joined by AND/OR logic. When a rule matches the evaluation context, its designated variant is served instead of the default.

Rules are evaluated by **priority** (lowest number first). The first matching rule wins.

### Segments

Segments are reusable condition groups that define user cohorts (e.g., "beta testers", "enterprise accounts"). They can be referenced across multiple rules to keep targeting logic consistent and maintainable.

### Evaluation context

Every evaluation request includes a **context** with a required `targetingKey` (identifying the subject — usually a user ID) and arbitrary attributes (plan, country, email, etc.) that rules can match against.

### Audit log

Every flag, rule, segment, and settings change is recorded in an append-only audit log with the user's identity (from Cloudflare Access SSO), timestamp, and a description of what changed.

## Architecture

| Component | Technology | Purpose |
|---|---|---|
| **@woof/service** | Cloudflare Worker + Hono | OFREP evaluation API + Admin REST API |
| **@woof/admin-ui** | Cloudflare Worker + Remix | Management dashboard |
| **@woof/evaluation** | Pure TypeScript | Flag evaluation engine (no I/O) |
| **@woof/types** | TypeScript | Shared type definitions |
| **@woof/cli** | Node.js CLI | Interactive setup wizard |
| **Cloudflare KV** | Key-value store | Flag, rule, segment, and audit storage |
| **Cloudflare Access** | Zero Trust SSO | Admin authentication |

## Guides

- [Setup and deployment](guides/setup.md) — Install, configure, and deploy Woof to your Cloudflare account
- [Integration](guides/integration.md) — Connect your application using OpenFeature OFREP providers
- [Flags and targeting](guides/flags-and-targeting.md) — Create flags, write targeting rules, and manage segments
- [API reference](guides/api-reference.md) — OFREP and admin API endpoints
