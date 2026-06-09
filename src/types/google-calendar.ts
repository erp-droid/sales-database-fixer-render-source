export type GoogleCalendarSessionResponse = {
  status: "connected" | "disconnected" | "needs_setup";
  connectedGoogleEmail: string | null;
  connectionError: string | null;
  expectedRedirectUri: string | null;
  canUploadAttachments: boolean;
  requiresReconnectForAttachments: boolean;
};
