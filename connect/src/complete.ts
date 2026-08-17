import { MESSAGE_TYPE } from "./constants";
import type { OneConnectMessage, OneConnectResult } from "./types";

/**
 * Call this on the page your OAuth callback route redirects to, after
 * your server has exchanged the code for tokens. One line closes the
 * loop: we are the embedded frame, navigated back to the consumer's
 * origin by the OAuth redirect, so the parent is the host page on the
 * SAME origin. Post the result up; the SDK removes the modal and fires
 * onSuccess/onError there.
 *
 * Returns false when it had nothing to do (not inside a frame) — e.g.
 * the user opened the callback URL directly. Render your own fallback
 * UI in that case.
 */
export function completeOneConnect(
  result: OneConnectResult = { status: "success" }
): boolean {
  if (typeof window === "undefined") return false;

  if (window.parent && window.parent !== window) {
    const message: OneConnectMessage = {
      type: MESSAGE_TYPE,
      status: result.status,
      message: result.message,
    };
    try {
      // Target the consumer origin only — never "*". The host page
      // additionally checks event.origin before trusting the message.
      window.parent.postMessage(message, window.location.origin);
      return true;
    } catch {
      return false;
    }
  }

  return false;
}
