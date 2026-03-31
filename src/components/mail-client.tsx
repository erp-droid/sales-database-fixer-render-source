"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useEffectEvent, useState } from "react";

import { AppChrome } from "@/components/app-chrome";
import { GmailComposeModal, type GmailComposeInitialState } from "@/components/gmail-compose-modal";
import { getAppBranding } from "@/lib/app-variant";
import {
  buildMailContactSuggestions,
  dedupeMailRecipients,
} from "@/lib/mail-ui";
import type { BusinessAccountRow, BusinessAccountsResponse } from "@/types/business-account";
import type { MailConnectionStatus, MailSessionResponse } from "@/types/mail";
import type { MailContactSuggestion, MailRecipient, MailSendResponse } from "@/types/mail-compose";
import type {
  MailLinkContactPayload,
  MailMessage,
  MailThreadListResponse,
  MailThreadResponse,
  MailThreadSummary,
} from "@/types/mail-thread";

import styles from "./mail-client.module.css";

const MAILBOX_THREAD_LIMIT = 6;
const appBranding = getAppBranding();

type ComposeState = {
  initialState: GmailComposeInitialState | null;
  isOpen: boolean;
  sendMode: "compose" | "reply" | "forward";
  title: string;
};

type SessionErrorState = {
  message: string;
  status: MailConnectionStatus;
};

type LoadThreadsOptions = {
  forceConnected?: boolean;
};

type LoadSessionOptions = {
  forceRefresh?: boolean;
};

function cleanText(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function buildQuotedForwardHtml(message: MailMessage | null): string {
  if (!message) {
    return "<div></div>";
  }

  const sentAt = cleanText(message.sentAt || message.receivedAt);
  const fromLabel = message.from
    ? `${cleanText(message.from.name) || cleanText(message.from.email)} &lt;${cleanText(
        message.from.email,
      )}&gt;`
    : "";

  return `
    <br />
    <div class="${styles.quotedBlock}">
      <div><strong>From:</strong> ${fromLabel}</div>
      <div><strong>Sent:</strong> ${sentAt || "-"}</div>
      <div><strong>Subject:</strong> ${cleanText(message.subject) || "(no subject)"}</div>
      <br />
      ${message.htmlBody || "<div></div>"}
    </div>
  `;
}

function parseError(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "Request failed.";
  }

  const record = payload as Record<string, unknown>;
  if (typeof record.error === "string" && record.error.trim()) {
    return record.error.trim();
  }

  return "Request failed.";
}

async function readJsonResponse<T>(response: Response): Promise<T | null> {
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.includes("application/json")) {
    return null;
  }

  return (await response.json().catch(() => null)) as T | null;
}

function isMailSessionResponse(payload: unknown): payload is MailSessionResponse {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const record = payload as Record<string, unknown>;
  return (
    (record.status === "connected" ||
      record.status === "disconnected" ||
      record.status === "needs_setup") &&
    (record.senderEmail === null || typeof record.senderEmail === "string") &&
    Array.isArray(record.folders)
  );
}

function isMailboxPending(session: MailSessionResponse | null): boolean {
  const message = cleanText(session?.connectionError).toLowerCase();
  return session?.status === "disconnected" && message.includes("taking longer than expected");
}

function isBusinessAccountsResponse(payload: unknown): payload is BusinessAccountsResponse {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const record = payload as Record<string, unknown>;
  return Array.isArray(record.items) && typeof record.total === "number";
}

function isMailThreadListResponse(payload: unknown): payload is MailThreadListResponse {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const record = payload as Record<string, unknown>;
  return Array.isArray(record.items) && typeof record.total === "number";
}

function isMailThreadResponse(payload: unknown): payload is MailThreadResponse {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const record = payload as Record<string, unknown>;
  return Boolean(record.thread) && Array.isArray(record.messages);
}

function formatRelativeMailTimestamp(value: string | null): string {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function buildReplyRecipients(
  lastMessage: MailMessage | null,
  session: MailSessionResponse | null,
  replyAll: boolean,
): {
  cc: MailRecipient[];
  to: MailRecipient[];
} {
  const senderEmail = cleanText(session?.senderEmail).toLowerCase();
  if (!lastMessage) {
    return { to: [], cc: [] };
  }

  const primaryRecipient = lastMessage.from ? [lastMessage.from] : [];
  if (!replyAll) {
    return {
      to: primaryRecipient,
      cc: [],
    };
  }

  const additionalRecipients = [
    ...lastMessage.to,
    ...lastMessage.cc,
  ].filter((recipient) => cleanText(recipient.email).toLowerCase() !== senderEmail);

  return {
    to: dedupeMailRecipients(primaryRecipient),
    cc: dedupeMailRecipients(additionalRecipients),
  };
}

function buildLinkedContactPayload(
  suggestion: MailContactSuggestion,
): MailLinkContactPayload {
  return {
    contactId: suggestion.contactId ?? 0,
    businessAccountRecordId: suggestion.businessAccountRecordId ?? "",
    businessAccountId: suggestion.businessAccountId,
  };
}

function formatFolderLabel(folder: "inbox" | "sent" | "drafts" | "starred"): string {
  if (folder === "inbox") {
    return "Inbox";
  }
  if (folder === "sent") {
    return "Sent";
  }
  if (folder === "drafts") {
    return "Drafts";
  }
  return "Starred";
}

function buildInitials(value: string): string {
  const tokens = cleanText(value)
    .split(/[\s@._-]+/)
    .filter(Boolean);

  if (tokens.length === 0) {
    return "MB";
  }

  return tokens
    .slice(0, 2)
    .map((token) => token[0]?.toUpperCase() ?? "")
    .join("");
}

function summarizeParticipants(
  participants: string[],
  session: MailSessionResponse | null,
): string {
  const senderEmail = cleanText(session?.senderEmail).toLowerCase();
  const cleaned = participants.map(cleanText).filter(Boolean);
  if (cleaned.length === 0) {
    return "Unknown participant";
  }

  return (
    cleaned.find((participant) => participant.toLowerCase() !== senderEmail) ??
    cleaned[0]
  );
}

export function MailClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [session, setSession] = useState<MailSessionResponse | null>(null);
  const [sessionError, setSessionError] = useState<SessionErrorState | null>(null);
  const [isSessionLoading, setIsSessionLoading] = useState(true);
  const [folder, setFolder] = useState<"inbox" | "sent" | "drafts" | "starred">("inbox");
  const [searchInput, setSearchInput] = useState("");
  const [threadList, setThreadList] = useState<MailThreadSummary[]>([]);
  const [isThreadListLoading, setIsThreadListLoading] = useState(false);
  const [threadListError, setThreadListError] = useState<string | null>(null);
  const [sendNotice, setSendNotice] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [selectedThread, setSelectedThread] = useState<MailThreadResponse | null>(null);
  const [isThreadLoading, setIsThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [contactRows, setContactRows] = useState<BusinessAccountRow[]>([]);
  const [contactRowsError, setContactRowsError] = useState<string | null>(null);
  const [composeState, setComposeState] = useState<ComposeState>({
    initialState: null,
    isOpen: false,
    sendMode: "compose",
    title: "New Message",
  });
  const [linkSearch, setLinkSearch] = useState("");
  const [isLinkingThread, setIsLinkingThread] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkNotice, setLinkNotice] = useState<string | null>(null);
  const [isLinkPanelOpen, setIsLinkPanelOpen] = useState(false);

  const contactSuggestions = buildMailContactSuggestions(contactRows);
  const mailboxPending = isMailboxPending(session);
  const linkedContactCandidates = contactSuggestions
    .filter((suggestion) => {
      if (!linkSearch.trim()) {
        return true;
      }

      const haystack = [
        suggestion.name,
        suggestion.email,
        suggestion.companyName,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(linkSearch.trim().toLowerCase());
    })
    .slice(0, 8);
  const lastMessage =
    selectedThread?.messages[selectedThread.messages.length - 1] ?? null;

  async function loadSession(options?: LoadSessionOptions) {
    setIsSessionLoading(true);
    setSessionError(null);

    try {
      const response = await fetch(
        options?.forceRefresh ? "/api/mail/session?refresh=1" : "/api/mail/session",
        {
          cache: "no-store",
        },
      );
      const payload = await readJsonResponse<MailSessionResponse | { error?: string }>(response);

      if (!response.ok) {
        const message = parseError(payload);
        setSession({
          status: response.status === 422 ? "needs_setup" : "disconnected",
          senderEmail: null,
          senderDisplayName: null,
          expectedGoogleEmail: null,
          connectedGoogleEmail: null,
          connectionError: message,
          folders: ["inbox", "sent", "drafts", "starred"],
        });
        setSessionError({
          message,
          status: response.status === 422 ? "needs_setup" : "disconnected",
        });
        return;
      }

      if (!isMailSessionResponse(payload)) {
        throw new Error("Unexpected mail session response.");
      }

      setSession(payload);
      if (payload.connectionError) {
        setSessionError({
          message: payload.connectionError,
          status: payload.status,
        });
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to load mail session.";
      setSession({
        status: "disconnected",
        senderEmail: null,
        senderDisplayName: null,
        expectedGoogleEmail: null,
        connectedGoogleEmail: null,
        connectionError: message,
        folders: ["inbox", "sent", "drafts", "starred"],
      });
      setSessionError({
        message,
        status: "disconnected",
      });
    } finally {
      setIsSessionLoading(false);
    }
  }

  async function loadContacts() {
    setContactRowsError(null);

    try {
      const response = await fetch(
        "/api/business-accounts?sortBy=companyName&sortDir=asc&page=1&pageSize=200&includeInternal=1",
        {
          cache: "no-store",
        },
      );
      const payload = await readJsonResponse<BusinessAccountsResponse | { error?: string }>(
        response,
      );
      if (!response.ok) {
        throw new Error(parseError(payload));
      }
      if (!isBusinessAccountsResponse(payload)) {
        throw new Error("Unexpected contact lookup response.");
      }

      setContactRows(payload.items);
    } catch (error) {
      setContactRowsError(
        error instanceof Error ? error.message : "Unable to load contact suggestions.",
      );
    }
  }

  async function loadThreads(
    activeFolder: typeof folder,
    activeSearch: string,
    options?: LoadThreadsOptions,
  ) {
    if (!options?.forceConnected && session?.status !== "connected") {
      setThreadList([]);
      return;
    }

    setIsThreadListLoading(true);
    setThreadListError(null);

    try {
      const params = new URLSearchParams({
        folder: activeFolder,
        limit: String(MAILBOX_THREAD_LIMIT),
      });
      if (cleanText(activeSearch)) {
        params.set("q", cleanText(activeSearch));
      }

      const response = await fetch(`/api/mail/threads?${params.toString()}`, {
        cache: "no-store",
      });
      const payload = await readJsonResponse<MailThreadListResponse | { error?: string }>(
        response,
      );
      if (!response.ok) {
        throw new Error(parseError(payload));
      }
      if (!isMailThreadListResponse(payload)) {
        throw new Error("Unexpected thread list response.");
      }

      setThreadList(payload.items);
      setSelectedThreadId((current) => {
        if (!payload.items.length) {
          return null;
        }
        if (current && payload.items.some((thread) => thread.threadId === current)) {
          return current;
        }
        return payload.items[0]?.threadId ?? null;
      });
    } catch (error) {
      setThreadListError(
        error instanceof Error ? error.message : "Unable to load mailbox threads.",
      );
    } finally {
      setIsThreadListLoading(false);
    }
  }

  async function loadThread(threadId: string) {
    setIsThreadLoading(true);
    setThreadError(null);

    try {
      const response = await fetch(`/api/mail/threads/${encodeURIComponent(threadId)}`, {
        cache: "no-store",
      });
      const payload = await readJsonResponse<MailThreadResponse | { error?: string }>(response);
      if (!response.ok) {
        throw new Error(parseError(payload));
      }
      if (!isMailThreadResponse(payload)) {
        throw new Error("Unexpected thread response.");
      }

      setSelectedThread(payload);
      setLinkSearch("");
      setLinkError(null);
      setLinkNotice(null);
      setIsLinkPanelOpen(false);
    } catch (error) {
      setThreadError(error instanceof Error ? error.message : "Unable to load thread.");
    } finally {
      setIsThreadLoading(false);
    }
  }

  useEffect(() => {
    void loadSession();
  }, []);

  useEffect(() => {
    if (contactRows.length || contactRowsError) {
      return;
    }

    if (session?.status !== "connected") {
      return;
    }

    void loadContacts();
  }, [contactRows.length, contactRowsError, session?.status]);

  useEffect(() => {
    if (session?.status !== "connected") {
      setThreadList([]);
      setSelectedThreadId(null);
      setSelectedThread(null);
      return;
    }

    const timeout = window.setTimeout(() => {
      void (async () => {
        setIsThreadListLoading(true);
        setThreadListError(null);

        try {
          const params = new URLSearchParams({
            folder,
            limit: String(MAILBOX_THREAD_LIMIT),
          });
          if (cleanText(searchInput)) {
            params.set("q", cleanText(searchInput));
          }

          const response = await fetch(`/api/mail/threads?${params.toString()}`, {
            cache: "no-store",
          });
          const payload = await readJsonResponse<MailThreadListResponse | { error?: string }>(
            response,
          );
          if (!response.ok) {
            throw new Error(parseError(payload));
          }
          if (!isMailThreadListResponse(payload)) {
            throw new Error("Unexpected thread list response.");
          }

          setThreadList(payload.items);
          setSelectedThreadId((current) => {
            if (!payload.items.length) {
              return null;
            }
            if (current && payload.items.some((thread) => thread.threadId === current)) {
              return current;
            }
            return payload.items[0]?.threadId ?? null;
          });
        } catch (error) {
          setThreadListError(
            error instanceof Error ? error.message : "Unable to load mailbox threads.",
          );
        } finally {
          setIsThreadListLoading(false);
        }
      })();
    }, 220);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [folder, searchInput, session?.status]);

  useEffect(() => {
    if (!selectedThreadId || session?.status !== "connected") {
      setSelectedThread(null);
      return;
    }

    void loadThread(selectedThreadId);
  }, [selectedThreadId, session?.status]);

  const handleOauthMessage = useEffectEvent((event: MessageEvent) => {
    const data = event.data;
    if (!data || typeof data !== "object") {
      return;
    }

    const record = data as Record<string, unknown>;
    if (record.type !== "mbmail.oauth") {
      return;
    }

    if (record.success === true) {
      setSession((current) => ({
        status: "connected",
        senderEmail: current?.senderEmail ?? null,
        senderDisplayName: current?.senderDisplayName ?? null,
        expectedGoogleEmail:
          current?.expectedGoogleEmail ?? current?.senderEmail ?? null,
        connectedGoogleEmail:
          (typeof record.connectedGoogleEmail === "string" &&
          record.connectedGoogleEmail.trim()
            ? record.connectedGoogleEmail.trim()
            : null) ??
          current?.connectedGoogleEmail ??
          current?.expectedGoogleEmail ??
          current?.senderEmail ??
          null,
        connectionError: null,
        folders: current?.folders ?? ["inbox", "sent", "drafts", "starred"],
      }));
      setSessionError(null);
      void loadThreads(folder, searchInput, { forceConnected: true });
      return;
    }

    if (typeof record.message === "string" && record.message.trim()) {
      setSessionError({
        message: record.message,
        status: "needs_setup",
      });
    }
  });

  useEffect(() => {
    window.addEventListener("message", handleOauthMessage);
    return () => {
      window.removeEventListener("message", handleOauthMessage);
    };
  }, []);

  useEffect(() => {
    const composeKey = searchParams.get("composeKey");
    if (!composeKey) {
      return;
    }

    try {
      const raw = window.localStorage.getItem(composeKey);
      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw) as {
        initialState?: GmailComposeInitialState;
        sendMode?: "compose" | "reply" | "forward";
        title?: string;
      };
      setComposeState({
        initialState: parsed.initialState ?? null,
        isOpen: true,
        sendMode: parsed.sendMode ?? "compose",
        title: parsed.title ?? "New Message",
      });
      window.localStorage.removeItem(composeKey);
      router.replace("/mail");
    } catch {
      router.replace("/mail");
    }
  }, [router, searchParams]);

  function openCompose(state?: Partial<ComposeState>) {
    setComposeState({
      initialState: state?.initialState ?? null,
      isOpen: true,
      sendMode: state?.sendMode ?? "compose",
      title: state?.title ?? "New Message",
    });
  }

  async function handleConnectGmail() {
    const popup = window.open(
      "/api/mail/oauth/start?returnTo=/mail/oauth/complete",
      "mail-oauth",
      "popup=yes,width=640,height=780",
    );
    if (!popup) {
      setSessionError({
        message: "Popup blocked. Allow popups for this app to connect Gmail.",
        status: "needs_setup",
      });
    }
  }

  async function handleDisconnectGmail() {
    const response = await fetch("/api/mail/oauth/disconnect", {
      method: "POST",
    });
    if (!response.ok) {
      const payload = await readJsonResponse<{ error?: string }>(response);
      setSessionError({
        message: parseError(payload),
        status: "connected",
      });
      return;
    }

    await loadSession();
  }

  async function refreshMailboxAfterSend(result?: MailSendResponse) {
    setSendError(null);
    setSendNotice("Email sent.");
    await loadSession();
    await loadThreads(folder, searchInput);
    if (result?.threadId) {
      setSelectedThreadId(result.threadId);
      await loadThread(result.threadId);
    }
  }

  async function handleLinkThread(suggestion: MailContactSuggestion) {
    if (!selectedThread) {
      return;
    }

    setIsLinkingThread(true);
    setLinkError(null);
    setLinkNotice(null);

    try {
      const response = await fetch(
        `/api/mail/threads/${encodeURIComponent(selectedThread.thread.threadId)}/link`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...buildLinkedContactPayload(suggestion),
            contactName: suggestion.name,
            companyName: suggestion.companyName,
          }),
        },
      );
      const payload = await readJsonResponse<MailThreadResponse | { error?: string }>(response);
      if (!response.ok) {
        throw new Error(parseError(payload));
      }
      if (!isMailThreadResponse(payload)) {
        throw new Error("Unexpected link response.");
      }

      setSelectedThread(payload);
      setLinkSearch("");
      setLinkNotice("Thread linked and synced to Acumatica.");
      setIsLinkPanelOpen(false);
      await loadThreads(folder, searchInput);
    } catch (error) {
      setLinkError(error instanceof Error ? error.message : "Unable to link thread.");
    } finally {
      setIsLinkingThread(false);
    }
  }

  async function handleRetryThreadSync() {
    if (!selectedThread?.thread.linkedContact.contactId) {
      return;
    }

    const retrySuggestion =
      contactSuggestions.find(
        (suggestion) =>
          suggestion.contactId === selectedThread.thread.linkedContact.contactId &&
          suggestion.businessAccountRecordId ===
            selectedThread.thread.linkedContact.businessAccountRecordId,
      ) ?? null;
    if (!retrySuggestion) {
      setLinkError("The linked contact is no longer available in the local account snapshot.");
      return;
    }

    await handleLinkThread(retrySuggestion);
  }

  const selectedThreadSuggestedContact = selectedThread?.thread.linkedContact.contactId
    ? contactSuggestions.find(
        (suggestion) =>
          suggestion.contactId === selectedThread.thread.linkedContact.contactId &&
          suggestion.businessAccountRecordId ===
            selectedThread.thread.linkedContact.businessAccountRecordId,
      ) ?? null
    : null;
  const selectedThreadLeadParticipant = selectedThread
    ? summarizeParticipants(selectedThread.thread.participants, session)
    : "";
  const selectedThreadSyncLabel =
    selectedThread?.thread.activitySyncStatus.replace(/_/g, " ") ?? "";
  const linkedContactSummaryName =
    cleanText(selectedThread?.thread.linkedContact.contactName) ||
    cleanText(selectedThreadSuggestedContact?.name) ||
    cleanText(selectedThreadSuggestedContact?.email);
  const linkedContactSummaryCompany =
    cleanText(selectedThread?.thread.linkedContact.companyName) ||
    cleanText(selectedThreadSuggestedContact?.companyName);
  const linkedContactSummaryEmail = cleanText(selectedThreadSuggestedContact?.email);

  return (
    <AppChrome
      contentClassName={styles.pageContent}
      headerActions={
        session?.status === "connected" ? (
          <button className={styles.secondaryButton} onClick={() => void handleDisconnectGmail()} type="button">
            Disconnect Gmail
          </button>
        ) : mailboxPending ? (
          <button
            className={styles.secondaryButton}
            onClick={() => void loadSession({ forceRefresh: true })}
            type="button"
          >
            Retry mailbox
          </button>
        ) : (
          <button className={styles.primaryButton} onClick={() => void handleConnectGmail()} type="button">
            Connect Gmail
          </button>
        )
      }
      subtitle="Gmail-backed mailbox with Acumatica CRM activity logging."
      title="Mail"
    >

      <section className={styles.mailShell}>
        <aside className={styles.sidebar}>
          <button
            className={styles.composeButton}
            onClick={() => openCompose({ title: "New Message" })}
            type="button"
          >
            Compose
          </button>
          <div className={styles.folderList}>
            {(["inbox", "sent", "drafts", "starred"] as const).map((folderOption) => (
              <button
                className={
                  folder === folderOption
                    ? `${styles.folderButton} ${styles.folderButtonActive}`
                    : styles.folderButton
                }
                key={folderOption}
                onClick={() => setFolder(folderOption)}
                type="button"
              >
                {folderOption === "inbox"
                  ? "Inbox"
                  : folderOption === "sent"
                    ? "Sent"
                    : folderOption === "drafts"
                      ? "Drafts"
                      : "Starred"}
              </button>
            ))}
          </div>
          <div className={styles.connectionCard}>
            <strong>{session?.senderDisplayName || "Mailbox status"}</strong>
            <span>{session?.expectedGoogleEmail || session?.senderEmail || "No sender mapped yet"}</span>
            <div className={styles.connectionStatusRow}>
              <span
                className={`${styles.connectionDot} ${
                  session?.status === "connected"
                    ? styles.connectionDotConnected
                    : mailboxPending
                      ? styles.connectionDotPending
                      : styles.connectionDotIssue
                }`}
              />
              <span className={styles.connectionStatusLabel}>
                {session?.status === "connected"
                  ? "Connected"
                  : mailboxPending
                    ? "Connection in progress"
                    : session?.status === "needs_setup"
                      ? "Setup required"
                      : "Disconnected"}
              </span>
            </div>
            {isSessionLoading ? <span>Checking mailbox...</span> : null}
            {sessionError ? <span className={styles.warningText}>{sessionError.message}</span> : null}
            {sendError ? <span className={styles.warningText}>{sendError}</span> : null}
            {sendNotice ? <span className={styles.noticeText}>{sendNotice}</span> : null}
          </div>
        </aside>

        <section className={styles.threadListPanel}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.panelEyebrow}>Mailbox</p>
              <h2 className={styles.panelTitle}>{formatFolderLabel(folder)}</h2>
            </div>
            <span className={styles.panelMeta}>
              {session?.status === "connected" ? `${threadList.length} threads` : "Gmail required"}
            </span>
          </div>
          <div className={styles.searchWrap}>
            <input
              className={styles.searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search mail"
              value={searchInput}
            />
          </div>
          {session?.status !== "connected" ? (
            <div className={styles.emptyState}>
              <strong>
                {mailboxPending
                  ? "Mailbox connection is still processing"
                  : session?.status === "needs_setup"
                  ? "Mailbox setup is incomplete"
                  : "Connect Gmail to open your mailbox"}
              </strong>
              <p>
                {mailboxPending
                  ? session?.connectionError ||
                    "Google sign-in may still be finishing. Retry mailbox in a few seconds."
                  : sessionError?.message ||
                  `Mail stays read-only until your signed-in Acumatica login maps to a ${appBranding.companyName} mailbox and Gmail is connected.`}
              </p>
              <button
                className={mailboxPending ? styles.secondaryButton : styles.primaryButton}
                onClick={() => {
                  if (mailboxPending) {
                    void loadSession({ forceRefresh: true });
                    return;
                  }

                  void handleConnectGmail();
                }}
                type="button"
              >
                {mailboxPending ? "Retry mailbox" : "Connect Gmail"}
              </button>
            </div>
          ) : isThreadListLoading ? (
            <div className={styles.emptyState}>Loading threads...</div>
          ) : threadListError ? (
            <div className={styles.emptyState}>{threadListError}</div>
          ) : threadList.length === 0 ? (
            <div className={styles.emptyState}>No threads found in this folder.</div>
          ) : (
            <div className={styles.threadList}>
              {threadList.map((thread) => (
                (() => {
                  const leadParticipant = summarizeParticipants(thread.participants, session);
                  const participantCount = thread.participants.filter((value) => cleanText(value)).length;
                  return (
                    <button
                      className={
                        selectedThreadId === thread.threadId
                          ? `${styles.threadItem} ${styles.threadItemActive}`
                          : styles.threadItem
                      }
                      key={thread.threadId}
                      onClick={() => setSelectedThreadId(thread.threadId)}
                      type="button"
                    >
                      <div className={styles.threadIdentityRow}>
                        <span className={styles.threadAvatar}>
                          {buildInitials(leadParticipant || thread.subject || "Mail")}
                        </span>
                        <div className={styles.threadIdentityCopy}>
                          <div className={styles.threadHeadlineRow}>
                            <strong className={styles.threadParticipant}>{leadParticipant}</strong>
                            <span className={styles.threadTimestamp}>
                              {formatRelativeMailTimestamp(thread.lastMessageAt)}
                            </span>
                          </div>
                          <div className={styles.threadSubjectRow}>
                            <span className={styles.threadSubject}>
                              {thread.subject || "(no subject)"}
                            </span>
                            <span
                              className={`${styles.syncBadge} ${styles.threadSyncBadge} ${
                                thread.activitySyncStatus === "failed"
                                  ? styles.syncBadgeFailed
                                  : thread.activitySyncStatus === "pending"
                                    ? styles.syncBadgePending
                                    : thread.activitySyncStatus === "not_linked"
                                      ? styles.syncBadgeMuted
                                      : styles.syncBadgeSynced
                              }`}
                            >
                              {thread.activitySyncStatus.replace(/_/g, " ")}
                            </span>
                          </div>
                          <p className={styles.threadSnippet}>{thread.snippet}</p>
                          <span className={styles.threadParticipantCount}>
                            {participantCount} participant{participantCount === 1 ? "" : "s"}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })()
              ))}
            </div>
          )}
        </section>

        <section className={styles.readerPanel}>
          {!selectedThreadId ? (
            <div className={styles.emptyState}>Select a thread to read.</div>
          ) : isThreadLoading ? (
            <div className={styles.emptyState}>Loading thread...</div>
          ) : threadError ? (
            <div className={styles.emptyState}>{threadError}</div>
          ) : !selectedThread ? (
            <div className={styles.emptyState}>Thread unavailable.</div>
          ) : (
            <div className={styles.readerShell}>
              <div className={styles.readerMain}>
                <header className={styles.readerHeader}>
                  <div className={styles.readerTitleBlock}>
                    <p className={styles.panelEyebrow}>Conversation</p>
                    <h2>{selectedThread.thread.subject || "(no subject)"}</h2>
                    <div className={styles.readerMetaRow}>
                      <p className={styles.readerSubtitle}>
                        {selectedThreadLeadParticipant || "No participants"}
                        {selectedThread.thread.participants.length > 1
                          ? ` • ${selectedThread.thread.participants.length} participants`
                          : ""}
                      </p>
                      <span
                        className={`${styles.syncBadge} ${
                          selectedThread.thread.activitySyncStatus === "failed"
                            ? styles.syncBadgeFailed
                            : selectedThread.thread.activitySyncStatus === "pending"
                              ? styles.syncBadgePending
                              : selectedThread.thread.activitySyncStatus === "not_linked"
                                ? styles.syncBadgeMuted
                                : styles.syncBadgeSynced
                        }`}
                      >
                        {selectedThreadSyncLabel}
                      </span>
                    </div>
                  </div>
                  <div className={styles.readerActions}>
                    <button
                      onClick={() => {
                        const replyRecipients = buildReplyRecipients(lastMessage, session, false);
                        openCompose({
                          initialState: {
                            threadId: selectedThread.thread.threadId,
                            subject: cleanText(selectedThread.thread.subject).startsWith("Re:")
                              ? selectedThread.thread.subject
                              : `Re: ${selectedThread.thread.subject || ""}`.trim(),
                            htmlBody: "<div><br /></div>",
                            to: replyRecipients.to,
                            cc: replyRecipients.cc,
                            linkedContact: selectedThread.thread.linkedContact,
                            sourceSurface: "mail",
                          },
                          sendMode: "reply",
                          title: "Reply",
                        });
                      }}
                      type="button"
                    >
                      Reply
                    </button>
                    <button
                      onClick={() => {
                        const replyRecipients = buildReplyRecipients(lastMessage, session, true);
                        openCompose({
                          initialState: {
                            threadId: selectedThread.thread.threadId,
                            subject: cleanText(selectedThread.thread.subject).startsWith("Re:")
                              ? selectedThread.thread.subject
                              : `Re: ${selectedThread.thread.subject || ""}`.trim(),
                            htmlBody: "<div><br /></div>",
                            to: replyRecipients.to,
                            cc: replyRecipients.cc,
                            linkedContact: selectedThread.thread.linkedContact,
                            sourceSurface: "mail",
                          },
                          sendMode: "reply",
                          title: "Reply all",
                        });
                      }}
                      type="button"
                    >
                      Reply all
                    </button>
                    <button
                      onClick={() => {
                        openCompose({
                          initialState: {
                            threadId: selectedThread.thread.threadId,
                            subject: cleanText(selectedThread.thread.subject).startsWith("Fwd:")
                              ? selectedThread.thread.subject
                              : `Fwd: ${selectedThread.thread.subject || ""}`.trim(),
                            htmlBody: buildQuotedForwardHtml(lastMessage),
                            to: [],
                            cc: [],
                            bcc: [],
                            linkedContact: selectedThread.thread.linkedContact,
                            sourceSurface: "mail",
                          },
                          sendMode: "forward",
                          title: "Forward",
                        });
                      }}
                      type="button"
                    >
                      Forward
                    </button>
                    {selectedThread.thread.linkedContact.contactId ? (
                      <button onClick={() => void handleRetryThreadSync()} type="button">
                        Retry Acumatica log
                      </button>
                    ) : null}
                  </div>
                </header>

                <div className={styles.messageList}>
                  {selectedThread.messages.map((message) => (
                    <article
                      className={`${styles.messageCard} ${
                        message.direction === "outgoing"
                          ? styles.messageCardOutgoing
                          : styles.messageCardIncoming
                      }`}
                      key={message.messageId}
                    >
                      <header className={styles.messageHeader}>
                        <div className={styles.messageHeaderLeft}>
                          <div className={styles.messageAuthorRow}>
                            <span className={styles.messageAvatar}>
                              {buildInitials(
                                message.from?.name ||
                                  message.from?.email ||
                                  selectedThread.thread.subject ||
                                  "Mail",
                              )}
                            </span>
                            <div className={styles.messageAuthorCopy}>
                              <strong className={styles.messageSender}>
                                {message.from?.name || message.from?.email || "Unknown sender"}
                              </strong>
                              <div className={styles.messageAddresses}>
                                To:{" "}
                                {message.to.map((recipient) => cleanText(recipient.email)).join(", ") ||
                                  "-"}
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className={styles.messageHeaderRight}>
                          <span>{formatRelativeMailTimestamp(message.sentAt || message.receivedAt)}</span>
                          <div className={styles.messageMetaPills}>
                            <span className={styles.messageDirection}>
                              {message.direction === "outgoing" ? "Sent" : "Received"}
                            </span>
                            <span
                              className={`${styles.syncBadge} ${
                                message.activitySyncStatus === "failed"
                                  ? styles.syncBadgeFailed
                                  : message.activitySyncStatus === "pending"
                                    ? styles.syncBadgePending
                                    : message.activitySyncStatus === "not_linked"
                                      ? styles.syncBadgeMuted
                                      : styles.syncBadgeSynced
                              }`}
                            >
                              {message.activitySyncStatus.replace(/_/g, " ")}
                            </span>
                          </div>
                        </div>
                      </header>
                      <div
                        className={styles.messageBody}
                        dangerouslySetInnerHTML={{
                          __html: message.htmlBody || `<pre>${message.textBody}</pre>`,
                        }}
                      />
                    </article>
                  ))}
                </div>
              </div>

              <aside className={styles.readerRail}>
                <section className={styles.linkCard}>
                  <div className={styles.linkCardHeader}>
                    <div className={styles.linkCardCopy}>
                      <p className={styles.panelEyebrow}>Acumatica</p>
                      <strong className={styles.linkCardTitle}>
                        {linkedContactSummaryName ? "Thread linked" : "Link this thread"}
                      </strong>
                      <p className={styles.linkCardDescription}>
                        {linkedContactSummaryName
                          ? "This thread will log activity against the selected Acumatica contact."
                          : "Choose the Acumatica contact this conversation should log against after it lands."}
                      </p>
                    </div>
                    <span
                      className={`${styles.syncBadge} ${
                        selectedThread.thread.activitySyncStatus === "failed"
                          ? styles.syncBadgeFailed
                          : selectedThread.thread.activitySyncStatus === "pending"
                            ? styles.syncBadgePending
                            : selectedThread.thread.activitySyncStatus === "not_linked"
                              ? styles.syncBadgeMuted
                              : styles.syncBadgeSynced
                      }`}
                    >
                      {selectedThreadSyncLabel}
                    </span>
                  </div>

                  {linkedContactSummaryName ? (
                    <div className={styles.linkedContactCard}>
                      <strong>{linkedContactSummaryName}</strong>
                      <span>{linkedContactSummaryCompany || "Linked account unavailable"}</span>
                      {linkedContactSummaryEmail ? <span>{linkedContactSummaryEmail}</span> : null}
                    </div>
                  ) : (
                    <div className={styles.linkCardEmpty}>
                      Activity is not linked yet. Pick an Acumatica contact when you need to land this thread.
                    </div>
                  )}

                  {linkNotice ? <span className={styles.noticeText}>{linkNotice}</span> : null}
                  {linkError ? <span className={styles.warningText}>{linkError}</span> : null}
                  {contactRowsError ? <span className={styles.warningText}>{contactRowsError}</span> : null}

                  <div className={styles.linkCardActions}>
                    <button
                      className={styles.primaryButton}
                      onClick={() => {
                        setLinkError(null);
                        setLinkNotice(null);
                        setIsLinkPanelOpen((current) => !current);
                      }}
                      type="button"
                    >
                      {isLinkPanelOpen
                        ? "Hide contact search"
                        : linkedContactSummaryName
                          ? "Change link"
                          : "Link to contact"}
                    </button>
                    {selectedThread.thread.linkedContact.contactId ? (
                      <button
                        className={styles.secondaryButton}
                        onClick={() => void handleRetryThreadSync()}
                        type="button"
                      >
                        Retry sync
                      </button>
                    ) : null}
                  </div>
                </section>

                {isLinkPanelOpen ? (
                  <section className={styles.linkPanel}>
                    <div className={styles.linkPanelHeader}>
                      <strong>Search Acumatica contacts</strong>
                      <span>Match by name, email, or account</span>
                    </div>
                    <input
                      className={styles.linkInput}
                      onChange={(event) => setLinkSearch(event.target.value)}
                      placeholder="Search contacts by name, email, or account"
                      value={linkSearch}
                    />
                    <div className={styles.linkSuggestions}>
                      {linkedContactCandidates.length ? (
                        linkedContactCandidates.map((suggestion) => (
                          <button
                            className={styles.linkSuggestionButton}
                            disabled={isLinkingThread || !suggestion.contactId}
                            key={suggestion.key}
                            onClick={() => {
                              void handleLinkThread(suggestion);
                            }}
                            type="button"
                          >
                            <strong>{suggestion.name || suggestion.email}</strong>
                            <span>
                              {suggestion.companyName || "Unlinked account"} • {suggestion.email}
                            </span>
                          </button>
                        ))
                      ) : (
                        <div className={styles.linkSuggestionEmpty}>
                          No matching Acumatica contacts found for that search.
                        </div>
                      )}
                    </div>
                  </section>
                ) : null}
              </aside>
            </div>
          )}
        </section>
      </section>

      <GmailComposeModal
        contactSuggestions={contactSuggestions}
        initialState={composeState.initialState}
        isOpen={composeState.isOpen}
        onClose={() =>
          setComposeState((current) => ({
            ...current,
            isOpen: false,
          }))
        }
        onRequestConnectGmail={() => {
          void handleConnectGmail();
        }}
        onSendError={(message) => {
          setSendNotice(null);
          setSendError(message);
        }}
        onSendQueued={() => {
          setSendError(null);
          setSendNotice("Sending email in the background. You can keep working.");
        }}
        onSent={(result) => {
          void refreshMailboxAfterSend(result);
        }}
        sendMode={composeState.sendMode}
        session={session}
        title={composeState.title}
      />
    </AppChrome>
  );
}
