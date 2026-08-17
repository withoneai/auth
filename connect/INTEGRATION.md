# Add "Connect with One" to your app

**Time: ~30 minutes.** By the end, your users click one button, grant your app
scoped access to their own tools (Gmail, Slack, Notion, HubSpot, 500+ more),
and your backend holds a token that One enforces on every call.

What you need to build, in total:

| Piece | Where | Size |
|---|---|---|
| 4 environment values | your server's `.env` | copy-paste |
| 1 button | your frontend | ~10 lines |
| 2 API routes (`authorize`, `callback`) | your backend | ~40 lines each |
| 1 completion page | your frontend | 1 line that matters |
| 1 token helper (refresh) | your backend | ~20 lines |

That's it. No OAuth expertise required — the routes below are complete and
copy-pasteable. Your users' credentials never touch your app; you only ever
hold a One token scoped to exactly what each user granted.

---

## The picture

```
your frontend          your backend                 One
─────────────          ────────────                 ───
[Connect button]
  modal opens ───────► /api/one/authorize
                          makes state + PKCE,
                          sets a cookie,
                          forwards user ──────────► One's connect screen:
                                                    sign in → pick tools →
                                                    approve access
                       /api/one/callback ◄───────── sends back a one-time code
                          checks state,
                          swaps code + secret ────► One's token endpoint
                          saves tokens       ◄───── access token + refresh token
                          → completion page
  modal closes, onSuccess() fires
```

Two things to hold on to:

1. **Your frontend never sees a token.** It only opens the flow and hears
   "done". Tokens live on your server.
2. **The user is in charge.** They pick which tools and how much access at
   consent time, and can narrow or revoke it later from One. Calls outside
   the grant get a `403` from One — by design, your code can't override it.

---

## Step 0 · One-time setup in the One dashboard

[app.withone.ai → Settings → OAuth Apps](https://app.withone.ai/settings/oauth-apps)

1. **Create an OAuth app.** Set your name and logo — users see both on the
   consent screen. You get a **Client ID** (public) and a **Client Secret**
   (shown once; server-only, never in a browser).
2. **Register your redirect URI** — the exact URL of your callback route,
   e.g. `https://yourapp.com/api/one/callback`. `https` required (`http`
   allowed only for `localhost`).
3. **Optional: create a permission set** — the connectors your app needs and
   the access level for each (full / read & write / read only / specific
   actions). Users see it pre-filled at consent and can only *narrow* it.
   Skip this and your app asks for full access to whatever the user chooses
   to share — which they can also narrow.

```bash
# .env — server only. The secret must NEVER reach a browser.
ONE_CLIENT_ID=fa31f443ee3ba6a86822e724b981472e2faa43a9
ONE_CLIENT_SECRET=pica_secret_...
ONE_REDIRECT_URI=https://yourapp.com/api/one/callback
ONE_PERMISSION_SET=12e0d405-...        # optional
```

## Step 1 · The button (frontend)

```bash
npm install @withone/connect
```

```tsx
"use client";

import { useOneConnect } from "@withone/connect";

export function ConnectWithOne() {
  const { open } = useOneConnect({
    authorize: { url: "https://yourapp.com/api/one/authorize" }, // your route, absolute
    window: "modal",        // your page stays visible, dimmed, One's card on top
    appTheme: "light",      // or "dark" — you pick, matches YOUR app
    onSuccess: () => {
      // Your backend already has the tokens by the time this fires.
    },
    onError: (error) => console.error(error),
    onClose: () => {},      // user closed the card without finishing
  });

  return <button onClick={open}>Connect your tools</button>;
}
```

`window` options: `"modal"` (recommended — card over your dimmed page),
`"popup"` (separate small window), `"redirect"` (same-tab round trip; the
mobile standard), `"auto"` (popup on desktop, redirect on mobile — the
default).

## Step 2 · The authorize route (backend)

This route protects your users. It creates two secrets — `state` (proves the
person who comes back is the person who left) and a PKCE verifier (proves the
server redeeming the code is yours) — keeps them in a cookie, and forwards
the user to One.

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
  if (userEmail) url.searchParams.set("login_hint", userEmail); // pre-fills their email
  const theme = req.nextUrl.searchParams.get("one_theme");
  if (theme) url.searchParams.set("theme", theme);
  // Forward these two so modal mode renders correctly:
  const embed = req.nextUrl.searchParams.get("one_embed");
  if (embed) url.searchParams.set("embed", embed);

  const res = NextResponse.redirect(url.toString(), 302);
  res.cookies.set("one_tx", JSON.stringify({ state, verifier }), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600, // matches One's 10-minute code lifetime
    path: "/api/one",
  });
  return res;
}
```

## Step 3 · The callback route (backend)

One sends the user back with a **one-time code**. The code is worthless on
its own — it only becomes tokens when combined with your secret and the PKCE
verifier, which exist nowhere but your server.

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
    await saveOneTokens(req, {                    // ← your storage
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    });
  }
  return res;
}
```

## Step 4 · The completion page (frontend)

One line. It tells the SDK the flow finished, so the modal closes and your
`onSuccess` fires. Works for every window mode.

```tsx
// app/one/complete/page.tsx
"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { completeOneConnect } from "@withone/connect";

export default function OneCompletePage() {
  const params = useSearchParams();
  useEffect(() => {
    completeOneConnect(
      params.get("status") === "success"
        ? { status: "success" }
        : { status: "error", message: "The connection was not completed." }
    );
  }, [params]);

  return <p>Finishing up…</p>;
}
```

## Step 5 · The token helper (backend)

Access tokens last 1 hour. Refresh tokens last 30 days and are **rotated on
every use** — always save BOTH new tokens. (Reusing an old refresh token
revokes the whole family; that's One's stolen-token alarm.)

```ts
const ONE_TOKEN_URL = "https://api.withone.ai/oauth/token";

export async function getOneAccessToken(userId: string): Promise<string> {
  const t = await loadOneTokens(userId);           // ← your storage
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

## Step 6 · Use the grant

```ts
const token = await getOneAccessToken(userId);

// What did the user grant? (Ungranted connections are invisible, not 403.)
const res = await fetch("https://api.withone.ai/api/oauth/connections", {
  headers: { Authorization: `Bearer ${token}` },
});
const { rows } = await res.json();
// rows: [{ platform: "gmail", key: "live::gmail::default::…", ... }]
```

Or point any MCP client (your agents included) at One's hosted MCP server
with the same bearer token:

```
https://mcp.withone.ai/mcp
Authorization: Bearer <access_token>
```

---

## The 3 errors you'll actually see

| You see | It means | Do |
|---|---|---|
| `401` on a refresh | Refresh token expired (30 days idle) or revoked by the user | Send the user through the connect flow again — one click for them |
| `403` on an action | The call is outside what the user granted (wrong tool, or write on a read-only grant) | Respect it. If your app genuinely needs more, ask the user to reconnect with wider access |
| `invalid_grant` at the token endpoint | Code already used, or older than 10 minutes | Restart the flow; codes are strictly single-use |

## Checklist before you ship

- [ ] Client secret only in server env — search your frontend bundle to be sure
- [ ] Redirect URI registered in One exactly matches `ONE_REDIRECT_URI` (scheme, host, path)
- [ ] Refresh saves **both** tokens, every time
- [ ] `401/403` paths show the user a friendly "reconnect" prompt, not a crash
