/**
 * Public types for @withone/connect.
 *
 * The SDK deliberately knows nothing about OAuth internals: state, PKCE
 * and the client secret live on the consumer's backend (see README).
 * The SDK only opens the consumer's authorize route in a first-party
 * browsing context and reports how the flow ended.
 */

/** How the One window is opened. */
export type OneConnectWindowMode = "auto" | "popup" | "redirect" | "iframe";

/** Result posted back from the consumer's completion page. */
export interface OneConnectResult {
  status: "success" | "error";
  /** Human-readable detail for the error case. */
  message?: string;
}

export interface OneConnectProps {
  /**
   * The consumer's OWN backend route that starts the flow. It must
   * generate `state` + PKCE, set them in an httpOnly cookie, and 302
   * to One's /oauth/authorize (full recipe in the README). Must be an
   * absolute URL — the popup/redirect is a top-level navigation.
   */
  authorize: {
    url: string;
  };
  /**
   * "iframe"   — authkit-style: full-viewport transparent iframe; the
   *              host page stays visible + dimmed under One's card.
   *              Requires same-site embedding or CHIPS cookies — see
   *              the README's transport notes.
   * "popup"    — floating window over the dimmed host page.
   * "redirect" — same-tab navigation there and back (mobile standard).
   * "auto"     — popup on desktop, redirect on small/coarse-pointer
   *              devices. Default.
   */
  window?: OneConnectWindowMode;
  /** Forwarded to the authorize route as ?one_theme= so the backend can
   *  pass it through to One's connect page. */
  appTheme?: "dark" | "light";
  /** Fired when the completion page reports success. The token exchange
   *  already happened on the consumer's backend by this point. */
  onSuccess?: () => void;
  /** Fired when the completion page reports an error. */
  onError?: (error: string) => void;
  /** Fired when the user abandons the flow (closes the popup or the
   *  overlay's cancel button) without a result. */
  onClose?: () => void;
}

export interface OneConnectHandle {
  /** Opens the One window (or navigates, in redirect mode). */
  open: () => void;
  /** Tears everything down: popup, overlay, listeners. */
  close: () => void;
}

/** Message posted from the completion page to the opener (popup mode). */
export interface OneConnectMessage {
  type: string; // MESSAGE_TYPE constant
  status: "success" | "error";
  message?: string;
}
