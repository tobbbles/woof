# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — Unreleased

Initial public release.

### Added

#### OFREP Evaluation API
- Single flag evaluation (`POST /ofrep/v1/evaluate/flags/:key`)
- Bulk flag evaluation (`POST /ofrep/v1/evaluate/flags`) with ETag / 304 support
- Evaluation context logging with 24-hour retention
- Optional bearer token and API key authentication
- Rate limiting with `Retry-After` headers
- Spec-compliant error codes (`PARSE_ERROR`, `TARGETING_KEY_MISSING`, `FLAG_NOT_FOUND`)

#### Evaluation engine (`@woof/evaluation`)
- Flag types: boolean, string, integer, number, object
- Condition operators: `equals`, `not_equals`, `in`, `contains`, `ends_with`, `greater_than`, `less_than`, `semver_gte`, `semver_lte`
- Condition groups with AND/OR logic and arbitrary nesting
- Per-condition negation
- Priority-ordered rule targeting (first match wins)
- Reusable segments referenced by rules
- Percentage-based rollout with deterministic sticky hashing (FNV-1a)
- Configurable stickiness attribute (`user_id`, `session_id`, `device_id`)
- Kill switch — instant emergency off for any flag
- Prerequisites — require other flags to be enabled
- Schedule windows — activate/deactivate by date range

#### Admin API
- Full CRUD for flags, rules, and segments
- Global settings endpoint
- Cursor-based audit log with automatic change tracking
- Evaluation context history

#### Admin UI
- Flag management with inline editing
- Rule editor with visual condition builder
- Segment management panel
- Flag evaluation simulator
- Audit log viewer with pagination
- Settings page

#### CLI setup wizard (`yarn setup`)
- Interactive domain and route configuration
- Automatic DNS record creation (with API token)
- KV namespace provisioning (production + preview)
- Cloudflare Access SSO configuration
- CORS origin setup
- Bootstraps `wrangler.toml` from `.example` templates
- Re-runnable with existing config detection

#### Authentication
- Cloudflare Access JWT validation (issuer + audience)
- Service Binding support for Worker-to-Worker calls
- Dev mode fallback when Access is not configured

#### Developer experience
- Vitest test suite for the evaluation engine (100% line coverage)
- Biome linting and formatting
- GitHub Actions CI (build, lint, test)
