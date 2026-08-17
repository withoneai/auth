// Frame management for @withone/connect.
//
// The SDK has exactly one presentation: an authkit-style modal. A
// full-viewport transparent iframe sits over the host page; One's
// connect page renders a scrim + centered card inside it, so the host
// app stays visible and dimmed underneath. Works at every viewport
// size — the card is responsive and the frame is the viewport.
//
// Transport note: every step of the flow rides on the user's One
// session cookie, which is a THIRD-PARTY cookie when the host page is
// on a different site than One. Production embedding therefore relies
// on One serving that cookie as `Partitioned` (CHIPS) and allowing the
// client's domain via frame-ancestors (RFC 6749 §10.13). Same-site
// setups (e.g. localhost dev) work everywhere as-is.

export const IFRAME_ID = "one-connect-frame";

export function createEmbedIframe(url: string): HTMLIFrameElement {
  removeEmbedIframe();
  const iframe = document.createElement("iframe");
  iframe.id = IFRAME_ID;
  iframe.src = url;
  iframe.setAttribute("allowtransparency", "true");
  Object.assign(iframe.style, {
    position: "fixed",
    inset: "0",
    width: "100%",
    height: "100%",
    border: "0",
    zIndex: "2147483000",
    background: "transparent",
    colorScheme: "normal", // keep the transparent viewport from being painted
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(iframe);
  return iframe;
}

export function removeEmbedIframe(): void {
  const existing = document.getElementById(IFRAME_ID);
  if (existing) existing.remove();
}

export function getEmbedIframe(): HTMLIFrameElement | null {
  return document.getElementById(IFRAME_ID) as HTMLIFrameElement | null;
}
