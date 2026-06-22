"use client";

import { useEffect, useMemo, useState } from "react";

import { CONTACT_CLASS_OPTIONS } from "@/lib/business-account-create";
import {
  formatPhoneDraftValue,
  normalizeExtensionForSave,
  normalizePhoneForSave,
} from "@/lib/phone";
import type {
  BusinessAccountContactCreatePartialResponse,
  BusinessAccountContactCreateRequest,
  BusinessAccountContactCreateResponse,
} from "@/types/business-account-create";

import styles from "./create-contact-drawer.module.css";

export type CreateContactAccountOption = {
  businessAccountRecordId: string;
  businessAccountId: string;
  companyName: string;
  address: string;
};

type CreateContactDrawerProps = {
  accountOptions: CreateContactAccountOption[];
  initialAccountRecordId?: string | null;
  isOpen: boolean;
  onClose: () => void;
  onContactCreated: (
    result:
      | BusinessAccountContactCreateResponse
      | BusinessAccountContactCreatePartialResponse,
  ) => void;
};

const EMPTY_CONTACT_FORM: BusinessAccountContactCreateRequest = {
  displayName: "",
  jobTitle: "",
  email: "",
  phone1: "",
  extension: null,
  contactClass: "sales",
};

const CONTACT_FIELD_LABELS: Record<string, string> = {
  displayName: "Name",
  jobTitle: "Job Title",
  email: "Email",
  phone1: "Phone Number",
  extension: "Extension",
  contactClass: "Contact Class",
};

function readText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readFirstArrayText(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return null;
  }

  return value.map(readText).find(Boolean) ?? null;
}

function toHumanFieldLabel(field: string): string {
  const compact = field.trim();
  const key = compact.split(".").at(-1)?.replace(/\[\d+\]/g, "") ?? compact;
  const mapped = CONTACT_FIELD_LABELS[key];
  if (mapped) {
    return mapped;
  }

  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^./, (value) => value.toUpperCase());
}

function summarizeText(value: string | null | undefined): string | null {
  const text = value
    ?.replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) {
    return null;
  }
  return text.length > 260 ? `${text.slice(0, 260)}...` : text;
}

function parseError(
  payload: unknown,
  responseInfo?: {
    status: number;
    statusText: string;
    rawText: string | null;
  },
): string {
  if (!payload || typeof payload !== "object") {
    const raw = summarizeText(responseInfo?.rawText);
    if (raw) {
      return raw;
    }
    return responseInfo
      ? `Request failed (${responseInfo.status} ${responseInfo.statusText || "Unknown"}).`
      : "Request failed.";
  }

  const record = payload as Record<string, unknown>;
  const errorValue = readText(record.error);
  const messageValue = readText(record.message);
  const details = record.details;

  if (details && typeof details === "object") {
    const detailsRecord = details as Record<string, unknown>;
    const fieldErrors = detailsRecord.fieldErrors;
    if (fieldErrors && typeof fieldErrors === "object") {
      for (const [field, value] of Object.entries(fieldErrors as Record<string, unknown>)) {
        const first = readFirstArrayText(value);
        if (first) {
          return `${toHumanFieldLabel(field)}: ${first}`;
        }
      }
    }

    const formErrors = readFirstArrayText(detailsRecord.formErrors);
    if (formErrors) {
      return formErrors;
    }

    const modelState = detailsRecord.modelState;
    if (modelState && typeof modelState === "object") {
      for (const [field, value] of Object.entries(modelState as Record<string, unknown>)) {
        const first = readFirstArrayText(value);
        if (first) {
          return `${toHumanFieldLabel(field)}: ${first}`;
        }
      }
    }

    const detailMessage = readText(detailsRecord.message) ?? readText(detailsRecord.error);
    if (detailMessage) {
      return detailMessage;
    }
  }

  if (typeof details === "string" && details.trim()) {
    return details.trim();
  }

  const raw = summarizeText(responseInfo?.rawText);
  return (
    errorValue ??
    messageValue ??
    raw ??
    (responseInfo
      ? `Request failed (${responseInfo.status} ${responseInfo.statusText || "Unknown"}).`
      : "Request failed.")
  );
}

async function readResponsePayload<T>(response: Response): Promise<{
  payload: T | null;
  rawText: string | null;
}> {
  const rawText = (await response.text().catch(() => "")).trim();
  if (!rawText) {
    return {
      payload: null,
      rawText: null,
    };
  }

  try {
    return {
      payload: JSON.parse(rawText) as T,
      rawText,
    };
  } catch {
    return {
      payload: null,
      rawText,
    };
  }
}

function isBusinessAccountContactCreateResponse(
  payload: unknown,
): payload is BusinessAccountContactCreateResponse {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const record = payload as Record<string, unknown>;
  return (
    record.created === true &&
    typeof record.businessAccountRecordId === "string" &&
    typeof record.businessAccountId === "string" &&
    typeof record.contactId === "number" &&
    Array.isArray(record.accountRows) &&
    record.createdRow !== undefined
  );
}

function isBusinessAccountContactCreatePartialResponse(
  payload: unknown,
): payload is BusinessAccountContactCreatePartialResponse {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const record = payload as Record<string, unknown>;
  return (
    record.created === false &&
    record.partial === true &&
    typeof record.businessAccountRecordId === "string" &&
    typeof record.businessAccountId === "string" &&
    typeof record.contactId === "number" &&
    typeof record.error === "string" &&
    Array.isArray(record.accountRows)
  );
}

export function CreateContactDrawer({
  accountOptions,
  initialAccountRecordId = null,
  isOpen,
  onClose,
  onContactCreated,
}: CreateContactDrawerProps) {
  const [selectedAccountRecordId, setSelectedAccountRecordId] = useState("");
  const [accountSearchTerm, setAccountSearchTerm] = useState("");
  const [contactForm, setContactForm] = useState<BusinessAccountContactCreateRequest>({
    ...EMPTY_CONTACT_FORM,
  });
  const [contactError, setContactError] = useState<string | null>(null);
  const [contactNotice, setContactNotice] = useState<string | null>(null);
  const [isCreatingContact, setIsCreatingContact] = useState(false);
  const [contactPartialComplete, setContactPartialComplete] = useState(false);

  useEffect(() => {
    if (isOpen) {
      return;
    }

    setSelectedAccountRecordId("");
    setAccountSearchTerm("");
    setContactForm({ ...EMPTY_CONTACT_FORM });
    setContactError(null);
    setContactNotice(null);
    setIsCreatingContact(false);
    setContactPartialComplete(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || selectedAccountRecordId || !initialAccountRecordId) {
      return;
    }

    const matchingOption =
      accountOptions.find(
        (option) => option.businessAccountRecordId === initialAccountRecordId,
      ) ?? null;
    if (!matchingOption) {
      return;
    }

    setSelectedAccountRecordId(matchingOption.businessAccountRecordId);
    setAccountSearchTerm(matchingOption.companyName);
  }, [accountOptions, initialAccountRecordId, isOpen, selectedAccountRecordId]);

  const selectedAccount = useMemo(
    () =>
      accountOptions.find(
        (option) => option.businessAccountRecordId === selectedAccountRecordId,
      ) ?? null,
    [accountOptions, selectedAccountRecordId],
  );

  const filteredAccountOptions = useMemo(() => {
    const normalizedQuery = accountSearchTerm.trim().toLowerCase();
    const source = accountOptions;
    if (!normalizedQuery) {
      return source.slice(0, 10);
    }

    return source
      .filter((option) =>
        [option.companyName, option.businessAccountId, option.address]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery),
      )
      .slice(0, 12);
  }, [accountOptions, accountSearchTerm]);

  function handleSelectAccount(option: CreateContactAccountOption) {
    setSelectedAccountRecordId(option.businessAccountRecordId);
    setAccountSearchTerm(option.companyName);
    setContactError(null);
    setContactNotice(null);
  }

  function handleClearSelectedAccount() {
    setSelectedAccountRecordId("");
    setAccountSearchTerm("");
    setContactError(null);
    setContactNotice(null);
  }

  async function handleCreateContact() {
    if (!selectedAccount) {
      setContactError("Select the business account this contact belongs to.");
      return;
    }
    if (!contactForm.displayName.trim()) {
      setContactError("Name is required.");
      return;
    }
    if (!contactForm.jobTitle.trim()) {
      setContactError("Job Title is required.");
      return;
    }
    if (!contactForm.email.trim()) {
      setContactError("Email is required.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactForm.email.trim())) {
      setContactError("Email must be a valid email address.");
      return;
    }

    const normalizedPhone = normalizePhoneForSave(contactForm.phone1);
    if (!normalizedPhone) {
      setContactError("Phone Number must use the format ###-###-####.");
      return;
    }
    const normalizedExtension = contactForm.extension
      ? normalizeExtensionForSave(contactForm.extension)
      : null;
    if (contactForm.extension && !normalizedExtension) {
      setContactError("Extension must use 1 to 5 digits.");
      return;
    }

    setIsCreatingContact(true);
    setContactError(null);
    setContactNotice(null);

    try {
      const response = await fetch(
        `/api/business-accounts/${encodeURIComponent(selectedAccount.businessAccountRecordId)}/contacts`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...contactForm,
            email: contactForm.email.trim(),
            extension: normalizedExtension,
            phone1: normalizedPhone,
          }),
        },
      );
      const { payload, rawText } = await readResponsePayload<
        | BusinessAccountContactCreateResponse
        | BusinessAccountContactCreatePartialResponse
        | { error?: string }
      >(response);

      if (response.ok) {
        if (!isBusinessAccountContactCreateResponse(payload)) {
          throw new Error("Unexpected response while creating the contact.");
        }

        onContactCreated(payload);
        onClose();
        return;
      }

      if (isBusinessAccountContactCreatePartialResponse(payload)) {
        onContactCreated(payload);
        setContactPartialComplete(true);
        setContactError(payload.error);
        setContactNotice(
          "Contact was saved locally, but the primary contact switch did not complete.",
        );
        return;
      }

      throw new Error(
        parseError(payload, {
          status: response.status,
          statusText: response.statusText,
          rawText,
        }),
      );
    } catch (error) {
      setContactError(error instanceof Error ? error.message : "Unable to create contact.");
    } finally {
      setIsCreatingContact(false);
    }
  }

  if (!isOpen) {
    return null;
  }

  return (
    <>
      <button className={styles.backdrop} onClick={onClose} type="button" />
      <aside className={`${styles.drawer} ${styles.drawerOpen}`}>
        <div className={styles.drawerHeader}>
          <div>
            <p className={styles.kicker}>New Contact</p>
            <h2>Create contact</h2>
            <p className={styles.headerMeta}>
              Choose the business account first, then create the contact and set it as primary.
            </p>
          </div>
          <button className={styles.closeButton} onClick={onClose} type="button">
            Close
          </button>
        </div>

        <div className={styles.drawerBody}>
          <section className={styles.section}>
            <h3>Business Account</h3>
            <label>
              Search account
              <input
                disabled={Boolean(selectedAccount)}
                onChange={(event) => setAccountSearchTerm(event.target.value)}
                placeholder="Search company, account ID, or address"
                value={accountSearchTerm}
              />
            </label>
            <p className={styles.lookupHint}>
              You must choose the business account this contact belongs to before creating it.
            </p>

            {selectedAccount ? (
              <div className={styles.selectedAccountCard}>
                <strong>{selectedAccount.companyName}</strong>
                <span>Account ID {selectedAccount.businessAccountId}</span>
                <span>{selectedAccount.address}</span>
                <button
                  className={styles.secondaryButton}
                  disabled={contactPartialComplete}
                  onClick={handleClearSelectedAccount}
                  type="button"
                >
                  Change account
                </button>
              </div>
            ) : filteredAccountOptions.length > 0 ? (
              <div className={styles.lookupSuggestions}>
                {filteredAccountOptions.map((option) => (
                  <button
                    className={styles.lookupSuggestionItem}
                    key={option.businessAccountRecordId}
                    onClick={() => {
                      handleSelectAccount(option);
                    }}
                    type="button"
                  >
                    <span className={styles.lookupSuggestionTitle}>
                      {option.companyName}
                    </span>
                    <span className={styles.lookupSuggestionMeta}>
                      {option.businessAccountId}
                    </span>
                    <span className={styles.lookupSuggestionMeta}>{option.address}</span>
                  </button>
                ))}
              </div>
            ) : accountSearchTerm.trim().length > 0 ? (
              <p className={styles.lookupHint}>No matching business accounts were found.</p>
            ) : null}

            {accountOptions.length === 0 ? (
              <p className={styles.lookupHint}>
                No business accounts are loaded yet. Sync records first.
              </p>
            ) : null}
          </section>

          <section className={styles.section}>
            <h3>Contact Details</h3>
            <p className={styles.lookupHint}>
              This creates a local contact row and makes it the primary contact for the selected account.
            </p>

            <label>
              Name
              <input
                disabled={contactPartialComplete}
                onChange={(event) =>
                  setContactForm((current) => ({
                    ...current,
                    displayName: event.target.value,
                  }))
                }
                value={contactForm.displayName}
              />
            </label>

            <label>
              Job Title
              <input
                disabled={contactPartialComplete}
                onChange={(event) =>
                  setContactForm((current) => ({
                    ...current,
                    jobTitle: event.target.value,
                  }))
                }
                value={contactForm.jobTitle}
              />
            </label>

            <label>
              Email
              <input
                disabled={contactPartialComplete}
                onChange={(event) =>
                  setContactForm((current) => ({
                    ...current,
                    email: event.target.value,
                  }))
                }
                value={contactForm.email}
              />
            </label>

            <label>
              Phone Number
              <input
                disabled={contactPartialComplete}
                inputMode="numeric"
                maxLength={12}
                onChange={(event) =>
                  setContactForm((current) => ({
                    ...current,
                    phone1: formatPhoneDraftValue(event.target.value),
                  }))
                }
                placeholder="123-456-7890"
                value={contactForm.phone1}
              />
            </label>

            <label>
              Extension
              <input
                disabled={contactPartialComplete}
                inputMode="numeric"
                maxLength={5}
                onChange={(event) =>
                  setContactForm((current) => ({
                    ...current,
                    extension: event.target.value.replace(/\D/g, "").slice(0, 5) || null,
                  }))
                }
                placeholder="Extension"
                value={contactForm.extension ?? ""}
              />
            </label>

            <label>
              Contact Class
              <select
                disabled={contactPartialComplete}
                onChange={(event) =>
                  setContactForm((current) => ({
                    ...current,
                    contactClass:
                      event.target.value as BusinessAccountContactCreateRequest["contactClass"],
                  }))
                }
                value={contactForm.contactClass}
              >
                {CONTACT_CLASS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </section>

          {contactError ? <p className={styles.error}>{contactError}</p> : null}
          {contactNotice ? <p className={styles.warning}>{contactNotice}</p> : null}

          <div className={styles.actions}>
            <button className={styles.secondaryButton} onClick={onClose} type="button">
              {contactPartialComplete ? "Close" : "Cancel"}
            </button>
            {!contactPartialComplete ? (
              <button
                className={styles.primaryButton}
                disabled={isCreatingContact || accountOptions.length === 0}
                onClick={() => {
                  void handleCreateContact();
                }}
                type="button"
              >
                {isCreatingContact ? "Creating..." : "Create contact"}
              </button>
            ) : null}
          </div>
        </div>
      </aside>
    </>
  );
}
