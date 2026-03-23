---
name: one-auth
description: Enable One Auth — a drop-in authentication widget that lets your users connect their third-party apps (Gmail, Slack, HubSpot, etc.) to your application. Supports OAuth and non-OAuth integrations across 250+ platforms with project-level multi-tenant configuration.
---

# One Auth Integration Guide

One Auth is a drop-in authentication widget that lets your users connect their third-party apps to your application. It supports 250+ integrations — both OAuth and non-OAuth — including Gmail, Slack, HubSpot, Salesforce, QuickBooks, and more. Configuration is managed per-project via the [One Dashboard](https://app.withone.ai/settings/authkit), enabling multi-tenant architectures where each project maintains its own set of visible apps, OAuth credentials, and scopes.

## What is One Auth?

One Auth is a pre-built, embeddable authentication component that:
- Lets your users connect their third-party apps (Gmail, Slack, HubSpot, etc.) to your application
- Supports both OAuth and non-OAuth integrations across 250+ platforms
- Handles token management and refresh automatically
- Works with any frontend framework (React, Vue, vanilla JS)
- Configurable per-project via the [One Dashboard](https://app.withone.ai/settings/authkit) — choose which apps are visible, use your own OAuth credentials or One's defaults, and customize scopes
- Requires a backend token endpoint

## Prerequisites

- One API key from https://app.withone.ai/settings/api-keys
- Backend capable of making authenticated API calls
- Frontend capable of running JavaScript

---

## Architecture Overview

```
┌─────────────┐     ┌─────────────────┐     ┌─────────────┐
│   Frontend  │────▶│  Your Backend   │────▶│   One API   │
│ (One Auth)  │     │ (Token Endpoint)│     │             │
└─────────────┘     └─────────────────┘     └─────────────┘
       │                                           │
       └───────────── OAuth Flow ──────────────────┘
```

1. Frontend calls your token endpoint (with pagination params)
2. Your backend generates a One session token
3. One Auth uses token to manage OAuth flow
4. On success, you receive connection details to store

---

## Step 1: Install Package

```bash
npm install @withone/auth
# or
yarn add @withone/auth
```

---

## Step 2: Backend Token Endpoint

Your backend needs an endpoint that generates an Auth token by calling the One API.

### Environment Variables

```env
ONE_SECRET_KEY=sk_test_your_secret_key_here
```

| Variable | Description |
|---|---|
| `ONE_SECRET_KEY` | Your secret key from [One dashboard](https://app.withone.ai/settings/api-keys) |

### Requirements
- Must be accessible via full URL (not relative path)
- Must include CORS headers (Auth iframe calls this endpoint)
- Should identify the user via `x-user-id` header
- Must handle pagination — the Auth widget sends `page` and `limit` as query parameters

### How It Works

1. Your endpoint extracts the `x-user-id` header and validates it
2. The Auth widget sends `page` and `limit` as query parameters for paginated integration lists
3. It calls `POST https://api.withone.ai/v1/authkit/token?page={page}&limit={limit}` with your `ONE_SECRET_KEY` in the `X-One-Secret` header and a JSON body containing the user's `identity` and `identityType`
4. The API returns the integration list, which is forwarded back to the client

### Token Generation Code

```typescript
import { NextRequest, NextResponse } from "next/server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-user-id",
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

// POST /api/one-auth
export async function POST(req: NextRequest) {
  try {
    const userId = req.headers.get("x-user-id");
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: corsHeaders }
      );
    }

    // The Auth widget sends pagination params as query parameters
    const page = req.nextUrl.searchParams.get("page");
    const limit = req.nextUrl.searchParams.get("limit");

    const response = await fetch(
      `https://api.withone.ai/v1/authkit/token?page=${page}&limit=${limit}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-One-Secret": process.env.ONE_SECRET_KEY!,
        },
        body: JSON.stringify({
          identity: userId,
          identityType: "user",
        }),
      }
    );

    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to generate token" },
        { status: response.status, headers: corsHeaders }
      );
    }

    const data = await response.json();
    return NextResponse.json(data, { headers: corsHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to generate token" },
      { status: 500, headers: corsHeaders }
    );
  }
}
```

### Example cURL Request

```bash
curl -X POST "https://your-domain.com/api/one-auth" \
  -H "Content-Type: application/json" \
  -H "x-user-id: f47ac10b-58cc-4372-a567-0e02b2c3d479"
```

### Response

**Success (200):**
```json
{
  "rows": [
    {
      "id": 41596,
      "connectionDefId": 34,
      "type": "api",
      "title": "ActiveCampaign",
      "image": "https://assets.withone.ai/connectors/activecampaign.svg",
      "environment": "test",
      "tags": [],
      "active": true
    },
    {
      "id": 41524,
      "connectionDefId": 109,
      "type": "api",
      "title": "Anthropic",
      "image": "https://assets.withone.ai/connectors/anthropic.svg",
      "environment": "test",
      "tags": [],
      "active": true
    }
  ],
  "total": 247,
  "pages": 3,
  "page": 1,
  "requestId": 110256
}
```

The response includes a paginated list of available integrations. The widget handles pagination automatically by calling your token endpoint with different `page` values.

**Error (401) — Missing user ID:**
```json
{ "error": "Unauthorized" }
```

### Identity Types

| Type | Use Case |
|------|----------|
| `user` | Personal connections per user |
| `team` | Shared connections within a team |
| `organization` | Company-wide shared connections |
| `project` | Project-scoped isolated connections |

### Required CORS Headers

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization, x-user-id
```

**Important:** Include any custom headers you use (like `x-user-id`) in the allowed headers.

---

## Step 3: Frontend Integration

### Using the React Hook

```typescript
import { useOneAuth } from "@withone/auth";

function ConnectButton() {
  const { open } = useOneAuth({
    token: {
      url: "https://your-domain.com/api/one-auth", // MUST be full URL
      headers: {
        "x-user-id": currentUserId,
      },
    },
    selectedConnection: "Gmail",  // Optional: skip list, go directly to this integration
    onSuccess: (connection) => {
      // connection.key - unique identifier for this connection
      // connection.platform - e.g., "gmail"
      // connection.environment - "live" or "test"

      saveConnectionToDatabase(connection);
    },
    onError: (error) => {
      console.error("Connection failed:", error);
    },
    onClose: () => {
      console.log("Modal closed");
    },
  });

  return (
    <button onClick={() => open()}>
      Connect Integration
    </button>
  );
}
```

### Critical: Token URL Must Be Full URL

```typescript
// CORRECT - Full URL
url: "https://your-domain.com/api/one-auth"
url: `${window.location.origin}/api/one-auth`

// INCORRECT - Will fail
url: "/api/one-auth"
```

### selectedConnection Parameter

Pass the integration's **display name** to skip the integration list:

```typescript
// Opens directly to Gmail auth flow
selectedConnection: "Gmail"

// Opens directly to Slack auth flow
selectedConnection: "Slack"

// Opens to integration list (user picks)
selectedConnection: undefined
```

**Note:** Use the display name (e.g., "Gmail", "Google Calendar", "HubSpot"), not the platform ID.

---

## Step 4: Store Connections

When `onSuccess` fires, save the connection to your database.

### Connection Object Structure

```typescript
interface ConnectionRecord {
  _id: string;
  platformVersion: string;
  connectionDefinitionId: string;
  name: string;
  key: string;              // Use this for API calls
  environment: string;      // "live" or "test"
  platform: string;         // "gmail", "slack", etc.
  secretsServiceId: string;
  identity?: string;
  identityType?: "user" | "team" | "organization" | "project";
  settings: {
    parseWebhookBody: boolean;
    showSecret: boolean;
    allowCustomEvents: boolean;
    oauth: boolean;
  };
  throughput: {
    key: string;
    limit: number;
  };
  createdAt: number;
  updatedAt: number;
  updated: boolean;
  version: string;
  lastModifiedBy: string;
  deleted: boolean;
  tags: string[];
  active: boolean;
  deprecated: boolean;
}
```

### Recommended Database Schema

```sql
CREATE TABLE user_connections (
    id UUID PRIMARY KEY,
    user_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    connection_key TEXT UNIQUE,
    environment TEXT DEFAULT 'live',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

### Save on Success

```typescript
onSuccess: async (connection) => {
  await fetch("/api/connections", {
    method: "POST",
    body: JSON.stringify({
      user_id: currentUserId,
      platform: connection.platform,
      connection_key: connection.key,
      environment: connection.environment,
    }),
  });

  refreshConnectionsList();
}
```

---

## Step 5: List Available Integrations

Fetch available integrations from the One API.

### API Request

```
GET https://api.withone.ai/v1/available-connectors?authkit=true&limit=300
Headers:
  x-one-secret: YOUR_ONE_SECRET_KEY
```

### Response Structure

```json
{
  "rows": [
    {
      "platform": "gmail",
      "name": "Gmail",
      "category": "Communication",
      "image": "https://...",
      "description": "..."
    }
  ],
  "total": 200,
  "pages": 1,
  "page": 1
}
```

### Key Fields

| Field | Description |
|-------|-------------|
| `platform` | Platform identifier (use for API calls) |
| `name` | Display name (use for `selectedConnection`) |
| `category` | Category for grouping |
| `image` | Logo URL |

---

## Step 6: Using Connections

Once stored, use the `connection_key` to make API calls via One.

### Passthrough API

```
POST https://api.withone.ai/v1/passthrough/{platform}/{action}
Headers:
  x-one-secret: YOUR_ONE_SECRET_KEY
  x-one-connection-key: CONNECTION_KEY_FROM_DATABASE
  Content-Type: application/json
```

### Example: Send Gmail

```typescript
const response = await fetch(
  "https://api.withone.ai/v1/passthrough/gmail/messages/send",
  {
    method: "POST",
    headers: {
      "x-one-secret": ONE_SECRET_KEY,
      "x-one-connection-key": user.gmailConnectionKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: "recipient@example.com",
      subject: "Hello",
      body: "Message content",
    }),
  }
);
```

---

## Hook Configuration Options

```typescript
interface AuthProps {
  token: {
    url: string;                        // Full URL to your token endpoint
    headers?: Record<string, unknown>;  // Custom headers for token request
  };
  baseUrl?: string;          // Custom Auth UI URL (default: https://auth.withone.ai)
  appTheme?: "dark" | "light";
  title?: string;            // Modal title
  imageUrl?: string;         // Company logo URL
  companyName?: string;      // Company name displayed in modal
  selectedConnection?: string; // Pre-select an integration by display name
  showNameInput?: boolean;   // Show name input for the connection
  onSuccess?: (connection: ConnectionRecord) => void;
  onError?: (error: string) => void;
  onClose?: () => void;
}
```

---

## Configuration & Management

All configuration for what appears in the Auth component is managed via the **[One Dashboard](https://app.withone.ai/settings/authkit)** — not in code.

### What You Can Configure

| Setting | Description |
|---------|-------------|
| **Visible apps** | Choose which integrations appear in the Auth modal for your users |
| **OAuth credentials** | Use One's default client ID/secret, or provide your own for any integration |
| **Scopes** | Customize the OAuth scopes requested for each integration |

### Project-Level Scoping

AuthKit configuration is scoped at the **project level**, enabling multi-tenant architecture. Each project in your One account maintains its own independent set of visible apps, OAuth credentials, and scopes. This means you can serve different AuthKit configurations to different products or customer segments from a single One account.

> **Dashboard link:** [app.withone.ai/settings/authkit](https://app.withone.ai/settings/authkit)

---

## Local Development

### Chrome Security Flag

Chrome may block the Auth iframe from calling localhost. To fix:

1. Go to `chrome://flags`
2. Search for "Block insecure private network requests"
3. Set to **Disabled**
4. Restart Chrome

### Alternative: Use ngrok

Expose your local server via ngrok and use that URL for the token endpoint.

---

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| 405 Method Not Allowed | Missing OPTIONS handler | Add OPTIONS endpoint with CORS headers |
| CORS error | Missing or wrong CORS headers | Include all custom headers in Access-Control-Allow-Headers |
| Token fetch fails | Invalid secret key | Verify key at app.withone.ai/settings/api-keys |
| Opens list instead of integration | Wrong selectedConnection value | Use display name ("Gmail") not platform ID ("gmail") |
| Connection not saving | onSuccess not storing data | Save connection in onSuccess callback |
| Foreign key error | user_id references non-existent user | Remove foreign key constraint or ensure user exists |

---

## API Quick Reference

### Frontend Hook
```typescript
import { useOneAuth } from "@withone/auth";
const { open, close } = useOneAuth({ token, onSuccess, onError, onClose, selectedConnection });
```

### One API Endpoints
- **Available Connectors:** `GET /v1/available-connectors?authkit=true`
- **List Connections:** `GET /v1/vault/connections?identity={id}&identityType=user`
- **Passthrough:** `POST /v1/passthrough/{platform}/{action}`

### Documentation
- One Docs: https://withone.ai/docs
- Auth Setup: https://withone.ai/docs/auth
