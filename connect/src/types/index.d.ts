/**
 * Public types for @withone/connect.
 *
 * The SDK deliberately knows nothing about OAuth internals: state, PKCE
 * and the client secret live on the consumer's backend (see README).
 * The SDK only opens One's connect experience as a modal over the host
 * page and reports how the flow ended.
 */

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
   * absolute URL.
   */
  authorize: {
    url: string;
  };
  /** Forwarded to the authorize route as ?one_theme= so the backend can
   *  pass it through to One's connect page. */
  appTheme?: "dark" | "light";
  /** Fired when the completion page reports success. The token exchange
   *  already happened on the consumer's backend by this point. */
  onSuccess?: () => void;
  /** Fired when the completion page reports an error. */
  onError?: (error: string) => void;
  /** Fired when the user closes the card without a result. */
  onClose?: () => void;
}

export interface OneConnectHandle {
  /** Opens One's connect modal over the current page. */
  open: () => void;
  /** Tears everything down: modal frame + listeners. */
  close: () => void;
}

/** Message posted from the completion page up to the host page. */
export interface OneConnectMessage {
  type: string; // MESSAGE_TYPE constant
  status: "success" | "error";
  message?: string;
}
