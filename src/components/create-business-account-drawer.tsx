"use client";

import { useEffect, useMemo, useState } from "react";

import { getAppBranding } from "@/lib/app-variant";
import {
  BUSINESS_ACCOUNT_CLASS_OPTIONS,
  CATEGORY_OPTIONS,
  COMPANY_REGION_OPTIONS,
  CONTACT_CLASS_OPTIONS,
  INDUSTRY_TYPE_OPTIONS,
  SUB_CATEGORY_OPTIONS,
  WEEK_OPTIONS,
} from "@/lib/business-account-create";
import {
  formatPhoneDraftValue,
  normalizeExtensionForSave,
  normalizePhoneForSave,
} from "@/lib/phone";
import type {
  BusinessAccountCreateRequest,
  BusinessAccountCreateResponse,
  BusinessAccountContactCreatePartialResponse,
  BusinessAccountContactCreateRequest,
  BusinessAccountContactCreateResponse,
} from "@/types/business-account-create";
import type {
  CompanyAttributeSuggestion,
  CompanyAttributeSuggestionRequest,
  CompanyAttributeSuggestionResponse,
} from "@/types/company-attribute-suggestion";

import styles from "./create-business-account-drawer.module.css";

const appBranding = getAppBranding();

type AddressLookupSuggestion = {
  id: string;
  type: string;
  text: string;
  description: string;
};

type AddressLookupResponse = {
  items: AddressLookupSuggestion[];
};

type AddressRetrieveResponse = {
  address: {
    addressLine1: string;
    addressLine2: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
};

type CreateBusinessAccountDrawerProps = {
  isOpen: boolean;
  employeeOptions: Array<{ id: string; name: string }>;
  openAiAttributeSuggestEnabled: boolean;
  onClose: () => void;
  onAccountCreated: (result: BusinessAccountCreateResponse) => void;
  onContactCreated: (
    result:
      | BusinessAccountContactCreateResponse
      | BusinessAccountContactCreatePartialResponse,
  ) => void;
};

type AccountCreateFormState = Omit<
  BusinessAccountCreateRequest,
  "classId" | "category" | "week"
> & {
  classId: BusinessAccountCreateRequest["classId"] | "";
  category: BusinessAccountCreateRequest["category"] | "";
  week: string;
};

type CreatedAccountState = {
  businessAccountRecordId: string;
  businessAccountId: string;
  companyName: string;
  warnings: string[];
};

const EMPTY_ACCOUNT_FORM: AccountCreateFormState = {
  companyName: "",
  companyDescription: null,
  classId: "",
  salesRepId: null,
  salesRepName: null,
  companyPhone: null,
  industryType: "",
  subCategory: "",
  companyRegion: "",
  week: "",
  category: "",
  addressLookupId: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  postalCode: "",
  country: "CA",
};

const EMPTY_CONTACT_FORM: BusinessAccountContactCreateRequest = {
  displayName: "",
  jobTitle: "",
  email: "",
  phone1: "",
  extension: null,
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

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [delayMs, value]);

  return debouncedValue;
}

function isAddressLookupSuggestion(payload: unknown): payload is AddressLookupSuggestion {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const record = payload as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.type === "string" &&
    typeof record.text === "string" &&
    typeof record.description === "string"
  );
}

function isAddressLookupResponse(payload: unknown): payload is AddressLookupResponse {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const record = payload as Record<string, unknown>;
  return Array.isArray(record.items) && record.items.every(isAddressLookupSuggestion);
}

function isAddressRetrieveResponse(payload: unknown): payload is AddressRetrieveResponse {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const record = payload as Record<string, unknown>;
  if (!record.address || typeof record.address !== "object") {
    return false;
  }

  const address = record.address as Record<string, unknown>;
  return (
    typeof address.addressLine1 === "string" &&
    typeof address.addressLine2 === "string" &&
    typeof address.city === "string" &&
    typeof address.state === "string" &&
    typeof address.postalCode === "string" &&
    typeof address.country === "string"
  );
}

function isBusinessAccountCreateResponse(payload: unknown): payload is BusinessAccountCreateResponse {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const record = payload as Record<string, unknown>;
  return (
    record.created === true &&
    typeof record.businessAccountRecordId === "string" &&
    typeof record.businessAccountId === "string" &&
    Array.isArray(record.accountRows) &&
    record.createdRow !== undefined
  );
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

function isCompanyAttributeSuggestionSource(
  value: unknown,
): value is CompanyAttributeSuggestion["sources"][number] {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.title === "string" &&
    typeof record.url === "string" &&
    (record.domain === null || typeof record.domain === "string")
  );
}

function isCompanyAttributeSuggestion(value: unknown): value is CompanyAttributeSuggestion {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    (record.companyRegion === null || typeof record.companyRegion === "string") &&
    (record.companyRegionLabel === null || typeof record.companyRegionLabel === "string") &&
    (record.category === null || typeof record.category === "string") &&
    (record.categoryLabel === null || typeof record.categoryLabel === "string") &&
    (record.industryType === null || typeof record.industryType === "string") &&
    (record.industryTypeLabel === null || typeof record.industryTypeLabel === "string") &&
    (record.subCategory === null || typeof record.subCategory === "string") &&
    (record.subCategoryLabel === null || typeof record.subCategoryLabel === "string") &&
    (record.companyDescription === null || typeof record.companyDescription === "string") &&
    (record.confidence === "low" ||
      record.confidence === "medium" ||
      record.confidence === "high") &&
    typeof record.reasoning === "string" &&
    Array.isArray(record.sources) &&
    record.sources.every((source) => isCompanyAttributeSuggestionSource(source))
  );
}

function isCompanyAttributeSuggestionResponse(
  value: unknown,
): value is CompanyAttributeSuggestionResponse {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  if (record.status === "ready") {
    return (
      isCompanyAttributeSuggestion(record.suggestion) &&
      Array.isArray(record.filledFieldKeys)
    );
  }

  if (record.status === "need_more_context" || record.status === "no_match") {
    return typeof record.message === "string";
  }

  return false;
}

function hasMissingCompanyAttributeSuggestionField(
  form: Pick<
    AccountCreateFormState,
    "companyDescription" | "companyRegion" | "category" | "industryType" | "subCategory"
  >,
): boolean {
  return (
    readText(form.companyDescription) === null ||
    readText(form.companyRegion) === null ||
    readText(form.category) === null ||
    readText(form.industryType) === null ||
    readText(form.subCategory) === null
  );
}

function buildCompanyAttributeSuggestionRequest(
  form: AccountCreateFormState,
): CompanyAttributeSuggestionRequest {
  return {
    companyName: readText(form.companyName),
    companyDescription: readText(form.companyDescription),
    businessAccountId: null,
    addressLine1: readText(form.addressLine1),
    city: readText(form.city),
    state: readText(form.state),
    postalCode: readText(form.postalCode),
    country: readText(form.country),
    contactEmail: null,
    companyRegion: readText(form.companyRegion),
    industryType: readText(form.industryType),
    subCategory: readText(form.subCategory),
    category: readText(form.category),
  };
}

function buildCompanyAttributeSuggestionFingerprint(
  request: CompanyAttributeSuggestionRequest | null,
): string | null {
  if (!request) {
    return null;
  }

  return JSON.stringify(request);
}

function applyCompanyAttributeSuggestion(
  form: AccountCreateFormState,
  suggestion: CompanyAttributeSuggestion,
): {
  form: AccountCreateFormState;
  appliedCount: number;
} {
  let appliedCount = 0;
  let nextForm = form;

  if (!readText(form.companyRegion) && readText(suggestion.companyRegion)) {
    nextForm = {
      ...nextForm,
      companyRegion: suggestion.companyRegion ?? "",
    };
    appliedCount += 1;
  }

  if (!readText(form.category) && readText(suggestion.category)) {
    nextForm = {
      ...nextForm,
      category: (suggestion.category as AccountCreateFormState["category"]) ?? "",
    };
    appliedCount += 1;
  }

  if (!readText(form.industryType) && readText(suggestion.industryType)) {
    nextForm = {
      ...nextForm,
      industryType: suggestion.industryType ?? "",
    };
    appliedCount += 1;
  }

  if (!readText(form.subCategory) && readText(suggestion.subCategory)) {
    nextForm = {
      ...nextForm,
      subCategory: suggestion.subCategory ?? "",
    };
    appliedCount += 1;
  }

  if (!readText(form.companyDescription) && readText(suggestion.companyDescription)) {
    nextForm = {
      ...nextForm,
      companyDescription: suggestion.companyDescription,
    };
    appliedCount += 1;
  }

  return {
    form: nextForm,
    appliedCount,
  };
}

export function CreateBusinessAccountDrawer({
  isOpen,
  employeeOptions,
  openAiAttributeSuggestEnabled,
  onClose,
  onAccountCreated,
  onContactCreated,
}: CreateBusinessAccountDrawerProps) {
  const [accountForm, setAccountForm] = useState<AccountCreateFormState>({ ...EMPTY_ACCOUNT_FORM });
  const [contactForm, setContactForm] = useState<BusinessAccountContactCreateRequest>({
    ...EMPTY_CONTACT_FORM,
  });
  const [addressSearchTerm, setAddressSearchTerm] = useState("");
  const [addressSelectionLabel, setAddressSelectionLabel] = useState<string | null>(null);
  const [addressSuggestions, setAddressSuggestions] = useState<AddressLookupSuggestion[]>([]);
  const [isAddressLookupLoading, setIsAddressLookupLoading] = useState(false);
  const [addressLookupError, setAddressLookupError] = useState<string | null>(null);
  const [isApplyingAddress, setIsApplyingAddress] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountNotice, setAccountNotice] = useState<string | null>(null);
  const [companyAttributeSuggestionError, setCompanyAttributeSuggestionError] = useState<string | null>(null);
  const [companyAttributeSuggestionNotice, setCompanyAttributeSuggestionNotice] =
    useState<string | null>(null);
  const [companyAttributeSuggestionResult, setCompanyAttributeSuggestionResult] =
    useState<CompanyAttributeSuggestion | null>(null);
  const [companyAttributeSuggestionFingerprint, setCompanyAttributeSuggestionFingerprint] =
    useState<string | null>(null);
  const [isSuggestingCompanyAttributes, setIsSuggestingCompanyAttributes] = useState(false);
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [createdAccount, setCreatedAccount] = useState<CreatedAccountState | null>(null);
  const [contactError, setContactError] = useState<string | null>(null);
  const [contactNotice, setContactNotice] = useState<string | null>(null);
  const [isCreatingContact, setIsCreatingContact] = useState(false);
  const [contactPartialComplete, setContactPartialComplete] = useState(false);

  const debouncedAddressSearchTerm = useDebouncedValue(addressSearchTerm, 220);
  const currentCompanyAttributeSuggestionRequest = useMemo(
    () => buildCompanyAttributeSuggestionRequest(accountForm),
    [accountForm],
  );
  const currentCompanyAttributeSuggestionFingerprint = useMemo(
    () => buildCompanyAttributeSuggestionFingerprint(currentCompanyAttributeSuggestionRequest),
    [currentCompanyAttributeSuggestionRequest],
  );
  const sortedEmployeeOptions = useMemo(
    () =>
      [...employeeOptions].sort((left, right) =>
        left.name.localeCompare(right.name, undefined, {
          sensitivity: "base",
          numeric: true,
        }),
      ),
    [employeeOptions],
  );
  const canSuggestCompanyAttributes =
    openAiAttributeSuggestEnabled &&
    !createdAccount &&
    readText(accountForm.companyName) !== null &&
    hasMissingCompanyAttributeSuggestionField(accountForm);

  useEffect(() => {
    if (isOpen) {
      return;
    }

    setAccountForm({ ...EMPTY_ACCOUNT_FORM });
    setContactForm({ ...EMPTY_CONTACT_FORM });
    setAddressSearchTerm("");
    setAddressSelectionLabel(null);
    setAddressSuggestions([]);
    setIsAddressLookupLoading(false);
    setAddressLookupError(null);
    setIsApplyingAddress(false);
    setAccountError(null);
    setAccountNotice(null);
    setCompanyAttributeSuggestionError(null);
    setCompanyAttributeSuggestionNotice(null);
    setCompanyAttributeSuggestionResult(null);
    setCompanyAttributeSuggestionFingerprint(null);
    setIsSuggestingCompanyAttributes(false);
    setIsCreatingAccount(false);
    setCreatedAccount(null);
    setContactError(null);
    setContactNotice(null);
    setIsCreatingContact(false);
    setContactPartialComplete(false);
  }, [isOpen]);

  useEffect(() => {
    if (
      companyAttributeSuggestionFingerprint !== null &&
      currentCompanyAttributeSuggestionFingerprint !== null &&
      companyAttributeSuggestionFingerprint !== currentCompanyAttributeSuggestionFingerprint
    ) {
      setCompanyAttributeSuggestionError(null);
      setCompanyAttributeSuggestionNotice(null);
      setCompanyAttributeSuggestionResult(null);
      setCompanyAttributeSuggestionFingerprint(null);
    }
  }, [
    companyAttributeSuggestionFingerprint,
    currentCompanyAttributeSuggestionFingerprint,
  ]);

  useEffect(() => {
    if (!isOpen || createdAccount || accountForm.addressLookupId || debouncedAddressSearchTerm.length < 3) {
      setAddressSuggestions([]);
      setIsAddressLookupLoading(false);
      return;
    }

    const controller = new AbortController();
    setIsAddressLookupLoading(true);
    setAddressLookupError(null);

    const params = new URLSearchParams({
      q: debouncedAddressSearchTerm,
    });

    fetch(`/api/address-complete/canada-post?${params.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await readJsonResponse<AddressLookupResponse | { error?: string }>(
          response,
        );
        if (!response.ok) {
          throw new Error(parseError(payload));
        }
        if (!isAddressLookupResponse(payload)) {
          throw new Error("Unexpected address lookup response.");
        }
        if (!controller.signal.aborted) {
          setAddressSuggestions(payload.items);
        }
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          return;
        }
        setAddressSuggestions([]);
        setAddressLookupError(
          error instanceof Error ? error.message : "Address lookup failed.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsAddressLookupLoading(false);
        }
      });

    return () => controller.abort();
  }, [accountForm.addressLookupId, createdAccount, debouncedAddressSearchTerm, isOpen]);

  async function applyAddressSuggestion(suggestion: AddressLookupSuggestion) {
    setIsApplyingAddress(true);
    setAddressLookupError(null);
    setAccountError(null);
    try {
      const params = new URLSearchParams({
        id: suggestion.id,
        addressLine1: accountForm.addressLine1,
        addressLine2: accountForm.addressLine2,
        city: accountForm.city,
        state: accountForm.state,
        postalCode: accountForm.postalCode,
      });

      const response = await fetch(`/api/address-complete/canada-post?${params.toString()}`, {
        cache: "no-store",
      });
      const payload = await readJsonResponse<AddressRetrieveResponse | { error?: string }>(
        response,
      );
      if (!response.ok) {
        throw new Error(parseError(payload));
      }
      if (!isAddressRetrieveResponse(payload)) {
        throw new Error("Unexpected address lookup response.");
      }

      setAccountForm((current) => ({
        ...current,
        addressLookupId: suggestion.id,
        addressLine1: payload.address.addressLine1,
        addressLine2: payload.address.addressLine2 || current.addressLine2,
        city: payload.address.city,
        state: payload.address.state,
        postalCode: payload.address.postalCode,
        country: "CA",
      }));
      setAddressSelectionLabel(
        [suggestion.text, suggestion.description].filter(Boolean).join(" • "),
      );
      setAddressSuggestions([]);
      setAddressSearchTerm(suggestion.text);
    } catch (error) {
      setAddressLookupError(error instanceof Error ? error.message : "Address lookup failed.");
    } finally {
      setIsApplyingAddress(false);
    }
  }

  function clearSelectedAddress() {
    setAccountForm((current) => ({
      ...current,
      addressLookupId: "",
      addressLine1: "",
      city: "",
      state: "",
      postalCode: "",
      country: "CA",
    }));
    setAddressSelectionLabel(null);
    setAddressSuggestions([]);
    setAddressSearchTerm("");
    setAddressLookupError(null);
  }

  async function handleCreateAccount() {
    if (!accountForm.companyName.trim()) {
      setAccountError("Account Name is required.");
      return;
    }
    if (!accountForm.classId) {
      setAccountError("Business Account Class is required.");
      return;
    }
    if (!accountForm.industryType.trim()) {
      setAccountError("Industry Type is required.");
      return;
    }
    if (!accountForm.subCategory.trim()) {
      setAccountError("Industry Type Sub-Category is required.");
      return;
    }
    if (!accountForm.companyRegion.trim()) {
      setAccountError("Company Region is required.");
      return;
    }
    if (!accountForm.category) {
      setAccountError("Client Type is required.");
      return;
    }
    if (!accountForm.addressLookupId) {
      setAccountError("Select a Canada Post address before creating the account.");
      return;
    }
    if (accountForm.salesRepName && !accountForm.salesRepId) {
      setAccountError("Select a valid Sales Rep from the employee list.");
      return;
    }
    const normalizedCompanyPhone = accountForm.companyPhone
      ? normalizePhoneForSave(accountForm.companyPhone)
      : null;
    if (accountForm.companyPhone && !normalizedCompanyPhone) {
      setAccountError("Company Phone must use the format ###-###-####.");
      return;
    }

    setIsCreatingAccount(true);
    setAccountError(null);
    setAccountNotice(null);

    try {
      const requestBody: BusinessAccountCreateRequest = {
        ...accountForm,
        companyDescription: readText(accountForm.companyDescription),
        classId: accountForm.classId,
        category: accountForm.category,
        companyPhone: normalizedCompanyPhone,
        week: accountForm.week || null,
      };
      const response = await fetch("/api/business-accounts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });
      const payload = await readJsonResponse<BusinessAccountCreateResponse | { error?: string }>(
        response,
      );
      if (!response.ok) {
        throw new Error(parseError(payload));
      }
      if (!isBusinessAccountCreateResponse(payload)) {
        throw new Error("Unexpected response while creating the business account.");
      }

      onAccountCreated(payload);
      setCreatedAccount({
        businessAccountRecordId: payload.businessAccountRecordId,
        businessAccountId: payload.businessAccountId,
        companyName: payload.createdRow.companyName,
        warnings: payload.warnings,
      });
      setAccountNotice(
        `Business account ${payload.businessAccountId} was created in Acumatica.`,
      );
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : "Unable to create business account.");
    } finally {
      setIsCreatingAccount(false);
    }
  }

  async function handleSuggestCompanyAttributes() {
    const requestBody = buildCompanyAttributeSuggestionRequest(accountForm);
    const requestFingerprint = buildCompanyAttributeSuggestionFingerprint(requestBody);

    setIsSuggestingCompanyAttributes(true);
    setCompanyAttributeSuggestionError(null);

    try {
      const response = await fetch("/api/business-accounts/attribute-suggestion", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });
      const payload = await readJsonResponse<
        CompanyAttributeSuggestionResponse | { error?: string }
      >(response);

      if (!response.ok) {
        throw new Error(parseError(payload));
      }
      if (!isCompanyAttributeSuggestionResponse(payload)) {
        throw new Error("Unexpected response while suggesting company attributes.");
      }

      setCompanyAttributeSuggestionFingerprint(requestFingerprint);

      if (payload.status === "need_more_context" || payload.status === "no_match") {
        setCompanyAttributeSuggestionResult(null);
        setCompanyAttributeSuggestionNotice(payload.message);
        return;
      }

      setCompanyAttributeSuggestionResult(payload.suggestion);
      let appliedCount = 0;
      setAccountForm((current) => {
        const result = applyCompanyAttributeSuggestion(current, payload.suggestion);
        appliedCount = result.appliedCount;
        return result.form;
      });

      if (appliedCount > 0) {
        const filledLabels = payload.filledFieldKeys
          .map((field) =>
            field === "companyRegion"
              ? "Company Region"
              : field === "companyDescription"
                ? "Company Description"
                : field === "industryType"
                  ? "Industry Type"
                  : field === "subCategory"
                    ? "Sub-Category"
                    : "Category",
          )
          .join(", ");
        setCompanyAttributeSuggestionNotice(
          `OpenAI filled missing ${filledLabels}. Create saves the description locally and sends only Acumatica attributes upstream.`,
        );
      } else {
        setCompanyAttributeSuggestionNotice(
          "OpenAI found suggestions, but there was no new Company Region, Category, Industry Type, Sub-Category, or Company Description to add.",
        );
      }
    } catch (error) {
      setCompanyAttributeSuggestionResult(null);
      setCompanyAttributeSuggestionNotice(null);
      setCompanyAttributeSuggestionError(
        error instanceof Error ? error.message : "Failed to suggest company attributes.",
      );
    } finally {
      setIsSuggestingCompanyAttributes(false);
    }
  }

  async function handleCreateContact() {
    if (!createdAccount) {
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
        `/api/business-accounts/${encodeURIComponent(createdAccount.businessAccountRecordId)}/contacts`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...contactForm,
            extension: normalizedExtension,
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
            <p className={styles.kicker}>New Business Account</p>
            <h2>Create in Acumatica</h2>
            {createdAccount ? (
              <p className={styles.headerMeta}>
                {createdAccount.companyName} • Account ID {createdAccount.businessAccountId}
              </p>
            ) : (
              <p className={styles.headerMeta}>
                Step 1 of 2: create the business account, then optionally add its primary contact.
              </p>
            )}
          </div>
          <button className={styles.closeButton} onClick={onClose} type="button">
            Close
          </button>
        </div>

        <div className={styles.drawerBody}>
          {!createdAccount ? (
            <>
              <section className={styles.section}>
                <h3>Business Account</h3>
                <label>
                  Account Name
                  <input
                    onChange={(event) =>
                      setAccountForm((current) => ({
                        ...current,
                        companyName: event.target.value,
                      }))
                    }
                    value={accountForm.companyName}
                  />
                </label>

                <label>
                  Company Description
                  <textarea
                    onChange={(event) =>
                      setAccountForm((current) => ({
                        ...current,
                        companyDescription: event.target.value,
                      }))
                    }
                    placeholder="Stored only in this app. Not sent to Acumatica."
                    value={accountForm.companyDescription ?? ""}
                  />
                </label>
                <p className={styles.lookupHint}>
                  This description stays in the app only. Create saves it locally and does not push it to Acumatica.
                </p>

                <label>
                  Company Phone
                  <input
                    inputMode="numeric"
                    maxLength={12}
                    onChange={(event) =>
                      setAccountForm((current) => ({
                        ...current,
                        companyPhone: formatPhoneDraftValue(event.target.value) || null,
                      }))
                    }
                    placeholder="123-456-7890"
                    value={accountForm.companyPhone ?? ""}
                  />
                </label>

                <label>
                  Business Account Class
                  <select
                    onChange={(event) =>
                      setAccountForm((current) => ({
                        ...current,
                        classId: event.target.value as AccountCreateFormState["classId"],
                      }))
                    }
                    value={accountForm.classId}
                  >
                    <option value="">Select class</option>
                    {BUSINESS_ACCOUNT_CLASS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Sales Rep
                  <select
                    onChange={(event) => {
                      const nextId = event.target.value.trim();
                      const selectedEmployee =
                        sortedEmployeeOptions.find((employee) => employee.id === nextId) ?? null;
                      setAccountForm((current) => ({
                        ...current,
                        salesRepId: selectedEmployee?.id ?? null,
                        salesRepName: selectedEmployee?.name ?? null,
                      }));
                    }}
                    value={accountForm.salesRepId ?? ""}
                  >
                    <option value="">Unassigned</option>
                    {sortedEmployeeOptions.map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {employee.name}
                      </option>
                    ))}
                  </select>
                </label>
              </section>

              <section className={styles.section}>
                <h3>Address</h3>
                <label>
                  Canada Post address search
                  <input
                    disabled={Boolean(accountForm.addressLookupId)}
                    onChange={(event) => setAddressSearchTerm(event.target.value)}
                    placeholder="Start typing an address in Canada"
                    value={addressSearchTerm}
                  />
                </label>
                <p className={styles.lookupHint}>
                  New accounts require a Canada Post AddressComplete selection.
                </p>

                {isAddressLookupLoading ? (
                  <p className={styles.lookupLoading}>Looking up Canada Post suggestions...</p>
                ) : null}
                {addressLookupError ? <p className={styles.lookupError}>{addressLookupError}</p> : null}

                {!accountForm.addressLookupId && addressSuggestions.length > 0 ? (
                  <div className={styles.lookupSuggestions}>
                    {addressSuggestions.map((suggestion) => (
                      <button
                        className={styles.lookupSuggestionItem}
                        key={suggestion.id}
                        onClick={() => {
                          void applyAddressSuggestion(suggestion);
                        }}
                        type="button"
                      >
                        <span className={styles.lookupSuggestionTitle}>{suggestion.text}</span>
                        <span className={styles.lookupSuggestionMeta}>{suggestion.description}</span>
                      </button>
                    ))}
                  </div>
                ) : null}

                {accountForm.addressLookupId ? (
                  <div className={styles.selectedAddressCard}>
                    <strong>Selected Canada Post address</strong>
                    <span>{addressSelectionLabel ?? accountForm.addressLine1}</span>
                    <button className={styles.secondaryButton} onClick={clearSelectedAddress} type="button">
                      Change address
                    </button>
                  </div>
                ) : null}

                <label>
                  Address Line 1
                  <input disabled readOnly value={accountForm.addressLine1} />
                </label>
                <label>
                  Unit Number
                  <input
                    onChange={(event) =>
                      setAccountForm((current) => ({
                        ...current,
                        addressLine2: event.target.value,
                      }))
                    }
                    value={accountForm.addressLine2}
                  />
                </label>
                <label>
                  City
                  <input disabled readOnly value={accountForm.city} />
                </label>
                <label>
                  Province/State
                  <input disabled readOnly value={accountForm.state} />
                </label>
                <label>
                  Postal Code
                  <input disabled readOnly value={accountForm.postalCode} />
                </label>
              </section>

              <section className={styles.section}>
                <h3>Attributes</h3>
                <div className={styles.companyAttributeSuggestionSection}>
                  <div className={styles.companyAttributeSuggestionActions}>
                    <button
                      className={styles.secondaryButton}
                      disabled={
                        isCreatingAccount ||
                        isApplyingAddress ||
                        isSuggestingCompanyAttributes ||
                        !canSuggestCompanyAttributes
                      }
                      onClick={() => {
                        void handleSuggestCompanyAttributes();
                      }}
                      type="button"
                    >
                      {isSuggestingCompanyAttributes ? "Researching..." : "Suggest with OpenAI"}
                    </button>
                    {!openAiAttributeSuggestEnabled ? (
                      <p className={styles.lookupHint}>
                        OpenAI attribute suggestions are not configured for this environment.
                      </p>
                    ) : !hasMissingCompanyAttributeSuggestionField(accountForm) ? (
                      <p className={styles.lookupHint}>
                        OpenAI only fills missing Company Region, Category, Industry Type, Sub-Category, or Company Description.
                      </p>
                    ) : readText(accountForm.companyName) === null ? (
                      <p className={styles.lookupHint}>
                        Enter an account name before asking OpenAI to research this company.
                      </p>
                    ) : (
                      <p className={styles.lookupHint}>
                        OpenAI looks online for company evidence, writes a local-only company description, and also uses {appBranding.companyName}&apos;s postal-code region map.
                      </p>
                    )}
                  </div>
                  {companyAttributeSuggestionError ? (
                    <p className={styles.lookupError}>{companyAttributeSuggestionError}</p>
                  ) : null}
                  {companyAttributeSuggestionNotice ? (
                    <p className={styles.lookupHint}>{companyAttributeSuggestionNotice}</p>
                  ) : null}
                  {companyAttributeSuggestionResult ? (
                    <div className={styles.companyAttributeSuggestionResult}>
                      <p>
                        Suggested values:
                        {" "}
                        {companyAttributeSuggestionResult.companyRegionLabel ?? "No region"}
                        {" / "}
                        {companyAttributeSuggestionResult.categoryLabel ?? "No category"}
                        {" / "}
                        {companyAttributeSuggestionResult.industryTypeLabel ?? "No industry type"}
                        {" / "}
                        {companyAttributeSuggestionResult.subCategoryLabel ?? "No sub-category"}
                        {" "}
                        ({companyAttributeSuggestionResult.confidence} confidence)
                      </p>
                      {companyAttributeSuggestionResult.companyDescription ? (
                        <p>{companyAttributeSuggestionResult.companyDescription}</p>
                      ) : null}
                      <p>{companyAttributeSuggestionResult.reasoning}</p>
                      {companyAttributeSuggestionResult.sources.length > 0 ? (
                        <div className={styles.companyAttributeSuggestionSources}>
                          {companyAttributeSuggestionResult.sources.map((source) => (
                            <a
                              className={styles.companyAttributeSuggestionSource}
                              href={source.url}
                              key={source.url}
                              rel="noreferrer"
                              target="_blank"
                            >
                              {source.title}
                            </a>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <label>
                  Industry Type
                  <select
                    onChange={(event) =>
                      setAccountForm((current) => ({
                        ...current,
                        industryType: event.target.value,
                      }))
                    }
                    value={accountForm.industryType}
                  >
                    <option value="">Select Industry Type</option>
                    {INDUSTRY_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Industry Type Sub-Category
                  <select
                    onChange={(event) =>
                      setAccountForm((current) => ({
                        ...current,
                        subCategory: event.target.value,
                      }))
                    }
                    value={accountForm.subCategory}
                  >
                    <option value="">Select Sub-Category</option>
                    {SUB_CATEGORY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Client Type
                  <select
                    onChange={(event) =>
                      setAccountForm((current) => ({
                        ...current,
                        category: event.target.value as AccountCreateFormState["category"],
                      }))
                    }
                    value={accountForm.category}
                  >
                    <option value="">Select Client Type</option>
                    {CATEGORY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Company Region
                  <select
                    onChange={(event) =>
                      setAccountForm((current) => ({
                        ...current,
                        companyRegion: event.target.value,
                      }))
                    }
                    value={accountForm.companyRegion}
                  >
                    <option value="">Select Company Region</option>
                    {COMPANY_REGION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Week
                  <select
                    onChange={(event) =>
                      setAccountForm((current) => ({
                        ...current,
                        week: event.target.value,
                      }))
                    }
                    value={accountForm.week}
                  >
                    <option value="">Optional</option>
                    {WEEK_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </section>

              {accountError ? <p className={styles.error}>{accountError}</p> : null}
              {accountNotice ? <p className={styles.notice}>{accountNotice}</p> : null}

              <button
                className={styles.primaryButton}
                disabled={isCreatingAccount || isApplyingAddress}
                onClick={() => {
                  void handleCreateAccount();
                }}
                type="button"
              >
                {isCreatingAccount ? "Creating..." : "Create account in Acumatica"}
              </button>
            </>
          ) : (
            <>
              <section className={styles.section}>
                <h3>Add primary contact (optional)</h3>
                <p className={styles.lookupHint}>
                  If you create the contact here, the app will also try to make it the primary contact on the new account.
                </p>
                {createdAccount.warnings.map((warning) => (
                  <p className={styles.warning} key={warning}>
                    {warning}
                  </p>
                ))}
                {accountNotice ? <p className={styles.notice}>{accountNotice}</p> : null}

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
                        contactClass: event.target.value as BusinessAccountContactCreateRequest["contactClass"],
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
                  {contactPartialComplete ? "Close" : "Skip for now"}
                </button>
                {!contactPartialComplete ? (
                  <button
                    className={styles.primaryButton}
                    disabled={isCreatingContact}
                    onClick={() => {
                      void handleCreateContact();
                    }}
                    type="button"
                  >
                    {isCreatingContact ? "Creating..." : "Create contact"}
                  </button>
                ) : null}
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
