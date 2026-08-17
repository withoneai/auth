// Window + overlay management for @withone/connect.
//
// Unlike @withone/auth, this flow can NEVER run in an iframe on the
// consumer's domain: every step (OTP verify, listing connections, the
// consent POST) rides on the end user's One session cookie, which is a
// third-party cookie inside an iframe — blocked by Safari (ITP) and
// partitioned by Firefox. RFC 6749 §10.13 also requires the
// authorization endpoint to resist framing (clickjacking). So:
//   desktop → floating popup window over a dimmed host page
//   mobile  → same-tab redirect there and back

export const OVERLAY_ID = "one-connect-overlay";
export const POPUP_NAME = "one-connect";

const POPUP_WIDTH = 480;
const POPUP_HEIGHT = 760;

/** Small/coarse-pointer devices get a redirect: mobile browsers open
 *  popups as new tabs, which is exactly the experience we're avoiding. */
export function resolveWindowMode(
  requested: "auto" | "popup" | "redirect" | undefined
): "popup" | "redirect" {
  if (requested === "popup" || requested === "redirect") return requested;
  if (typeof window === "undefined") return "redirect";
  const coarse =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;
  const narrow = window.innerWidth < 768;
  return coarse && narrow ? "redirect" : "popup";
}

/** Opens the centered popup. Returns null when the browser blocked it —
 *  callers should fall back to a redirect. */
export function openPopup(url: string): Window | null {
  const dualLeft = window.screenLeft ?? window.screenX ?? 0;
  const dualTop = window.screenTop ?? window.screenY ?? 0;
  const width =
    window.innerWidth ?? document.documentElement.clientWidth ?? screen.width;
  const height =
    window.innerHeight ??
    document.documentElement.clientHeight ??
    screen.height;

  const left = dualLeft + Math.max(0, (width - POPUP_WIDTH) / 2);
  const top = dualTop + Math.max(0, (height - POPUP_HEIGHT) / 2);

  // Keep the feature string MINIMAL. Chromium computes "popup vs tab"
  // from the feature list, and extra legacy keys (toolbar/menubar/
  // location) tip some configurations into opening a full tab — the
  // exact failure this window manager exists to avoid. `popup=yes`
  // plus geometry is the reliable form. (Chrome always keeps the URL
  // bar visible on popups anyway, so users still see withone.ai.)
  const features = [
    `width=${POPUP_WIDTH}`,
    `height=${POPUP_HEIGHT}`,
    `left=${Math.round(left)}`,
    `top=${Math.round(top)}`,
    "popup=yes",
  ].join(",");

  try {
    return window.open(url, POPUP_NAME, features);
  } catch {
    return null;
  }
}

interface OverlayHandlers {
  onFocus: () => void;
  onCancel: () => void;
}

/** Dims the host page behind the popup so the pair reads as a modal.
 *  All styles inline — the SDK ships no CSS. */
export function showOverlay(handlers: OverlayHandlers): void {
  removeOverlay();

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-label", "One secure window is open");
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483000",
    background: "rgba(8, 8, 8, 0.55)",
    backdropFilter: "blur(4px)",
    webkitBackdropFilter: "blur(4px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  } as Partial<CSSStyleDeclaration>);

  const card = document.createElement("div");
  Object.assign(card.style, {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "14px",
    padding: "28px 32px",
    textAlign: "center",
    fontFamily:
      "'DM Sans', system-ui, -apple-system, 'Segoe UI', sans-serif",
    color: "#FAFAF7",
  } as Partial<CSSStyleDeclaration>);

  const text = document.createElement("div");
  text.textContent = "Continue in the secure One window";
  Object.assign(text.style, {
    fontSize: "15px",
    fontWeight: "500",
  } as Partial<CSSStyleDeclaration>);

  const sub = document.createElement("div");
  sub.textContent = "Don't see it? It may be behind this window.";
  Object.assign(sub.style, {
    fontSize: "12.5px",
    color: "rgba(250, 250, 247, 0.65)",
  } as Partial<CSSStyleDeclaration>);

  const row = document.createElement("div");
  Object.assign(row.style, {
    display: "flex",
    gap: "10px",
    marginTop: "6px",
  } as Partial<CSSStyleDeclaration>);

  const focusBtn = document.createElement("button");
  focusBtn.type = "button";
  focusBtn.textContent = "Show the window";
  Object.assign(focusBtn.style, {
    font: "inherit",
    fontSize: "13px",
    fontWeight: "600",
    padding: "9px 18px",
    borderRadius: "10px",
    border: "none",
    cursor: "pointer",
    background: "#F3C747",
    color: "#191919",
  } as Partial<CSSStyleDeclaration>);
  focusBtn.addEventListener("click", handlers.onFocus);

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.textContent = "Cancel";
  Object.assign(cancelBtn.style, {
    font: "inherit",
    fontSize: "13px",
    fontWeight: "500",
    padding: "9px 18px",
    borderRadius: "10px",
    border: "1px solid rgba(250, 250, 247, 0.35)",
    cursor: "pointer",
    background: "transparent",
    color: "#FAFAF7",
  } as Partial<CSSStyleDeclaration>);
  cancelBtn.addEventListener("click", handlers.onCancel);

  row.appendChild(focusBtn);
  row.appendChild(cancelBtn);
  card.appendChild(text);
  card.appendChild(sub);
  card.appendChild(row);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

export function removeOverlay(): void {
  const existing = document.getElementById(OVERLAY_ID);
  if (existing) existing.remove();
}
