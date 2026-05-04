import { ConnectionRecord, EventLinkProps, EventProps } from "./types";
import { createWindow, EventLinkWindow, VISIBLE_IFRAME_ID } from "./window";

// Track processed messages to prevent duplicates (defense-in-depth)
const processedMessages = new Set<string>();
const MESSAGE_EXPIRY_MS = 5000;

// One-shot guard so we only handle a given OAuth return once per page
// load. The hook can be called multiple times across React re-renders;
// without this guard we'd open multiple check iframes for the same
// return.
let oauthReturnHandled = false;

// Separator used between the original OAuth state and the base64url
// encoded return URL. Tilde is in the URL "unreserved" set so it
// survives URL encoding intact, and it's not used by base64url so
// splitting is unambiguous.
const STATE_SEPARATOR = "~";

// SDK version tag appended as the third segment of the OAuth state.
// The One-hosted callback parses this to decide whether to redirect
// back with a clean URL (v3+) or with the legacy ?one_auth_state=
// query parameter (older SDKs that detect the return via the URL).
// Bumping this string is a wire-protocol change \u2014 the callback page
// in core-ui must understand the new tag before the SDK starts
// emitting it.
const SDK_VERSION_TAG = "v3";

// sessionStorage key for the pending OAuth state. Set on cue.app
// BEFORE the top-level navigation to the OAuth provider; read on
// return. sessionStorage is scoped per (top-level browsing context,
// origin), so the entry survives the cross-origin round-trip in the
// same tab and is restored when the user returns to the tenant
// origin. This replaces the v1.2.0 design which relied on a polluted
// URL + hard reload.
const PENDING_STORAGE_KEY = "__withone_auth_pending";
// Pending entries older than this are treated as stale and discarded.
// 10 minutes covers any realistic same-window OAuth flow with slack.
const PENDING_TTL_MS = 10 * 60 * 1000;

// ---- base64url helpers (no deps) -------------------------------------

function base64urlEncode(str: string): string {
  return btoa(str)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// ---- OAuth URL state injection ---------------------------------------

// Replaces the `state` query param in the OAuth provider URL with one
// that has the return URL appended. Falls back to a string replace if
// the URL constructor can't parse the input (very unusual but
// defensive).
function injectReturnUrlIntoState(
  oauthUrl: string,
  originalState: string,
  returnUrl: string
): string {
  // State format (v3): ORIG ~ base64url(returnUrl) ~ v3
  // Legacy v1.2.0 format was 2 segments without the version tag.
  // The trailing version tag tells the One-hosted callback page to
  // redirect back with a clean URL instead of appending
  // ?one_auth_state= for URL-based detection.
  const newState =
    `${originalState}${STATE_SEPARATOR}${base64urlEncode(returnUrl)}` +
    `${STATE_SEPARATOR}${SDK_VERSION_TAG}`;
  try {
    const parsed = new URL(oauthUrl);
    parsed.searchParams.set("state", newState);
    return parsed.toString();
  } catch {
    return oauthUrl
      .replace(
        `state=${encodeURIComponent(originalState)}`,
        `state=${encodeURIComponent(newState)}`
      )
      .replace(
        // Some OAuth URLs include the state without URL-encoding it
        `state=${originalState}`,
        `state=${encodeURIComponent(newState)}`
      );
  }
}

// ---- OAuth return handler --------------------------------------------

// Opens the auth iframe in "checkState" mode after the user comes back
// from the OAuth provider. The iframe at auth.withone.ai polls
// /v1/connections/oauth/check?state=X and renders a loading spinner
// followed by a success or failure screen. When the backend reports a
// final status the iframe posts LINK_SUCCESS / LINK_ERROR back here
// immediately so the consumer's callback fires in parallel with the
// visible UI. The iframe stays visible until the user dismisses it
// with the X button (which fires EXIT_EVENT_LINK). NO auto-close.
function handleOAuthReturn(props: EventLinkProps, state: string) {
  const checkWindow = new EventLinkWindow({
    ...props,
    checkState: state,
  });

  let cleaned = false;
  let resultDelivered = false;

  const handler = (event: MessageEvent) => {
    if (typeof window === "undefined") return;

    const iframe = document.getElementById(
      VISIBLE_IFRAME_ID
    ) as HTMLIFrameElement | null;

    // Only accept messages from this iframe instance.
    if (!iframe || event.source !== iframe.contentWindow) {
      return;
    }

    const eventData = (event as unknown as EventProps).data;
    if (!eventData?.messageType) return;

    if (eventData.messageType === "LINK_SUCCESS") {
      if (!resultDelivered) {
        resultDelivered = true;
        try {
          props.onSuccess?.(eventData.message as ConnectionRecord);
        } catch {
          /* consumer callback errors are not our problem */
        }
      }
    } else if (eventData.messageType === "LINK_ERROR") {
      if (!resultDelivered) {
        resultDelivered = true;
        try {
          props.onError?.(eventData.message as string);
        } catch {
          /* consumer callback errors are not our problem */
        }
      }
    } else if (eventData.messageType === "EXIT_EVENT_LINK") {
      // User clicked X. Tear down everything. If onSuccess/onError
      // hasn't fired yet (user dismissed during polling), fire
      // onClose so the consumer knows the user bailed.
      try {
        props.onClose?.();
      } catch {
        /* ignore */
      }
      cleanup();
    }
  };

  function cleanup() {
    if (cleaned) return;
    cleaned = true;
    if (typeof window !== "undefined") {
      window.removeEventListener("message", handler);
    }
    checkWindow.closeLink();
    // Reset the module-level guard so the NEXT OAuth flow on this page
    // can be detected. Without this, back-to-back OAuth flows in an
    // SPA (no full page reload between them) would silently skip the
    // second return detection.
    oauthReturnHandled = false;
  }

  if (typeof window !== "undefined") {
    window.addEventListener("message", handler);
  }
  checkWindow.openLink();
}

// Fired when the callback page redirected back with `?one_auth_error=`
// but no state. The OAuth provider returned an error (e.g., the user
// denied consent) and the callback knows there's nothing to poll.
function handleOAuthReturnError(props: EventLinkProps, errorMessage: string) {
  setTimeout(() => {
    props.onError?.(errorMessage);
  }, 0);
}

// Detects whether this page load is a same-window OAuth return by
// reading sessionStorage on the tenant origin. The pending entry is
// written by the OAUTH_REDIRECT handler BEFORE the top-level
// navigation to the OAuth provider; it survives the cross-origin
// round-trip because sessionStorage is scoped per (top-level
// browsing context, origin) and the user returns to the same tab on
// the same tenant origin.
//
// The URL is never read here. The One-hosted callback page (core-ui
// app/connections/oauth/callback) redirects the user back to a clean
// URL when it sees an SDK version tag of v3+ in the OAuth state, so
// there is nothing to detect on the URL. This eliminates the v1.2.0
// hard reload (window.location.replace) that existed only to strip a
// polluted URL before the framework router cached it.
//
// Backwards compatibility: tenants on v1.2.0 emit a 2-segment state
// without the v3 tag, so the callback falls back to its legacy
// ?one_auth_state= redirect for them. v1.3.0 SDKs ignore that param
// entirely \u2014 the source of truth is sessionStorage.
function detectOAuthReturn(props: EventLinkProps) {
  if (typeof window === "undefined") return;
  if (oauthReturnHandled) return;

  let pending: { state?: string; error?: string; at?: number } | null = null;
  try {
    const raw = window.sessionStorage.getItem(PENDING_STORAGE_KEY);
    if (raw) pending = JSON.parse(raw);
  } catch {
    pending = null;
  }
  if (!pending) return;

  // Single-shot: always consume the entry, even if stale, so a later
  // page load doesn't pick it up.
  try {
    window.sessionStorage.removeItem(PENDING_STORAGE_KEY);
  } catch {
    /* ignore */
  }

  const fresh =
    typeof pending.at === "number" && Date.now() - pending.at < PENDING_TTL_MS;
  if (!fresh) return;

  if (pending.state) {
    oauthReturnHandled = true;
    handleOAuthReturn(props, pending.state);
  } else if (pending.error) {
    oauthReturnHandled = true;
    handleOAuthReturnError(props, pending.error);
  }
}

// ---- Main hook -------------------------------------------------------

export const useEventLink = (props: EventLinkProps) => {
  // Detect OAuth return on every call. The module-level guard ensures
  // we only actually process a return once per page load, even if the
  // hook is called from multiple components or re-renders.
  detectOAuthReturn(props);

  const linkWindow = createWindow({ ...props });

  let messageHandler: ((event: MessageEvent) => void) | null = null;
  let isListenerActive = false;

  const handleMessage = (event: MessageEvent) => {
    if (typeof window === "undefined") return;

    const iFrameWindow = document.getElementById(VISIBLE_IFRAME_ID) as HTMLIFrameElement;
    if (!iFrameWindow || iFrameWindow.style.display !== "block") return;

    // Only accept messages from our iframe instance.
    if (event.source !== iFrameWindow.contentWindow) return;

    const eventData = (event as unknown as EventProps).data;
    if (!eventData?.messageType) return;

    // Deduplication: prevent processing same message type within expiry window
    const dedupeKey = `${eventData.messageType}-${JSON.stringify(eventData.message ?? eventData.url ?? "")}`;
    if (processedMessages.has(dedupeKey)) {
      return;
    }
    processedMessages.add(dedupeKey);
    setTimeout(() => processedMessages.delete(dedupeKey), MESSAGE_EXPIRY_MS);

    switch (eventData.messageType) {
      case "EXIT_EVENT_LINK":
        props.onClose?.();
        setTimeout(() => {
          close();
        }, 200);
        break;
      case "LINK_SUCCESS":
        props.onSuccess?.(eventData.message as ConnectionRecord);
        break;
      case "LINK_ERROR":
        props.onError?.(eventData.message as string);
        break;
      case "OAUTH_REDIRECT": {
        // Same-window OAuth redirect flow. The iframe asks the parent
        // to navigate to the OAuth provider URL. We capture the
        // current page URL, encode it into the OAuth state parameter,
        // tear down the iframe, and navigate.
        const oauthUrl = eventData.url;
        const oauthState = eventData.state;
        if (!oauthUrl || !oauthState) {
          props.onError?.("Invalid OAuth redirect message");
          break;
        }
        const returnUrl = window.location.href;
        const navigateUrl = injectReturnUrlIntoState(
          oauthUrl,
          oauthState,
          returnUrl
        );

        // Stash the OAuth state to sessionStorage BEFORE leaving the
        // page. sessionStorage is scoped per (top-level browsing
        // context, origin), so this entry survives the cross-origin
        // round-trip through the OAuth provider and the One-hosted
        // callback, and is restored when the user returns to this
        // tenant origin in the same tab. detectOAuthReturn reads it
        // on hook mount post-return.
        //
        // If the write throws (private mode, quota, disabled storage),
        // we still navigate \u2014 the user gets the connection created
        // server-side but won't see the success modal. Tenant query
        // refetch (e.g. React Query refetchOnWindowFocus) will surface
        // the new connection in their list within a moment.
        try {
          window.sessionStorage.setItem(
            PENDING_STORAGE_KEY,
            JSON.stringify({
              state: oauthState,
              at: Date.now(),
            })
          );
        } catch {
          /* sessionStorage unavailable \u2014 navigate anyway */
        }

        // Detach our message listener but keep the iframe visible.
        // The page navigation will destroy it naturally when the
        // browser starts loading the OAuth provider's page. This
        // avoids the visual flicker that happens when the iframe is
        // removed before the navigation starts — the user sees the
        // iframe's loading state continuously until the new page
        // begins to render.
        if (messageHandler && isListenerActive) {
          window.removeEventListener("message", messageHandler);
          isListenerActive = false;
          messageHandler = null;
        }

        window.location.href = navigateUrl;
        break;
      }
    }
  };

  const open = () => {
    // Remove existing listener first (defensive)
    if (messageHandler && isListenerActive) {
      window.removeEventListener("message", messageHandler);
    }

    messageHandler = handleMessage;

    if (typeof window !== "undefined") {
      window.addEventListener("message", messageHandler);
      isListenerActive = true;
    }

    linkWindow.openLink();
  };

  const close = () => {
    // Clean up listener and dedup state when closing
    if (typeof window !== "undefined" && messageHandler && isListenerActive) {
      window.removeEventListener("message", messageHandler);
      isListenerActive = false;
      messageHandler = null;
    }
    // Only clear the EXIT dedup key so re-opening works immediately.
    // LINK_SUCCESS / LINK_ERROR dedup keys stay to prevent duplicate callbacks.
    for (const key of processedMessages) {
      if (key.startsWith("EXIT_EVENT_LINK")) {
        processedMessages.delete(key);
      }
    }

    linkWindow.closeLink();
  };

  return { open, close };
};
