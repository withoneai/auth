import { EventLinkWindowProps } from "../types";

// Capability flag sent to the auth iframe so it knows the parent
// supports the same-window OAuth redirect flow. Older iframes that
// don't read this flag will keep using the popup behavior. Older
// packages (without this flag) make the iframe fall back to popups.
const PACKAGE_CAPABILITIES = {
  oauthRedirect: true,
};

// DOM ID for the auth iframe. Constant so the package can find and
// remove its own iframe deterministically across re-mounts and BFCache
// edge cases.
export const VISIBLE_IFRAME_ID = "event-link";

export class EventLinkWindow {
  private linkTokenEndpoint: string;
  private linkHeaders?: object;
  private baseUrl?: string;
  private onClose?: () => void;
  private title?: string;
  private imageUrl?: string;
  private companyName?: string;
  private selectedConnection?: string;
  private showNameInput?: boolean;
  private appTheme?: "dark" | "light";
  private checkState?: string;

  constructor(props: EventLinkWindowProps) {
    this.linkTokenEndpoint = props.token.url;
    this.linkHeaders = props.token.headers;
    this.baseUrl = props.baseUrl;
    this.onClose = props.onClose;
    this.title = props.title;
    this.imageUrl = props.imageUrl;
    this.companyName = props.companyName;
    this.selectedConnection = props.selectedConnection;
    this.showNameInput = props.showNameInput;
    this.appTheme = props.appTheme;
    this.checkState = props.checkState;
  }

  private _getBaseUrl() {
    if (this.baseUrl) {
      return this.baseUrl;
    }
    return "https://auth.withone.ai";
  }

  private _buildPayload() {
    return {
      linkTokenEndpoint: this.linkTokenEndpoint,
      linkHeaders: this.linkHeaders,
      title: this.title,
      imageUrl: this.imageUrl,
      companyName: this.companyName,
      selectedConnection: this.selectedConnection,
      showNameInput: this.showNameInput,
      appTheme: this.appTheme,
      // Internal — tells the iframe what the parent supports
      capabilities: PACKAGE_CAPABILITIES,
      // Internal — when present, iframe goes straight to status check
      checkState: this.checkState,
    };
  }

  public openLink() {
    // Defensive: if a previous instance is still in the DOM (e.g.,
    // from a double open() call), remove it first. Two iframes with
    // the same id would both receive postMessages and cause weird
    // race conditions.
    const existing = document.getElementById(VISIBLE_IFRAME_ID);
    if (existing) {
      existing.remove();
    }

    const container = document.createElement("iframe");

    const payload = this._buildPayload();
    const jsonString = JSON.stringify(payload);

    const base64Encoded = btoa(jsonString);
    const urlParams = { data: base64Encoded };
    const queryString = new URLSearchParams(urlParams).toString();

    const url = `${this._getBaseUrl()}?${queryString}`;

    document.body.appendChild(container);
    container.style.height = "100%";
    container.style.width = "100%";
    container.style.position = "fixed";
    container.style.display = "hidden";
    container.style.visibility = "hidden";
    container.style.zIndex = "9999";
    container.style.backgroundColor = "transparent";
    container.style.inset = "0px";
    container.style.borderWidth = "0px";
    container.id = VISIBLE_IFRAME_ID;
    container.style.overflow = "hidden auto";
    container.src = url;

    container.onload = () => {
      setTimeout(() => {
        container.style.display = "block";
        container.style.visibility = "visible";
      }, 100);
      container.contentWindow?.postMessage(payload, url);
    };
  }

  public closeLink() {
    const iFrameWindow = document.getElementById(
      VISIBLE_IFRAME_ID
    ) as HTMLIFrameElement;
    if (iFrameWindow) {
      iFrameWindow.remove();
    }
  }
}

export const createWindow = (props: EventLinkWindowProps) => {
  return new EventLinkWindow(props);
};
