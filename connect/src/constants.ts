// Wire-protocol constants shared by useOneConnect (host page) and
// completeOneConnect (the consumer's completion page). Changing any of
// these is a breaking change between SDK versions running on the two
// pages — bump with care.

/** postMessage envelope type for the result, completion page → host. */
export const MESSAGE_TYPE = "@withone/connect:result";

/** Posted by One's connect page (cross-origin) when the user closes the
 *  card without a result. */
export const EXIT_MESSAGE_TYPE = "@withone/connect:exit";

/** Query params the consumer's callback route puts on its final
 *  redirect (any same-origin URL). The SDK reads them straight off the
 *  iframe's location once the frame is back on the consumer's origin —
 *  no completion page, no postMessage required. */
export const RETURN_STATUS_PARAM = "one_connect";
export const RETURN_MESSAGE_PARAM = "one_connect_message";

/** Fragment key on the authorize URL carrying the app-chosen theme.
 *  A fragment never reaches any server and survives the whole redirect
 *  chain, so the consumer's backend forwards nothing. */
export const THEME_PARAM = "one_theme";
