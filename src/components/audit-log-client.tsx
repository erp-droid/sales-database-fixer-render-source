"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { AppChrome } from "@/components/app-chrome";
import type { AuditActionGroup, AuditItemType, AuditLogResponse, AuditLogRow, AuditResultCode } from "@/lib/audit-log-types";

import styles from "./audit-log-client.module.css";

type SessionResponse = {
  authenticated: boolean;
  user: {
    id: string;
    name: string;
  } | null;
  degraded?: boolean;
};

type ErrorPayload = {
  error?: string;
};

const ITEM_TYPE_LABELS: Record<AuditItemType, string> = {
  call: "Call",
  email: "Email",
  meeting: "Meeting",
  contact: "Contact",
  business_account: "Business account",
};

const ACTION_LABELS: Record<AuditActionGroup, string> = {
  call: "Call",
  email_send: "Email sent",
  meeting_create: "Meeting booked",
  contact_create: "Contact created",
  contact_delete: "Contact deleted",
  contact_merge: "Contact merged",
  business_account_create: "Business account created",
};

const RESULT_LABELS: Record<AuditResultCode, string> = {
  answered: "Answered",
  not_answered: "Not answered",
  succeeded: "Succeeded",
  failed: "Failed",
  partial: "Partial",
  queued: "Queued",
  approved: "Approved",
  cancelled: "Cancelled",
  executed: "Executed",
};

function readJsonResponse<T>(response: Response): Promise<T | null> {
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.includes("application/json")) {
    return Promise.resolve(null);
  }

  return response.json().catch(() => null) as Promise<T | null>;
}

function parseError(payload: ErrorPayload | null): string {
  if (!payload?.error || !payload.error.trim()) {
    return "Request failed.";
  }

  return payload.error;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }

  return parsed.toLocaleString();
}

function buildRecordLabel(item: AuditLogRow): string {
  if (item.companyName && item.contactName) {
    return `${item.companyName} / ${item.contactName}`;
  }
  if (item.companyName) {
    return item.companyName;
  }
  if (item.contactName) {
    return item.contactName;
  }
  if (item.emailSubject) {
    return item.emailSubject;
  }
  if (item.phoneNumber) {
    return item.phoneNumber;
  }
  return "Record";
}

function buildActorOptionKey(option: { loginName: string | null; label: string }): string {
  const loginName = option.loginName?.trim().toLowerCase() ?? "";
  const label = option.label.trim().toLowerCase();
  return loginName || label;
}

function dedupeActorOptions(
  options: Array<{ loginName: string | null; label: string }>,
): Array<{ loginName: string | null; label: string }> {
  const deduped = new Map<string, { loginName: string | null; label: string }>();

  for (const option of options) {
    const key = buildActorOptionKey(option);
    if (!key || deduped.has(key)) {
      continue;
    }

    deduped.set(key, option);
  }

  return [...deduped.values()];
}

function buildQueryString(input: {
  q: string;
  itemType: AuditItemType | "all";
  actionGroup: AuditActionGroup | "all";
  result: AuditResultCode | "all";
  actor: string;
  dateFrom: string;
  dateTo: string;
  page: number;
  businessAccountRecordId: string | null;
  contactId: number | null;
}): string {
  const params = new URLSearchParams();
  if (input.q.trim()) {
    params.set("q", input.q.trim());
  }
  if (input.itemType !== "all") {
    params.set("itemType", input.itemType);
  }
  if (input.actionGroup !== "all") {
    params.set("actionGroup", input.actionGroup);
  }
  if (input.result !== "all") {
    params.set("result", input.result);
  }
  if (input.actor.trim()) {
    params.set("actor", input.actor.trim());
  }
  if (input.dateFrom.trim()) {
    params.set("dateFrom", input.dateFrom.trim());
  }
  if (input.dateTo.trim()) {
    params.set("dateTo", input.dateTo.trim());
  }
  if (input.businessAccountRecordId?.trim()) {
    params.set("businessAccountRecordId", input.businessAccountRecordId.trim());
  }
  if (input.contactId !== null) {
    params.set("contactId", String(input.contactId));
  }
  params.set("page", String(input.page));
  params.set("pageSize", "50");
  return params.toString();
}

export function AuditLogClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [response, setResponse] = useState<AuditLogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [itemType, setItemType] = useState<AuditItemType | "all">("all");
  const [actionGroup, setActionGroup] = useState<AuditActionGroup | "all">("all");
  const [resultCode, setResultCode] = useState<AuditResultCode | "all">("all");
  const [actor, setActor] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [recordBusinessAccountRecordId, setRecordBusinessAccountRecordId] = useState<string | null>(null);
  const [recordContactId, setRecordContactId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const liveReloadTimerRef = useRef<number | null>(null);
  const actorOptions = dedupeActorOptions(response?.actors ?? []);

  useEffect(() => {
    async function fetchSession() {
      const sessionResponse = await fetch("/api/auth/session", { cache: "no-store" });
      const sessionPayload = await readJsonResponse<SessionResponse | ErrorPayload>(sessionResponse);
      if (sessionPayload && "authenticated" in sessionPayload) {
        setSession(sessionPayload);
        if (!sessionPayload.authenticated) {
          setError("Your Acumatica session has expired. Sign in again to review the audit log.");
        }
      }
    }

    void fetchSession();
  }, []);

  useEffect(() => {
    const itemTypeParam = searchParams.get("itemType");
    const actionGroupParam = searchParams.get("actionGroup");
    const resultParam = searchParams.get("result");
    const contactIdParam = searchParams.get("contactId");

    setSearch(searchParams.get("q") ?? "");
    setItemType(
      itemTypeParam === "call" ||
        itemTypeParam === "email" ||
        itemTypeParam === "meeting" ||
        itemTypeParam === "contact" ||
        itemTypeParam === "business_account"
        ? itemTypeParam
        : "all",
    );
    setActionGroup(
      actionGroupParam === "call" ||
        actionGroupParam === "email_send" ||
        actionGroupParam === "meeting_create" ||
        actionGroupParam === "contact_create" ||
        actionGroupParam === "contact_delete" ||
        actionGroupParam === "contact_merge" ||
        actionGroupParam === "business_account_create"
        ? actionGroupParam
        : "all",
    );
    setResultCode(
      resultParam === "answered" ||
        resultParam === "not_answered" ||
        resultParam === "succeeded" ||
        resultParam === "failed" ||
        resultParam === "partial" ||
        resultParam === "queued" ||
        resultParam === "approved" ||
        resultParam === "cancelled" ||
        resultParam === "executed"
        ? resultParam
        : "all",
    );
    setActor(searchParams.get("actor") ?? "");
    setDateFrom(searchParams.get("dateFrom") ?? "");
    setDateTo(searchParams.get("dateTo") ?? "");
    setPage(Number(searchParams.get("page")) > 0 ? Number(searchParams.get("page")) : 1);
    setRecordBusinessAccountRecordId(searchParams.get("businessAccountRecordId")?.trim() || null);
    setRecordContactId(
      contactIdParam && Number.isInteger(Number(contactIdParam)) && Number(contactIdParam) > 0
        ? Number(contactIdParam)
        : null,
    );
  }, [searchParams]);

  const loadAudit = useEffectEvent(async (showLoading = false): Promise<void> => {
    if (!session?.authenticated) {
      setLoading(false);
      return;
    }

    if (showLoading) {
      setLoading(true);
    }

    try {
      const query = buildQueryString({
        q: search,
        itemType,
        actionGroup,
        result: resultCode,
        actor,
        dateFrom,
        dateTo,
        page,
        businessAccountRecordId: recordBusinessAccountRecordId,
        contactId: recordContactId,
      });
      const auditResponse = await fetch(`/api/audit?${query}`, { cache: "no-store" });
      const auditPayload = await readJsonResponse<AuditLogResponse | ErrorPayload>(auditResponse);
      if (!auditResponse.ok) {
        throw new Error(parseError(auditPayload as ErrorPayload | null));
      }
      if (!auditPayload || !("items" in auditPayload)) {
        throw new Error("Unexpected response while loading the audit log.");
      }

      setResponse(auditPayload);
      setSelectedId((current) =>
        current && auditPayload.items.some((item) => item.id === current) ? current : null,
      );
      setError(null);
    } catch (auditError) {
      setError(auditError instanceof Error ? auditError.message : "Unable to load the audit log.");
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  });

  useEffect(() => {
    if (!session?.authenticated) {
      setLoading(false);
      return;
    }

    const timeout = window.setTimeout(() => {
      void loadAudit(true);
    }, 150);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [
    session?.authenticated,
    search,
    itemType,
    actionGroup,
    resultCode,
    actor,
    dateFrom,
    dateTo,
    page,
    recordBusinessAccountRecordId,
    recordContactId,
  ]);

  useEffect(() => {
    if (!session?.authenticated) {
      return;
    }

    const interval = window.setInterval(() => {
      void loadAudit(false);
    }, 120_000);

    const scheduleReload = () => {
      if (liveReloadTimerRef.current !== null) {
        window.clearTimeout(liveReloadTimerRef.current);
      }

      liveReloadTimerRef.current = window.setTimeout(() => {
        liveReloadTimerRef.current = null;
        void loadAudit(false);
      }, 250);
    };

    const eventSource = new EventSource("/api/audit/stream");
    eventSource.addEventListener("ready", scheduleReload);
    eventSource.addEventListener("changed", scheduleReload);
    eventSource.onerror = () => {
      // EventSource retries automatically. Keep the fallback polling interval active.
    };

    return () => {
      window.clearInterval(interval);
      if (liveReloadTimerRef.current !== null) {
        window.clearTimeout(liveReloadTimerRef.current);
        liveReloadTimerRef.current = null;
      }
      eventSource.close();
    };
  }, [
    session?.authenticated,
    search,
    itemType,
    actionGroup,
    resultCode,
    actor,
    dateFrom,
    dateTo,
    page,
    recordBusinessAccountRecordId,
    recordContactId,
  ]);

  const items = response?.items ?? [];
  const selectedItem = items.find((item) => item.id === selectedId) ?? null;
  const totalPages = response ? Math.max(1, Math.ceil(response.total / response.pageSize)) : 1;

  function clearFilters() {
    setSearch("");
    setItemType("all");
    setActionGroup("all");
    setResultCode("all");
    setActor("");
    setDateFrom("");
    setDateTo("");
    setPage(1);
    setRecordBusinessAccountRecordId(null);
    setRecordContactId(null);
    router.replace("/audit");
  }

  function applyRecordFilter(next: { businessAccountRecordId?: string | null; contactId?: number | null }) {
    const query = buildQueryString({
      q: "",
      itemType: "all",
      actionGroup: "all",
      result: "all",
      actor: "",
      dateFrom: "",
      dateTo: "",
      page: 1,
      businessAccountRecordId: next.businessAccountRecordId ?? null,
      contactId: next.contactId ?? null,
    });
    router.push(`/audit?${query}`);
  }

  return (
    <AppChrome
      contentClassName={styles.pageContent}
      subtitle="Review who changed what, when it happened, and which account, contact, call, email, or meeting was affected."
      title="Audit Log"
      userName={session?.user?.name ?? "Signed in"}
    >

      {error ? <p className={styles.warning}>{error}</p> : null}

      <section className={styles.summaryBar}>
        <span className={styles.stateTag}>{loading ? "Loading audit log" : "Live audit log"}</span>
        <span>Total events: {response?.total ?? 0}</span>
        <span>Page: {response?.page ?? 1} / {totalPages}</span>
      </section>

      <section className={styles.controls}>
        <label className={styles.controlField}>
          Search
          <input
            className={styles.controlInput}
            onChange={(event) => {
              setPage(1);
              setSearch(event.target.value);
            }}
            placeholder="Search company, contact, phone, subject, actor, or result"
            value={search}
          />
        </label>

        <label className={styles.controlField}>
          Item Type
          <select
            className={styles.controlInput}
            onChange={(event) => {
              setPage(1);
              setItemType(event.target.value as AuditItemType | "all");
            }}
            value={itemType}
          >
            <option value="all">All items</option>
            <option value="call">Calls</option>
            <option value="email">Emails</option>
            <option value="meeting">Meetings</option>
            <option value="contact">Contacts</option>
            <option value="business_account">Business accounts</option>
          </select>
        </label>

        <label className={styles.controlField}>
          Action
          <select
            className={styles.controlInput}
            onChange={(event) => {
              setPage(1);
              setActionGroup(event.target.value as AuditActionGroup | "all");
            }}
            value={actionGroup}
          >
            <option value="all">All actions</option>
            <option value="call">Call</option>
            <option value="email_send">Email sent</option>
            <option value="meeting_create">Meeting booked</option>
            <option value="contact_create">Contact created</option>
            <option value="contact_delete">Contact deleted</option>
            <option value="contact_merge">Contact merged</option>
            <option value="business_account_create">Business account created</option>
          </select>
        </label>

        <label className={styles.controlField}>
          Result
          <select
            className={styles.controlInput}
            onChange={(event) => {
              setPage(1);
              setResultCode(event.target.value as AuditResultCode | "all");
            }}
            value={resultCode}
          >
            <option value="all">All results</option>
            <option value="answered">Answered</option>
            <option value="not_answered">Not answered</option>
            <option value="succeeded">Succeeded</option>
            <option value="partial">Partial</option>
            <option value="failed">Failed</option>
            <option value="queued">Queued</option>
            <option value="approved">Approved</option>
            <option value="cancelled">Cancelled</option>
            <option value="executed">Executed</option>
          </select>
        </label>

        <label className={styles.controlField}>
          Actor
          <select
            className={styles.controlInput}
            onChange={(event) => {
              setPage(1);
              setActor(event.target.value);
            }}
            value={actor}
          >
            <option value="">All actors</option>
            {actorOptions.map((option) => (
              <option key={buildActorOptionKey(option)} value={option.loginName ?? ""}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.controlField}>
          Date From
          <input
            className={styles.controlInput}
            onChange={(event) => {
              setPage(1);
              setDateFrom(event.target.value);
            }}
            type="date"
            value={dateFrom}
          />
        </label>

        <label className={styles.controlField}>
          Date To
          <input
            className={styles.controlInput}
            onChange={(event) => {
              setPage(1);
              setDateTo(event.target.value);
            }}
            type="date"
            value={dateTo}
          />
        </label>

        <div className={styles.controlActions}>
          <button className={styles.secondaryButton} onClick={clearFilters} type="button">
            Clear filters
          </button>
        </div>
      </section>

      <section className={styles.tableShell}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>Item</th>
              <th>Action</th>
              <th>Record</th>
              <th>Affected fields</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className={styles.loadingCell} colSpan={7}>
                  Loading audit log...
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td className={styles.loadingCell} colSpan={7}>
                  No audit events match the current filters.
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr
                  className={item.id === selectedId ? `${styles.row} ${styles.rowSelected}` : styles.row}
                  key={item.id}
                  onClick={() => setSelectedId(item.id)}
                >
                  <td>{formatDateTime(item.occurredAt)}</td>
                  <td>{item.actorName ?? item.actorLoginName ?? "Unknown"}</td>
                  <td>{ITEM_TYPE_LABELS[item.itemType]}</td>
                  <td>{ACTION_LABELS[item.actionGroup]}</td>
                  <td>
                    <div className={styles.recordCell}>
                      <strong>{buildRecordLabel(item)}</strong>
                      {item.summary ? <span>{item.summary}</span> : null}
                    </div>
                  </td>
                  <td>{item.affectedFields.length > 0 ? item.affectedFields.map((field) => field.label).join(", ") : "-"}</td>
                  <td>
                    <span className={`${styles.resultBadge} ${styles[`result${item.resultCode.replace(/(^|_)([a-z])/g, (_, __, letter) => letter.toUpperCase())}`]}`}>
                      {RESULT_LABELS[item.resultCode]}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <section className={styles.pagination}>
        <button
          className={styles.secondaryButton}
          disabled={page <= 1}
          onClick={() => setPage((current) => Math.max(1, current - 1))}
          type="button"
        >
          Previous
        </button>
        <span>
          Showing page {response?.page ?? 1} of {totalPages}
        </span>
        <button
          className={styles.secondaryButton}
          disabled={page >= totalPages}
          onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
          type="button"
        >
          Next
        </button>
      </section>

      <aside className={`${styles.drawer} ${selectedItem ? styles.drawerOpen : ""}`}>
        <div className={styles.drawerHeader}>
          <div>
            <p className={styles.drawerEyebrow}>Audit Event</p>
            <h2>{selectedItem?.summary ?? "Event details"}</h2>
          </div>
          <button className={styles.secondaryButton} onClick={() => setSelectedId(null)} type="button">
            Close
          </button>
        </div>

        {selectedItem ? (
          <div className={styles.drawerBody}>
            <dl className={styles.detailList}>
              <div>
                <dt>When</dt>
                <dd>{formatDateTime(selectedItem.occurredAt)}</dd>
              </div>
              <div>
                <dt>Who</dt>
                <dd>{selectedItem.actorName ?? selectedItem.actorLoginName ?? "Unknown"}</dd>
              </div>
              <div>
                <dt>Item</dt>
                <dd>{ITEM_TYPE_LABELS[selectedItem.itemType]}</dd>
              </div>
              <div>
                <dt>Action</dt>
                <dd>{ACTION_LABELS[selectedItem.actionGroup]}</dd>
              </div>
              <div>
                <dt>Result</dt>
                <dd>{RESULT_LABELS[selectedItem.resultCode]}</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>{selectedItem.sourceSurface ?? "-"}</dd>
              </div>
              {selectedItem.emailSubject ? (
                <div>
                  <dt>Email subject</dt>
                  <dd>{selectedItem.emailSubject}</dd>
                </div>
              ) : null}
              {selectedItem.phoneNumber ? (
                <div>
                  <dt>Phone</dt>
                  <dd>{selectedItem.phoneNumber}</dd>
                </div>
              ) : null}
              {selectedItem.activitySyncStatus ? (
                <div>
                  <dt>Activity sync</dt>
                  <dd>{selectedItem.activitySyncStatus}</dd>
                </div>
              ) : null}
            </dl>

            <section className={styles.drawerSection}>
              <h3>Affected Fields</h3>
              {selectedItem.affectedFields.length > 0 ? (
                <div className={styles.chipList}>
                  {selectedItem.affectedFields.map((field) => (
                    <span className={styles.chip} key={`${selectedItem.id}-${field.key}`}>
                      {field.label}
                    </span>
                  ))}
                </div>
              ) : (
                <p className={styles.emptyState}>No field list was captured for this event.</p>
              )}
            </section>

            <section className={styles.drawerSection}>
              <h3>Related Records</h3>
              {selectedItem.links.length > 0 ? (
                <div className={styles.relatedList}>
                  {selectedItem.links.map((link, index) => {
                    const content = (
                      <>
                        <strong>{link.companyName ?? link.contactName ?? "Record"}</strong>
                        <span>
                          {link.role.replace(/_/g, " ")}
                          {link.businessAccountId ? ` • ${link.businessAccountId}` : ""}
                          {link.contactId ? ` • Contact ${link.contactId}` : ""}
                        </span>
                      </>
                    );
                    const isFilterable = Boolean(link.businessAccountRecordId || link.contactId);

                    return isFilterable ? (
                      <button
                        className={styles.relatedButton}
                        key={`${selectedItem.id}-${link.role}-${index}`}
                        onClick={() =>
                          applyRecordFilter({
                            businessAccountRecordId: link.businessAccountRecordId,
                            contactId: link.contactId,
                          })
                        }
                        type="button"
                      >
                        {content}
                      </button>
                    ) : (
                      <div
                        className={styles.relatedButton}
                        key={`${selectedItem.id}-${link.role}-${index}`}
                      >
                        {content}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className={styles.emptyState}>No related records were captured for this event.</p>
              )}
            </section>
          </div>
        ) : (
          <div className={styles.drawerBody}>
            <p className={styles.emptyState}>Select an audit row to inspect the event details.</p>
          </div>
        )}
      </aside>

      {selectedItem ? <button className={styles.backdrop} onClick={() => setSelectedId(null)} type="button" /> : null}
    </AppChrome>
  );
}
