"use client";

import { useEffect, useMemo, useState } from "react";

type BusinessAccountRow = {
  id: string;
  accountRecordId?: string;
  companyName: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  salesRepId: string | null;
  salesRepName: string | null;
  primaryContactName: string | null;
  primaryContactPhone: string | null;
  primaryContactEmail: string | null;
  category: "A" | "B" | "C" | "D" | null;
  notes: string | null;
  lastModifiedIso: string | null;
};

type DetailResponse = {
  row: BusinessAccountRow;
};

type PutPayload = {
  companyName: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  salesRepId: string | null;
  salesRepName: string | null;
  primaryContactName: string | null;
  primaryContactPhone: string | null;
  primaryContactEmail: string | null;
  category: "A" | "B" | "C" | "D" | null;
  notes: string | null;
  expectedLastModified: string | null;
};

type ErrorPayload = {
  error?: string;
  details?: unknown;
};

const DEFAULT_ID = "e7494823-2303-f011-8365-025dbe72350a";

function isBusinessAccountRow(value: unknown): value is BusinessAccountRow {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && typeof record.companyName === "string";
}

function isDetailResponse(value: unknown): value is DetailResponse {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return isBusinessAccountRow(record.row);
}

function parseError(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "Unknown request error";
  }

  const record = payload as ErrorPayload;
  if (typeof record.error === "string" && record.error.trim()) {
    return record.error;
  }

  return "Unknown request error";
}

function readRow(payload: unknown): BusinessAccountRow | null {
  if (isDetailResponse(payload)) {
    return payload.row;
  }
  if (isBusinessAccountRow(payload)) {
    return payload;
  }
  return null;
}

async function readJson(response: Response): Promise<unknown | null> {
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.includes("application/json")) {
    return null;
  }

  return response.json().catch(() => null);
}

export default function PutSmokePage() {
  const [status, setStatus] = useState("Starting PUT smoke test...");
  const [logLines, setLogLines] = useState<string[]>([]);

  const accountId = useMemo(() => {
    if (typeof window === "undefined") {
      return DEFAULT_ID;
    }
    const params = new URLSearchParams(window.location.search);
    return params.get("id")?.trim() || DEFAULT_ID;
  }, []);

  useEffect(() => {
    let mounted = true;
    const logs: string[] = [];

    function log(message: string) {
      logs.push(message);
      if (mounted) {
        setLogLines([...logs]);
      }
    }

    async function run() {
      document.title = "PUT RUNNING";
      setStatus("Fetching current account...");
      log(`Target account id: ${accountId}`);

      const get1 = await fetch(`/api/business-accounts/${encodeURIComponent(accountId)}`, {
        cache: "no-store",
      });
      const payload1 = await readJson(get1);
      if (!get1.ok) {
        const errorMessage = `Initial GET failed: ${get1.status} ${parseError(payload1)}`;
        document.title = "PUT FAIL GET";
        setStatus(errorMessage);
        log(errorMessage);
        return;
      }

      const row = readRow(payload1);
      if (!row) {
        const errorMessage = "Initial GET returned unexpected payload.";
        document.title = "PUT FAIL GET PAYLOAD";
        setStatus(errorMessage);
        log(errorMessage);
        return;
      }

      const nextName = `${row.companyName}.`;
      log(`Current name: ${row.companyName}`);
      log(`Updating name to: ${nextName}`);

      const body: PutPayload = {
        companyName: nextName,
        addressLine1: row.addressLine1,
        addressLine2: row.addressLine2,
        city: row.city,
        state: row.state,
        postalCode: row.postalCode,
        country: row.country,
        salesRepId: row.salesRepId,
        salesRepName: row.salesRepName,
        primaryContactName: row.primaryContactName,
        primaryContactPhone: row.primaryContactPhone,
        primaryContactEmail: row.primaryContactEmail,
        category: row.category,
        notes: row.notes,
        expectedLastModified: row.lastModifiedIso,
      };

      setStatus("Sending PUT...");
      const putResponse = await fetch(`/api/business-accounts/${encodeURIComponent(accountId)}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const putPayload = await readJson(putResponse);
      if (!putResponse.ok) {
        const errorMessage = `PUT failed: ${putResponse.status} ${parseError(putPayload)}`;
        document.title = "PUT FAIL";
        setStatus(errorMessage);
        log(errorMessage);
        log(`Payload: ${JSON.stringify(putPayload)}`);
        return;
      }
      log(`PUT succeeded with status ${putResponse.status}`);

      setStatus("Verifying updated name...");
      const get2 = await fetch(`/api/business-accounts/${encodeURIComponent(accountId)}`, {
        cache: "no-store",
      });
      const payload2 = await readJson(get2);
      if (!get2.ok) {
        const errorMessage = `Verification GET failed: ${get2.status} ${parseError(payload2)}`;
        document.title = "PUT FAIL VERIFY";
        setStatus(errorMessage);
        log(errorMessage);
        return;
      }

      const verifiedRow = readRow(payload2);
      if (!verifiedRow) {
        const errorMessage = "Verification GET returned unexpected payload.";
        document.title = "PUT FAIL VERIFY PAYLOAD";
        setStatus(errorMessage);
        log(errorMessage);
        return;
      }

      if (verifiedRow.companyName !== nextName) {
        const errorMessage = `Verification mismatch. Expected '${nextName}', got '${verifiedRow.companyName}'.`;
        document.title = "PUT FAIL VERIFY VALUE";
        setStatus(errorMessage);
        log(errorMessage);
        return;
      }

      const successMessage = `PUT OK for ${accountId}. New name: ${verifiedRow.companyName}`;
      document.title = "PUT OK";
      setStatus(successMessage);
      log(successMessage);
    }

    void run();

    return () => {
      mounted = false;
    };
  }, [accountId]);

  return (
    <main
      style={{
        padding: "24px",
        fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
      }}
    >
      <h1>PUT Smoke Test</h1>
      <p>{status}</p>
      <pre
        style={{
          background: "#f6f7f9",
          border: "1px solid #d9dde6",
          borderRadius: "8px",
          padding: "12px",
          whiteSpace: "pre-wrap",
        }}
      >
        {logLines.join("\n")}
      </pre>
    </main>
  );
}
