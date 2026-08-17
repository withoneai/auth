import {
  EMBED_PARAM,
  EXIT_MESSAGE_TYPE,
  MESSAGE_TYPE,
  PENDING_STORAGE_KEY,
  PENDING_TTL_MS,
  RETURN_MESSAGE_PARAM,
  RETURN_STATUS_PARAM,
  THEME_PARAM,
} from "./constants";
import {
  createEmbedIframe,
  getEmbedIframe,
  openPopup,
  removeEmbedIframe,
  removeOverlay,
  resolveWindowMode,
  showOverlay,
} from "./window";
import type {
  OneConnectHandle,
  OneConnectMessage,
  OneConnectProps,
} from "./types";

// How often we check whether the user closed the popup by hand.
const POPUP_CLOSED_POLL_MS = 500;

// One-shot guard: a redirect-mode return is processed at most once per
// page load, no matter how many components call useOneConnect.
let redirectReturnHandled = false;

// ---- redirect-mode return detection ----------------------------------

// In redirect mode the whole tab goes to One and comes back via the
// consumer's callback route, which sends the user to their completion
// page; completeOneConnect() there navigates back to the ORIGINAL page
// with ?one_connect=success|error appended. This function runs on every
// useOneConnect call, consumes that param, cleans the URL, and fires
// the right callback — so redirect mode has the same callback semantics
// as popup mode.
function detectRedirectReturn(props: OneConnectProps) {
  if (typeof window === "undefined") return;
  if (redirectReturnHandled) return;

  let params: URLSearchParams;
  try {
    params = new URL(window.location.href).searchParams;
  } catch {
    return;
  }
  const status = params.get(RETURN_STATUS_PARAM);
  if (status !== "success" && status !== "error") return;

  redirectReturnHandled = true;
  const message = params.get(RETURN_MESSAGE_PARAM) ?? undefined;

  // Strip our params so a refresh doesn't re-fire callbacks and the
  // framework router never caches a polluted URL.
  try {
    const clean = new URL(window.location.href);
    clean.searchParams.delete(RETURN_STATUS_PARAM);
    clean.searchParams.delete(RETURN_MESSAGE_PARAM);
    window.history.replaceState(window.history.state, "", clean.toString());
  } catch {
    /* history unavailable — callbacks still fire */
  }

  setTimeout(() => {
    try {
      if (status === "success") {
        props.onSuccess?.();
      } else {
        props.onError?.(message ?? "The connection was not completed.");
      }
    } catch {
      /* consumer callback errors are not our problem */
    }
  }, 0);
}

// ---- main hook -------------------------------------------------------

// Like useOneAuth, this is a plain function rather than a React hook so
// it works from any framework. It runs redirect-return detection as a
// side effect of being called.
export const useOneConnect = (props: OneConnectProps): OneConnectHandle => {
  detectRedirectReturn(props);

  let popupRef: Window | null = null;
  let messageHandler: ((event: MessageEvent) => void) | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let resultDelivered = false;

  const buildUrl = (embed: boolean): string => {
    try {
      const url = new URL(props.authorize.url);
      if (props.appTheme) url.searchParams.set(THEME_PARAM, props.appTheme);
      if (embed) url.searchParams.set(EMBED_PARAM, "1");
      return url.toString();
    } catch {
      return props.authorize.url;
    }
  };

  const teardown = () => {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (typeof window !== "undefined" && messageHandler) {
      window.removeEventListener("message", messageHandler);
      messageHandler = null;
    }
    removeOverlay();
    removeEmbedIframe();
    if (popupRef && !popupRef.closed) {
      try {
        popupRef.close();
      } catch {
        /* COOP can make .close throw — nothing to do */
      }
    }
    popupRef = null;
  };

  const deliver = (status: "success" | "error", message?: string) => {
    if (resultDelivered) return;
    resultDelivered = true;
    try {
      if (status === "success") {
        props.onSuccess?.();
      } else {
        props.onError?.(message ?? "The connection was not completed.");
      }
    } catch {
      /* consumer callback errors are not our problem */
    }
    teardown();
  };

  const handleMessage = (event: MessageEvent) => {
    const data = event.data as OneConnectMessage | undefined;
    if (!data) return;

    // Modal mode: only trust messages from OUR iframe's browsing
    // context. Exit can come from One's page (cross-origin); results
    // come from the completion page, which is the consumer's own
    // origin because the OAuth redirect brought the frame home.
    const iframe = getEmbedIframe();
    if (iframe) {
      if (event.source !== iframe.contentWindow) return;
      if (data.type === EXIT_MESSAGE_TYPE) {
        teardown();
        try {
          props.onClose?.();
        } catch {
          /* ignore */
        }
        return;
      }
      if (
        data.type === MESSAGE_TYPE &&
        event.origin === window.location.origin &&
        (data.status === "success" || data.status === "error")
      ) {
        deliver(data.status, data.message);
      }
      return;
    }

    // Popup mode: the completion page lives on the CONSUMER'S OWN
    // origin (their callback route redirects there), which is the same
    // origin as this page. Anything else is noise or an attack.
    if (event.origin !== window.location.origin) return;
    if (data.type !== MESSAGE_TYPE) return;
    if (data.status !== "success" && data.status !== "error") return;
    deliver(data.status, data.message);
  };

  const open = () => {
    if (typeof window === "undefined") return;
    resultDelivered = false;

    const mode = resolveWindowMode(props.window);
    const url = buildUrl(mode === "modal");

    // Written for redirect mode (completeOneConnect reads it to come
    // back here); harmless in popup mode where the popup never sees
    // this tab's sessionStorage. NOT written in modal mode — the
    // completion page must postMessage to the parent, not navigate.
    if (mode !== "modal") {
      try {
        window.sessionStorage.setItem(
          PENDING_STORAGE_KEY,
          JSON.stringify({ returnUrl: window.location.href, at: Date.now() })
        );
      } catch {
        /* private mode / quota — redirect mode degrades gracefully */
      }
    }

    if (mode === "redirect") {
      window.location.href = url;
      return;
    }

    if (mode === "modal") {
      messageHandler = handleMessage;
      window.addEventListener("message", messageHandler);
      createEmbedIframe(url);
      return;
    }

    popupRef = openPopup(url);
    if (!popupRef) {
      // Popup blocked — fall back to the redirect flow rather than
      // failing. The pending entry above makes the return work.
      window.location.href = url;
      return;
    }

    messageHandler = handleMessage;
    window.addEventListener("message", messageHandler);

    showOverlay({
      onFocus: () => {
        try {
          popupRef?.focus();
        } catch {
          /* ignore */
        }
      },
      onCancel: () => {
        teardown();
        try {
          props.onClose?.();
        } catch {
          /* ignore */
        }
      },
    });

    pollTimer = setInterval(() => {
      if (!popupRef || popupRef.closed) {
        if (pollTimer !== null) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
        if (!resultDelivered) {
          // Closed by hand before any result arrived — user bailed.
          teardown();
          try {
            props.onClose?.();
          } catch {
            /* ignore */
          }
        }
      }
    }, POPUP_CLOSED_POLL_MS);
  };

  const close = () => {
    teardown();
  };

  return { open, close };
};

// Exported for completeOneConnect; kept here so the pending-entry shape
// has a single owner.
export interface PendingEntry {
  returnUrl?: string;
  at?: number;
}

export function readAndConsumePending(): PendingEntry | null {
  if (typeof window === "undefined") return null;
  let pending: PendingEntry | null = null;
  try {
    const raw = window.sessionStorage.getItem(PENDING_STORAGE_KEY);
    if (raw) pending = JSON.parse(raw);
  } catch {
    pending = null;
  }
  try {
    window.sessionStorage.removeItem(PENDING_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  if (!pending) return null;
  const fresh =
    typeof pending.at === "number" && Date.now() - pending.at < PENDING_TTL_MS;
  return fresh ? pending : null;
}
