# Contributing to Woof

Thanks for your interest in contributing! This guide covers everything you need to get started.

## Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [Yarn](https://yarnpkg.com/) v4 (enabled via Corepack: `corepack enable`)
- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (only needed for deploying)

## Local development setup

```bash
# Clone the repo
git clone https://github.com/<your-org>/woof.git
cd woof

# Install dependencies
yarn install

# Build all packages (types must build before evaluation/service)
yarn build

# Start local dev servers (API + admin UI)
yarn dev
```

## Project structure

| Package | Path | Description |
|---|---|---|
| `@woof/types` | `packages/types` | Shared TypeScript types |
| `@woof/evaluation` | `packages/evaluation` | Pure flag evaluation engine (no I/O) |
| `@woof/service` | `packages/service` | Cloudflare Worker — Hono API |
| `@woof/admin-ui` | `packages/admin-ui` | Cloudflare Worker — Remix UI |
| `@woof/cli` | `packages/cli` | Interactive setup wizard |

Dependency order: `types` → `evaluation` → `service` / `admin-ui`.

## Running tests

```bash
# Run all tests
yarn test

# Run tests for a specific package
yarn workspace @woof/evaluation test

# Run with coverage report
yarn workspace @woof/evaluation test:coverage

# Watch mode during development
yarn workspace @woof/evaluation test:watch
```

We use [Vitest](https://vitest.dev/) for testing. The `@woof/evaluation` package targets 80%+ coverage.

## Linting and formatting

```bash
# Check for lint and format issues
yarn lint

# Auto-fix issues
yarn format
```

We use [Biome](https://biomejs.dev/) for linting and formatting.

## Pull request guidelines

1. Create a feature branch from `main`.
2. Make your changes — keep PRs focused on a single concern.
3. Ensure the following pass before submitting:
   ```bash
   yarn build
   yarn test
   yarn lint
   ```
4. Write clear commit messages explaining *why*, not just *what*.
5. Open a PR against `main` with a short description of the change.

## Code style

- TypeScript strict mode is enabled across all packages.
- `@woof/evaluation` must remain a pure-function library with **zero runtime dependencies** (only `@woof/types`). This keeps it portable and easy to test.
- Prefer explicit types at module boundaries; rely on inference internally.
- Keep functions small and focused. The evaluation engine uses early-return patterns — follow that convention.
