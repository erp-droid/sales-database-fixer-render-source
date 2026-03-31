"use client";

import {
  type ChangeEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import { getAppBranding } from "@/lib/app-variant";
import { dedupeMailRecipients } from "@/lib/mail-ui";
import type { MailSessionResponse } from "@/types/mail";
import type {
  MailAttachmentInput,
  MailContactSuggestion,
  MailDraftResponse,
  MailRecipient,
  MailSendResponse,
} from "@/types/mail-compose";

import styles from "./gmail-compose-modal.module.css";

const appBranding = getAppBranding();

type RecipientField = "to" | "cc" | "bcc";
type ComposeSendMode = "compose" | "reply" | "forward";

export type GmailComposeInitialState = {
  threadId?: string | null;
  draftId?: string | null;
  subject?: string;
  htmlBody?: string;
  textBody?: string;
  to?: MailRecipient[];
  cc?: MailRecipient[];
  bcc?: MailRecipient[];
  attachments?: MailAttachmentInput[];
  linkedContact?: {
    contactId: number | null;
    businessAccountRecordId: string | null;
    businessAccountId: string | null;
    contactName: string | null;
    companyName: string | null;
  } | null;
  sourceSurface?: "accounts" | "mail";
};

type GmailComposeModalProps = {
  contactSuggestions: MailContactSuggestion[];
  initialState?: GmailComposeInitialState | null;
  isOpen: boolean;
  onClose: () => void;
  onDraftSaved?: (result: MailDraftResponse) => void;
  onRequestConnectGmail?: () => void;
  onSendError?: (message: string) => void;
  onSendQueued?: () => void;
  onSent: (result: MailSendResponse) => void;
  session: MailSessionResponse | null;
  sendMode?: ComposeSendMode;
  title?: string;
};

type ComposeDraftState = Required<
  Pick<GmailComposeInitialState, "threadId" | "draftId" | "subject" | "htmlBody" | "textBody">
> & {
  to: MailRecipient[];
  cc: MailRecipient[];
  bcc: MailRecipient[];
  linkedContact: {
    contactId: number | null;
    businessAccountRecordId: string | null;
    businessAccountId: string | null;
    contactName: string | null;
    companyName: string | null;
  };
  attachments: MailAttachmentInput[];
  sourceSurface: "accounts" | "mail";
};

const EMPTY_LINKED_CONTACT = {
  contactId: null,
  businessAccountRecordId: null,
  businessAccountId: null,
  contactName: null,
  companyName: null,
};

function cleanText(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function buildEmptyDraft(initialState?: GmailComposeInitialState | null): ComposeDraftState {
  return {
    threadId: initialState?.threadId ?? null,
    draftId: initialState?.draftId ?? null,
    subject: initialState?.subject ?? "",
    htmlBody: initialState?.htmlBody ?? "",
    textBody: initialState?.textBody ?? "",
    to: initialState?.to ?? [],
    cc: initialState?.cc ?? [],
    bcc: initialState?.bcc ?? [],
    attachments: initialState?.attachments ?? [],
    linkedContact: initialState?.linkedContact ?? EMPTY_LINKED_CONTACT,
    sourceSurface: initialState?.sourceSurface ?? "mail",
  };
}

function htmlToText(html: string): string {
  if (typeof window === "undefined") {
    return html;
  }

  const container = document.createElement("div");
  container.innerHTML = html;
  return container.innerText.trim();
}

function isEmailLike(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function buildRecipientLabel(recipient: MailRecipient): string {
  const name = cleanText(recipient.name);
  const email = cleanText(recipient.email);
  if (!name) {
    return email;
  }
  return `${name} <${email}>`;
}

function createManualRecipient(email: string): MailRecipient {
  return {
    email: cleanText(email).toLowerCase(),
    name: null,
    contactId: null,
    businessAccountRecordId: null,
    businessAccountId: null,
  };
}

function createRecipientFromSuggestion(suggestion: MailContactSuggestion): MailRecipient {
  return {
    email: suggestion.email,
    name: suggestion.name,
    contactId: suggestion.contactId,
    businessAccountRecordId: suggestion.businessAccountRecordId,
    businessAccountId: suggestion.businessAccountId,
  };
}

function findSuggestionByRecipient(
  suggestions: MailContactSuggestion[],
  recipient: MailRecipient | null | undefined,
): MailContactSuggestion | null {
  if (!recipient) {
    return null;
  }

  if (recipient.contactId) {
    const byContactId =
      suggestions.find(
        (suggestion) =>
          suggestion.contactId === recipient.contactId &&
          suggestion.businessAccountRecordId === recipient.businessAccountRecordId,
      ) ?? suggestions.find((suggestion) => suggestion.contactId === recipient.contactId);
    if (byContactId) {
      return byContactId;
    }
  }

  const email = cleanText(recipient.email).toLowerCase();
  if (!email) {
    return null;
  }

  return (
    suggestions.find((suggestion) => suggestion.email.toLowerCase() === email) ?? null
  );
}

async function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Unable to read file."));
        return;
      }

      const commaIndex = result.indexOf(",");
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.onerror = () => reject(new Error("Unable to read file."));
    reader.readAsDataURL(file);
  });
}

async function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Unable to read image."));
        return;
      }
      resolve(reader.result);
    };
    reader.onerror = () => reject(new Error("Unable to read image."));
    reader.readAsDataURL(file);
  });
}

function insertHtmlAtCursor(html: string) {
  document.execCommand("insertHTML", false, html);
}

function resolveRecipientInputValue(
  rawValue: string,
  suggestions: MailContactSuggestion[],
): { error: string | null; recipient: MailRecipient | null } {
  const normalizedValue = cleanText(rawValue).replace(/,$/, "");
  if (!normalizedValue) {
    return { recipient: null, error: null };
  }

  const matchingSuggestion =
    suggestions.find((suggestion) => {
      const comparable = normalizedValue.toLowerCase();
      return (
        suggestion.email.toLowerCase() === comparable ||
        cleanText(suggestion.name).toLowerCase() === comparable
      );
    }) ?? null;
  if (matchingSuggestion) {
    return {
      recipient: createRecipientFromSuggestion(matchingSuggestion),
      error: null,
    };
  }

  if (!isEmailLike(normalizedValue)) {
    return {
      recipient: null,
      error: "Enter a valid email address.",
    };
  }

  return {
    recipient: createManualRecipient(normalizedValue),
    error: null,
  };
}

function formatComposeModeLabel(sendMode: ComposeSendMode): string {
  if (sendMode === "reply") {
    return "Reply";
  }
  if (sendMode === "forward") {
    return "Forward";
  }
  return "Draft";
}

export function GmailComposeModal({
  contactSuggestions,
  initialState = null,
  isOpen,
  onClose,
  onDraftSaved,
  onRequestConnectGmail,
  onSendError,
  onSendQueued,
  onSent,
  session,
  sendMode = "compose",
  title = "New Message",
}: GmailComposeModalProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const inlineImageInputRef = useRef<HTMLInputElement | null>(null);
  const autosaveTimeoutRef = useRef<number | null>(null);
  const lastAutosaveSignatureRef = useRef("");

  const [draft, setDraft] = useState<ComposeDraftState>(() => buildEmptyDraft(initialState));
  const [recipientInputs, setRecipientInputs] = useState<Record<RecipientField, string>>({
    to: "",
    cc: "",
    bcc: "",
  });
  const [activeRecipientField, setActiveRecipientField] = useState<RecipientField>("to");
  const [showCc, setShowCc] = useState(Boolean(initialState?.cc?.length));
  const [showBcc, setShowBcc] = useState(Boolean(initialState?.bcc?.length));
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [composeError, setComposeError] = useState<string | null>(null);
  const [composeNotice, setComposeNotice] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      return;
    }

    setDraft(buildEmptyDraft(initialState));
    setRecipientInputs({ to: "", cc: "", bcc: "" });
    setActiveRecipientField("to");
    setShowCc(Boolean(initialState?.cc?.length));
    setShowBcc(Boolean(initialState?.bcc?.length));
    setIsSavingDraft(false);
    setIsSending(false);
    setIsMinimized(false);
    setIsMaximized(false);
    setComposeError(null);
    setComposeNotice(null);
    lastAutosaveSignatureRef.current = "";
    if (autosaveTimeoutRef.current) {
      window.clearTimeout(autosaveTimeoutRef.current);
      autosaveTimeoutRef.current = null;
    }
  }, [initialState, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const nextDraft = buildEmptyDraft(initialState);
    setDraft(nextDraft);
    setShowCc(Boolean(nextDraft.cc.length));
    setShowBcc(Boolean(nextDraft.bcc.length));
    if (editorRef.current) {
      editorRef.current.innerHTML = nextDraft.htmlBody || "";
    }
  }, [initialState, isOpen]);

  useEffect(() => {
    if (!isOpen || !editorRef.current) {
      return;
    }

    if (editorRef.current.innerHTML !== draft.htmlBody) {
      editorRef.current.innerHTML = draft.htmlBody || "";
    }
  }, [draft.htmlBody, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    if (draft.linkedContact.contactId || draft.to.length !== 1) {
      return;
    }

    const suggestion = findSuggestionByRecipient(contactSuggestions, draft.to[0]);
    if (!suggestion) {
      return;
    }

    setDraft((current) => ({
      ...current,
      linkedContact: {
        contactId: suggestion.contactId,
        businessAccountRecordId: suggestion.businessAccountRecordId,
        businessAccountId: suggestion.businessAccountId,
        contactName: suggestion.name,
        companyName: suggestion.companyName,
      },
    }));
  }, [contactSuggestions, draft.linkedContact.contactId, draft.to, isOpen]);

  useEffect(() => {
    if (!isOpen || session?.status !== "connected") {
      return;
    }

    const hasDraftContent =
      draft.to.length > 0 ||
      draft.cc.length > 0 ||
      draft.bcc.length > 0 ||
      cleanText(draft.subject) ||
      cleanText(draft.htmlBody) ||
      draft.attachments.length > 0;
    if (!hasDraftContent || isSending) {
      return;
    }

    const signature = JSON.stringify({
      threadId: draft.threadId,
      draftId: draft.draftId,
      subject: draft.subject,
      htmlBody: draft.htmlBody,
      to: draft.to,
      cc: draft.cc,
      bcc: draft.bcc,
      linkedContact: draft.linkedContact,
      attachments: draft.attachments.map((attachment) => ({
        fileName: attachment.fileName,
        sizeBytes: attachment.sizeBytes,
      })),
    });
    if (signature === lastAutosaveSignatureRef.current) {
      return;
    }

    if (autosaveTimeoutRef.current) {
      window.clearTimeout(autosaveTimeoutRef.current);
    }

    autosaveTimeoutRef.current = window.setTimeout(() => {
      void (async () => {
        try {
          setIsSavingDraft(true);
          const endpoint = draft.draftId
            ? `/api/mail/drafts/${encodeURIComponent(draft.draftId)}`
            : "/api/mail/drafts";
          const method = draft.draftId ? "PATCH" : "POST";
          const response = await fetch(endpoint, {
            method,
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              ...draft,
              textBody: htmlToText(draft.htmlBody),
            }),
          });
          const payload = (await response.json().catch(() => null)) as
            | MailDraftResponse
            | { error?: string }
            | null;

          if (!response.ok) {
            throw new Error(payload && "error" in payload ? payload.error || "Draft save failed." : "Draft save failed.");
          }

          if (!payload || !("saved" in payload) || payload.saved !== true) {
            throw new Error("Unexpected draft save response.");
          }

          lastAutosaveSignatureRef.current = signature;
          setDraft((current) => ({
            ...current,
            draftId: payload.draftId,
            threadId: payload.threadId ?? current.threadId,
          }));
          setComposeNotice("Saved to drafts");
          onDraftSaved?.(payload);
        } catch (error) {
          setComposeError(error instanceof Error ? error.message : "Unable to save draft.");
        } finally {
          setIsSavingDraft(false);
        }
      })();
    }, 1400);

    return () => {
      if (autosaveTimeoutRef.current) {
        window.clearTimeout(autosaveTimeoutRef.current);
        autosaveTimeoutRef.current = null;
      }
    };
  }, [draft, isOpen, isSending, onDraftSaved, session?.status]);

  if (!isOpen) {
    return null;
  }

  const activeRecipientInput = recipientInputs[activeRecipientField];
  const filteredSuggestions = contactSuggestions
    .filter((suggestion) => {
      if (!activeRecipientInput.trim()) {
        return false;
      }

      const haystack = [
        suggestion.name,
        suggestion.email,
        suggestion.companyName,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(activeRecipientInput.trim().toLowerCase());
    })
    .slice(0, 8);
  function updateRecipientField(field: RecipientField, recipients: MailRecipient[]) {
    setDraft((current) => ({
      ...current,
      [field]: dedupeMailRecipients(recipients),
    }));
  }

  function addRecipient(field: RecipientField, recipient: MailRecipient) {
    updateRecipientField(field, [...draft[field], recipient]);
    setRecipientInputs((current) => ({
      ...current,
      [field]: "",
    }));
    setComposeError(null);
  }

  function removeRecipient(field: RecipientField, recipient: MailRecipient) {
    updateRecipientField(
      field,
      draft[field].filter(
        (item) =>
          !(
            item.email === recipient.email &&
            item.contactId === recipient.contactId &&
            item.businessAccountRecordId === recipient.businessAccountRecordId
          ),
      ),
    );
  }

  function commitRecipientInput(field: RecipientField) {
    const resolution = resolveRecipientInputValue(recipientInputs[field], contactSuggestions);
    if (!resolution.recipient && !resolution.error) {
      return;
    }
    if (resolution.error) {
      setComposeError(resolution.error);
      return;
    }
    if (!resolution.recipient) {
      return;
    }
    addRecipient(field, resolution.recipient);
  }

  function buildDraftWithCommittedRecipientInputs(): {
    draft: ComposeDraftState | null;
    error: string | null;
  } {
    let nextDraft = draft;
    const nextInputs = { ...recipientInputs };
    let hasCommittedRecipient = false;

    for (const field of ["to", "cc", "bcc"] as RecipientField[]) {
      const resolution = resolveRecipientInputValue(nextInputs[field], contactSuggestions);
      if (!resolution.recipient && !resolution.error) {
        continue;
      }
      if (resolution.error) {
        return {
          draft: null,
          error: resolution.error,
        };
      }
      if (!resolution.recipient) {
        continue;
      }

      nextDraft = {
        ...nextDraft,
        [field]: dedupeMailRecipients([...nextDraft[field], resolution.recipient]),
      };
      nextInputs[field] = "";
      hasCommittedRecipient = true;
    }

    if (hasCommittedRecipient) {
      setDraft(nextDraft);
      setRecipientInputs(nextInputs);
      setComposeError(null);
    }

    return {
      draft: nextDraft,
      error: null,
    };
  }

  function updateEditorHtml(nextHtml: string) {
    setDraft((current) => ({
      ...current,
      htmlBody: nextHtml,
      textBody: htmlToText(nextHtml),
    }));
  }

  function applyEditorCommand(command: string, value?: string) {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    updateEditorHtml(editorRef.current?.innerHTML || "");
  }

  async function handleAttachmentChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) {
      return;
    }

    try {
      const attachments = await Promise.all(
        files.map(async (file) => ({
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          base64Data: await readFileAsBase64(file),
        })),
      );
      setDraft((current) => ({
        ...current,
        attachments: [...current.attachments, ...attachments],
      }));
    } catch (error) {
      setComposeError(error instanceof Error ? error.message : "Unable to attach file.");
    } finally {
      event.target.value = "";
    }
  }

  async function handleInlineImageChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    const image = files[0] ?? null;
    if (!image) {
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(image);
      editorRef.current?.focus();
      insertHtmlAtCursor(
        `<img alt="${image.name.replace(/"/g, "&quot;")}" src="${dataUrl}" />`,
      );
      updateEditorHtml(editorRef.current?.innerHTML || "");
    } catch (error) {
      setComposeError(error instanceof Error ? error.message : "Unable to insert image.");
    } finally {
      event.target.value = "";
    }
  }

  async function handleSend() {
    if (session?.status !== "connected") {
      setComposeError("Connect Gmail before sending mail from the app.");
      return;
    }

    const preparedDraft = buildDraftWithCommittedRecipientInputs();
    if (preparedDraft.error) {
      setComposeError(preparedDraft.error);
      return;
    }

    const nextDraft = preparedDraft.draft;
    if (!nextDraft) {
      setComposeError("Unable to prepare this draft for sending.");
      return;
    }

    if (nextDraft.to.length + nextDraft.cc.length + nextDraft.bcc.length === 0) {
      setComposeError("Add at least one recipient.");
      return;
    }

    setIsSending(true);
    setComposeError(null);
    setComposeNotice(null);

    const endpoint =
      sendMode === "reply" && draft.threadId
        ? `/api/mail/threads/${encodeURIComponent(draft.threadId)}/reply`
        : sendMode === "forward" && initialState?.threadId
          ? `/api/mail/threads/${encodeURIComponent(initialState.threadId)}/forward`
          : "/api/mail/messages/send";
    const requestBody = JSON.stringify({
      ...nextDraft,
      textBody: htmlToText(nextDraft.htmlBody),
    });

    onSendQueued?.();
    onClose();

    void (async () => {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: requestBody,
        });
        const payload = (await response.json().catch(() => null)) as
          | MailSendResponse
          | { error?: string }
          | null;

        if (!response.ok) {
          throw new Error(
            payload && "error" in payload ? payload.error || "Send failed." : "Send failed.",
          );
        }

        if (!payload || !("sent" in payload) || payload.sent !== true) {
          throw new Error("Unexpected send response.");
        }

        onSent(payload);
      } catch (error) {
        onSendError?.(error instanceof Error ? error.message : "Unable to send email.");
      }
    })();
  }

  function handlePopout() {
    const preparedDraft = buildDraftWithCommittedRecipientInputs();
    if (preparedDraft.error || !preparedDraft.draft) {
      setComposeError(preparedDraft.error || "Unable to create a pop-out composer.");
      return;
    }

    const composeKey = `mail-compose-${crypto.randomUUID()}`;
    try {
      window.localStorage.setItem(
        composeKey,
        JSON.stringify({
          initialState: {
            ...preparedDraft.draft,
            attachments: preparedDraft.draft.attachments,
          },
          sendMode,
          title,
        }),
      );
    } catch {
      setComposeError("Unable to create a pop-out composer.");
      return;
    }

    window.open(
      `/mail?composeKey=${encodeURIComponent(composeKey)}`,
      "_blank",
      "popup=yes,width=1180,height=920",
    );
    onClose();
  }

  const modalClassName = [
    styles.composeShell,
    isMaximized ? styles.composeShellMaximized : "",
    isMinimized ? styles.composeShellMinimized : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <div className={styles.overlay} onClick={onClose} />
      <section className={modalClassName}>
        <header className={styles.topBar}>
          <div className={styles.topBarTitle}>
            <strong>{title}</strong>
            <span>{formatComposeModeLabel(sendMode)} in {appBranding.mailLabel}</span>
          </div>
          <div className={styles.windowActions}>
            <button onClick={() => setIsMinimized((current) => !current)} type="button">
              {isMinimized ? "Restore" : "Minimize"}
            </button>
            <button onClick={() => setIsMaximized((current) => !current)} type="button">
              {isMaximized ? "Window" : "Maximize"}
            </button>
            <button onClick={handlePopout} type="button">
              Pop out
            </button>
            <button onClick={onClose} type="button">
              Close
            </button>
          </div>
        </header>

        {isMinimized ? (
          <button className={styles.minimizedBar} onClick={() => setIsMinimized(false)} type="button">
            {cleanText(draft.subject) || "New Message"}
          </button>
        ) : (
          <>
            <div className={`${styles.headerRow} ${styles.headerRowPrimary}`}>
              <span className={styles.headerLabel}>From</span>
              <div className={styles.fromValue}>
                <span className={styles.fromAvatar}>
                  {(cleanText(session?.senderDisplayName || session?.senderEmail || "MB")[0] || "M").toUpperCase()}
                </span>
                <div className={styles.fromCopy}>
                  <strong>{session?.senderDisplayName || "Sender"}</strong>
                  <span>{session?.senderEmail || "Connect Gmail first"}</span>
                </div>
              </div>
            </div>

            {(["to", "cc", "bcc"] as RecipientField[]).map((field) => {
              if ((field === "cc" && !showCc) || (field === "bcc" && !showBcc)) {
                return null;
              }

              return (
                <div className={styles.headerRow} key={field}>
                  <span className={styles.headerLabel}>{field.toUpperCase()}</span>
                  <div className={styles.recipientComposer}>
                    <div className={styles.recipientChipRow}>
                      {draft[field].map((recipient) => (
                        <span className={styles.recipientChip} key={buildRecipientLabel(recipient)}>
                          {buildRecipientLabel(recipient)}
                          <button
                            onClick={() => removeRecipient(field, recipient)}
                            type="button"
                          >
                            x
                          </button>
                        </span>
                      ))}
                      <input
                        className={styles.recipientInput}
                        onBlur={() => {
                          commitRecipientInput(field);
                        }}
                        onChange={(event) =>
                          setRecipientInputs((current) => ({
                            ...current,
                            [field]: event.target.value,
                          }))
                        }
                        onFocus={() => setActiveRecipientField(field)}
                        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                          if (event.key === "Enter" || event.key === ",") {
                            event.preventDefault();
                            commitRecipientInput(field);
                          } else if (
                            event.key === "Backspace" &&
                            !recipientInputs[field] &&
                            draft[field].length > 0
                          ) {
                            removeRecipient(field, draft[field][draft[field].length - 1]);
                          }
                        }}
                        placeholder={
                          draft[field].length === 0
                            ? field === "to"
                              ? "To"
                              : field === "cc"
                                ? "Cc"
                                : "Bcc"
                            : ""
                        }
                        value={recipientInputs[field]}
                      />
                    </div>
                    {activeRecipientField === field && filteredSuggestions.length > 0 ? (
                      <div className={styles.suggestionsMenu}>
                        {filteredSuggestions.map((suggestion) => (
                          <button
                            className={styles.suggestionButton}
                            key={suggestion.key}
                            onMouseDown={(event) => {
                              event.preventDefault();
                              addRecipient(field, createRecipientFromSuggestion(suggestion));
                            }}
                            type="button"
                          >
                            <strong>{suggestion.name || suggestion.email}</strong>
                            <span>
                              {suggestion.email}
                              {suggestion.companyName ? ` • ${suggestion.companyName}` : ""}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  {field === "to" ? (
                    <div className={styles.ccActions}>
                      {!showCc ? (
                        <button onClick={() => setShowCc(true)} type="button">
                          Cc
                        </button>
                      ) : null}
                      {!showBcc ? (
                        <button onClick={() => setShowBcc(true)} type="button">
                          Bcc
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}

            <div className={`${styles.subjectRow} ${styles.headerRowPrimary}`}>
              <span className={styles.headerLabel}>Subject</span>
              <input
                className={styles.subjectInput}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    subject: event.target.value,
                  }))
                }
                placeholder="Subject"
                value={draft.subject}
              />
            </div>

            <div className={styles.editorWrap}>
              <div
                className={styles.editor}
                contentEditable
                onInput={(event) => {
                  updateEditorHtml((event.currentTarget as HTMLDivElement).innerHTML);
                }}
                ref={editorRef}
                suppressContentEditableWarning
              />
            </div>

            {draft.attachments.length > 0 ? (
              <div className={styles.attachmentRow}>
                {draft.attachments.map((attachment) => (
                  <span className={styles.attachmentChip} key={`${attachment.fileName}-${attachment.sizeBytes}`}>
                    {attachment.fileName}
                    <button
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          attachments: current.attachments.filter(
                            (item) => item !== attachment,
                          ),
                        }))
                      }
                      type="button"
                    >
                      x
                    </button>
                  </span>
                ))}
              </div>
            ) : null}

            <footer className={styles.footer}>
              <div className={styles.toolbar}>
                <button onClick={() => applyEditorCommand("undo")} type="button">
                  Undo
                </button>
                <button onClick={() => applyEditorCommand("redo")} type="button">
                  Redo
                </button>
                <select
                  className={styles.toolbarSelect}
                  defaultValue="Arial"
                  onChange={(event) => applyEditorCommand("fontName", event.target.value)}
                >
                  <option value="Arial">Sans Serif</option>
                  <option value="Georgia">Serif</option>
                  <option value="Courier New">Monospace</option>
                </select>
                <button onClick={() => applyEditorCommand("bold")} type="button">
                  B
                </button>
                <button onClick={() => applyEditorCommand("italic")} type="button">
                  I
                </button>
                <button onClick={() => applyEditorCommand("underline")} type="button">
                  U
                </button>
                <button onClick={() => applyEditorCommand("insertUnorderedList")} type="button">
                  • List
                </button>
                <button onClick={() => applyEditorCommand("insertOrderedList")} type="button">
                  1. List
                </button>
                <button onClick={() => attachmentInputRef.current?.click()} type="button">
                  Attach
                </button>
                <button onClick={() => inlineImageInputRef.current?.click()} type="button">
                  Inline image
                </button>
              </div>

              <div className={styles.footerActions}>
                <div className={styles.footerPrimaryActions}>
                  <button
                    className={styles.sendButton}
                    disabled={isSending || session?.status !== "connected"}
                    onClick={() => {
                      void handleSend();
                    }}
                    type="button"
                  >
                    {isSending ? "Sending..." : "Send"}
                  </button>
                  {session?.status !== "connected" && onRequestConnectGmail ? (
                    <button
                      className={styles.connectButton}
                      onClick={onRequestConnectGmail}
                      type="button"
                    >
                      Connect Gmail
                    </button>
                  ) : null}
                </div>
                <span className={styles.statusText}>
                  {isSavingDraft
                    ? "Saving draft..."
                    : composeError
                      ? composeError
                      : composeNotice || null}
                </span>
              </div>
            </footer>
          </>
        )}

        <input
          hidden
          multiple
          onChange={(event) => {
            void handleAttachmentChange(event);
          }}
          ref={attachmentInputRef}
          type="file"
        />
        <input
          accept="image/*"
          hidden
          onChange={(event) => {
            void handleInlineImageChange(event);
          }}
          ref={inlineImageInputRef}
          type="file"
        />
      </section>
    </>
  );
}
