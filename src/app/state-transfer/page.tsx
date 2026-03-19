"use client";

import { useState } from "react";

type ImportResult = {
  backupPath: string;
  importedTables: Array<{
    name: string;
    rowCount: number;
  }>;
  importedHistory: boolean;
};

export default function StateTransferPage() {
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  async function handleExport() {
    setIsExporting(true);
    try {
      const response = await fetch("/api/admin/state-transfer/export", {
        method: "GET",
        credentials: "include",
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Failed to export the state snapshot.");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `app-state-snapshot-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Failed to export the state snapshot.");
    } finally {
      setIsExporting(false);
    }
  }

  async function handleImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setImportError(null);
    setImportResult(null);
    setIsImporting(true);
    try {
      const formData = new FormData();
      formData.append("snapshot", file);

      const response = await fetch("/api/admin/state-transfer/import", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      const payload = (await response.json().catch(() => null)) as
        | (ImportResult & { error?: never })
        | { error?: string }
        | null;

      if (!response.ok) {
        throw new Error(payload && "error" in payload ? payload.error ?? "Snapshot import failed." : "Snapshot import failed.");
      }

      setImportResult(payload as ImportResult);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Snapshot import failed.");
    } finally {
      setIsImporting(false);
      event.target.value = "";
    }
  }

  return (
    <main
      style={{
        maxWidth: 860,
        margin: "0 auto",
        padding: "48px 24px 72px",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <h1 style={{ fontSize: 40, marginBottom: 12 }}>State Transfer</h1>
      <p style={{ color: "#5b6b87", fontSize: 18, lineHeight: 1.5, marginBottom: 32 }}>
        Export the current app snapshot from Render, then import it into localhost so your local
        Audit, Data Quality, deletion queue, and read-model state match production.
      </p>

      <section
        style={{
          border: "1px solid #d8e2f0",
          borderRadius: 20,
          padding: 24,
          marginBottom: 24,
          background: "#fff",
        }}
      >
        <h2 style={{ fontSize: 24, marginBottom: 8 }}>1. Export from this environment</h2>
        <p style={{ color: "#5b6b87", marginBottom: 16 }}>
          Use this on Render to download the latest app snapshot as JSON.
        </p>
        <button
          type="button"
          onClick={handleExport}
          disabled={isExporting}
          style={{
            padding: "12px 18px",
            borderRadius: 12,
            border: "1px solid #2f7ff7",
            background: isExporting ? "#d7e7ff" : "#edf5ff",
            color: "#235fc0",
            fontWeight: 600,
            cursor: isExporting ? "progress" : "pointer",
          }}
        >
          {isExporting ? "Exporting..." : "Download snapshot"}
        </button>
      </section>

      <section
        style={{
          border: "1px solid #d8e2f0",
          borderRadius: 20,
          padding: 24,
          background: "#fff",
        }}
      >
        <h2 style={{ fontSize: 24, marginBottom: 8 }}>2. Import into localhost</h2>
        <p style={{ color: "#5b6b87", marginBottom: 16 }}>
          Use this on localhost only. The current local state is backed up automatically before the
          import runs.
        </p>
        <label
          style={{
            display: "inline-block",
            padding: "12px 18px",
            borderRadius: 12,
            border: "1px solid #2f7ff7",
            background: isImporting ? "#d7e7ff" : "#edf5ff",
            color: "#235fc0",
            fontWeight: 600,
            cursor: isImporting ? "progress" : "pointer",
          }}
        >
          {isImporting ? "Importing..." : "Choose snapshot file"}
          <input
            type="file"
            accept="application/json"
            onChange={handleImport}
            disabled={isImporting}
            style={{ display: "none" }}
          />
        </label>

        {importError ? (
          <p style={{ marginTop: 16, color: "#c0392b", fontWeight: 600 }}>{importError}</p>
        ) : null}

        {importResult ? (
          <div
            style={{
              marginTop: 20,
              padding: 16,
              borderRadius: 14,
              background: "#f5f9ff",
              border: "1px solid #d8e2f0",
            }}
          >
            <p style={{ marginBottom: 8, fontWeight: 700 }}>Import completed.</p>
            <p style={{ marginBottom: 12, color: "#41506b" }}>
              Backup saved to <code>{importResult.backupPath}</code>
            </p>
            <ul style={{ margin: 0, paddingLeft: 20, color: "#41506b" }}>
              {importResult.importedTables.map((table) => (
                <li key={table.name}>
                  {table.name}: {table.rowCount.toLocaleString()} rows
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </main>
  );
}
