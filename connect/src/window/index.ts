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

export const SUCCESS_ID = "one-connect-success";

/** The brief "Access granted" confirmation shown after the grant
 *  completes — the same beat authkit's "Connection established" screen
 *  provides. By this point the card's iframe has already navigated home
 *  and been removed, so the SDK paints this itself: scrim + a small
 *  authkit-styled card, auto-dismissing (or on click). Pure inline
 *  styles — the SDK ships no CSS and loads no assets. */
export function showSuccessOverlay(theme?: "dark" | "light"): void {
  removeSuccessOverlay();
  const dark = theme === "dark";
  const overlay = document.createElement("div");
  overlay.id = SUCCESS_ID;
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483000",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(8, 8, 8, 0.5)",
    opacity: "0",
    transition: "opacity 160ms ease",
  } as Partial<CSSStyleDeclaration>);

  const card = document.createElement("div");
  Object.assign(card.style, {
    width: "320px",
    maxWidth: "calc(100vw - 32px)",
    padding: "40px 32px",
    borderRadius: "28px",
    background: dark ? "rgba(25, 25, 25, 0.97)" : "rgba(255, 255, 255, 0.97)",
    border: `1px solid ${dark ? "rgba(255,255,255,0.08)" : "rgba(228,228,223,0.9)"}`,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "16px",
    textAlign: "center",
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  } as Partial<CSSStyleDeclaration>);
  card.innerHTML =
    '<div style="width:56px;height:56px;border-radius:50%;background:#10b981;display:flex;align-items:center;justify-content:center;">' +
    '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>' +
    "</div>" +
    `<div style="font-size:17px;font-weight:600;letter-spacing:-0.01em;color:${dark ? "#fafafa" : "#111114"};">Access granted</div>` +
    `<div style="font-size:13px;line-height:1.5;max-width:240px;color:${dark ? "#a1a1aa" : "#6b7280"};">Your tools are connected. You can pick up right where you left off.</div>`;

  overlay.appendChild(card);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => {
    overlay.style.opacity = "1";
  });

  const dismiss = () => {
    overlay.style.opacity = "0";
    window.setTimeout(() => overlay.remove(), 180);
  };
  overlay.addEventListener("click", dismiss);
  window.setTimeout(dismiss, 2400);
}

export function removeSuccessOverlay(): void {
  document.getElementById(SUCCESS_ID)?.remove();
}

export function getEmbedIframe(): HTMLIFrameElement | null {
  return document.getElementById(IFRAME_ID) as HTMLIFrameElement | null;
}
