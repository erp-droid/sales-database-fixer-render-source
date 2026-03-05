"use client";

import { useEffect, useMemo, useState } from "react";

import {
  getCachedContactMergePreview,
  loadContactMergePreview,
} from "@/lib/contact-merge-preview-client";
import type { DataQualityIssueRow } from "@/types/data-quality";
import type {
  ContactMergeFieldChoice,
  ContactMergeFieldKey,
  ContactMergeResponse,
  ContactMergePreviewResponse,
} from "@/types/contact-merge";

import styles from "./contact-merge-modal.module.css";

type ContactMergeModalProps = {
  isOpen: boolean;
  businessAccountRecordId: string;
  businessAccountId: string;
  companyName: string;
  contacts: DataQualityIssueRow[];
  onClose: () => void;
  onMerged: (result: ContactMergeResponse) => void;
};

type MergeErrorPayload = {
  error?: string;
  partial?: boolean;
  stage?: string;
};

function formatText(value: string | null | undefined): string {
  if (!value || !value.trim()) {
    return "-";
  }

  return value;
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
    record.merged === true &&
    typeof record.businessAccountRecordId === "string" &&
    typeof record.businessAccountId === "string" &&
    typeof record.keptContactId === "number" &&
    typeof record.deletedContactId === "number" &&
    Array.isArray(record.accountRows)
  );
}

function pickDefaultKeepContact(contacts: DataQualityIssueRow[]): number | null {
  if (contacts.length < 2) {
    return contacts[0]?.contactId ?? null;
  }

  const primary = contacts.find((contact) => contact.isPrimaryContact && contact.contactId !== null);
  if (primary?.contactId !== null && primary?.contactId !== undefined) {
    return primary.contactId;
  }

  return contacts[0]?.contactId ?? null;
}

function buildFieldChoicesFromPreview(
  preview: ContactMergePreviewResponse,
): Record<ContactMergeFieldKey, "keep" | "delete"> {
  return preview.fields.reduce(
    (choices, field) => {
      choices[field.field] = field.recommendedSource;
      return choices;
    },
    {} as Record<ContactMergeFieldKey, "keep" | "delete">,
  );
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
  const initialKeepContactId = pickDefaultKeepContact(contacts);
  const initialDeleteContactId =
    initialKeepContactId === null
      ? null
      : contacts.find((contact) => contact.contactId !== initialKeepContactId)?.contactId ?? null;
  const initialPreview =
    initialKeepContactId !== null && initialDeleteContactId !== null
      ? getCachedContactMergePreview({
          businessAccountRecordId,
          keepContactId: initialKeepContactId,
          deleteContactId: initialDeleteContactId,
        })
      : null;

  const [keepContactId, setKeepContactId] = useState<number | null>(initialKeepContactId);
  const [preview, setPreview] = useState<ContactMergePreviewResponse | null>(initialPreview);
  const [fieldChoices, setFieldChoices] = useState<Record<ContactMergeFieldKey, "keep" | "delete"> | null>(
    initialPreview ? buildFieldChoicesFromPreview(initialPreview) : null,
  );
  const [setKeptAsPrimary, setSetKeptAsPrimary] = useState(
    initialPreview?.recommendedSetKeptAsPrimary ?? false,
  );
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [partialErrorMessage, setPartialErrorMessage] = useState<string | null>(null);

  const orderedContacts = useMemo(() => contacts.slice(0, 2), [contacts]);
  const deleteContactId = useMemo(() => {
    if (keepContactId === null) {
      return null;
    }

    const other = orderedContacts.find((contact) => contact.contactId !== keepContactId);
    return other?.contactId ?? null;
  }, [keepContactId, orderedContacts]);

  const contactsById = useMemo(() => {
    const mapped = new Map<number, DataQualityIssueRow>();
    orderedContacts.forEach((contact) => {
      if (contact.contactId !== null) {
        mapped.set(contact.contactId, contact);
      }
    });
    return mapped;
  }, [orderedContacts]);

  useEffect(() => {
    if (!isOpen) {
      setPreview(null);
      setFieldChoices(null);
      setSetKeptAsPrimary(false);
      setIsLoadingPreview(false);
      setErrorMessage(null);
      setPartialErrorMessage(null);
      setKeepContactId(pickDefaultKeepContact(contacts));
      return;
    }

    if (orderedContacts.length !== 2) {
      setPreview(null);
      setFieldChoices(null);
      setIsLoadingPreview(false);
      setErrorMessage("This group must have exactly 2 contacts to use merge.");
      return;
    }

    if (keepContactId === null || deleteContactId === null) {
      setPreview(null);
      setFieldChoices(null);
      setIsLoadingPreview(false);
      setErrorMessage("Both selected contacts must have ContactID values before they can be merged.");
      return;
    }

    const previewKeepContactId = keepContactId;
    const previewDeleteContactId = deleteContactId;

    const cachedPreview = getCachedContactMergePreview({
      businessAccountRecordId,
      keepContactId: previewKeepContactId,
      deleteContactId: previewDeleteContactId,
    });
    if (cachedPreview) {
      setPreview(cachedPreview);
      setFieldChoices(buildFieldChoicesFromPreview(cachedPreview));
      setSetKeptAsPrimary(cachedPreview.recommendedSetKeptAsPrimary);
      setIsLoadingPreview(false);
      setErrorMessage(null);
      setPartialErrorMessage(null);
      return;
    }

    let isActive = true;
    setPreview(null);
    setFieldChoices(null);
    setIsLoadingPreview(true);
    setErrorMessage(null);
    setPartialErrorMessage(null);

    async function loadPreview() {
      try {
        const payload = await loadContactMergePreview({
          businessAccountRecordId,
          keepContactId: previewKeepContactId,
          deleteContactId: previewDeleteContactId,
        });

        if (!isActive) {
          return;
        }

        setPreview(payload);
        setFieldChoices(buildFieldChoicesFromPreview(payload));
        setSetKeptAsPrimary(payload.recommendedSetKeptAsPrimary);
      } catch (error) {
        if (!isActive) {
          return;
        }

        setPreview(null);
        setFieldChoices(null);
        setErrorMessage(
          error instanceof Error ? error.message : "Failed to load contact merge preview.",
        );
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
  }, [
    businessAccountRecordId,
    contacts,
    deleteContactId,
    isOpen,
    keepContactId,
    orderedContacts,
  ]);

  const keepContact = keepContactId !== null ? contactsById.get(keepContactId) ?? null : null;
  const deleteContact =
    deleteContactId !== null ? contactsById.get(deleteContactId) ?? null : null;
  const selectedFieldChoices = useMemo(() => {
    if (!preview || !fieldChoices) {
      return [] as ContactMergeFieldChoice[];
    }

    return preview.fields.map((field) => ({
      field: field.field,
      source: field.valuesDiffer ? fieldChoices[field.field] ?? field.recommendedSource : "keep",
    }));
  }, [fieldChoices, preview]);

  const updatedFields = useMemo(() => {
    if (!preview || !fieldChoices) {
      return [] as string[];
    }

    return preview.fields
      .filter((field) => {
        const selectedSource = field.valuesDiffer
          ? fieldChoices[field.field] ?? field.recommendedSource
          : "keep";
        const nextValue = selectedSource === "delete" ? field.deleteValue : field.keepValue;
        return (nextValue ?? "") !== (field.keepValue ?? "");
      })
      .map((field) => field.label);
  }, [fieldChoices, preview]);

  async function handleMerge() {
    if (!preview || keepContactId === null || deleteContactId === null) {
      return;
    }

    const confirmed = window.confirm(
      "This will permanently delete the selected duplicate contact in Acumatica.",
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
          deleteContactId,
          setKeptAsPrimary,
          expectedAccountLastModified: preview.expectedAccountLastModified,
          expectedKeepContactLastModified: preview.expectedKeepContactLastModified,
          expectedDeleteContactLastModified: preview.expectedDeleteContactLastModified,
          fieldChoices: selectedFieldChoices,
        }),
      });
      const payload = await readJsonResponse<ContactMergeResponse | MergeErrorPayload>(response);

      if (!response.ok) {
        const message = parseError(payload as MergeErrorPayload | null);
        if ((payload as MergeErrorPayload | null)?.partial) {
          setPartialErrorMessage(message);
          return;
        }

        throw new Error(message);
      }

      if (!isContactMergeResponse(payload)) {
        throw new Error("Unexpected response while merging contacts.");
      }

      onMerged(payload);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to merge contacts.");
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
            <h2 id="contact-merge-title">Merge contacts in Acumatica</h2>
            <p className={styles.accountMeta}>
              {formatText(companyName)} · Account ID {formatText(businessAccountId)} · Sales Rep{" "}
              {formatText(orderedContacts[0]?.salesRepName)}
            </p>
            <p className={styles.accountMeta}>
              Duplicate group: {formatText(orderedContacts[0]?.contactName)}
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

        {orderedContacts.length === 2 ? (
          <>
            <section className={styles.selectorSection}>
              {orderedContacts.map((contact) => {
                const contactId = contact.contactId;
                const isKeep = contactId !== null && contactId === keepContactId;
                const lastModified =
                  contactId !== null && contactId === preview?.keepContactId
                    ? preview.expectedKeepContactLastModified
                    : preview?.expectedDeleteContactLastModified;

                return (
                  <label className={styles.recordCard} key={contact.rowKey ?? String(contactId)}>
                    <input
                      checked={isKeep}
                      disabled={contactId === null || isSubmitting}
                      name="keep-contact"
                      onChange={() => {
                        if (contactId !== null) {
                          setKeepContactId(contactId);
                        }
                      }}
                      type="radio"
                    />
                    <div>
                      <strong>{isKeep ? "Keep this record" : "Delete this record"}</strong>
                      <p>Contact ID: {contactId ?? "-"}</p>
                      <p>{formatText(contact.contactName)}</p>
                      <p>{formatText(contact.contactEmail)}</p>
                      <p>Last modified: {formatDateTime(lastModified)}</p>
                      {contact.isPrimaryContact ? (
                        <span className={styles.primaryBadge}>PRIMARY</span>
                      ) : null}
                    </div>
                  </label>
                );
              })}
            </section>

            {isLoadingPreview ? (
              <p className={styles.loading}>Loading full field comparison...</p>
            ) : null}

            {preview ? (
              <>
                <section className={styles.matrixSection}>
                  <div className={styles.matrixHeader}>
                    <span>Field</span>
                    <span>Keep record</span>
                    <span>Delete record</span>
                    <span>Choice</span>
                  </div>
                  <div className={styles.matrixBody}>
                    {preview.fields.map((field) => {
                      const selectedSource = field.valuesDiffer
                        ? fieldChoices?.[field.field] ?? field.recommendedSource
                        : "keep";
                      return (
                        <div className={styles.matrixRow} key={field.field}>
                          <strong>{field.label}</strong>
                          <div className={styles.valueCell}>{formatText(field.keepValue)}</div>
                          <div className={styles.valueCell}>{formatText(field.deleteValue)}</div>
                          <div className={styles.choiceCell}>
                            {field.valuesDiffer ? (
                              <div className={styles.choiceGroup}>
                                <label>
                                  <input
                                    checked={selectedSource === "keep"}
                                    name={`merge-field-${field.field}`}
                                    onChange={() => {
                                      setFieldChoices((current) =>
                                        current
                                          ? {
                                              ...current,
                                              [field.field]: "keep",
                                            }
                                          : current,
                                      );
                                    }}
                                    type="radio"
                                  />
                                  Keep left
                                </label>
                                <label>
                                  <input
                                    checked={selectedSource === "delete"}
                                    name={`merge-field-${field.field}`}
                                    onChange={() => {
                                      setFieldChoices((current) =>
                                        current
                                          ? {
                                              ...current,
                                              [field.field]: "delete",
                                            }
                                          : current,
                                      );
                                    }}
                                    type="radio"
                                  />
                                  Keep right
                                </label>
                              </div>
                            ) : (
                              <span className={styles.sameValue}>Same value</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>

                <section className={styles.confirmSection}>
                  <div className={styles.primarySection}>
                    <label>
                      <input
                        checked={setKeptAsPrimary}
                        disabled={keepContactId === null || isSubmitting}
                        onChange={(event) => {
                          setSetKeptAsPrimary(event.target.checked);
                        }}
                        type="checkbox"
                      />
                      Make kept record primary
                    </label>
                    {preview.deleteIsPrimary && !setKeptAsPrimary ? (
                      <p className={styles.inlineWarning}>
                        This account will lose its current primary contact unless another contact
                        is already primary.
                      </p>
                    ) : null}
                  </div>

                  <div className={styles.summaryBox}>
                    <p>Kept contact ID: {keepContactId}</p>
                    <p>Deleted contact ID: {deleteContactId}</p>
                    <p>
                      Fields updated: {updatedFields.length ? updatedFields.join(", ") : "No field changes"}
                    </p>
                    <p>
                      Primary change:{" "}
                      {setKeptAsPrimary && !preview.keepIsPrimary ? "Yes" : "No"}
                    </p>
                  </div>

                  <div className={styles.footer}>
                    <button className={styles.secondaryButton} onClick={onClose} type="button">
                      Cancel
                    </button>
                    <button
                      className={styles.primaryButton}
                      disabled={!preview || keepContactId === null || deleteContactId === null || isSubmitting}
                      onClick={() => {
                        void handleMerge();
                      }}
                      type="button"
                    >
                      {isSubmitting ? "Merging..." : "Merge into Acumatica"}
                    </button>
                  </div>
                </section>
              </>
            ) : null}
          </>
        ) : null}

        {preview && keepContact && deleteContact ? (
          <p className={styles.confirmNote}>
            {formatText(keepContact.contactName)} will be kept. {formatText(deleteContact.contactName)} will
            be deleted if the merge succeeds.
          </p>
        ) : null}
      </section>
    </div>
  );
}
