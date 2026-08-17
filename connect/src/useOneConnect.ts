import {
  EMBED_PARAM,
  EXIT_MESSAGE_TYPE,
  MESSAGE_TYPE,
  THEME_PARAM,
} from "./constants";
import {
  createEmbedIframe,
  getEmbedIframe,
  removeEmbedIframe,
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

  const buildUrl = (): string => {
    try {
      const url = new URL(props.authorize.url);
      if (props.appTheme) url.searchParams.set(THEME_PARAM, props.appTheme);
      url.searchParams.set(EMBED_PARAM, "1");
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

  const open = () => {
    if (typeof window === "undefined") return;
    resultDelivered = false;

    messageHandler = handleMessage;
    window.addEventListener("message", messageHandler);
    createEmbedIframe(buildUrl());
  };

  const close = () => {
    teardown();
  };

  return { open, close };
};
