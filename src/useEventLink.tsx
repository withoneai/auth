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

// Query param names used by the same-window OAuth redirect flow.
// These appear on the parent app's URL after the user comes back from
// the OAuth provider. The package detects them on init, processes the
// result, and strips them from the URL.
const RETURN_STATE_PARAM = "one_auth_state";
const RETURN_ERROR_PARAM = "one_auth_error";

// Separator used between the original OAuth state and the base64url
// encoded return URL. Tilde is in the URL "unreserved" set so it
// survives URL encoding intact, and it's not used by base64url so
// splitting is unambiguous.
const STATE_SEPARATOR = "~";

// (No persistent storage needed. State rides in the URL fragment, which
// framework routers ignore for cache keys, so a synchronous strip via
// replaceState is sufficient — no reload, no stash.)

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
  const newState = `${originalState}${STATE_SEPARATOR}${base64urlEncode(returnUrl)}`;
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

// Detects whether this page load is a same-window OAuth return.
//
// State channel: the OAuth callback page redirects back to the parent
// app with state encoded in the URL FRAGMENT (e.g. /agents/uuid#one_auth_state=abc),
// not the query string. Why fragments:
//
//   - Fragments never reach the server (HTTP spec) so they don't appear
//     in server logs / analytics — small security win over ?one_auth_state.
//   - Fragments are not part of the cache key for any major SPA router
//     (Next.js App Router's Router Cache keys on pathname + query;
//     Vue Router, React Router, SvelteKit, Angular Router all treat
//     hash as a separate property orthogonal to routing). So stripping
//     the fragment via history.replaceState does NOT need to fight a
//     framework cache.
//
// Backward compatibility: we ALSO read from window.location.search so
// older deployments of the OAuth callback page (pre-fragment switch)
// keep working. The fragment path is preferred because it doesn't
// pollute the framework router's cached URL.
//
// We strip whichever channel the params arrived on, synchronously,
// before opening the check iframe. A subsequent router.push (e.g.
// after the user opens and closes a settings modal) lands on the
// clean URL with no risk of resurrecting the params.
function detectOAuthReturn(props: EventLinkProps) {
  if (typeof window === "undefined") return;
  if (oauthReturnHandled) return;

  // Read the fragment. window.location.hash includes the leading "#",
  // which URLSearchParams handles fine when we strip it.
  let fragmentParams: URLSearchParams | null = null;
  try {
    const rawHash = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : window.location.hash;
    if (rawHash) fragmentParams = new URLSearchParams(rawHash);
  } catch {
    fragmentParams = null;
  }

  // Read the query string (legacy / backward-compatible channel).
  let queryParams: URLSearchParams | null = null;
  try {
    queryParams = new URLSearchParams(window.location.search);
  } catch {
    queryParams = null;
  }

  // Prefer fragment values, fall back to query. Either channel works
  // identically for the consumer; the package handles the cleanup.
  const stateParam =
    fragmentParams?.get(RETURN_STATE_PARAM) ??
    queryParams?.get(RETURN_STATE_PARAM) ??
    null;
  const errorParam =
    fragmentParams?.get(RETURN_ERROR_PARAM) ??
    queryParams?.get(RETURN_ERROR_PARAM) ??
    null;

  // No return params anywhere — nothing to do.
  if (!stateParam && !errorParam) return;

  oauthReturnHandled = true;

  // Strip our params from BOTH channels synchronously, before any
  // framework code observes the polluted URL. We're calling the
  // browser-native replaceState here (the framework's patched version,
  // if any, will pick it up via its own observer hooks).
  try {
    const url = new URL(window.location.href);

    // Remove from query (always safe even if absent).
    url.searchParams.delete(RETURN_STATE_PARAM);
    url.searchParams.delete(RETURN_ERROR_PARAM);

    // Wipe the entire fragment when our params arrived through it.
    // We can't selectively remove just our keys: returning from OAuth
    // is a major navigation event and any other fragment params are
    // very likely stale — for example a deep-link convention like
    // `#open=notion` that triggered the original AuthKit open. Leaving
    // those in place causes consumers to auto-re-open AuthKit on top
    // of our success/failure check iframe.
    if (fragmentParams) {
      url.hash = "";
    }

    window.history.replaceState(null, document.title, url.toString());
  } catch {
    // If URL surgery failed, fall through. The check iframe will still
    // open below; the URL just stays polluted (same as pre-1.1.7).
  }

  if (stateParam) {
    handleOAuthReturn(props, stateParam);
    return;
  }
  if (errorParam) {
    handleOAuthReturnError(props, errorParam);
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
