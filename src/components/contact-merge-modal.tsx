"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";

import {
  getCachedContactMergePreview,
  refreshContactMergePreview,
  type ContactMergePreviewQuery,
} from "@/lib/contact-merge-preview-client";
import type {
  ContactMergeFieldChoice,
  ContactMergeFieldKey,
  ContactMergePreviewContact,
  ContactMergeResponse,
  MergeableContactCandidate,
} from "@/types/contact-merge";

import styles from "./contact-merge-modal.module.css";

type ContactMergeModalProps = {
  isOpen: boolean;
  businessAccountRecordId: string;
  businessAccountId: string;
  companyName: string;
  contacts: MergeableContactCandidate[];
  onClose: () => void;
  onMerged: (result: ContactMergeResponse) => void;
};

type MergeErrorPayload = {
  error?: string;
  partial?: boolean;
  stage?: string;
};

const EMPTY_PREVIEW_CONTACTS: ContactMergePreviewContact[] = [];

function hasMeaningfulValue(value: string | null | undefined): boolean {
  return Boolean(value && value.trim());
}

function formatText(value: string | null | undefined): string {
  if (!hasMeaningfulValue(value)) {
    return "-";
  }

  return value ?? "-";
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

function parseError(payload: MergeErrorPayload | null): string {
  if (!payload?.error || !payload.error.trim()) {
    return "Request failed.";
  }

  return payload.error;
}

function readJsonResponse<T>(response: Response): Promise<T | null> {
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.includes("application/json")) {
    return Promise.resolve(null);
  }

  return response.json().catch(() => null) as Promise<T | null>;
}

function isContactMergeResponse(value: unknown): value is ContactMergeResponse {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    (record.merged === true || record.queued === true) &&
    typeof record.businessAccountRecordId === "string" &&
    typeof record.businessAccountId === "string" &&
    typeof record.keptContactId === "number" &&
    Array.isArray(record.deletedContactIds) &&
    record.deletedContactIds.every((contactId) => typeof contactId === "number") &&
    Array.isArray(record.accountRows)
  );
}

function pickDefaultKeepContact(contacts: MergeableContactCandidate[]): number | null {
  if (contacts.length < 2) {
    return contacts[0]?.contactId ?? null;
  }

  const primary = contacts.find((contact) => contact.isPrimaryContact && contact.contactId !== null);
  if (primary?.contactId !== null && primary?.contactId !== undefined) {
    return primary.contactId;
  }

  return contacts[0]?.contactId ?? null;
}

function buildPreviewQuery(
  businessAccountRecordId: string,
  contacts: MergeableContactCandidate[],
  keepContactId: number,
): ContactMergePreviewQuery {
  const contactIds = contacts
    .filter((contact): contact is MergeableContactCandidate & { contactId: number } => {
      return contact.contactId !== null;
    })
    .map((contact) => contact.contactId);

  return {
    businessAccountRecordId,
    keepContactId,
    contactIds: [keepContactId, ...contactIds.filter((contactId) => contactId !== keepContactId)],
  };
}

function buildFieldChoicesFromPreview(
  preview: {
    fields: Array<{
      field: ContactMergeFieldKey;
      recommendedSourceContactId: number;
    }>;
  },
): Record<ContactMergeFieldKey, number> {
  return preview.fields.reduce(
    (choices, field) => {
      choices[field.field] = field.recommendedSourceContactId;
      return choices;
    },
    {} as Record<ContactMergeFieldKey, number>,
  );
}

function resolveCandidateLabel(
  candidate: MergeableContactCandidate | null | undefined,
  previewContact: ContactMergePreviewContact | null | undefined,
): string {
  return (
    candidate?.contactName?.trim() ||
    previewContact?.displayName?.trim() ||
    (previewContact?.contactId ? `Contact ${previewContact.contactId}` : "Contact")
  );
}

function getFieldValueForContact(
  field: {
    values: Array<{
      contactId: number;
      value: string | null;
    }>;
  },
  contactId: number,
): string | null {
  return field.values.find((entry) => entry.contactId === contactId)?.value ?? null;
}

export function ContactMergeModal({
  isOpen,
  businessAccountRecordId,
  businessAccountId,
  companyName,
  contacts,
  onClose,
  onMerged,
}: ContactMergeModalProps) {
  const mergeableContacts = useMemo(
    () =>
      contacts.filter((contact): contact is MergeableContactCandidate & { contactId: number } => {
        return contact.contactId !== null;
      }),
    [contacts],
  );
  const initialKeepContactId = pickDefaultKeepContact(mergeableContacts);
  const initialPreview =
    initialKeepContactId !== null && mergeableContacts.length >= 2
      ? getCachedContactMergePreview(
          buildPreviewQuery(businessAccountRecordId, mergeableContacts, initialKeepContactId),
        )
      : null;

  const [keepContactId, setKeepContactId] = useState<number | null>(initialKeepContactId);
  const [preview, setPreview] = useState(initialPreview);
  const [fieldChoices, setFieldChoices] = useState<Record<ContactMergeFieldKey, number> | null>(
    initialPreview ? buildFieldChoicesFromPreview(initialPreview) : null,
  );
  const [setKeptAsPrimary, setSetKeptAsPrimary] = useState(
    initialPreview?.recommendedSetKeptAsPrimary ?? false,
  );
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [partialErrorMessage, setPartialErrorMessage] = useState<string | null>(null);
  const [submissionLocked, setSubmissionLocked] = useState(false);

  const contactsById = useMemo(() => {
    const mapped = new Map<number, MergeableContactCandidate>();
    mergeableContacts.forEach((contact) => {
      mapped.set(contact.contactId, contact);
    });
    return mapped;
  }, [mergeableContacts]);

  const previewQuery = useMemo(() => {
    if (keepContactId === null || mergeableContacts.length < 2) {
      return null;
    }

    return buildPreviewQuery(businessAccountRecordId, mergeableContacts, keepContactId);
  }, [businessAccountRecordId, keepContactId, mergeableContacts]);

  useEffect(() => {
    if (!isOpen) {
      setPreview(null);
      setFieldChoices(null);
      setSetKeptAsPrimary(false);
      setIsLoadingPreview(false);
      setErrorMessage(null);
      setPartialErrorMessage(null);
      setSubmissionLocked(false);
      setKeepContactId(pickDefaultKeepContact(mergeableContacts));
      return;
    }

    if (contacts.length !== mergeableContacts.length) {
      setPreview(null);
      setFieldChoices(null);
      setIsLoadingPreview(false);
      setErrorMessage("Every selected row must have a Contact ID before it can be merged.");
      return;
    }

    if (mergeableContacts.length < 2) {
      setPreview(null);
      setFieldChoices(null);
      setIsLoadingPreview(false);
      setErrorMessage("Select at least 2 contacts to use merge.");
      return;
    }

    if (!previewQuery) {
      setPreview(null);
      setFieldChoices(null);
      setIsLoadingPreview(false);
      setErrorMessage("Choose a kept contact to continue.");
      return;
    }

    const activePreviewQuery = previewQuery;
    const cachedPreview = getCachedContactMergePreview(activePreviewQuery);
    const cachedFieldChoices = cachedPreview
      ? buildFieldChoicesFromPreview(cachedPreview)
      : null;
    if (cachedPreview) {
      setPreview(cachedPreview);
      setFieldChoices(cachedFieldChoices);
      setSetKeptAsPrimary(cachedPreview.recommendedSetKeptAsPrimary);
      setIsLoadingPreview(true);
      setErrorMessage(null);
      setPartialErrorMessage(null);
      setSubmissionLocked(true);
    } else {
      setPreview(null);
      setFieldChoices(null);
      setIsLoadingPreview(true);
      setErrorMessage(null);
      setPartialErrorMessage(null);
      setSubmissionLocked(true);
    }

    let isActive = true;

    async function loadPreview() {
      try {
        const payload = await refreshContactMergePreview(activePreviewQuery);

        if (!isActive) {
          return;
        }

        setPreview(payload);
        if (!cachedPreview) {
          setFieldChoices(buildFieldChoicesFromPreview(payload));
          setSetKeptAsPrimary(payload.recommendedSetKeptAsPrimary);
        }
        setErrorMessage(null);
        setPartialErrorMessage(null);
        setSubmissionLocked(false);
      } catch (error) {
        if (!isActive) {
          return;
        }

        if (cachedPreview) {
          setPreview(cachedPreview);
          setFieldChoices((currentFieldChoices) => currentFieldChoices ?? cachedFieldChoices);
          setPartialErrorMessage(
            "Could not refresh the merge preview. Reload and try again.",
          );
          setSubmissionLocked(true);
        } else {
          setPreview(null);
          setFieldChoices(null);
          setErrorMessage(
            error instanceof Error ? error.message : "Failed to load contact merge preview.",
          );
        }
      } finally {
        if (isActive) {
          setIsLoadingPreview(false);
        }
      }
    }

    void loadPreview();

    return () => {
      isActive = false;
    };
  }, [contacts.length, isOpen, mergeableContacts, previewQuery]);

  const previewContacts = useMemo(() => {
    if (!preview?.contacts.length) {
      return EMPTY_PREVIEW_CONTACTS;
    }

    return preview.contacts;
  }, [preview?.contacts]);
  const previewContactsById = useMemo(() => {
    const mapped = new Map<number, ContactMergePreviewContact>();
    previewContacts.forEach((contact) => {
      mapped.set(contact.contactId, contact);
    });
    return mapped;
  }, [previewContacts]);
  const previewFields = useMemo(() => {
    if (!preview?.fields.length) {
      return [];
    }

    return preview.fields
      .filter((field) => field.values.some((entry) => hasMeaningfulValue(entry.value)));
  }, [preview?.fields]);

  const keptContact = keepContactId !== null ? contactsById.get(keepContactId) ?? null : null;
  const loserContacts = useMemo(
    () => mergeableContacts.filter((contact) => contact.contactId !== keepContactId),
    [keepContactId, mergeableContacts],
  );
  const selectedFieldChoices = useMemo(() => {
    if (!preview || !fieldChoices) {
      return [] as ContactMergeFieldChoice[];
    }

    return preview.fields.map((field) => ({
      field: field.field,
      sourceContactId:
        field.valuesDiffer
          ? fieldChoices[field.field] ?? field.recommendedSourceContactId
          : keepContactId ?? field.recommendedSourceContactId,
    }));
  }, [fieldChoices, keepContactId, preview]);

  const updatedFields = useMemo(() => {
    if (!preview || !fieldChoices || keepContactId === null) {
      return [] as string[];
    }

    return preview.fields
      .filter((field) => {
        const keepValue =
          field.values.find((entry) => entry.contactId === keepContactId)?.value ?? null;
        const selectedSourceContactId = field.valuesDiffer
          ? fieldChoices[field.field] ?? field.recommendedSourceContactId
          : keepContactId;
        const nextValue =
          field.values.find((entry) => entry.contactId === selectedSourceContactId)?.value ?? null;
        return (nextValue ?? "") !== (keepValue ?? "");
      })
      .map((field) => field.label);
  }, [fieldChoices, keepContactId, preview]);

  const matrixGridStyle = useMemo<CSSProperties | undefined>(() => {
    if (!previewContacts.length) {
      return undefined;
    }

    return {
      gridTemplateColumns: `144px repeat(${previewContacts.length}, 240px) 240px`,
    };
  }, [previewContacts.length]);

  async function handleMerge() {
    if (
      !previewQuery ||
      !preview ||
      keepContactId === null ||
      submissionLocked ||
      isLoadingPreview
    ) {
      return;
    }

    const confirmed = window.confirm(
      `This will queue ${loserContacts.length} duplicate contact${
        loserContacts.length === 1 ? "" : "s"
      } for merge. The loser contact${loserContacts.length === 1 ? "" : "s"} will disappear from the app immediately, but Acumatica will not be updated until the queued action is approved and reaches the scheduled cutoff.`,
    );
    if (!confirmed) {
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setPartialErrorMessage(null);

    try {
      const response = await fetch("/api/contacts/merge", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          businessAccountRecordId: preview.businessAccountRecordId,
          businessAccountId: preview.businessAccountId,
          keepContactId,
          selectedContactIds: previewQuery.contactIds,
          setKeptAsPrimary,
          expectedAccountLastModified: preview.expectedAccountLastModified,
          expectedContactLastModifieds: preview.contacts.map((contact) => ({
            contactId: contact.contactId,
            lastModified: contact.lastModifiedIso,
          })),
          fieldChoices: selectedFieldChoices,
        }),
      });
      const payload = await readJsonResponse<ContactMergeResponse | MergeErrorPayload>(response);

      if (!response.ok) {
        const message = parseError(payload as MergeErrorPayload | null);
        if ((payload as MergeErrorPayload | null)?.partial) {
          setPartialErrorMessage(message);
          setSubmissionLocked(true);
          return;
        }

        throw new Error(message);
      }

      if (!isContactMergeResponse(payload)) {
        throw new Error("Unexpected response while queueing the contact merge.");
      }

      onMerged(payload);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to queue the contact merge.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!isOpen) {
    return null;
  }

  return (
    <div className={styles.backdrop} onClick={onClose} role="presentation">
      <section
        aria-labelledby="contact-merge-title"
        aria-modal="true"
        className={styles.modal}
        onClick={(event) => {
          event.stopPropagation();
        }}
        role="dialog"
      >
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Duplicate Contact Merge</p>
            <h2 id="contact-merge-title">Queue contact merge</h2>
            <p className={styles.accountMeta}>
              {formatText(companyName)} · Account ID {formatText(businessAccountId)} · Sales Rep{" "}
              {formatText(mergeableContacts[0]?.salesRepName)}
            </p>
            <p className={styles.accountMeta}>
              Selected contacts: {mergeableContacts.length}
            </p>
          </div>
          <button className={styles.closeButton} onClick={onClose} type="button">
            Close
          </button>
        </header>

        {errorMessage ? <p className={styles.errorBanner}>{errorMessage}</p> : null}
        {partialErrorMessage ? <p className={styles.partialBanner}>{partialErrorMessage}</p> : null}
        {preview?.warnings.length ? (
          <div className={styles.warningStack}>
            {preview.warnings.map((warning) => (
              <p className={styles.warningBanner} key={warning}>
                {warning}
              </p>
            ))}
          </div>
        ) : null}

        {isLoadingPreview ? (
          <p className={styles.loading}>Loading full field comparison...</p>
        ) : null}

        {preview ? (
          <>
            <section className={styles.matrixSection}>
              <div className={styles.matrixScroller}>
                <div className={styles.matrixHeader} style={matrixGridStyle}>
                  <span className={styles.matrixFieldHeader}>Field</span>
                  {previewContacts.map((contact) => {
                    const isKeep = contact.contactId === keepContactId;
                    return (
                      <button
                        className={`${styles.matrixContactHeader} ${
                          isKeep ? styles.matrixContactHeaderActive : ""
                        }`}
                        disabled={isSubmitting || submissionLocked}
                        key={`header-${contact.contactId}`}
                        onClick={() => {
                          setKeepContactId(contact.contactId);
                          setSubmissionLocked(false);
                        }}
                        aria-pressed={isKeep}
                        type="button"
                      >
                        <span
                          className={styles.matrixContactTitle}
                          title={`${resolveCandidateLabel(
                            contactsById.get(contact.contactId),
                            contact,
                          )} · ${contact.contactId}`}
                        >
                          {resolveCandidateLabel(
                            contactsById.get(contact.contactId),
                            contact,
                          )}{" "}
                          · {contact.contactId}
                        </span>
                        <span
                          className={styles.matrixContactMeta}
                          title={formatText(contact.email)}
                        >
                          {formatText(contact.email)}
                        </span>
                        <span className={styles.matrixContactMeta}>
                          Last modified: {formatDateTime(contact.lastModifiedIso)}
                        </span>
                        <span className={styles.matrixContactBadges}>
                          {isKeep ? (
                            <span className={styles.matrixKeepBadge}>Keep this contact</span>
                          ) : null}
                          {contact.isPrimary ? (
                            <span className={styles.primaryBadge}>PRIMARY</span>
                          ) : null}
                        </span>
                      </button>
                    );
                  })}
                  <span className={styles.matrixChoiceHeader}>Selected value</span>
                </div>
                <div className={styles.matrixBody}>
                  {previewFields.map((field) => {
                    const selectedSourceContactId = field.valuesDiffer
                      ? fieldChoices?.[field.field] ?? field.recommendedSourceContactId
                      : keepContactId ?? field.recommendedSourceContactId;
                    const selectedValue = getFieldValueForContact(field, selectedSourceContactId);

                    return (
                      <div className={styles.matrixRow} key={field.field} style={matrixGridStyle}>
                        <strong className={styles.fieldLabel}>{field.label}</strong>
                        {field.values.map((entry) => {
                          const isSelected = entry.contactId === selectedSourceContactId;
                          const isKeepColumn = entry.contactId === keepContactId;

                          return (
                            <div
                              className={`${styles.valueCell} ${
                                isKeepColumn ? styles.keepColumnCell : ""
                              }`}
                              key={`${field.field}-${entry.contactId}`}
                            >
                              {field.valuesDiffer ? (
                                <button
                                  className={`${styles.valueButton} ${
                                    isKeepColumn ? styles.valueButtonKeepColumn : ""
                                  } ${
                                    isSelected ? styles.valueButtonSelected : ""
                                  }`}
                                  disabled={isSubmitting || submissionLocked}
                                  onClick={() => {
                                    setFieldChoices((current) =>
                                      current
                                        ? {
                                            ...current,
                                            [field.field]: entry.contactId,
                                          }
                                        : current,
                                    );
                                    setSubmissionLocked(false);
                                  }}
                                  title={formatText(entry.value)}
                                  type="button"
                                >
                                  <span className={styles.valueButtonValue}>
                                    {formatText(entry.value)}
                                  </span>
                                </button>
                              ) : (
                                <div
                                  className={`${styles.valueStatic} ${
                                    isKeepColumn ? styles.valueStaticKeepColumn : ""
                                  }`}
                                  title={formatText(entry.value)}
                                >
                                  {formatText(entry.value)}
                                </div>
                              )}
                            </div>
                          );
                        })}
                        <div className={styles.choiceCell}>
                          <div
                            className={styles.choiceSummary}
                            title={formatText(selectedValue)}
                          >
                            <strong className={styles.choiceValue}>
                              {formatText(selectedValue)}
                            </strong>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

            <section className={styles.confirmSection}>
              <div className={styles.primarySection}>
                <label>
                  <input
                    checked={setKeptAsPrimary}
                    disabled={keepContactId === null || isSubmitting || submissionLocked}
                    onChange={(event) => {
                      setSetKeptAsPrimary(event.target.checked);
                      setSubmissionLocked(false);
                    }}
                    type="checkbox"
                  />
                  Make kept record primary
                </label>
                {preview.contacts.some(
                  (contact) => contact.isPrimary && contact.contactId !== keepContactId,
                ) && !setKeptAsPrimary ? (
                  <p className={styles.inlineWarning}>
                    This account will lose its current primary contact unless another contact is
                    already primary.
                  </p>
                ) : null}
              </div>

              <div className={styles.summaryBox}>
                <p>
                  Kept contact:{" "}
                  {keepContactId !== null
                    ? `${resolveCandidateLabel(
                        contactsById.get(keepContactId),
                        previewContactsById.get(keepContactId),
                      )} · ${keepContactId}`
                    : "-"}
                </p>
                <p>
                  Merged contact IDs:{" "}
                  {loserContacts.length
                    ? loserContacts.map((contact) => contact.contactId).join(", ")
                    : "-"}
                </p>
                <p>
                  Fields updated: {updatedFields.length ? updatedFields.join(", ") : "No field changes"}
                </p>
                <p>
                  Primary change:{" "}
                  {setKeptAsPrimary &&
                  !preview.contacts.some(
                    (contact) => contact.isPrimary && contact.contactId === keepContactId,
                  )
                    ? "Yes"
                    : "No"}
                </p>
              </div>

              <div className={styles.footer}>
                <button className={styles.secondaryButton} onClick={onClose} type="button">
                  Cancel
                </button>
                <button
                  className={styles.primaryButton}
                  disabled={
                    !preview ||
                    keepContactId === null ||
                    isSubmitting ||
                    submissionLocked ||
                    isLoadingPreview
                  }
                  onClick={() => {
                    void handleMerge();
                  }}
                  type="button"
                >
                  {isSubmitting ? "Queueing..." : "Queue merge"}
                </button>
              </div>
            </section>
          </>
        ) : null}

        {keptContact ? (
          <p className={styles.confirmNote}>
            {formatText(keptContact.contactName)} will be kept. {loserContacts.length} contact
            {loserContacts.length === 1 ? "" : "s"} will be hidden from the app immediately and
            merged later when the queued action runs.
          </p>
        ) : null}
      </section>
    </div>
  );
}
