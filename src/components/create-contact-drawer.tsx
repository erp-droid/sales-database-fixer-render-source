"use client";

import { useEffect, useMemo, useState } from "react";

import { CONTACT_CLASS_OPTIONS } from "@/lib/business-account-create";
import { formatPhoneDraftValue, normalizePhoneForSave } from "@/lib/phone";
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
  contactClass: "sales",
};

function readText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseError(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "Request failed.";
  }

  const record = payload as Record<string, unknown>;
  const errorValue = readText(record.error);
  const details = record.details;

  if (details && typeof details === "object") {
    const detailsRecord = details as Record<string, unknown>;
    const modelState = detailsRecord.modelState;
    if (modelState && typeof modelState === "object") {
      for (const [field, value] of Object.entries(modelState as Record<string, unknown>)) {
        if (Array.isArray(value)) {
          const first = value.map(readText).find(Boolean);
          if (first) {
            return `${field}: ${first}`;
          }
        }
      }
    }
  }

  return errorValue ?? "Request failed.";
}

async function readJsonResponse<T>(response: Response): Promise<T | null> {
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.includes("application/json")) {
    return null;
  }

  return (await response.json().catch(() => null)) as T | null;
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

    const normalizedPhone = normalizePhoneForSave(contactForm.phone1);
    if (!normalizedPhone) {
      setContactError("Phone Number must use the format ###-###-####.");
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
            phone1: normalizedPhone,
          }),
        },
      );
      const payload = await readJsonResponse<
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
          "Contact was created in Acumatica, but the primary contact switch did not complete.",
        );
        return;
      }

      throw new Error(parseError(payload));
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
            <h2>Create in Acumatica</h2>
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
              This flow uses the existing Acumatica contact-create route and then attempts to set the new contact as primary.
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
