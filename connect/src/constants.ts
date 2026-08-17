// Wire-protocol constants shared by useOneConnect (host page) and
// completeOneConnect (the consumer's completion page). Changing any of
// these is a breaking change between SDK versions running on the two
// pages — bump with care.

/** postMessage envelope type, popup mode. */
export const MESSAGE_TYPE = "@withone/connect:result";

/** sessionStorage key for the pending redirect-mode flow. Written on
 *  the host page before navigating away; read back by
 *  completeOneConnect (same tab, same origin) to return the user to
 *  the exact page they started on. */
export const PENDING_STORAGE_KEY = "__withone_connect_pending";

/** Pending entries older than this are stale — an abandoned flow. */
export const PENDING_TTL_MS = 10 * 60 * 1000;

/** Query params appended to the return URL in redirect mode. Consumed
 *  (and stripped from the URL) by useOneConnect on the next load. */
export const RETURN_STATUS_PARAM = "one_connect";
export const RETURN_MESSAGE_PARAM = "one_connect_message";

/** Query param appended to the consumer's authorize route so their
 *  backend can forward the theme to One's connect page. */
export const THEME_PARAM = "one_theme";
