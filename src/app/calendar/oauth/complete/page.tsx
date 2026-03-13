"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";

function readFirstParam(searchParams: URLSearchParams, keys: string[]): string | null {
  for (const key of keys) {
    const value = searchParams.get(key)?.trim();
    if (value) {
      return value;
    }
  }

  return null;
}

function CalendarOauthCompletePageContent() {
  const searchParams = useSearchParams();

  const payload = useMemo(() => {
    const params = new URLSearchParams(searchParams.toString());
    const errorMessage = readFirstParam(params, [
      "error_description",
      "error",
      "message",
      "reason",
    ]);
    const connectedGoogleEmail = readFirstParam(params, [
      "connectedGoogleEmail",
      "email",
      "gmail",
    ]);

    return errorMessage
      ? {
          type: "mbcalendar.oauth",
          success: false as const,
          message: errorMessage,
        }
      : {
          type: "mbcalendar.oauth",
          success: true as const,
          connectedGoogleEmail,
        };
  }, [searchParams]);

  const title = payload.success
    ? "Google Calendar connection complete"
    : "Google Calendar connection failed";
  const message = payload.success
    ? "This window can close now."
    : payload.message || "Unable to complete Google Calendar connection.";

  useEffect(() => {
    const opener = window.opener;
    const hasOpener = Boolean(opener && !opener.closed);

    if (hasOpener) {
      opener.postMessage(payload, window.location.origin);
    }

    if (hasOpener) {
      const timeout = window.setTimeout(() => {
        window.close();
      }, 120);

      return () => {
        window.clearTimeout(timeout);
      };
    }

    return undefined;
  }, [payload]);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "24px",
        background: "linear-gradient(180deg, #f6f8fb 0%, #eef4f8 100%)",
        color: "#172033",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <section
        style={{
          width: "min(440px, 100%)",
          border: "1px solid #d4dde8",
          borderRadius: "16px",
          background: "#ffffff",
          boxShadow: "0 16px 40px rgba(23, 32, 51, 0.12)",
          padding: "24px",
          display: "grid",
          gap: "12px",
        }}
      >
        <h1 style={{ margin: 0, fontSize: "24px" }}>{title}</h1>
        <p style={{ margin: 0, lineHeight: 1.5 }}>{message}</p>
        <p style={{ margin: 0, color: "#667085", lineHeight: 1.5 }}>
          If this window does not close automatically, return to the meeting drawer and refresh
          the calendar connection there.
        </p>
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
          <Link
            href="/accounts"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              border: "1px solid #d4dde8",
              borderRadius: "10px",
              padding: "10px 14px",
              color: "#2f8f63",
              textDecoration: "none",
              fontWeight: 600,
            }}
          >
            Return to accounts
          </Link>
          <button
            onClick={() => window.close()}
            style={{
              border: "1px solid #d4dde8",
              borderRadius: "10px",
              padding: "10px 14px",
              background: "#eaf6ef",
              color: "#172033",
              fontWeight: 600,
              cursor: "pointer",
            }}
            type="button"
          >
            Close window
          </button>
        </div>
      </section>
    </main>
  );
}

export default function CalendarOauthCompletePage() {
  return (
    <Suspense fallback={null}>
      <CalendarOauthCompletePageContent />
    </Suspense>
  );
}
