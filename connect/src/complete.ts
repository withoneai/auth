import {
  MESSAGE_TYPE,
  RETURN_MESSAGE_PARAM,
  RETURN_STATUS_PARAM,
} from "./constants";
import { readAndConsumePending } from "./useOneConnect";
import type { OneConnectMessage, OneConnectResult } from "./types";

/**
 * Call this on the page your OAuth callback route redirects to, after
 * your server has exchanged the code for tokens. One line closes the
 * loop for BOTH window modes:
 *
 *   popup mode    — posts the result to the opener (your page that
 *                   called open()) and closes the popup. The opener's
 *                   onSuccess/onError fires.
 *   redirect mode — navigates back to the exact page the user started
 *                   on, with the result in the URL; useOneConnect there
 *                   consumes it and fires the same callbacks.
 *
 * Returns false when it had nothing to do (no opener, no pending
 * entry) — e.g. the user opened the callback URL directly. Render your
 * own fallback UI in that case.
 */
export function completeOneConnect(
  result: OneConnectResult = { status: "success" }
): boolean {
  if (typeof window === "undefined") return false;

  // Popup mode: we are the popup; the host page is our opener on the
  // same origin (this page is served by the consumer's own app).
  if (window.opener && window.opener !== window) {
    const message: OneConnectMessage = {
      type: MESSAGE_TYPE,
      status: result.status,
      message: result.message,
    };
    try {
      // Target the consumer origin only — never "*". The host page
      // additionally checks event.origin before trusting the message.
      (window.opener as Window).postMessage(
        message,
        window.location.origin
      );
    } catch {
      return false;
    }
    // Give the message a beat to land before the context dies.
    setTimeout(() => {
      try {
        window.close();
      } catch {
        /* some browsers refuse; the page can show "you can close this" */
      }
    }, 50);
    return true;
  }

  // iframe mode: we're the embedded frame, navigated back to the
  // consumer's origin by the OAuth redirect — the parent is the host
  // page on the SAME origin. Post the result up; the SDK removes the
  // iframe and fires the callbacks.
  if (window.parent && window.parent !== window) {
    const message: OneConnectMessage = {
      type: MESSAGE_TYPE,
      status: result.status,
      message: result.message,
    };
    try {
      window.parent.postMessage(message, window.location.origin);
      return true;
    } catch {
      return false;
    }
  }

  // Redirect mode: same tab, so the pending entry written by open()
  // is readable here. Send the user back where they started.
  const pending = readAndConsumePending();
  if (pending?.returnUrl) {
    try {
      const url = new URL(pending.returnUrl);
      url.searchParams.set(RETURN_STATUS_PARAM, result.status);
      if (result.message) {
        url.searchParams.set(RETURN_MESSAGE_PARAM, result.message);
      }
      window.location.replace(url.toString());
      return true;
    } catch {
      return false;
    }
  }

  return false;
}
