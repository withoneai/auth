# @withone/connect

Let your users grant your application **scoped, revocable access to their own
One-connected tools** — Gmail, Slack, Notion, Stripe and 500+ more — through
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
your app (browser)         your backend               One
─────────────────          ────────────               ───
OneConnect.open()
   │  modal opens ───────► GET  /api/one/authorize
   │  (iframe)                  mint state + PKCE,
   │                            set httpOnly cookie,
   │                            302 ────────────────► /oauth/authorize
   │                                                  user signs in (email code),
   │                                                  connects tools, narrows &
   │                                                  grants access
   │                       GET  /api/one/callback ◄── 302 redirect_uri?code&state
   │                            verify state,
   │                            POST /oauth/token ──► code + verifier + secret
   │                            store tokens     ◄─── access + refresh token
   │                            302 → /?one_connect=success
   ◄── SDK sees ?one_connect= on the frame, closes the modal
onSuccess() fires. Done — no completion page to build.
```

Everything sensitive (state, PKCE verifier, client secret, tokens) lives on
**your server**. The SDK is a thin modal opener: it never touches a token.

You build exactly **two backend routes and one button**. Both routes are
plain OAuth — copy them from below.

---

## 1 · Create your OAuth app in One

Dashboard → **Settings → OAuth Apps → New OAuth app**.

- You get a **Client ID** (public) and a **Client Secret** (shown once —
  server-only, never in a browser).
- Register your **redirect URI** (e.g. `https://yourapp.com/api/one/callback`).
- Pick the **access-token lifetime**: 7 days, 30 days, 90 days or 1 year.
- Optionally create a **permission set**: the connectors your app needs and
  the access level for each (full / read & write / read only / specific
  actions). Your user sees it pre-filled at consent and can only *narrow* it.
  Without a permission set your app asks for access to the user's
  connections generally — which they can also narrow.

```bash
# .env — server only. NEVER ship the secret to a browser.
ONE_CLIENT_ID=...
ONE_CLIENT_SECRET=one_secret_...
ONE_PERMISSION_SET=79659c66-...        # optional
ONE_REDIRECT_URI=https://yourapp.com/api/one/callback
```

## 2 · Install

```bash
npm install @withone/connect
```

## 3 · Frontend: the button

```tsx
"use client";

import { useOneConnect } from "@withone/connect";

export function ConnectWithOne() {
  const { open } = useOneConnect({
    authorize: { url: "https://yourapp.com/api/one/authorize" }, // absolute URL
    appTheme: "light", // or "dark" — the card renders in the theme YOU pick
    onSuccess: () => {
      // Your backend already stored the tokens by the time this fires.
    },
    onError: (error) => console.error(error),
    onClose: () => {}, // user closed the card without finishing
  });

  return <button onClick={open}>Connect your tools</button>;
}
```

| Option | Type | Description |
|---|---|---|
| `authorize.url` | `string` | Your backend route from step 4. Must be absolute. |
| `appTheme` | `"dark" \| "light"` | Theme for the card. The SDK carries it itself — nothing for your backend to forward. |
| `onSuccess` | `() => void` | The grant completed and your server stored the tokens. |
| `onError` | `(error: string) => void` | The flow failed (message included). |
| `onClose` | `() => void` | The user closed the card without a result. |

## 4 · Backend: the authorize route

Generates `state` (CSRF proof) and PKCE (proof that whoever redeems the code
is this server), stashes both in an httpOnly cookie, and 302s the browser to
One.

```ts
// app/api/one/authorize/route.ts (Next.js App Router)
import { createHash, randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";

const ONE_AUTHORIZE_URL = "https://api.withone.ai/oauth/authorize";

export async function GET(req: NextRequest) {
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
  // Optional: your user's email. One pre-fills (never locks) their sign-in.
  const userEmail = await getCurrentUserEmail(req); // ← your code
  if (userEmail) url.searchParams.set("login_hint", userEmail);

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
and the PKCE verifier). Exchange it server-side, store the tokens, then
redirect anywhere on your site with `?one_connect=success` appended — the SDK
watches the frame for that parameter and closes the modal. **There is no
completion page to build.**

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
    return NextResponse.redirect(
      new URL(
        "/?one_connect=error&one_connect_message=" +
          encodeURIComponent("The sign-in attempt expired or was tampered with."),
        req.url,
      ),
      302,
    );
  }

  const basic = Buffer.from(
    `${process.env.ONE_CLIENT_ID}:${process.env.ONE_CLIENT_SECRET}`,
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
    new URL(
      tokenRes.ok
        ? "/?one_connect=success"
        : "/?one_connect=error&one_connect_message=" +
          encodeURIComponent("Token exchange failed."),
      req.url,
    ),
    302,
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

## 6 · Backend: refreshing the token

Access tokens last as long as you chose when creating the app (7 days to
1 year). Refresh tokens last **30 days** and are **rotated on every use** —
always store BOTH new tokens; reusing an old refresh token revokes the entire
token family (theft protection).

```ts
const ONE_TOKEN_URL = "https://api.withone.ai/oauth/token";

export async function getOneAccessToken(userId: string): Promise<string> {
  const t = await loadOneTokens(userId);           // ← your code
  if (Date.now() < t.expiresAt - 60_000) return t.accessToken;

  // The refresh exchange is authenticated exactly like the code
  // exchange — same Basic header. The public-client form (client_id in
  // the body, no secret) is rejected with 401.
  const basic = Buffer.from(
    `${process.env.ONE_CLIENT_ID}:${process.env.ONE_CLIENT_SECRET}`,
  ).toString("base64");
  const res = await fetch(ONE_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: t.refreshToken,
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

## 7 · Backend: using the grant

The bearer token works on One's standard `/v1` API — the same routes every
other credential uses.

```ts
const token = await getOneAccessToken(userId);

// Discover what the user granted. Ungranted connections are invisible,
// not merely forbidden.
const res = await fetch("https://api.withone.ai/v1/connections", {
  headers: { Authorization: `Bearer ${token}` },
});
```

Execute actions through `/v1/passthrough/*` with the same bearer. Every call
is checked inside One against what the user granted — a call outside the
grant returns `403`, and your code cannot override it. That is the point.

---

## What your user sees afterwards

In their own One dashboard, your app appears under **Authorized apps** with
what they granted and when it was last used. They can revoke it at any time —
handle `401`/`403` by prompting them to reconnect. In *your* dashboard, your
OAuth app lists every user who granted access, and you can revoke individual
users too.

## Security notes

- The client secret lives on your server only. Authenticate the token
  exchange with the `Authorization: Basic` header, as shown above.
- The authorization code is single-use and expires in 10 minutes.
- The SDK never handles tokens; it only opens One's card in a modal iframe
  and watches for the `?one_connect=` result. There is nothing sensitive in
  the browser to leak.

## License

GPL-3.0
