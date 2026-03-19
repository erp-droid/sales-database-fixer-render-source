"use client";

import { useEffect, useMemo, useState } from "react";

import type {
  BusinessAccountDetailResponse,
  BusinessAccountRow,
} from "@/types/business-account";
import type {
  OpportunityCreateOptionsResponse,
  OpportunityCreateRequest,
  OpportunityCreateResponse,
} from "@/types/opportunity-create";
import type { CreateContactAccountOption } from "@/components/create-contact-drawer";

import styles from "./create-opportunity-drawer.module.css";

type EmployeeOption = {
  id: string;
  name: string;
};

type OpportunityContactOption = {
  contactId: number;
  displayName: string;
  email: string;
  phone: string;
  isPrimary: boolean;
};

type OpportunityFormState = Omit<
  OpportunityCreateRequest,
  "businessAccountRecordId" | "businessAccountId" | "contactId"
>;

type CreateOpportunityDrawerProps = {
  accountOptions: CreateContactAccountOption[];
  employeeOptions: EmployeeOption[];
  fallbackRows: BusinessAccountRow[];
  initialAccountRecordId?: string | null;
  initialContactId?: number | null;
  initialOwnerId?: string | null;
  initialOwnerName?: string | null;
  isOpen: boolean;
  onClose: () => void;
  onOpportunityCreated: (result: OpportunityCreateResponse) => void;
  onRequestCreateContact: (businessAccountRecordId: string) => void;
};

const FALLBACK_CLASS_OPTIONS = [
  { value: "PRODUCTION", label: "PRODUCTION" },
  { value: "SERVICE", label: "SERVICE" },
  { value: "GLENDALE", label: "GLENDALE" },
];

const FALLBACK_PROJECT_TYPE_OPTIONS = [
  { value: "Construct", label: "Construct" },
  { value: "Electrical", label: "Electrical" },
  { value: "HVAC", label: "HVAC" },
  { value: "M-Trade", label: "M-Trade" },
  { value: "Plumbing", label: "Plumbing" },
] as OpportunityCreateOptionsResponse["projectTypeOptions"];

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

function isOpportunityCreateResponse(
  payload: unknown,
): payload is OpportunityCreateResponse {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const record = payload as Record<string, unknown>;
  return (
    record.created === true &&
    typeof record.opportunityId === "string" &&
    typeof record.businessAccountRecordId === "string" &&
    typeof record.businessAccountId === "string" &&
    typeof record.contactId === "number" &&
    typeof record.subject === "string" &&
    Array.isArray(record.warnings)
  );
}

function isOpportunityOptionsResponse(
  payload: unknown,
): payload is OpportunityCreateOptionsResponse {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const record = payload as Record<string, unknown>;
  return Array.isArray(record.classOptions) && Array.isArray(record.projectTypeOptions);
}

function readDetailRows(payload: unknown): BusinessAccountRow[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.rows)) {
    return record.rows as BusinessAccountRow[];
  }

  if (record.row && typeof record.row === "object") {
    return [record.row as BusinessAccountRow];
  }

  return [];
}

function readAccountLocation(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  return readText((payload as Record<string, unknown>).accountLocation);
}

function resolveRowBusinessAccountRecordId(row: BusinessAccountRow): string {
  return row.accountRecordId?.trim() || row.id.trim() || row.businessAccountId.trim();
}

function resolveRowContactId(row: BusinessAccountRow): number | null {
  return row.contactId ?? row.primaryContactId ?? null;
}

function mergeContactOptions(
  existing: OpportunityContactOption,
  incoming: OpportunityContactOption,
): OpportunityContactOption {
  if (incoming.isPrimary && !existing.isPrimary) {
    return incoming;
  }

  return {
    ...existing,
    displayName: incoming.displayName || existing.displayName,
    email: incoming.email || existing.email,
    phone: incoming.phone || existing.phone,
    isPrimary: existing.isPrimary || incoming.isPrimary,
  };
}

function buildContactOptionsFromRows(
  rows: BusinessAccountRow[],
  businessAccountRecordId: string,
): OpportunityContactOption[] {
  const byContactId = new Map<number, OpportunityContactOption>();

  rows.forEach((row) => {
    if (resolveRowBusinessAccountRecordId(row) !== businessAccountRecordId) {
      return;
    }

    const contactId = resolveRowContactId(row);
    if (contactId === null) {
      return;
    }

    const nextOption: OpportunityContactOption = {
      contactId,
      displayName: row.primaryContactName?.trim() || `Contact ${contactId}`,
      email: row.primaryContactEmail?.trim() || "",
      phone: row.primaryContactPhone?.trim() || "",
      isPrimary: row.isPrimaryContact === true || row.primaryContactId === contactId,
    };

    const current = byContactId.get(contactId);
    byContactId.set(contactId, current ? mergeContactOptions(current, nextOption) : nextOption);
  });

  return [...byContactId.values()].sort((left, right) => {
    if (left.isPrimary !== right.isPrimary) {
      return left.isPrimary ? -1 : 1;
    }

    return left.displayName.localeCompare(right.displayName, undefined, {
      sensitivity: "base",
    });
  });
}

function toDateInputValue(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return parsed.toISOString().slice(0, 10);
}

function toIsoDateValue(value: string): string {
  const normalized = value.trim();
  return normalized ? `${normalized}T00:00:00.000Z` : "";
}

function buildFallbackOptions(): OpportunityCreateOptionsResponse {
  const today = new Date().toISOString();

  return {
    classOptions: FALLBACK_CLASS_OPTIONS,
    defaultClassId: FALLBACK_CLASS_OPTIONS[0].value,
    defaultStage: "Awaiting Estimate",
    defaultLocation: "",
    defaultOwnerName: null,
    defaultEstimationDate: today,
    defaultLinkToDrive: "",
    projectTypeOptions: FALLBACK_PROJECT_TYPE_OPTIONS,
    requiredAttributeLabels: {
      willWinJob: "Do you think we are going to win this job?",
      linkToDrive: "Link to Drive",
      projectType: "Project Type",
    },
  };
}

function buildInitialForm(
  options: OpportunityCreateOptionsResponse,
): OpportunityFormState {
  return {
    subject: "",
    classId: options.defaultClassId,
    location: options.defaultLocation,
    stage: options.defaultStage,
    estimationDate: toDateInputValue(options.defaultEstimationDate),
    note: null,
    willWinJob: "Yes",
    linkToDrive: "",
    projectType: "M-Trade",
    ownerId: null,
    ownerName: null,
  };
}

function findEmployeeMatch(
  employeeOptions: EmployeeOption[],
  input: {
    id?: string | null;
    name?: string | null;
  },
): EmployeeOption | null {
  const normalizedId = input.id?.trim().toLowerCase() ?? "";
  const normalizedName = input.name?.trim().toLowerCase() ?? "";

  if (normalizedId) {
    const idMatch =
      employeeOptions.find((option) => option.id.trim().toLowerCase() === normalizedId) ?? null;
    if (idMatch) {
      return idMatch;
    }
  }

  if (!normalizedName) {
    return null;
  }

  return (
    employeeOptions.find((option) => option.name.trim().toLowerCase() === normalizedName) ?? null
  );
}

export function CreateOpportunityDrawer({
  accountOptions,
  employeeOptions,
  fallbackRows,
  initialAccountRecordId = null,
  initialContactId = null,
  initialOwnerId = null,
  initialOwnerName = null,
  isOpen,
  onClose,
  onOpportunityCreated,
  onRequestCreateContact,
}: CreateOpportunityDrawerProps) {
  const fallbackOptions = useMemo(() => buildFallbackOptions(), []);
  const [selectedAccountRecordId, setSelectedAccountRecordId] = useState("");
  const [accountSearchTerm, setAccountSearchTerm] = useState("");
  const [selectedContactId, setSelectedContactId] = useState("");
  const [contactOptions, setContactOptions] = useState<OpportunityContactOption[]>([]);
  const [isLoadingContacts, setIsLoadingContacts] = useState(false);
  const [contactLoadError, setContactLoadError] = useState<string | null>(null);
  const [options, setOptions] = useState<OpportunityCreateOptionsResponse | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [opportunityForm, setOpportunityForm] = useState<OpportunityFormState>(
    buildInitialForm(fallbackOptions),
  );
  const [ownerSearchTerm, setOwnerSearchTerm] = useState("");
  const [ownerFocused, setOwnerFocused] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [defaultsPrimed, setDefaultsPrimed] = useState(false);

  const effectiveOptions = options ?? fallbackOptions;

  useEffect(() => {
    if (isOpen) {
      return;
    }

    setSelectedAccountRecordId("");
    setAccountSearchTerm("");
    setSelectedContactId("");
    setContactOptions([]);
    setIsLoadingContacts(false);
    setContactLoadError(null);
    setOpportunityForm(buildInitialForm(fallbackOptions));
    setOwnerSearchTerm("");
    setOwnerFocused(false);
    setCreateError(null);
    setIsCreating(false);
    setDefaultsPrimed(false);
    setOptionsError(null);
  }, [fallbackOptions, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const controller = new AbortController();

    async function loadOptions() {
      try {
        const response = await fetch("/api/opportunities/options", {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await readJsonResponse<OpportunityCreateOptionsResponse | { error?: string }>(
          response,
        );

        if (!response.ok) {
          throw new Error(parseError(payload));
        }

        if (!isOpportunityOptionsResponse(payload)) {
          throw new Error("Unexpected response while loading opportunity defaults.");
        }

        if (controller.signal.aborted) {
          return;
        }

        setOptions(payload);
        setOptionsError(null);
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        setOptions(null);
        setOptionsError(
          error instanceof Error
            ? error.message
            : "Unable to load opportunity defaults.",
        );
      }
    }

    void loadOptions();
    return () => controller.abort();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || defaultsPrimed) {
      return;
    }

    const matchedOwner =
      findEmployeeMatch(employeeOptions, {
        id: initialOwnerId,
        name: initialOwnerName,
      }) ??
      findEmployeeMatch(employeeOptions, {
        name: effectiveOptions.defaultOwnerName,
      });

    const ownerName =
      matchedOwner?.name ??
      initialOwnerName?.trim() ??
      effectiveOptions.defaultOwnerName ??
      null;

    setOpportunityForm((current) => ({
      ...current,
      classId:
        !current.classId || current.classId === fallbackOptions.defaultClassId
          ? effectiveOptions.defaultClassId
          : current.classId,
      location:
        !current.location || current.location === fallbackOptions.defaultLocation
          ? effectiveOptions.defaultLocation
          : current.location,
      stage:
        !current.stage || current.stage === fallbackOptions.defaultStage
          ? effectiveOptions.defaultStage
          : current.stage,
      estimationDate:
        !current.estimationDate ||
        current.estimationDate === toDateInputValue(fallbackOptions.defaultEstimationDate)
          ? toDateInputValue(effectiveOptions.defaultEstimationDate)
          : current.estimationDate,
      ownerId: matchedOwner?.id ?? current.ownerId ?? null,
      ownerName: ownerName ?? current.ownerName ?? null,
    }));
    setOwnerSearchTerm(ownerName ?? "");
    setDefaultsPrimed(true);
  }, [
    defaultsPrimed,
    effectiveOptions,
    employeeOptions,
    fallbackOptions,
    initialOwnerId,
    initialOwnerName,
    isOpen,
  ]);

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
    if (!normalizedQuery) {
      return accountOptions.slice(0, 10);
    }

    return accountOptions
      .filter((option) =>
        [option.companyName, option.businessAccountId, option.address]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery),
      )
      .slice(0, 12);
  }, [accountOptions, accountSearchTerm]);

  const filteredEmployeeOptions = useMemo(() => {
    const normalizedQuery = ownerSearchTerm.trim().toLowerCase();
    if (!normalizedQuery) {
      return employeeOptions.slice(0, 25);
    }

    return employeeOptions
      .filter((option) =>
        [option.name, option.id].join(" ").toLowerCase().includes(normalizedQuery),
      )
      .slice(0, 25);
  }, [employeeOptions, ownerSearchTerm]);

  useEffect(() => {
    if (!isOpen || !selectedAccountRecordId) {
      return;
    }

    const controller = new AbortController();

    async function loadContacts() {
      setIsLoadingContacts(true);
      setContactLoadError(null);

      try {
        const response = await fetch(
          `/api/business-accounts/${encodeURIComponent(selectedAccountRecordId)}?live=1`,
          {
            cache: "no-store",
            signal: controller.signal,
          },
        );
        const payload = await readJsonResponse<
          BusinessAccountDetailResponse | { error?: string }
        >(response);

        if (!response.ok) {
          throw new Error(parseError(payload));
        }

        const detailRows = readDetailRows(payload);
        if (detailRows.length === 0) {
          throw new Error("This account could not be loaded.");
        }

        if (controller.signal.aborted) {
          return;
        }

        setContactOptions(buildContactOptionsFromRows(detailRows, selectedAccountRecordId));

        setOpportunityForm((current) => ({
          ...current,
          location: readAccountLocation(payload) ?? effectiveOptions.defaultLocation,
          stage: effectiveOptions.defaultStage,
        }));
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        const fallbackOptionsForContacts = buildContactOptionsFromRows(
          fallbackRows,
          selectedAccountRecordId,
        );
        setContactOptions(fallbackOptionsForContacts);
        setContactLoadError(
          error instanceof Error ? error.message : "Unable to load contacts.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setIsLoadingContacts(false);
        }
      }
    }

    void loadContacts();

    return () => controller.abort();
  }, [
    effectiveOptions.defaultLocation,
    effectiveOptions.defaultStage,
    fallbackRows,
    isOpen,
    selectedAccountRecordId,
  ]);

  useEffect(() => {
    if (!isOpen || !selectedAccountRecordId) {
      return;
    }

    const currentSelectionValid = contactOptions.some(
      (option) => String(option.contactId) === selectedContactId,
    );
    if (currentSelectionValid) {
      return;
    }

    if (
      initialAccountRecordId === selectedAccountRecordId &&
      initialContactId !== null &&
      contactOptions.some((option) => option.contactId === initialContactId)
    ) {
      setSelectedContactId(String(initialContactId));
      return;
    }

    const primaryOption = contactOptions.find((option) => option.isPrimary);
    if (primaryOption) {
      setSelectedContactId(String(primaryOption.contactId));
      return;
    }

    if (contactOptions.length === 1) {
      setSelectedContactId(String(contactOptions[0]?.contactId ?? ""));
      return;
    }

    setSelectedContactId("");
  }, [
    contactOptions,
    initialAccountRecordId,
    initialContactId,
    isOpen,
    selectedAccountRecordId,
    selectedContactId,
  ]);

  function handleSelectAccount(option: CreateContactAccountOption) {
    setSelectedAccountRecordId(option.businessAccountRecordId);
    setAccountSearchTerm(option.companyName);
    setSelectedContactId("");
    setCreateError(null);
    setContactLoadError(null);
    setOpportunityForm((current) => ({
      ...current,
      location: effectiveOptions.defaultLocation,
      stage: effectiveOptions.defaultStage,
    }));
  }

  function handleClearSelectedAccount() {
    setSelectedAccountRecordId("");
    setAccountSearchTerm("");
    setSelectedContactId("");
    setContactOptions([]);
    setCreateError(null);
    setContactLoadError(null);
    setOpportunityForm((current) => ({
      ...current,
      location: effectiveOptions.defaultLocation,
      stage: effectiveOptions.defaultStage,
    }));
  }

  function handleSelectOwner(option: EmployeeOption) {
    setOpportunityForm((current) => ({
      ...current,
      ownerId: option.id,
      ownerName: option.name,
    }));
    setOwnerSearchTerm(option.name);
    setOwnerFocused(false);
  }

  function handleClearOwner() {
    setOpportunityForm((current) => ({
      ...current,
      ownerId: null,
      ownerName: null,
    }));
    setOwnerSearchTerm("");
    setOwnerFocused(false);
  }

  async function handleCreateOpportunity() {
    if (!selectedAccount) {
      setCreateError("Select the business account first.");
      return;
    }

    const numericContactId = Number(selectedContactId);
    if (!Number.isInteger(numericContactId) || numericContactId <= 0) {
      setCreateError("Select the contact this opportunity belongs to.");
      return;
    }

    if (!opportunityForm.subject.trim()) {
      setCreateError("Project description is required.");
      return;
    }

    if (!opportunityForm.classId.trim()) {
      setCreateError("Opportunity class is required.");
      return;
    }

    if (!opportunityForm.estimationDate.trim()) {
      setCreateError("Estimation date is required.");
      return;
    }

    if (!opportunityForm.linkToDrive.trim()) {
      setCreateError("Link to Drive is required.");
      return;
    }

    if (!opportunityForm.ownerId && !opportunityForm.ownerName?.trim()) {
      setCreateError("Estimator is required.");
      return;
    }

    setIsCreating(true);
    setCreateError(null);

    try {
      const response = await fetch("/api/opportunities", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          businessAccountRecordId: selectedAccount.businessAccountRecordId,
          businessAccountId: selectedAccount.businessAccountId,
          contactId: numericContactId,
          subject: opportunityForm.subject,
          classId: opportunityForm.classId,
          location: opportunityForm.location,
          stage: opportunityForm.stage,
          estimationDate: toIsoDateValue(opportunityForm.estimationDate),
          note: opportunityForm.note?.trim() ? opportunityForm.note.trim() : null,
          willWinJob: opportunityForm.willWinJob,
          linkToDrive: opportunityForm.linkToDrive,
          projectType: opportunityForm.projectType,
          ownerId: opportunityForm.ownerId,
          ownerName: opportunityForm.ownerName?.trim() || null,
        } satisfies OpportunityCreateRequest),
      });

      const payload = await readJsonResponse<
        OpportunityCreateResponse | { error?: string }
      >(response);

      if (!response.ok) {
        throw new Error(parseError(payload));
      }

      if (!isOpportunityCreateResponse(payload)) {
        throw new Error("Unexpected response while creating the opportunity.");
      }

      onOpportunityCreated(payload);
      onClose();
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : "Unable to create opportunity.",
      );
    } finally {
      setIsCreating(false);
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
            <p className={styles.kicker}>New Opportunity</p>
            <h2>Create in Acumatica</h2>
            <p className={styles.headerMeta}>
              Create only the opportunity record. This flow does not create project quotes.
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
              Select the account first, then choose which contact this opportunity belongs to.
            </p>

            {selectedAccount ? (
              <div className={styles.selectedAccountCard}>
                <strong>{selectedAccount.companyName}</strong>
                <span>Account ID {selectedAccount.businessAccountId}</span>
                <span>{selectedAccount.address}</span>
                <button
                  className={styles.secondaryButton}
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
            <div className={styles.sectionHeader}>
              <h3>Contact Selection</h3>
              <button
                className={styles.secondaryButton}
                disabled={!selectedAccount}
                onClick={() => {
                  if (selectedAccount) {
                    onRequestCreateContact(selectedAccount.businessAccountRecordId);
                  }
                }}
                type="button"
              >
                New contact
              </button>
            </div>

            <label>
              Contact
              <select
                disabled={!selectedAccount || isLoadingContacts}
                onChange={(event) => setSelectedContactId(event.target.value)}
                value={selectedContactId}
              >
                <option value="">
                  {selectedAccount ? "Select contact" : "Select business account first"}
                </option>
                {contactOptions.map((option) => (
                  <option key={option.contactId} value={option.contactId}>
                    {option.displayName}
                    {option.isPrimary ? " (Primary)" : ""}
                    {option.email ? ` - ${option.email}` : ""}
                  </option>
                ))}
              </select>
            </label>
            {isLoadingContacts ? (
              <p className={styles.lookupHint}>Loading contacts...</p>
            ) : null}
            {!isLoadingContacts && selectedAccount && contactOptions.length === 0 ? (
              <p className={styles.lookupHint}>
                No contacts were found for this account. Create one to continue.
              </p>
            ) : null}
            {contactLoadError ? (
              <p className={styles.warning}>
                {contactOptions.length > 0
                  ? "Live contact refresh failed. Using the contacts already loaded in the grid."
                  : contactLoadError}
              </p>
            ) : null}
          </section>

          <section className={styles.section}>
            <h3>Opportunity Details</h3>

            <label>
              Project description
              <input
                onChange={(event) =>
                  setOpportunityForm((current) => ({
                    ...current,
                    subject: event.target.value,
                  }))
                }
                placeholder="Example: Warehouse electrical upgrade"
                value={opportunityForm.subject}
              />
            </label>

            <div className={styles.fieldGrid}>
              <label>
                Class
                <select
                  onChange={(event) =>
                    setOpportunityForm((current) => ({
                      ...current,
                      classId: event.target.value,
                    }))
                  }
                  value={opportunityForm.classId}
                >
                  {effectiveOptions.classOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Estimation date
                <input
                  onChange={(event) =>
                    setOpportunityForm((current) => ({
                      ...current,
                      estimationDate: event.target.value,
                    }))
                  }
                  type="date"
                  value={opportunityForm.estimationDate}
                />
              </label>
            </div>

            <label>
              Estimator
              <input
                onBlur={() => {
                  window.setTimeout(() => {
                    setOwnerFocused(false);
                  }, 100);
                }}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setOwnerSearchTerm(nextValue);
                  setOpportunityForm((current) => ({
                    ...current,
                    ownerId: null,
                    ownerName: nextValue.trim() || null,
                  }));
                }}
                onFocus={() => setOwnerFocused(true)}
                placeholder="Type an estimator name"
                value={ownerSearchTerm}
              />
            </label>

            {opportunityForm.ownerId ? (
              <div className={styles.selectedOwnerCard}>
                <strong>{opportunityForm.ownerName}</strong>
                <span>Employee ID {opportunityForm.ownerId}</span>
                <button
                  className={styles.secondaryButton}
                  onClick={handleClearOwner}
                  type="button"
                >
                  Clear estimator
                </button>
              </div>
            ) : ownerFocused && filteredEmployeeOptions.length > 0 ? (
              <div className={styles.lookupSuggestions}>
                {filteredEmployeeOptions.map((option) => (
                  <button
                    className={styles.lookupSuggestionItem}
                    key={option.id}
                    onClick={() => {
                      handleSelectOwner(option);
                    }}
                    onMouseDown={(event) => event.preventDefault()}
                    type="button"
                  >
                    <span className={styles.lookupSuggestionTitle}>{option.name}</span>
                    <span className={styles.lookupSuggestionMeta}>{option.id}</span>
                  </button>
                ))}
              </div>
            ) : null}

            <label>
              Note
              <textarea
                className={styles.textarea}
                onChange={(event) =>
                  setOpportunityForm((current) => ({
                    ...current,
                    note: event.target.value || null,
                  }))
                }
                placeholder="Optional note for the opportunity"
                rows={5}
                value={opportunityForm.note ?? ""}
              />
            </label>
          </section>

          <section className={styles.section}>
            <h3>Required Attributes</h3>

            <label>
              {effectiveOptions.requiredAttributeLabels.willWinJob}
              <select
                onChange={(event) =>
                  setOpportunityForm((current) => ({
                    ...current,
                    willWinJob:
                      event.target.value as OpportunityCreateRequest["willWinJob"],
                  }))
                }
                value={opportunityForm.willWinJob}
              >
                <option value="Yes">Yes</option>
                <option value="No">No</option>
              </select>
            </label>

            <label>
              {effectiveOptions.requiredAttributeLabels.linkToDrive} *
              <input
                onChange={(event) =>
                  setOpportunityForm((current) => ({
                    ...current,
                    linkToDrive: event.target.value,
                  }))
                }
                placeholder="Paste the required Google Drive link"
                value={opportunityForm.linkToDrive}
              />
            </label>

            <label>
              {effectiveOptions.requiredAttributeLabels.projectType}
              <select
                onChange={(event) =>
                  setOpportunityForm((current) => ({
                    ...current,
                    projectType:
                      event.target.value as OpportunityCreateRequest["projectType"],
                  }))
                }
                value={opportunityForm.projectType}
              >
                {effectiveOptions.projectTypeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <p className={styles.lookupHint}>
              These fields are required for the MeadowBrook opportunity contract.
            </p>
          </section>

          {optionsError ? <p className={styles.warning}>{optionsError}</p> : null}
          {createError ? <p className={styles.error}>{createError}</p> : null}

          <div className={styles.actions}>
            <button className={styles.secondaryButton} onClick={onClose} type="button">
              Cancel
            </button>
            <button
              className={styles.primaryButton}
              disabled={isCreating || accountOptions.length === 0}
              onClick={() => {
                void handleCreateOpportunity();
              }}
              type="button"
            >
              {isCreating ? "Creating..." : "Create opportunity"}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
