import { MESSAGE_TYPE } from "./constants";
import type { OneConnectMessage, OneConnectResult } from "./types";

/**
 * OPTIONAL. The standard integration needs no completion page at all:
 * the callback route's final redirect carries ?one_connect=success (or
 * error) on any same-origin URL, and the SDK reads it off the frame's
 * location directly. Use this helper only if you render a custom
 * completion page and want to signal the SDK from it explicitly.
 *
 * Returns false when it had nothing to do (not inside a frame) — e.g.
 * the user opened the page directly. Render fallback UI in that case.
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
