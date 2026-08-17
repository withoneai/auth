# @withone/connect

Let your users grant your application **scoped, revocable access to their own
One-connected tools** — Gmail, Slack, Notion, HubSpot and 500+ more — through
the standard OAuth 2.1 authorization-code flow (with PKCE).

The mental model, in one breath:

> Your user owns their connections inside One. You never see their Gmail
> password — you hold a One access token scoped to **exactly what they
> granted**, and they can narrow or revoke it at any time. One enforces the
> grant on every single call.

This is a different product from [`@withone/auth`](https://github.com/withoneai/auth).
Auth puts connections **in your One project** (you own them). Connect puts
connections **in your user's own One account** and hands you a scoped grant.

---

## How it works

```
your app (browser)      your backend             One
─────────────────       ────────────             ───
useOneConnect().open()
   │  popup/redirect →  GET /api/one/authorize
   │                       state + PKCE, cookie
   │                       302 ─────────────────► /oauth/authorize
   │                                              user signs in (email code),
   │                                              connects tools, grants access
   │                    GET /api/one/callback ◄── 302 redirect_uri?code&state
   │                       verify state,
   │                       POST /oauth/token ───► code + verifier + secret
   │                       store tokens      ◄─── access (1h) + refresh (30d)
   │                       302 → completion page
   ◄── completeOneConnect() closes the loop
onSuccess() fires
```

Three window modes:

- **`iframe`** — authkit-style: your page stays visible and dimmed while
  One's card floats above it in a transparent iframe. The best-feeling mode —
  with one transport constraint: the flow rides on the user's One session
  cookie, which is third-party inside a cross-site iframe. Same-site setups
  (e.g. localhost dev) work everywhere; cross-site production embedding needs
  One's CHIPS (`Partitioned`) session cookies and a per-client
  `frame-ancestors` allow-list on One's side. Use `popup`/`redirect` if you
  can't accept that.
- **`popup`** — a floating popup window over your dimmed page. Your page never
  navigates and keeps all its state.
- **`redirect`** — a same-tab trip to One and back to the exact page the user
  started on. The default on mobile (popups become tabs there), and the most
  bulletproof mode everywhere.

`window: "auto"` (the default) picks popup on desktop and redirect on mobile.

---

## 1 · Install

```bash
npm install @withone/connect
```

## 2 · Create your OAuth app in One

[app.withone.ai → Settings → OAuth Apps](https://app.withone.ai/settings/oauth-apps)

- You get a **Client ID** (public) and a **Client Secret** (shown once —
  server-only, never in a browser).
- Register your **redirect URI** (e.g. `https://yourapp.com/api/one/callback`).
  `https` is required; plain `http` is allowed only for `localhost`.
- Optionally create a **permission set**: the connectors your app needs and the
  access level for each (full / read & write / read only / custom actions).
  Your user sees it pre-filled at consent and can only narrow it. Without a
  permission set, your app asks for full access to all of the user's
  connections — which they can also narrow.

```bash
# .env — server only. NEVER ship the secret to a browser.
ONE_CLIENT_ID=...
ONE_CLIENT_SECRET=pica_secret_...
ONE_PERMISSION_SET=843467e7-...        # optional
ONE_REDIRECT_URI=https://yourapp.com/api/one/callback
```

## 3 · Frontend: the button

```tsx
"use client";

import { useOneConnect } from "@withone/connect";

export function ConnectWithOne() {
  const { open } = useOneConnect({
    authorize: { url: "https://yourapp.com/api/one/authorize" }, // absolute URL
    appTheme: "light",
    onSuccess: () => {
      // Your backend already has the tokens by the time this fires.
      console.log("Connected!");
    },
    onError: (error) => console.error(error),
    onClose: () => console.log("User closed the window"),
  });

  return <button onClick={open}>Connect your tools</button>;
}
```

| Option | Type | Description |
|---|---|---|
| `authorize.url` | `string` | Your backend route from step 4. Must be absolute. |
| `window` | `"auto" \| "iframe" \| "popup" \| "redirect"` | Default `"auto"`: popup on desktop, redirect on mobile. See the transport notes above for `iframe`. |
| `appTheme` | `"dark" \| "light"` | The flow renders in the theme YOU pick — there is no user-facing toggle. Appended to your authorize route as `?one_theme=`; forward it to One (step 4). |
| `onSuccess` | `() => void` | The grant completed and your server stored the tokens. |
| `onError` | `(error: string) => void` | The flow failed. |
| `onClose` | `() => void` | The user abandoned the flow. |

## 4 · Backend: the authorize route

Generates `state` (CSRF protection) and PKCE (proof that the code redeemer is
you), stashes both in an httpOnly cookie, and forwards the browser to One.

```ts
// app/api/one/authorize/route.ts (Next.js App Router)
import { NextRequest, NextResponse } from "next/server";
import { createHash, randomBytes } from "crypto";

const ONE_AUTHORIZE_URL = "https://api.withone.ai/oauth/authorize";

export async function GET(req: NextRequest) {
  // Identify YOUR user however you normally do (session, JWT, ...).
  const userEmail = await getCurrentUserEmail(req); // ← your code

  const state = randomBytes(16).toString("hex");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  const url = new URL(ONE_AUTHORIZE_URL);
  url.searchParams.set("client_id", process.env.ONE_CLIENT_ID!);
  url.searchParams.set("redirect_uri", process.env.ONE_REDIRECT_URI!);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "user:connections:read user:connections:write");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (process.env.ONE_PERMISSION_SET) {
    url.searchParams.set("permission_set", process.env.ONE_PERMISSION_SET);
  }
  if (userEmail) {
    url.searchParams.set("login_hint", userEmail); // pre-fills their email
  }
  const theme = req.nextUrl.searchParams.get("one_theme");
  if (theme) url.searchParams.set("theme", theme);

  const res = NextResponse.redirect(url.toString(), 302);
  res.cookies.set("one_tx", JSON.stringify({ state, verifier }), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600, // matches One's 10-minute authorization-code lifetime
    path: "/api/one",
  });
  return res;
}
```

## 5 · Backend: the callback route

One redirects back with a **single-use code** (worthless without your secret
and the PKCE verifier). Exchange it server-side, store the tokens, then send
the browser to your completion page.

```ts
// app/api/one/callback/route.ts
import { NextRequest, NextResponse } from "next/server";

const ONE_TOKEN_URL = "https://api.withone.ai/oauth/token";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const tx = req.cookies.get("one_tx")?.value;

  const parsed = tx ? JSON.parse(tx) : null;
  if (!code || !state || !parsed || parsed.state !== state) {
    return NextResponse.redirect("/one/complete?status=error", 302);
  }

  const basic = Buffer.from(
    `${process.env.ONE_CLIENT_ID}:${process.env.ONE_CLIENT_SECRET}`
  ).toString("base64");

  const tokenRes = await fetch(ONE_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: process.env.ONE_REDIRECT_URI!,
      code_verifier: parsed.verifier,
    }),
  });

  const res = NextResponse.redirect(
    tokenRes.ok ? "/one/complete?status=success" : "/one/complete?status=error",
    302
  );
  res.cookies.delete("one_tx");

  if (tokenRes.ok) {
    // { access_token, refresh_token, token_type: "bearer", expires_in, scope }
    const tokens = await tokenRes.json();
    await saveOneTokens(req, {                    // ← your code
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    });
  }
  return res;
}
```

## 6 · Frontend: the completion page

One line. Works for both popup and redirect modes.

```tsx
// app/one/complete/page.tsx
"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { completeOneConnect } from "@withone/connect";

export default function OneCompletePage() {
  const params = useSearchParams();
  useEffect(() => {
    const ok = completeOneConnect(
      params.get("status") === "success"
        ? { status: "success" }
        : { status: "error", message: "The connection was not completed." }
    );
    // ok === false → the user opened this URL directly; show fallback UI.
  }, [params]);

  return <p>Finishing up…</p>;
}
```

## 7 · Backend: refreshing the token

Access tokens last 1 hour (configurable on your OAuth app). Refresh tokens
last 30 days and are **rotated on every use** — always store BOTH new tokens;
reusing an old refresh token revokes the entire token family (theft
protection).

```ts
const ONE_TOKEN_URL = "https://api.withone.ai/oauth/token";

export async function getOneAccessToken(userId: string): Promise<string> {
  const t = await loadOneTokens(userId);           // ← your code
  if (Date.now() < t.expiresAt - 60_000) return t.accessToken;

  const res = await fetch(ONE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: t.refreshToken,
      client_id: process.env.ONE_CLIENT_ID!,
    }),
  });
  if (!res.ok) throw new Error("One refresh failed — re-run the connect flow");

  const tokens = await res.json();
  await saveOneTokens(userId, {                    // BOTH tokens — rotation!
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  });
  return tokens.access_token;
}
```

## 8 · Backend: using the grant

```ts
const token = await getOneAccessToken(userId);

// Discover what the user granted. Ungranted connections are invisible,
// not merely forbidden.
const res = await fetch("https://api.withone.ai/api/oauth/connections", {
  headers: { Authorization: `Bearer ${token}` },
});
const { rows } = await res.json();
// rows: [{ platform: "gmail", key: "live::gmail::default::…", ... }]
```

Execute actions with the same bearer token — e.g. point any MCP client at
One's hosted MCP server:

```
https://mcp.withone.ai/mcp
Authorization: Bearer <access_token>
```

Every call is checked inside One against what the user granted. A call outside
the grant returns `403` — your code cannot override it, and that is the point.

---

## Security notes

- The client secret lives on your server only. One supports
  `client_secret_basic` (the `Authorization: Basic` header) — not
  `client_secret_post`.
- The authorization code is single-use and expires in 10 minutes.
- The SDK never handles tokens; it only opens a first-party One window and
  reports completion. There is nothing sensitive in the browser to leak.
- Your user can revoke or narrow the grant at any time from their One
  settings. Handle `401`/`403` by prompting them to reconnect.

## License

GPL-3.0
