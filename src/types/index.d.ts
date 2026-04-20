export interface EventLinkProps {
  baseUrl?: string;
  appTheme?: 'dark' | 'light';
  title?: string;
  imageUrl?: string;
  companyName?: string;
  onClose?: () => void;
  onSuccess?: (connection: ConnectionRecord) => void;
  onError?: (error: string) => void;
  selectedConnection?: string;
  showNameInput?: boolean;
  // Controls how the third-party OAuth provider is opened.
  // 'same' (default): navigate the top-level window to the provider
  // and return to the original page via a state-encoded return URL.
  // 'popup': open the provider in a separate popup window (the
  // pre-1.0.3 behavior). Useful if the host app can't tolerate a
  // full-page redirect.
  authWindow?: 'same' | 'popup';
  token: {
    url: string;
    headers?: Record<string, unknown>;
  }
}

// Internal type — extends EventLinkProps with implementation flags
// not part of the public API.
export interface EventLinkWindowProps {
  baseUrl?: string;
  appTheme?: 'dark' | 'light';
  environment?: "sandbox" | "production";
  title?: string;
  imageUrl?: string;
  companyName?: string;
  onClose?: () => void;
  selectedConnection?: string;
  showNameInput?: boolean;
  authWindow?: 'same' | 'popup';
  token: {
    url: string;
    headers?: Record<string, unknown>;
  };
  // Internal: when set, the iframe is opened in "check" mode and goes
  // straight to polling /v1/connections/oauth/check?state=X. Used by
  // the OAuth return flow after a same-window redirect.
  checkState?: string;
}

export interface ConnectionRecord {
  _id: string;
  platformVersion: string;
  connectionDefinitionId: string;
  name: string;
  key: string;
  environment: string;
  platform: string;
  secretsServiceId: string;
  identity?: string;
  identityType?: 'user' | 'team' | 'organization' | 'project';
  settings: {
    parseWebhookBody: boolean;
    showSecret: boolean;
    allowCustomEvents: boolean;
    oauth: boolean;
  };
  throughput: {
    key: string;
    limit: number;
  };
  createdAt: number;
  updatedAt: number;
  updated: boolean;
  version: string;
  lastModifiedBy: string;
  deleted: boolean;
  tags: string[];
  active: boolean;
  deprecated: boolean;
}

export interface EventProps {
  data: {
    messageType: string;
    message: ConnectionRecord | string;
    // Optional fields for OAUTH_REDIRECT messages
    url?: string;
    state?: string;
  }
}
