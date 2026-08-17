// Wire-protocol constants shared by useOneConnect (host page) and
// completeOneConnect (the consumer's completion page). Changing any of
// these is a breaking change between SDK versions running on the two
// pages — bump with care.

/** postMessage envelope type for the result, completion page → host. */
export const MESSAGE_TYPE = "@withone/connect:result";

/** Posted by One's connect page (cross-origin) when the user closes the
 *  card without a result. */
export const EXIT_MESSAGE_TYPE = "@withone/connect:exit";

/** Query param appended to the consumer's authorize route; their
 *  backend forwards it to One as embed=1 so the connect page renders as
 *  a scrim + card over a transparent body. */
export const EMBED_PARAM = "one_embed";

/** Query param appended to the consumer's authorize route so their
 *  backend can forward the theme to One's connect page. */
export const THEME_PARAM = "one_theme";
