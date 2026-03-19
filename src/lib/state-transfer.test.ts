import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("state transfer", () => {
  const originalEnv = { ...process.env };
  let tempDir = "";

  beforeEach(() => {
    vi.resetModules();
    tempDir = mkdtempSync(path.join(tmpdir(), "state-transfer-"));
    process.env.READ_MODEL_SQLITE_PATH = path.join(tempDir, "read-model.sqlite");
    process.env.DATA_QUALITY_HISTORY_PATH = path.join(tempDir, "data-quality-history.json");
    process.env.ACUMATICA_BASE_URL = "https://example.com";
    process.env.ACUMATICA_COMPANY = "Example";
    process.env.AUTH_PROVIDER = "acumatica";
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  it("exports and reimports portable state with a backup", async () => {
    const { getReadModelDb } = await import("@/lib/read-model/db");
    const { exportAppStateTransferSnapshot, importAppStateTransferSnapshot } = await import(
      "@/lib/state-transfer"
    );

    const db = getReadModelDb();
    db.prepare(
      `
      INSERT INTO account_rows (
        row_key, id, account_record_id, business_account_id, contact_id, is_primary_contact,
        company_name, address, address_line1, address_line2, city, state, postal_code, country,
        phone_number, sales_rep_id, sales_rep_name, industry_type, sub_category, company_region,
        week, primary_contact_name, primary_contact_phone, primary_contact_email, primary_contact_id,
        category, notes, last_modified_iso, search_text, address_key, payload_json, updated_at
      ) VALUES (
        'acc-1:contact:1', 'acc-1', 'acc-1', 'BA-1', 1, 1,
        'Acme', '', '', '', '', '', '', '',
        NULL, NULL, NULL, NULL, NULL, NULL,
        NULL, 'Jane Doe', NULL, NULL, 1,
        NULL, NULL, NULL, 'acme', '', '{}', '2026-03-19T00:00:00.000Z'
      )
      `,
    ).run();
    db.prepare(
      `
      INSERT INTO audit_events (
        id, occurred_at, item_type, action_group, result_code, actor_login_name, actor_name,
        source_surface, summary, business_account_record_id, business_account_id, company_name,
        contact_id, contact_name, phone_number, email_subject, email_thread_id, email_message_id,
        call_session_id, call_direction, activity_sync_status, search_text, created_at, updated_at
      ) VALUES (
        'audit-1', '2026-03-19T10:00:00.000Z', 'Contact', 'updated', 'succeeded', 'jserrano',
        'Jorge Serrano', 'accounts', 'Updated contact', 'acc-1', 'BA-1', 'Acme', 1, 'Jane Doe',
        NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'updated contact', '2026-03-19T10:00:00.000Z',
        '2026-03-19T10:00:00.000Z'
      )
      `,
    ).run();

    const historyPath = path.join(tempDir, "data-quality-history.json");
    const initialHistory = { version: 3, issues: { a: { status: "open" } } };
    require("node:fs").writeFileSync(historyPath, JSON.stringify(initialHistory), "utf8");

    const snapshot = await exportAppStateTransferSnapshot("render");
    expect(snapshot.tables.account_rows).toHaveLength(1);
    expect(snapshot.tables.audit_events).toHaveLength(1);
    expect(snapshot.dataQualityHistory).toEqual(initialHistory);

    db.prepare("DELETE FROM audit_events").run();
    db.prepare("DELETE FROM account_rows").run();
    require("node:fs").writeFileSync(historyPath, JSON.stringify({ version: 3, issues: {} }), "utf8");

    const result = await importAppStateTransferSnapshot(snapshot);
    expect(result.importedTables.find((table) => table.name === "account_rows")?.rowCount).toBe(1);
    expect(result.importedTables.find((table) => table.name === "audit_events")?.rowCount).toBe(1);

    const restoredAuditCount = db
      .prepare("SELECT COUNT(*) AS count FROM audit_events")
      .get() as { count: number };
    const restoredAccountCount = db
      .prepare("SELECT COUNT(*) AS count FROM account_rows")
      .get() as { count: number };
    expect(restoredAuditCount.count).toBe(1);
    expect(restoredAccountCount.count).toBe(1);

    const restoredHistory = JSON.parse(readFileSync(historyPath, "utf8")) as unknown;
    expect(restoredHistory).toEqual(initialHistory);

    const backupPayload = JSON.parse(readFileSync(result.backupPath, "utf8")) as {
      version: number;
      tables: Record<string, unknown[]>;
    };
    expect(backupPayload.version).toBe(1);
    expect(backupPayload.tables.account_rows).toEqual([]);
    expect(backupPayload.tables.audit_events).toEqual([]);
  });

  it("rejects invalid snapshots", async () => {
    const { importAppStateTransferSnapshot } = await import("@/lib/state-transfer");

    await expect(importAppStateTransferSnapshot({ version: 999 })).rejects.toThrow(
      "Snapshot version is not supported.",
    );
  });
});
