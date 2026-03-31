"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { getAppBranding } from "@/lib/app-variant";
import type {
  OnboardingContactOption,
  OnboardingFormPayload,
  OnboardingPendingRequestResponse,
  OnboardingRequestResponse,
} from "@/types/onboarding";

import styles from "./onboarding.module.css";

const appBranding = getAppBranding();

type LoadState =
  | "loading"
  | "ready"
  | "submitted"
  | "converted"
  | "failed"
  | "error";

type ContactMode = "existing" | "new";

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

type SelectOption = {
  value: string;
  label: string;
  meta?: string | null;
};

type FormState = {
  billingName: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  addressLookupId: string;
  addressTouched: boolean;
  invoiceMode: ContactMode;
  invoiceContactId: number | null;
  invoiceNewName: string;
  invoiceNewEmail: string;
  invoiceNewPhone: string;
  collectionsSameAsInvoice: boolean;
  collectionsMode: ContactMode;
  collectionsContactId: number | null;
  collectionsNewName: string;
  collectionsNewEmail: string;
  collectionsNewPhone: string;
  paymentTermsDifferent: boolean;
  paymentTermId: string;
  poRequired: boolean;
  poInstructions: string;
};

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

function parseError(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "Request failed.";
  }

  const record = payload as Record<string, unknown>;
  return typeof record.error === "string" && record.error.trim()
    ? record.error.trim()
    : "Request failed.";
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

function createInitialFormState(
  data: OnboardingPendingRequestResponse,
): FormState {
  const hasContacts = data.contacts.length > 0;
  const defaultInvoiceContactId = null;
  const invoiceMode: ContactMode = hasContacts ? "existing" : "new";
  const collectionsMode: ContactMode = hasContacts ? "existing" : "new";
  const paymentTermId =
    data.defaultPaymentTermId ||
    data.paymentTerms[0]?.id ||
    "NET 30";

  return {
    billingName: data.companyName ?? "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    state: "",
    postalCode: "",
    country: "",
    addressLookupId: "",
    addressTouched: false,
    invoiceMode,
    invoiceContactId: defaultInvoiceContactId,
    invoiceNewName: "",
    invoiceNewEmail: "",
    invoiceNewPhone: "",
    collectionsSameAsInvoice: true,
    collectionsMode,
    collectionsContactId: defaultInvoiceContactId,
    collectionsNewName: "",
    collectionsNewEmail: "",
    collectionsNewPhone: "",
    paymentTermsDifferent: false,
    paymentTermId,
    poRequired: false,
    poInstructions: "",
  };
}

function isPendingRequestResponse(
  payload: OnboardingRequestResponse,
): payload is OnboardingPendingRequestResponse {
  return payload.status === "pending";
}

function buildContactOptions(contacts: OnboardingContactOption[]): SelectOption[] {
  return contacts.map((contact) => ({
    value: String(contact.id),
    label: contact.name || `Contact ${contact.id}`,
    meta: [contact.email, contact.phone].filter(Boolean).join(" • ") || null,
  }));
}

function SearchableSelect({
  value,
  options,
  placeholder,
  onChange,
  disabled,
}: {
  value: string;
  options: SelectOption[];
  placeholder?: string;
  onChange: (nextValue: string) => void;
  disabled?: boolean;
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const selectedOption = options.find((option) => option.value === value) ?? null;
  const [query, setQuery] = useState("");
  const inputValue = open ? query : (selectedOption?.label ?? "");

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointer(event: MouseEvent) {
      if (!wrapperRef.current) {
        return;
      }
      if (wrapperRef.current.contains(event.target as Node)) {
        return;
      }
      setOpen(false);
    }

    window.addEventListener("mousedown", handlePointer);
    return () => window.removeEventListener("mousedown", handlePointer);
  }, [open, selectedOption?.label]);

  const filteredOptions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return options;
    }
    return options.filter((option) => option.label.toLowerCase().includes(needle));
  }, [options, query]);

  function handleSelect(option: SelectOption) {
    onChange(option.value);
    setQuery(option.label);
    setOpen(false);
  }

  return (
    <div className={styles.combo} ref={wrapperRef}>
      <div className={styles.comboInput}>
        <input
          ref={inputRef}
          value={inputValue}
          onChange={(event) => {
            setQuery(event.target.value);
            if (!open) {
              setOpen(true);
            }
          }}
          onFocus={() => {
            setQuery(selectedOption?.label ?? "");
            setOpen(true);
            setTimeout(() => inputRef.current?.select(), 0);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && filteredOptions.length > 0) {
              event.preventDefault();
              handleSelect(filteredOptions[0]);
            }
            if (event.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
        />
        <span className={styles.comboChevron} />
      </div>
      {open ? (
        <div className={styles.comboMenu}>
          {filteredOptions.length > 0 ? (
            filteredOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`${styles.comboOption} ${
                  option.value === value ? styles.comboOptionActive : ""
                }`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  handleSelect(option);
                }}
              >
                <span className={styles.comboOptionLabel}>{option.label}</span>
                {option.meta ? (
                  <span className={styles.comboOptionMeta}>{option.meta}</span>
                ) : null}
              </button>
            ))
          ) : (
            <div className={styles.comboEmpty}>No matches found.</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function OnboardingClient({ token }: { token: string }) {
  const [state, setState] = useState<LoadState>("loading");
  const [data, setData] = useState<OnboardingRequestResponse | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [addressSearchTerm, setAddressSearchTerm] = useState("");
  const [addressSuggestions, setAddressSuggestions] = useState<AddressLookupSuggestion[]>([]);
  const [isAddressLookupLoading, setIsAddressLookupLoading] = useState(false);
  const [addressLookupError, setAddressLookupError] = useState<string | null>(null);
  const [addressSelectionLabel, setAddressSelectionLabel] = useState<string | null>(null);
  const [isApplyingAddress, setIsApplyingAddress] = useState(false);
  const [editorSessionId, setEditorSessionId] = useState<string | null>(null);
  const [editorWarning, setEditorWarning] = useState<string | null>(null);
  const pendingData = useMemo(
    () => (data && isPendingRequestResponse(data) ? data : null),
    [data],
  );
  const contactOptions = useMemo(() => pendingData?.contacts ?? [], [pendingData]);
  const contactSelectOptions = useMemo(
    () => buildContactOptions(contactOptions),
    [contactOptions],
  );
  const debouncedAddressSearchTerm = useDebouncedValue(addressSearchTerm, 220);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const storageKey = `onboarding-editor-session:${token}`;
    const existing = window.sessionStorage.getItem(storageKey);
    if (existing) {
      setEditorSessionId(existing);
      return;
    }

    const nextSessionId = window.crypto.randomUUID();
    window.sessionStorage.setItem(storageKey, nextSessionId);
    setEditorSessionId(nextSessionId);
  }, [token]);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      setState("loading");
      setError(null);
      try {
        const response = await fetch(`/api/onboarding/requests/${token}`, {
          cache: "no-store",
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.error ?? "Unable to load onboarding details.");
        }

        if (cancelled) {
          return;
        }

        const typed = payload as OnboardingRequestResponse;
        setData(typed);

        if (!isPendingRequestResponse(typed)) {
          setState(typed.status as LoadState);
          setForm(null);
          return;
        }

        const initialForm = createInitialFormState(typed);
        setForm(initialForm);
        const addressPreview = [
          initialForm.addressLine1,
          initialForm.city,
          initialForm.state,
        ]
          .filter(Boolean)
          .join(", ");
        setAddressSearchTerm(addressPreview);
        setState("ready");
      } catch (err) {
        if (cancelled) {
          return;
        }
        setError(err instanceof Error ? err.message : "Unable to load onboarding details.");
        setState("error");
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (state !== "ready" || !editorSessionId) {
      return;
    }

    let cancelled = false;

    async function heartbeat(): Promise<void> {
      try {
        const response = await fetch(`/api/onboarding/requests/${token}/presence`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: editorSessionId }),
        });
        const payload = await response.json().catch(() => null);
        if (cancelled || !response.ok) {
          return;
        }

        setEditorWarning(
          payload?.conflict
            ? "Someone else is currently editing this form. You can still submit, but the latest accepted submission wins."
            : null,
        );
      } catch {
        if (!cancelled) {
          setEditorWarning(null);
        }
      }
    }

    void heartbeat();
    const intervalId = window.setInterval(() => {
      void heartbeat();
    }, 20_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [editorSessionId, state, token]);

  useEffect(() => {
    if (state !== "submitted") {
      return;
    }

    let cancelled = false;

    async function refreshStatus(): Promise<void> {
      try {
        const response = await fetch(`/api/onboarding/requests/${token}`, {
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as OnboardingRequestResponse | null;
        if (cancelled || !response.ok || !payload) {
          return;
        }

        setData(payload);
        if (payload.status === "converted" || payload.status === "failed") {
          setState(payload.status);
        }
      } catch {
        // Keep the submitted state stable while the backend finalizer retries.
      }
    }

    void refreshStatus();
    const intervalId = window.setInterval(() => {
      void refreshStatus();
    }, 5_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [state, token]);

  function updateForm(patch: Partial<FormState>): void {
    setForm((current) => (current ? { ...current, ...patch } : current));
  }

  function updateAddressField(patch: Partial<FormState>): void {
    setForm((current) =>
      current
        ? {
            ...current,
            ...patch,
            addressLookupId: "",
            addressTouched: true,
          }
        : current,
    );
    setAddressSelectionLabel(null);
  }

  function updateAddressSearch(value: string): void {
    setAddressSearchTerm(value);
    setAddressLookupError(null);
    setAddressSuggestions([]);
    setAddressSelectionLabel(null);
    setForm((current) =>
      current
        ? {
            ...current,
            addressLookupId: "",
            addressTouched: true,
          }
        : current,
    );
  }

  useEffect(() => {
    if (!form || form.addressLookupId || debouncedAddressSearchTerm.trim().length < 3) {
      setAddressSuggestions([]);
      setIsAddressLookupLoading(false);
      return;
    }

    const controller = new AbortController();
    setIsAddressLookupLoading(true);
    setAddressLookupError(null);

    const params = new URLSearchParams({
      q: debouncedAddressSearchTerm.trim(),
    });
    params.set("token", token);

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
  }, [debouncedAddressSearchTerm, form, token]);

  async function applyAddressSuggestion(suggestion: AddressLookupSuggestion) {
    if (!form) {
      return;
    }

    setIsApplyingAddress(true);
    setAddressLookupError(null);
    try {
      const params = new URLSearchParams({
        id: suggestion.id,
        addressLine1: form.addressLine1,
        addressLine2: form.addressLine2,
        city: form.city,
        state: form.state,
        postalCode: form.postalCode,
      });
      params.set("token", token);

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

      setForm((current) =>
        current
          ? {
              ...current,
              addressLookupId: suggestion.id,
              addressTouched: false,
              addressLine1: payload.address.addressLine1,
              addressLine2: payload.address.addressLine2 || current.addressLine2,
              city: payload.address.city,
              state: payload.address.state,
              postalCode: payload.address.postalCode,
              country: payload.address.country,
            }
          : current,
      );
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

  function buildPayload(): OnboardingFormPayload | null {
    if (!form || !pendingData) {
      return null;
    }

    const defaultTermId = pendingData.defaultPaymentTermId ?? "";

    if (form.addressTouched && !form.addressLookupId) {
      setSubmitError("Please select a Canada Post-verified address.");
      return null;
    }

    if (form.invoiceMode === "existing" && !form.invoiceContactId) {
      setSubmitError("Select the invoice contact.");
      return null;
    }

    if (
      form.collectionsSameAsInvoice === false &&
      form.collectionsMode === "existing" &&
      !form.collectionsContactId
    ) {
      setSubmitError("Select the payment inquiries contact.");
      return null;
    }
    if (form.paymentTermsDifferent) {
      if (!form.paymentTermId) {
        setSubmitError("Select the preferred payment terms.");
        return null;
      }
      if (defaultTermId && form.paymentTermId === defaultTermId) {
        setSubmitError(
          "Select a payment term different from the default or uncheck the box.",
        );
        return null;
      }
    }

    const effectivePaymentTermId =
      form.paymentTermsDifferent && form.paymentTermId
        ? form.paymentTermId
        : defaultTermId || form.paymentTermId;

    if (!effectivePaymentTermId) {
      setSubmitError("Select the preferred payment terms.");
      return null;
    }

    const invoiceContact =
      form.invoiceMode === "existing"
        ? { mode: "existing" as const, contactId: form.invoiceContactId as number }
        : {
            mode: "new" as const,
            name: form.invoiceNewName,
            email: form.invoiceNewEmail,
            phone: form.invoiceNewPhone,
          };

    const collectionsSelection =
      form.collectionsSameAsInvoice
        ? null
        : form.collectionsMode === "existing"
          ? { mode: "existing" as const, contactId: form.collectionsContactId as number }
          : {
              mode: "new" as const,
              name: form.collectionsNewName,
              email: form.collectionsNewEmail,
              phone: form.collectionsNewPhone,
            };

    return {
      billingName: form.billingName,
      billingAddress: {
        line1: form.addressLine1,
        line2: form.addressLine2,
        city: form.city,
        state: form.state,
        postalCode: form.postalCode,
        country: form.country,
      },
      invoiceContact,
      collectionsContact: {
        sameAsInvoice: form.collectionsSameAsInvoice,
        selection: collectionsSelection,
      },
      paymentTermsDifferent: form.paymentTermsDifferent,
      paymentTermId: effectivePaymentTermId,
      poRequired: form.poRequired,
      poInstructions: form.poInstructions ? form.poInstructions : null,
    };
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!form || isSubmitting) {
      return;
    }

    setSubmitError(null);
    const payload = buildPayload();
    if (!payload) {
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/onboarding/requests/${token}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result?.error ?? "Unable to submit onboarding form.");
      }

      setState(result.status === "converted" ? "converted" : "submitted");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Unable to submit onboarding form.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.hero}>
          <div className={styles.heroBrand}>
            <div
              className={styles.heroLogoMask}
              style={{
                maxWidth: `${appBranding.logoWidth}px`,
                aspectRatio: `${appBranding.logoWidth} / ${appBranding.logoHeight}`,
              }}
            >
              <Image
                src={appBranding.logoSrc}
                alt={appBranding.logoAlt}
                className={styles.heroLogo}
                width={appBranding.logoWidth}
                height={appBranding.logoHeight}
                sizes={`(max-width: 720px) 82vw, ${appBranding.logoWidth}px`}
                priority
              />
            </div>
          </div>
          <div className={styles.heroEyebrow}>Account setup</div>
          <h1>Let’s get everything ready</h1>
          <p>
            Confirm billing and key contacts so we can begin work.
          </p>
          {data?.companyName ? (
            <div className={styles.heroMeta}>
              <span>{data.companyName}</span>
              {data.opportunityId ? <span>Opportunity {data.opportunityId}</span> : null}
              <span>Secure form</span>
              <span>5 minutes</span>
            </div>
          ) : null}
        </header>

        {state === "loading" ? (
          <div className={styles.card}>Loading your secure form...</div>
        ) : null}

        {state === "error" ? (
          <div className={styles.card}>
            <h2>We hit a snag</h2>
            <p>{error ?? "Unable to load onboarding details."}</p>
          </div>
        ) : null}

        {state === "submitted" ? (
          <div className={styles.card}>
            <h2>We&apos;re finalizing your account</h2>
            <p>
              Your information was received. We&apos;re completing the setup now and this page will
              update automatically.
            </p>
          </div>
        ) : null}

        {state === "converted" ? (
          <div className={styles.card}>
            <h2>All set</h2>
            <p>Your account is active. We will follow up if anything else is needed.</p>
          </div>
        ) : null}

        {state === "failed" ? (
          <div className={styles.card}>
            <h2>We need a hand</h2>
            <p>
              Something went wrong while finalizing your onboarding. Please reply to the email so we
              can finish setup for you.
            </p>
          </div>
        ) : null}

        {state === "ready" && form && pendingData ? (
          <form className={styles.form} onSubmit={handleSubmit}>
            {editorWarning ? (
              <section className={styles.card}>
                <h2>Editing notice</h2>
                <p>{editorWarning}</p>
              </section>
            ) : null}
            <section className={styles.card}>
              <h2>Billing information</h2>
              <label className={styles.field}>
                <span>Find your address (Canada Post)</span>
                <input
                  value={addressSearchTerm}
                  onChange={(event) => updateAddressSearch(event.target.value)}
                  placeholder="Start typing your address"
                />
              </label>
              {isAddressLookupLoading ? (
                <p className={styles.lookupLoading}>Searching address...</p>
              ) : null}
              {addressLookupError ? (
                <p className={styles.lookupError}>{addressLookupError}</p>
              ) : null}
              {addressSelectionLabel ? (
                <div className={styles.selectedAddressCard}>
                  Verified address: {addressSelectionLabel}
                </div>
              ) : null}
              {addressSuggestions.length > 0 ? (
                <div className={styles.lookupSuggestions}>
                  {addressSuggestions.map((suggestion) => (
                    <button
                      key={suggestion.id}
                      type="button"
                      className={styles.lookupSuggestionItem}
                      onClick={() => applyAddressSuggestion(suggestion)}
                      disabled={isApplyingAddress}
                    >
                      <span className={styles.lookupSuggestionTitle}>{suggestion.text}</span>
                      <span className={styles.lookupSuggestionMeta}>
                        {suggestion.description}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
              <div className={styles.fieldGrid}>
                <label className={styles.field}>
                  <span>Billing name</span>
                  <input
                    value={form.billingName}
                    onChange={(event) => updateForm({ billingName: event.target.value })}
                    required
                  />
                </label>
                <label className={styles.field}>
                  <span>Address</span>
                  <input
                    value={form.addressLine1}
                    onChange={(event) => updateAddressField({ addressLine1: event.target.value })}
                    required
                  />
                </label>
                <label className={styles.field}>
                  <span>Unit number</span>
                  <input
                    value={form.addressLine2}
                    onChange={(event) => updateAddressField({ addressLine2: event.target.value })}
                  />
                </label>
                <label className={styles.field}>
                  <span>City</span>
                  <input
                    value={form.city}
                    onChange={(event) => updateAddressField({ city: event.target.value })}
                    required
                  />
                </label>
                <label className={styles.field}>
                  <span>State / Province</span>
                  <input
                    value={form.state}
                    onChange={(event) => updateAddressField({ state: event.target.value })}
                    required
                  />
                </label>
                <label className={styles.field}>
                  <span>Postal code</span>
                  <input
                    value={form.postalCode}
                    onChange={(event) => updateAddressField({ postalCode: event.target.value })}
                    required
                  />
                </label>
                <label className={styles.field}>
                  <span>Country</span>
                  <input
                    value={form.country}
                    onChange={(event) => updateAddressField({ country: event.target.value })}
                    required
                  />
                </label>
              </div>
            </section>

            <section className={styles.card}>
              <h2>Invoice contact</h2>
              <p className={styles.sectionHint}>Who should receive invoices and portal access?</p>
              {contactOptions.length > 0 ? (
                <div className={styles.choiceRow}>
                  <label className={styles.choiceOption}>
                    <input
                      type="radio"
                      name="invoiceContactMode"
                      checked={form.invoiceMode === "existing"}
                      onChange={() => updateForm({ invoiceMode: "existing" })}
                    />
                    <span>Choose an existing contact</span>
                  </label>
                  <label className={styles.choiceOption}>
                    <input
                      type="radio"
                      name="invoiceContactMode"
                      checked={form.invoiceMode === "new"}
                      onChange={() => updateForm({ invoiceMode: "new" })}
                    />
                    <span>Add a new contact</span>
                  </label>
                </div>
              ) : null}

              {form.invoiceMode === "existing" && contactOptions.length > 0 ? (
                <label className={styles.field}>
                  <span>Available contacts</span>
                  <SearchableSelect
                    value={form.invoiceContactId ? String(form.invoiceContactId) : ""}
                    options={contactSelectOptions}
                    placeholder="Search contacts"
                    onChange={(nextValue) =>
                      updateForm({
                        invoiceContactId: nextValue ? Number(nextValue) : null,
                      })
                    }
                  />
                </label>
              ) : (
                <div className={styles.fieldGrid}>
                  <label className={styles.field}>
                    <span>Contact name</span>
                    <input
                      value={form.invoiceNewName}
                      onChange={(event) => updateForm({ invoiceNewName: event.target.value })}
                      required
                    />
                  </label>
                  <label className={styles.field}>
                    <span>Email</span>
                    <input
                      type="email"
                      value={form.invoiceNewEmail}
                      onChange={(event) => updateForm({ invoiceNewEmail: event.target.value })}
                      required
                    />
                  </label>
                  <label className={styles.field}>
                    <span>Phone</span>
                    <input
                      value={form.invoiceNewPhone}
                      onChange={(event) => updateForm({ invoiceNewPhone: event.target.value })}
                      required
                    />
                  </label>
                </div>
              )}
            </section>

            <section className={styles.card}>
              <h2>Payment inquiries contact</h2>
              <p className={styles.sectionHint}>
                If a different person handles payment and collection questions.
              </p>
              <label className={styles.checkboxRow}>
                <input
                  type="checkbox"
                  checked={form.collectionsSameAsInvoice}
                  onChange={(event) =>
                    updateForm({ collectionsSameAsInvoice: event.target.checked })
                  }
                />
                Same as invoice contact
              </label>

              {!form.collectionsSameAsInvoice ? (
                <>
                  {contactOptions.length > 0 ? (
                    <div className={styles.choiceRow}>
                      <label className={styles.choiceOption}>
                        <input
                          type="radio"
                          name="collectionsContactMode"
                          checked={form.collectionsMode === "existing"}
                          onChange={() => updateForm({ collectionsMode: "existing" })}
                        />
                        <span>Choose an existing contact</span>
                      </label>
                      <label className={styles.choiceOption}>
                        <input
                          type="radio"
                          name="collectionsContactMode"
                          checked={form.collectionsMode === "new"}
                          onChange={() => updateForm({ collectionsMode: "new" })}
                        />
                        <span>Add a new contact</span>
                      </label>
                    </div>
                  ) : null}

                  {form.collectionsMode === "existing" && contactOptions.length > 0 ? (
                    <label className={styles.field}>
                        <span>Available contacts</span>
                        <SearchableSelect
                          value={form.collectionsContactId ? String(form.collectionsContactId) : ""}
                          options={contactSelectOptions}
                          placeholder="Search contacts"
                          onChange={(nextValue) =>
                            updateForm({
                              collectionsContactId: nextValue ? Number(nextValue) : null,
                            })
                          }
                        />
                      </label>
                  ) : (
                    <div className={styles.fieldGrid}>
                      <label className={styles.field}>
                        <span>Contact name</span>
                        <input
                          value={form.collectionsNewName}
                          onChange={(event) =>
                            updateForm({ collectionsNewName: event.target.value })
                          }
                          required
                        />
                      </label>
                      <label className={styles.field}>
                        <span>Email</span>
                        <input
                          type="email"
                          value={form.collectionsNewEmail}
                          onChange={(event) =>
                            updateForm({ collectionsNewEmail: event.target.value })
                          }
                          required
                        />
                      </label>
                      <label className={styles.field}>
                        <span>Phone</span>
                        <input
                          value={form.collectionsNewPhone}
                          onChange={(event) =>
                            updateForm({ collectionsNewPhone: event.target.value })
                          }
                          required
                        />
                      </label>
                    </div>
                  )}
                </>
              ) : null}
            </section>

            <section className={styles.card}>
              <h2>Payment terms</h2>
              {pendingData.paymentTermsError ? (
                <p className={styles.helperText}>{pendingData.paymentTermsError}</p>
              ) : null}
              <label className={styles.checkboxRow}>
                <input
                  type="checkbox"
                  checked={form.paymentTermsDifferent}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    const defaultTerm = pendingData.defaultPaymentTermId || form.paymentTermId;
                    const currentTerm = form.paymentTermId;
                    const nextTerm = checked
                      ? currentTerm && currentTerm !== defaultTerm
                        ? currentTerm
                        : ""
                      : defaultTerm;
                    updateForm({
                      paymentTermsDifferent: checked,
                      paymentTermId: nextTerm,
                    });
                  }}
                />
                Different payment terms required
              </label>
              {form.paymentTermsDifferent ? (
                <label className={styles.field}>
                  <span>Preferred terms</span>
                  <SearchableSelect
                    value={form.paymentTermId}
                    options={pendingData.paymentTerms.map((term) => ({
                      value: term.id,
                      label: term.label,
                    }))}
                    placeholder="Search terms"
                    onChange={(nextValue) => updateForm({ paymentTermId: nextValue })}
                  />
                </label>
              ) : (
                <div className={styles.selectedAddressCard}>
                  Default terms: {pendingData.defaultPaymentTermId}
                </div>
              )}
            </section>

            <section className={styles.card}>
              <h2>PO requirements</h2>
              <label className={styles.checkboxRow}>
                <input
                  type="checkbox"
                  checked={form.poRequired}
                  onChange={(event) => updateForm({ poRequired: event.target.checked })}
                />
                Purchase order required for invoicing
              </label>
              {form.poRequired ? (
                <label className={styles.field}>
                  <span>PO process or instructions</span>
                  <textarea
                    rows={4}
                    value={form.poInstructions}
                    onChange={(event) => updateForm({ poInstructions: event.target.value })}
                    required
                  />
                </label>
              ) : null}
            </section>

            <section className={styles.footerCard}>
              {submitError ? <div className={styles.error}>{submitError}</div> : null}
              <button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Submitting..." : "Submit onboarding details"}
              </button>
              <p>By submitting, you confirm the information is accurate and authorized.</p>
            </section>
          </form>
        ) : null}
      </div>
    </div>
  );
}
