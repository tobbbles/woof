# Integration

Woof implements the [OpenFeature Remote Evaluation Protocol (OFREP)](https://openfeature.dev), so you can connect using any OpenFeature SDK with an OFREP provider. This guide covers the most common setups.

## Overview

The evaluation flow works like this:

1. Your application initializes an OpenFeature SDK with an OFREP provider pointed at your Woof instance
2. When you evaluate a flag, the SDK sends a POST request to `/ofrep/v1/evaluate/flags/{key}` with the evaluation context
3. Woof evaluates the flag against its rules and returns the result
4. The SDK returns the resolved value to your application, or the code-level default if evaluation fails

For client-side (browser) applications, the SDK uses the bulk evaluation endpoint (`POST /ofrep/v1/evaluate/flags`) to fetch all flags at once and caches them locally, using ETags to avoid re-downloading unchanged results.

## Server-side (Node.js / Bun / Deno)

### Install

```sh
npm install @openfeature/server-sdk @openfeature/ofrep-provider
```

### Configure

```typescript
import { OpenFeature } from "@openfeature/server-sdk";
import { OFREPProvider } from "@openfeature/ofrep-provider";

// Point the provider at your Woof instance
OpenFeature.setProvider(
  new OFREPProvider({
    baseUrl: "https://flags.example.com",
  })
);
```

If you've secured your OFREP endpoints with an API key, pass it in the headers:

```typescript
OpenFeature.setProvider(
  new OFREPProvider({
    baseUrl: "https://flags.example.com",
    headers: {
      Authorization: "Bearer your-ofrep-api-key",
    },
  })
);
```

Or use the `X-API-Key` header:

```typescript
OpenFeature.setProvider(
  new OFREPProvider({
    baseUrl: "https://flags.example.com",
    headers: {
      "X-API-Key": "your-ofrep-api-key",
    },
  })
);
```

For dynamic tokens (e.g., rotating credentials), use a header factory:

```typescript
OpenFeature.setProvider(
  new OFREPProvider({
    baseUrl: "https://flags.example.com",
    headersFactory: () => {
      const token = getTokenFromVault();
      return [["Authorization", `Bearer ${token}`]];
    },
  })
);
```

### Evaluate flags

```typescript
const client = OpenFeature.getClient();

// Boolean flag with a default of false
const darkMode = await client.getBooleanValue("dark-mode", false, {
  targetingKey: "user-123",
  plan: "enterprise",
});

// String flag
const theme = await client.getStringValue("theme", "light", {
  targetingKey: "user-123",
});

// Number flag
const rateLimit = await client.getNumberValue("api-rate-limit", 100, {
  targetingKey: "service-abc",
});

// Object flag
const config = await client.getObjectValue("dashboard-config", {}, {
  targetingKey: "user-123",
});
```

The second argument is the **default value** — returned when the flag doesn't exist, evaluation fails, or the flag uses the code-default pattern. The third argument is the **evaluation context**.

### Get evaluation details

For more information about why a flag resolved to a particular value:

```typescript
const details = await client.getBooleanDetails("dark-mode", false, {
  targetingKey: "user-123",
});

console.log(details.value);       // true
console.log(details.reason);      // "TARGETING_MATCH"
console.log(details.variant);     // "on"
console.log(details.flagMetadata); // { flagType: "boolean", ruleName: "beta-users" }
```

### Environment variables

The OFREP provider also supports configuration via environment variables:

| Variable | Purpose | Example |
|---|---|---|
| `OFREP_ENDPOINT` | Base URL | `https://flags.example.com` |
| `OFREP_TIMEOUT_MS` | Request timeout in ms | `5000` |
| `OFREP_HEADERS` | Static headers (comma-separated) | `Authorization=Bearer token123` |

Explicitly passed options take precedence over environment variables.

## Client-side (Web / Browser)

### Install

```sh
npm install @openfeature/web-sdk @openfeature/ofrep-web-provider
```

### Configure

```typescript
import { OpenFeature } from "@openfeature/web-sdk";
import { OFREPWebProvider } from "@openfeature/ofrep-web-provider";

// Set the evaluation context (identifies the current user)
await OpenFeature.setContext({
  targetingKey: "user-123",
  plan: "enterprise",
  country: "US",
});

// Initialize the provider — this fetches all flags via bulk evaluation
await OpenFeature.setProviderAndWait(
  new OFREPWebProvider({
    baseUrl: "https://flags.example.com",
    pollInterval: 30000, // re-fetch every 30 seconds
  })
);
```

The web provider uses the bulk evaluation endpoint and ETag-based caching. On each poll, it sends `If-None-Match` with the previous ETag — if nothing changed, Woof responds with `304 Not Modified` and no data transfer occurs.

With an API key:

```typescript
await OpenFeature.setProviderAndWait(
  new OFREPWebProvider({
    baseUrl: "https://flags.example.com",
    pollInterval: 30000,
    headers: {
      "X-API-Key": "your-ofrep-api-key",
    },
  })
);
```

### Evaluate flags

```typescript
const client = OpenFeature.getClient();

// Flags are already cached from the bulk fetch
const darkMode = client.getBooleanValue("dark-mode", false);
const theme = client.getStringValue("theme", "light");
```

Note: client-side evaluation is synchronous (no `await`) because flags were pre-fetched during initialization.

### React

```typescript
import { OpenFeatureProvider, useFlag } from "@openfeature/react-sdk";
import { OFREPWebProvider } from "@openfeature/ofrep-web-provider";

const provider = new OFREPWebProvider({
  baseUrl: "https://flags.example.com",
  pollInterval: 30000,
});

function App() {
  return (
    <OpenFeatureProvider provider={provider}>
      <MyComponent />
    </OpenFeatureProvider>
  );
}

function MyComponent() {
  const { value: darkMode } = useFlag("dark-mode", false);
  return <div className={darkMode ? "dark" : "light"}>...</div>;
}
```

## Go

### Install

```sh
go get github.com/open-feature/go-sdk-contrib/providers/ofrep
```

### Configure and evaluate

```go
package main

import (
    "context"
    "fmt"

    "github.com/open-feature/go-sdk/openfeature"
    "github.com/open-feature/go-sdk-contrib/providers/ofrep"
)

func main() {
    // Initialize the provider
    provider := ofrep.NewProvider("https://flags.example.com")
    openfeature.SetProvider(provider)

    client := openfeature.NewClient("my-app")

    // Evaluate a boolean flag
    ctx := openfeature.NewEvaluationContext("user-123", map[string]interface{}{
        "plan": "enterprise",
    })

    darkMode, _ := client.BooleanValue(context.Background(), "dark-mode", false, ctx)
    fmt.Println("Dark mode:", darkMode)
}
```

With authentication:

```go
provider := ofrep.NewProvider(
    "https://flags.example.com",
    ofrep.WithBearerToken("your-ofrep-api-key"),
)

// or
provider := ofrep.NewProvider(
    "https://flags.example.com",
    ofrep.WithApiKeyAuth("your-ofrep-api-key"),
)
```

## Other languages

OFREP providers are available for many languages. The configuration pattern is the same: point the provider at your Woof base URL and optionally pass authentication headers.

| Language | Package | Docs |
|---|---|---|
| Java | `dev.openfeature.contrib:ofrep` | [GitHub](https://github.com/open-feature/java-sdk-contrib/tree/main/providers/ofrep) |
| Python | `openfeature-provider-ofrep` | [GitHub](https://github.com/open-feature/python-sdk-contrib/tree/main/providers/ofrep) |
| .NET | `OpenFeature.Contrib.Providers.Ofrep` | [GitHub](https://github.com/open-feature/dotnet-sdk-contrib/tree/main/src/OpenFeature.Contrib.Providers.Ofrep) |
| PHP | `open-feature/ofrep-provider` | [GitHub](https://github.com/open-feature/php-sdk-contrib/tree/main/providers/OFREP) |
| Kotlin | `dev.openfeature.contrib:ofrep` | [GitHub](https://github.com/open-feature/kotlin-sdk-contrib/tree/main/providers/ofrep) |

## Direct HTTP usage

You can also call the OFREP API directly without an SDK.

### Single flag evaluation

```sh
curl -X POST https://flags.example.com/ofrep/v1/evaluate/flags/dark-mode \
  -H "Content-Type: application/json" \
  -d '{
    "context": {
      "targetingKey": "user-123",
      "plan": "enterprise"
    }
  }'
```

Response:

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

### Bulk evaluation

```sh
curl -X POST https://flags.example.com/ofrep/v1/evaluate/flags \
  -H "Content-Type: application/json" \
  -d '{
    "context": {
      "targetingKey": "user-123"
    }
  }'
```

Response includes an `ETag` header. Pass it back on subsequent requests to avoid re-downloading unchanged results:

```sh
curl -X POST https://flags.example.com/ofrep/v1/evaluate/flags \
  -H "Content-Type: application/json" \
  -H "If-None-Match: \"abc123\"" \
  -d '{
    "context": {
      "targetingKey": "user-123"
    }
  }'

# Returns 304 Not Modified if nothing changed
```
