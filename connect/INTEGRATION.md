# Connect with One — the complete integration guide

**Who this is for:** you're building an app (we'll call yours "Duramata" in
the examples) and you want your users to grant it **scoped, revocable
access to their own tools** — Stripe, PostHog, Gmail, 500+ more — without
you ever touching their passwords. One handles sign-in, connections, and
consent in a card that floats **over your page**; you receive standard
OAuth tokens and call one API.

**Time: ~30 minutes.** The complete inventory of what you write:

| Piece | Where | Size |
|---|---|---|
| 4 environment values | your server's `.env` | copy-paste |
| 1 button | your frontend | ~10 lines |
| 2 API routes (`authorize`, `callback`) | your backend | ~40 lines each |
| 1 token helper (auto-refresh) | your backend | ~25 lines |

Every snippet below is lifted from a working reference app and shown in
Next.js App Router form; it's all plain `fetch` + standard OAuth, so any
stack (Express, Rails, Django…) maps 1:1.

---

## The picture — what actually happens

```
 your frontend            your backend                    One
 ─────────────            ────────────                    ───
 [Connect button]
   modal opens ─────────▶ /api/one/authorize
                            makes two secrets,
                            sets a cookie,
                            forwards the user ──────────▶ One's card, over your page:
                                                          sign in (emailed code) →
                                                          connect tools → grant access
                          /api/one/callback ◀──────────── returns a one-time code
                            checks the cookie,
                            trades code + your secret ──▶ One's token endpoint
                            stores tokens          ◀───── access token + refresh token
                            → redirects with ?one_connect=success
   modal closes, onSuccess() fires — the SDK reads the redirect itself
```

Two principles to hold on to — they explain every design choice below:

1. **Your frontend never sees a token.** The browser only ever carries
   things that are worthless if stolen; everything powerful moves
   server-to-server. That's why there's a "code" step instead of tokens
   appearing in the browser.
2. **The user stays in charge after saying yes.** Access rules live on
   One's side and are checked on *every* call — the user can narrow or
   revoke at any time, and your calls outside the grant get a `403` you
   cannot override. Build for that and you never have to think about it.

---

## Step 0 · One-time setup in the One dashboard

[app.withone.ai → Settings → OAuth Apps](https://app.withone.ai/settings/oauth-apps)

1. **Create an OAuth app.** Set the name and logo — your users see both on
   the consent card. You receive a **Client ID** (public, fine in URLs)
   and a **Client Secret** (shown once; it must live only on your server —
   it is your app's password at One).
2. **Register your redirect URI** — the exact URL of your callback route,
   e.g. `https://yourapp.com/api/one/callback`. One matches it
   character-for-character on every request. *Why so strict:* it means a
   forged authorize request can only ever deliver its result to **your**
   registered address — this one string comparison is the strongest lock
   in the whole flow.
3. **Create a permission set** — the tools your app needs and the access
   level for each (full / read & write / read only / hand-picked
   actions). Your user sees it pre-filled at consent and can only
   **narrow** it, never widen. Copy the set's ID from the panel. *Why:*
   asking for exactly what you need converts better, and the end user is
   never sent browsing a catalog — they only ever see your list.

```bash
# .env — server only. NEVER ship the secret to a browser.
ONE_CLIENT_ID=e4169d63…
ONE_CLIENT_SECRET=one_secret_…
ONE_PERMISSION_SET=93a0d27b-…            # the set you created
# Optional — omit it and your callback URL is derived from the request,
# so the same build runs on localhost and production:
# ONE_REDIRECT_URI=https://yourapp.com/api/one/callback
```

## Step 1 · Frontend: the button

```bash
npm install @withone/connect
```

```tsx
"use client";

import { useOneConnect } from "@withone/connect";

export function ConnectWithOne() {
  const { open } = useOneConnect({
    authorize: {
      // YOUR backend route from Step 2 — absolute URL.
      url: `${window.location.origin}/api/one/authorize`,
    },
    appTheme: "light",            // or "dark" — matches YOUR app; travels on its
                                  // own (URL fragment), nothing to forward
    onSuccess: () => {
      // By the time this fires, your backend already holds the tokens.
    },
    onError: (error) => console.error(error),
    onClose: () => {},            // user closed the card without finishing
  });

  return <button onClick={open}>Connect your tools</button>;
}
```

When clicked, your page stays visible and dims; One's card floats above it
(a transparent iframe under the hood — Plaid-style). Same experience on
mobile. *Why the SDK is this small:* it deliberately knows nothing about
OAuth — no secrets, no tokens, nothing sensitive ever enters your
frontend bundle. It opens your authorize route and reports how things
ended. That's its whole job.

## Step 2 · Backend: the authorize route ("the departure gate")

This route runs **before** anything leaves for One, and it exists to
prepare for the return trip. It mints two secrets:

- **`state`** — a random value that must come back unchanged at the end.
  *Why:* it proves the browser that returns is the browser that left,
  killing "login CSRF" attacks where an attacker splices their own
  half-finished flow into your user's session.
- **PKCE pair** — a random `verifier` (kept secret) and its SHA-256 hash,
  the `challenge` (sent along). *Why:* at the very end you'll reveal the
  verifier server-to-server; One hashes it and compares. Only the party
  that **started** this exact flow can produce it — so an intercepted
  code is useless even to someone who somehow also had your secret.

Both wait in an `httpOnly` cookie — readable by your server only, not by
any JavaScript, not even your own.

```ts
// app/api/one/authorize/route.ts
import { createHash, randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";

const ONE_AUTHORIZE_URL = "https://api.withone.ai/oauth/authorize";

export async function GET(req: NextRequest) {
  // Identify YOUR user however you normally do (session, JWT, …).
  const userEmail = await getCurrentUserEmail(req);            // ← your code

  const state = randomBytes(16).toString("hex");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  const url = new URL(ONE_AUTHORIZE_URL);
  url.searchParams.set("client_id", process.env.ONE_CLIENT_ID!);
  const redirectUri =
    process.env.ONE_REDIRECT_URI ?? `${req.nextUrl.origin}/api/one/callback`;
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "user:connections:read user:connections:write");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (process.env.ONE_PERMISSION_SET) {
    url.searchParams.set("permission_set", process.env.ONE_PERMISSION_SET);
  }
  if (userEmail) {
    // Pre-fills (never locks) the email on One's card — one less thing
    // for your user to type. They can still hit "Not you?" and change it.
    url.searchParams.set("login_hint", userEmail);
  }

  const res = NextResponse.redirect(url.toString(), 302);
  res.cookies.set("one_tx", JSON.stringify({ state, verifier }), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,          // matches One's 10-minute code lifetime
    path: "/api/one",
  });
  return res;
}
```

## Step 3 · Backend: the callback route ("the arrivals gate")

One sends the user back with a **single-use authorization code** — valid
10 minutes, dead after first use, and worthless by itself: redeeming it
requires your client secret AND the PKCE verifier, neither of which ever
entered a browser. *Why the code dance at all:* the hand-back moment
necessarily travels through the browser, so the thing handed back must be
safe to photograph. Tokens aren't; a claim ticket is.

```ts
// app/api/one/callback/route.ts
import { NextRequest, NextResponse } from "next/server";

const ONE_TOKEN_URL = "https://api.withone.ai/oauth/token";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const oauthError = req.nextUrl.searchParams.get("error");
  const tx = req.cookies.get("one_tx")?.value;

  // Your final redirect IS the completion signal: land the frame on ANY
  // page of your app with ?one_connect=success|error in the URL and the
  // SDK closes the modal and fires your callback. No completion page.
  const fail = (message: string) => {
    const res = NextResponse.redirect(
      new URL(`/?one_connect=error&one_connect_message=${encodeURIComponent(message)}`, req.url),
      302,
    );
    res.cookies.delete("one_tx");
    return res;
  };

  if (oauthError === "access_denied") return fail("You cancelled the request.");

  let parsed: { state?: string; verifier?: string } | null = null;
  try { parsed = tx ? JSON.parse(tx) : null; } catch { parsed = null; }

  // The state check: YOUR proof this return matches YOUR departure.
  if (!code || !state || !parsed?.verifier || parsed.state !== state) {
    return fail("The sign-in attempt expired or was tampered with.");
  }

  // The trade — server to server, no browser involved. Your secret is
  // used here and ONLY here, as HTTP Basic auth (client_secret_basic).
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
      redirect_uri:
        process.env.ONE_REDIRECT_URI ?? `${req.nextUrl.origin}/api/one/callback`,
      code_verifier: parsed.verifier,          // revealed for the first time ever
    }),
  });
  if (!tokenRes.ok) return fail("One rejected the code exchange.");

  const tokens = (await tokenRes.json()) as {
    access_token: string;   // ~1 hour
    refresh_token: string;  // ~30 days, ROTATES on every use
    expires_in: number;
  };

  // Store both, keyed by YOUR user, in your database. Server-side only.
  await saveOneTokens(req, {                                    // ← your code
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  });

  const res = NextResponse.redirect(new URL("/?one_connect=success", req.url), 302);
  res.cookies.delete("one_tx");
  return res;
}
```

*Why this ends with a plain redirect:* the SDK owns the invisible frame,
and once your callback sends it back to **your** origin, the SDK is
allowed to read the frame's URL. It sees `one_connect=success`, closes
the modal, and fires your `onSuccess` — you write no completion page and
enforce nothing. What happens next is entirely yours. (If you *want* a
custom completion experience inside the card, the SDK exports an
optional `completeOneConnect()` helper — but the standard path needs
nothing.)

## Step 4 · Backend: the token helper ("the renewals clerk")

Access tokens last ~1 hour **on purpose** — a stolen bearer token is a
60-minute problem, not a forever problem. Refresh tokens last ~30 days
and **rotate**: every refresh returns a NEW pair and kills the old one.
The two rules that matter:

- **Always save BOTH new tokens.** Miss the new refresh token once and
  you're locked out at the next refresh.
- If One ever sees an *already-used* refresh token, it reads that as two
  parties holding one credential — theft — and **revokes the entire
  family**. That's a feature protecting your users; handle it by asking
  the user to reconnect.

```ts
const ONE_TOKEN_URL = "https://api.withone.ai/oauth/token";

export async function getOneAccessToken(userId: string): Promise<string> {
  const t = await loadOneTokens(userId);                        // ← your storage
  if (Date.now() < t.expiresAt - 60_000) return t.accessToken;  // still fresh

  const res = await fetch(ONE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: t.refreshToken,
      client_id: process.env.ONE_CLIENT_ID!,   // note: body, not Basic auth
    }),
  });
  if (!res.ok) throw new Error("One refresh failed — ask the user to reconnect");

  const data = await res.json();
  await saveOneTokens(userId, {                // BOTH tokens — rotation!
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  });
  return data.access_token;
}
```

## Step 5 · Using the grant

```ts
const token = await getOneAccessToken(userId);

// What did the user actually grant? Ungranted connections are
// INVISIBLE here — not listed-but-forbidden. You can't covet what
// you can't enumerate; render your UI from this list.
const res = await fetch("https://api.withone.ai/api/oauth/connections", {
  headers: { Authorization: `Bearer ${token}` },
});
const { rows } = await res.json();
// rows: [{ platform: "stripe", key: "live::stripe::default::…", … }]
```

For agents, point any MCP client at One's hosted server with the same
bearer token:

```
https://mcp.withone.ai/mcp
Authorization: Bearer <access_token>
```

Every call is checked against the user's grant **inside One, at call
time**. A call outside it returns `403` with a reason — your code cannot
override it, and that's the promise your users are relying on. If the
user narrows or revokes in their One settings, it takes effect on your
very next call.

---

## The 3 errors you'll actually meet

| You see | It means | Do |
|---|---|---|
| `401` on a refresh | Refresh token expired (~30 days idle) or the family was revoked | Send the user through the connect flow again — one click for them |
| `403` on an action | Outside the grant (wrong tool, or a write on a read-only grant) | Respect it. If you genuinely need more, ask the user to reconnect with a wider ask |
| `invalid_grant` at the token endpoint | Code already used, or older than 10 minutes | Restart the flow; codes are strictly single-use |

## Ship checklist

- [ ] Client secret exists ONLY in server env — grep your frontend bundle to be sure
- [ ] Registered redirect URI matches your callback URL exactly (scheme, host, path)
- [ ] The refresh path saves **both** tokens, every time
- [ ] `401`/`403` render a friendly "reconnect your tools" prompt, not a crash
