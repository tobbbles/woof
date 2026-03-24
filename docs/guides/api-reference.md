# API reference

Woof exposes two API surfaces: the **OFREP evaluation API** (for SDK consumers) and the **Admin API** (for flag management). Both are served by the same Worker.

## OFREP evaluation API

Base path: `/ofrep/v1`

These endpoints implement the [OpenFeature Remote Evaluation Protocol](https://openfeature.dev). They are publicly accessible by default, or protected by an API key when `OFREP_API_KEY` is configured.

### Authentication

When `OFREP_API_KEY` is set, requests must include one of:

- `Authorization: Bearer <key>`
- `X-API-Key: <key>`

Unauthenticated requests receive `401`. Invalid keys receive `403`.

### Rate limiting

All OFREP endpoints are rate-limited to 600 requests per minute per client IP. Exceeded requests receive `429` with a `Retry-After` header indicating seconds until the window resets.

---

### POST /ofrep/v1/evaluate/flags/:key

Evaluate a single flag.

**Request:**

```json
{
  "context": {
    "targetingKey": "user-123",
    "plan": "enterprise",
    "country": "US"
  }
}
```

`context.targetingKey` is required. Additional attributes are optional and used for rule targeting.

**Responses:**

#### 200 — Evaluation success

```json
{
  "key": "dark-mode",
  "value": true,
  "reason": "TARGETING_MATCH",
  "variant": "on",
  "metadata": {
    "flagType": "boolean",
    "ruleName": "enterprise-users"
  }
}
```

| Field | Type | Description |
|---|---|---|
| `key` | string | Flag identifier |
| `value` | boolean / string / number / object | Resolved value. Absent when the client should use its code-level default. |
| `reason` | string | `STATIC`, `TARGETING_MATCH`, `SPLIT`, `DISABLED`, or `UNKNOWN` |
| `variant` | string | Name of the resolved variant |
| `metadata` | object | Includes `flagType` and optionally `ruleName` |

#### 400 — Evaluation failure

```json
{
  "key": "dark-mode",
  "errorCode": "TARGETING_KEY_MISSING",
  "errorDetails": "context.targetingKey is required"
}
```

Error codes: `PARSE_ERROR`, `TARGETING_KEY_MISSING`, `INVALID_CONTEXT`, `GENERAL`

#### 404 — Flag not found

```json
{
  "key": "nonexistent",
  "errorCode": "FLAG_NOT_FOUND",
  "errorDetails": "Flag \"nonexistent\" not found"
}
```

#### 500 — Server error

```json
{
  "errorDetails": "Internal server error"
}
```

---

### POST /ofrep/v1/evaluate/flags

Evaluate all flags (bulk evaluation).

**Request headers:**

| Header | Description |
|---|---|
| `If-None-Match` | ETag from a previous response. Returns `304` if unchanged. Supports multiple comma-separated values. |

**Request body:** Same as single flag evaluation.

**Responses:**

#### 200 — Bulk evaluation success

Returns an `ETag` response header for cache validation.

```json
{
  "flags": [
    {
      "key": "dark-mode",
      "value": true,
      "reason": "TARGETING_MATCH",
      "variant": "on",
      "metadata": { "flagType": "boolean" }
    },
    {
      "key": "checkout-flow",
      "value": "v1",
      "reason": "STATIC",
      "variant": "legacy",
      "metadata": { "flagType": "string" }
    }
  ]
}
```

Individual entries can be successes or failures (partial success is possible).

#### 304 — Not modified

Returned when the `If-None-Match` header matches the current ETag. No response body.

#### 400 — Bulk evaluation failure

```json
{
  "errorCode": "TARGETING_KEY_MISSING",
  "errorDetails": "context.targetingKey is required"
}
```

---

## Admin API

Base path: `/api/v1`

Protected by Cloudflare Access. Requests must include a valid Access JWT (automatically handled when using the admin UI or accessing through a browser with an active Access session).

### Flags

#### GET /api/v1/flags

List all flags.

**Response:** `{ "flags": [Flag, ...] }`

#### GET /api/v1/flags/:key

Get a single flag by key.

**Response:** `Flag`

#### POST /api/v1/flags

Create a new flag.

**Request:**

```json
{
  "key": "dark-mode",
  "type": "boolean",
  "enabled": true,
  "defaultVariant": "off",
  "variants": {
    "on": true,
    "off": false
  },
  "description": "Enables dark mode"
}
```

#### PUT /api/v1/flags/:key

Update an existing flag. Fields are merged with the existing flag.

#### DELETE /api/v1/flags/:key

Delete a flag.

---

### Rules

#### GET /api/v1/rules

List rules. Optionally filter by flag: `GET /api/v1/rules?flagKey=dark-mode`

**Response:** `{ "rules": [Rule, ...] }`

#### GET /api/v1/rules/:id

Get a single rule by ID.

#### POST /api/v1/rules

Create a new rule.

**Request:**

```json
{
  "flagKey": "dark-mode",
  "name": "Beta testers",
  "variantKey": "on",
  "priority": 1,
  "conditionGroup": {
    "logic": "AND",
    "conditions": [
      {
        "attribute": "email",
        "operator": "ends_with",
        "value": "@beta.example.com"
      }
    ],
    "groups": []
  }
}
```

`priority` is optional and defaults to the next available value.

#### PUT /api/v1/rules/:id

Update an existing rule. All fields are optional.

#### DELETE /api/v1/rules/:id

Delete a rule.

---

### Segments

#### GET /api/v1/segments

List all segments.

**Response:** `{ "segments": [Segment, ...] }`

#### GET /api/v1/segments/:key

Get a single segment by key.

#### POST /api/v1/segments

Create a new segment.

**Request:**

```json
{
  "name": "Enterprise US",
  "key": "enterprise-us",
  "description": "Enterprise plan users in the US or Canada",
  "conditionGroup": {
    "logic": "AND",
    "conditions": [
      { "attribute": "plan", "operator": "equals", "value": "enterprise" },
      { "attribute": "country", "operator": "in", "value": "US,CA" }
    ],
    "groups": []
  }
}
```

#### PUT /api/v1/segments/:key

Update an existing segment. All fields are optional.

#### DELETE /api/v1/segments/:key

Delete a segment.

---

### Audit log

#### GET /api/v1/audit

List audit entries, newest first. Supports pagination.

**Query parameters:**

| Param | Default | Description |
|---|---|---|
| `limit` | 50 | Number of entries to return (max 500) |
| `cursor` | — | Cursor for pagination (from previous response) |

**Response:**

```json
{
  "entries": [
    {
      "id": "abc-123",
      "timestamp": "2025-03-15T10:30:00.000Z",
      "user": "alice@example.com",
      "action": "created",
      "entityType": "flag",
      "entityKey": "dark-mode",
      "entityName": "dark-mode",
      "details": "Created flag dark-mode"
    }
  ],
  "cursor": "next-page-cursor"
}
```

---

### Settings

#### GET /api/v1/settings

Get current settings. Returns defaults if no settings have been saved.

#### PUT /api/v1/settings

Replace all settings.

**Request:**

```json
{
  "environments": [
    {
      "id": "env-1",
      "name": "Production",
      "key": "production",
      "color": "#10b981",
      "protected": true
    }
  ],
  "flagDefaults": {
    "defaultEnv": "production",
    "defaultRollout": 0,
    "requireApproval": false,
    "approvalEnvs": [],
    "staleFlagDays": 30,
    "autoDisableStale": false
  },
  "evaluation": {
    "strategy": "first-match",
    "cacheEnabled": true,
    "cacheTtlSeconds": 60,
    "loggingEnabled": true,
    "logLevel": "info"
  }
}
```

---

### Health check

#### GET /healthz

Returns `{ "ok": true }`. Not behind authentication.
