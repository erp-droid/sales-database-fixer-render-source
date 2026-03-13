"use client";

import { useEffect } from "react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "32px",
        background:
          "linear-gradient(135deg, rgba(232,242,248,1) 0%, rgba(248,250,252,1) 100%)",
      }}
    >
      <section
        style={{
          width: "min(520px, 100%)",
          padding: "32px",
          borderRadius: "24px",
          background: "#ffffff",
          border: "1px solid #d6e0ea",
          boxShadow: "0 24px 60px rgba(15, 23, 42, 0.12)",
          color: "#1e293b",
        }}
      >
        <p
          style={{
            margin: "0 0 12px",
            fontSize: "12px",
            fontWeight: 700,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "#25644b",
          }}
        >
          Application Error
        </p>
        <h1
          style={{
            margin: "0 0 12px",
            fontSize: "32px",
            lineHeight: 1.1,
          }}
        >
          The app hit an unexpected client error.
        </h1>
        <p
          style={{
            margin: "0 0 24px",
            color: "#475569",
            lineHeight: 1.6,
          }}
        >
          Retry the current view first. If the page was open during a deploy, use a hard refresh to
          reload the latest assets.
        </p>
        <div
          style={{
            display: "flex",
            gap: "12px",
            flexWrap: "wrap",
          }}
        >
          <button
            onClick={reset}
            style={{
              border: "none",
              borderRadius: "999px",
              padding: "12px 18px",
              fontWeight: 700,
              background: "#2f8f63",
              color: "#ffffff",
              cursor: "pointer",
            }}
            type="button"
          >
            Retry
          </button>
          <button
            onClick={() => window.location.reload()}
            style={{
              border: "1px solid #cbd5e1",
              borderRadius: "999px",
              padding: "12px 18px",
              fontWeight: 700,
              background: "#ffffff",
              color: "#1e293b",
              cursor: "pointer",
            }}
            type="button"
          >
            Hard refresh
          </button>
        </div>
      </section>
    </main>
  );
}
