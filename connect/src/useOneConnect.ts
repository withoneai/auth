import {
  EXIT_MESSAGE_TYPE,
  MESSAGE_TYPE,
  RETURN_MESSAGE_PARAM,
  RETURN_STATUS_PARAM,
  THEME_PARAM,
} from "./constants";
import {
  createEmbedIframe,
  getEmbedIframe,
  removeEmbedIframe,
  removeSuccessOverlay,
  showSuccessOverlay,
} from "./window";
import type {
  OneConnectHandle,
  OneConnectMessage,
  OneConnectProps,
} from "./types";

// Like useOneAuth, this is a plain function rather than a React hook so
// it works from any framework.
export const useOneConnect = (props: OneConnectProps): OneConnectHandle => {
  let messageHandler: ((event: MessageEvent) => void) | null = null;
  let resultDelivered = false;

  // The theme rides in the URL FRAGMENT: fragments never reach any
  // server and browsers carry them through the whole redirect chain
  // (consumer's authorize route -> One -> the card), so the consumer's
  // backend forwards NOTHING. Embedding needs no signal at all -- the
  // card detects its own iframe with window.self !== window.top.
  const buildUrl = (): string => {
    try {
      const url = new URL(props.authorize.url);
      if (props.appTheme) url.hash = `${THEME_PARAM}=${props.appTheme}`;
      return url.toString();
    } catch {
      return props.authorize.url;
    }
  };

  const teardown = () => {
    if (typeof window !== "undefined" && messageHandler) {
      window.removeEventListener("message", messageHandler);
      messageHandler = null;
    }
    removeEmbedIframe();
  };

  const deliver = (status: "success" | "error", message?: string) => {
    if (resultDelivered) return;
    resultDelivered = true;
    teardown();
    // The confirmation beat: by now the frame is gone, so the SDK
    // paints a brief "Access granted" card itself while the host page
    // (already told via onSuccess below) updates underneath it.
    if (status === "success") showSuccessOverlay(props.appTheme);
    try {
      if (status === "success") {
        props.onSuccess?.();
      } else {
        props.onError?.(message ?? "The connection was not completed.");
      }
    } catch {
      /* consumer callback errors are not our problem */
    }
  };

  // Only trust messages from OUR iframe's browsing context. Exit can
  // come from One's page (cross-origin); results come from the
  // completion page, which is the consumer's own origin because the
  // OAuth redirect brought the frame home.
  const handleMessage = (event: MessageEvent) => {
    const data = event.data as OneConnectMessage | undefined;
    if (!data) return;

    const iframe = getEmbedIframe();
    if (!iframe || event.source !== iframe.contentWindow) return;

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
  };

  // Fires on every navigation inside the frame. While the frame is on
  // One's origin, reading its location throws (same-origin policy) and
  // we ignore it. The moment the consumer's callback redirects home —
  // to ANY same-origin URL carrying ?one_connect=success|error — the
  // read succeeds and the flow completes. The consumer writes no
  // completion page and no postMessage; their callback's final
  // redirect IS the completion signal.
  const handleFrameLoad = () => {
    const iframe = getEmbedIframe();
    if (!iframe) return;
    let href: string;
    try {
      href = iframe.contentWindow?.location.href ?? "";
    } catch {
      return; // still cross-origin — not home yet
    }
    let params: URLSearchParams;
    try {
      params = new URL(href).searchParams;
    } catch {
      return;
    }
    const status = params.get(RETURN_STATUS_PARAM);
    if (status !== "success" && status !== "error") return;
    iframe.style.visibility = "hidden"; // no flash of the landing page
    deliver(status, params.get(RETURN_MESSAGE_PARAM) ?? undefined);
  };

  const open = () => {
    if (typeof window === "undefined") return;
    resultDelivered = false;

    messageHandler = handleMessage;
    window.addEventListener("message", messageHandler);
    const iframe = createEmbedIframe(buildUrl());
    iframe.addEventListener("load", handleFrameLoad);
  };

  const close = () => {
    removeSuccessOverlay();
    teardown();
  };

  return { open, close };
};
