# Flags and targeting

This guide covers creating flags, writing targeting rules, and managing reusable segments through the admin UI and API.

## Creating a flag

In the admin UI, navigate to **Flags** and click **New Flag**.

A flag requires:

| Field | Description |
|---|---|
| **Key** | Unique identifier used in code (e.g., `dark-mode`, `checkout-v2`) |
| **Type** | The value type: boolean, string, integer, number, or object |
| **Variants** | Named values the flag can resolve to |
| **Default variant** | Which variant to serve when no targeting rules match |

### Example: boolean flag

```
Key:              dark-mode
Type:             boolean
Variants:         on = true, off = false
Default variant:  off
```

When evaluated, this flag returns `false` by default. You can then add targeting rules to return `true` for specific users.

### Example: string flag

```
Key:              checkout-flow
Type:             string
Variants:         legacy = "v1", modern = "v2", experimental = "v3"
Default variant:  legacy
```

### Via the API

```sh
curl -X POST https://flags.example.com/api/v1/flags \
  -H "Content-Type: application/json" \
  -d '{
    "key": "dark-mode",
    "type": "boolean",
    "enabled": true,
    "defaultVariant": "off",
    "variants": {
      "on": true,
      "off": false
    },
    "description": "Enables dark mode UI"
  }'
```

## Enabling and disabling flags

Toggle a flag's **enabled** status to control whether it's live. When a flag is disabled:

- Evaluation returns the first variant with a `DISABLED` reason
- Targeting rules are not evaluated
- Clients receive the disabled state and can handle it appropriately

This is useful for kill switches — disable a flag instantly without deleting its configuration.

## Targeting rules

Rules let you serve different variants to different users based on their evaluation context.

### How rules work

Each rule has:

- **Name** — A human-readable label (e.g., "Beta testers", "US enterprise users")
- **Flag** — Which flag this rule applies to
- **Variant** — Which variant to serve when the rule matches
- **Priority** — Evaluation order (lower number = evaluated first)
- **Condition group** — The matching logic

Rules are evaluated in priority order. The **first matching rule wins** — its variant is returned and no further rules are checked. If no rules match, the flag's default variant is served.

### Conditions

A condition compares an attribute from the evaluation context against a value:

| Operator | Description | Example |
|---|---|---|
| `equals` | Exact string match | `plan equals "enterprise"` |
| `not_equals` | String inequality | `country not_equals "US"` |
| `in` | Value in comma-separated list | `country in "US,CA,GB"` |
| `contains` | Substring match | `email contains "@acme.com"` |
| `ends_with` | String suffix | `email ends_with "@beta.example.com"` |
| `greater_than` | Numeric comparison | `age greater_than "18"` |
| `less_than` | Numeric comparison | `score less_than "100"` |
| `semver_gte` | Semantic version >= | `app_version semver_gte "2.0.0"` |
| `semver_lte` | Semantic version <= | `app_version semver_lte "3.0.0"` |

Context attribute values are coerced to strings for comparison. If the attribute is missing from the context, the condition evaluates to false.

Each condition can also be **negated** to invert its result.

### Condition groups

Conditions are organized into **groups** joined by AND or OR logic. Groups can be nested for complex targeting:

```
AND
  ├── plan equals "enterprise"
  ├── OR
  │   ├── country in "US,CA"
  │   └── email ends_with "@partner.com"
  └── age greater_than "18"
```

This matches enterprise users who are either in US/CA or have a partner email, and are over 18.

An empty condition group (no conditions) always matches.

### Example: targeting beta users

Create a rule on the `dark-mode` flag:

| Field | Value |
|---|---|
| Name | Beta testers |
| Flag | dark-mode |
| Variant | on |
| Priority | 1 |
| Conditions | `email ends_with "@beta.example.com"` |

Now any user whose email ends with `@beta.example.com` gets `dark-mode = true`, while everyone else gets the default (`false`).

### Percentage-based rollouts

Flags support built-in percentage rollouts via `rolloutPercentage` (0–100). Woof uses a deterministic sticky hash (FNV-1a) combining the flag key and a user attribute to assign each user to a consistent bucket. The same user always gets the same result for the same flag.

Set a rollout percentage on a flag to gradually ramp up exposure:

| Setting | Description |
|---|---|
| `rolloutPercentage` | Percentage of users who receive the default variant (0–100) |
| `stickinessAttribute` | Context attribute to hash on — `user_id` (default), `session_id`, or `device_id` |

Users inside the rollout receive the default variant with reason `SPLIT`. Users outside receive the first variant with reason `STATIC`.

You can set these via the admin UI or the API:

```sh
curl -X PUT https://flags.example.com/api/v1/flags/dark-mode \
  -H "Content-Type: application/json" \
  -d '{"rolloutPercentage": 25, "stickinessAttribute": "user_id"}'
```

### Via the API

```sh
curl -X POST https://flags.example.com/api/v1/rules \
  -H "Content-Type: application/json" \
  -d '{
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
  }'
```

## Segments

Segments are reusable condition groups that define user cohorts. Instead of duplicating the same conditions across multiple rules, define a segment once and reference it.

### Example segments

**Beta testers:**
```
AND
  └── email ends_with "@beta.example.com"
```

**Enterprise US users:**
```
AND
  ├── plan equals "enterprise"
  └── country in "US,CA"
```

### Creating a segment

In the admin UI, navigate to **Segments** and define:

| Field | Description |
|---|---|
| **Name** | Human-readable label |
| **Key** | Unique identifier (e.g., `beta-testers`) |
| **Description** | What this cohort represents |
| **Condition group** | The matching logic |

### Via the API

```sh
curl -X POST https://flags.example.com/api/v1/segments \
  -H "Content-Type: application/json" \
  -d '{
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
  }'
```

## Evaluation order

When a flag is evaluated, Woof follows this sequence:

```
1. Kill switch active?
   └── Yes → return DISABLED (reason: kill_switch)

2. Prerequisites met? (all prerequisite flags must be enabled)
   └── No  → return DISABLED (reason: prerequisite_unmet)

3. Within schedule window? (scheduleStart / scheduleEnd)
   └── No  → return DISABLED (reason: schedule_not_started or schedule_expired)

4. Flag enabled?
   └── No  → return DISABLED (reason: disabled)

5. Do any targeting rules match?
   └── Evaluate rules in priority order (lowest number first)
   └── For each rule: conditions must match AND all referenced segments must match
   └── First match → return rule's variant with reason TARGETING_MATCH

6. Percentage rollout?
   └── Compute sticky hash → user inside rollout falls through to default
   └── User outside rollout → return first variant with reason STATIC

7. Return default variant (reason: SPLIT if rollout > 0, STATIC otherwise)
```

If at any point a referenced variant doesn't exist (e.g., a rule points to a deleted variant), Woof returns a **code-default response** — no value, with reason `UNKNOWN`. This tells the SDK to use the application's code-level default value rather than failing.

### Kill switch

Set `killSwitch: true` on a flag to force it off immediately, regardless of its enabled state, rules, or schedule. This is the highest-priority override — useful for incident response.

### Prerequisites

A flag can declare `prerequisites` — an array of other flag keys that must all be enabled for this flag to activate. If any prerequisite is missing or disabled, evaluation returns `DISABLED`.

### Schedule windows

Set `scheduleStart` and/or `scheduleEnd` (ISO 8601 datetimes) to automatically activate or deactivate a flag based on time. The flag returns `DISABLED` outside the window.

## Testing with the simulator

The admin UI includes a **Simulator** page where you can test flag evaluation without making API calls. Enter a targeting key and context attributes, pick a flag, and see exactly what value would be returned and why — including which rule matched.

## Audit log

Every change — flag created, rule updated, segment deleted, settings modified — is recorded in the audit log. Navigate to **Audit** in the admin UI to see:

- **Timestamp** of the change
- **User** who made it (from SSO identity)
- **Action** (created, updated, deleted, toggled)
- **Entity** that was affected
- **Details** describing the change

The audit log is append-only and retains the most recent 500 entries.
