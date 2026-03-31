import {
  readWrappedNumber,
  readWrappedString,
  type RawPaymentTerm,
} from "@/lib/acumatica";
import {
  serviceFetchBusinessAccountById,
  serviceFetchPaymentTerms,
} from "@/lib/acumatica-service-auth";
import { getEnv } from "@/lib/env";
import { HttpError } from "@/lib/errors";
import type {
  OnboardingAddress,
  OnboardingContactOption,
  OnboardingPendingRequestResponse,
  OnboardingPaymentTermOption,
} from "@/types/onboarding";
import type { OnboardingRequestRecord } from "@/lib/onboarding-store";

type RawRecord = Record<string, unknown>;

function isRecord(value: unknown): value is RawRecord {
  return Boolean(value) && typeof value === "object";
}

function readNullableWrappedString(record: unknown, key: string): string | null {
  const value = readWrappedString(record, key);
  return value ? value : null;
}

function readContactName(record: unknown): string | null {
  const display =
    readNullableWrappedString(record, "DisplayName") ||
    readNullableWrappedString(record, "ContactName") ||
    readNullableWrappedString(record, "FullName");
  if (display) {
    return display;
  }

  const first = readNullableWrappedString(record, "FirstName");
  const last = readNullableWrappedString(record, "LastName");
  const combined = [first, last].filter(Boolean).join(" ").trim();
  return combined || null;
}

function readContactEmail(record: unknown): string | null {
  return (
    readNullableWrappedString(record, "Email") ||
    readNullableWrappedString(record, "EMail")
  );
}

function readContactPhone(record: unknown): string | null {
  return (
    readNullableWrappedString(record, "Phone1") ||
    readNullableWrappedString(record, "Phone") ||
    readNullableWrappedString(record, "Phone2") ||
    readNullableWrappedString(record, "Phone3")
  );
}

function readAddress(account: RawRecord): OnboardingAddress {
  const mainAddress = isRecord(account.MainAddress) ? account.MainAddress : null;
  return {
    line1: readNullableWrappedString(mainAddress, "AddressLine1") ?? "",
    line2: readNullableWrappedString(mainAddress, "AddressLine2") ?? "",
    city: readNullableWrappedString(mainAddress, "City") ?? "",
    state: readNullableWrappedString(mainAddress, "State") ?? "",
    postalCode: readNullableWrappedString(mainAddress, "PostalCode") ?? "",
    country: readNullableWrappedString(mainAddress, "Country") ?? "",
  };
}

function readPrimaryContactId(account: RawRecord): number | null {
  const primary = isRecord(account.PrimaryContact) ? account.PrimaryContact : null;
  return primary ? readWrappedNumber(primary, "ContactID") : null;
}

function readContacts(account: RawRecord): OnboardingContactOption[] {
  const contactsRaw = Array.isArray(account.Contacts) ? account.Contacts : [];
  const primary = isRecord(account.PrimaryContact) ? account.PrimaryContact : null;
  const combined = primary ? [primary, ...contactsRaw] : contactsRaw;
  const seen = new Set<number>();

  return combined
    .map((contact): OnboardingContactOption | null => {
      if (!isRecord(contact)) {
        return null;
      }

      const id = readWrappedNumber(contact, "ContactID");
      if (!id || seen.has(id)) {
        return null;
      }

      seen.add(id);
      return {
        id,
        name: readContactName(contact) ?? `Contact ${id}`,
        email: readContactEmail(contact),
        phone: readContactPhone(contact),
      };
    })
    .filter((item): item is OnboardingContactOption => Boolean(item));
}

function readPaymentTermId(record: RawPaymentTerm): string | null {
  return (
    readNullableWrappedString(record, "TermID") ||
    readNullableWrappedString(record, "TermsID") ||
    readNullableWrappedString(record, "CreditTermsID") ||
    readNullableWrappedString(record, "Terms") ||
    readNullableWrappedString(record, "TermsID")
  );
}

function normalizePaymentTerms(rows: RawPaymentTerm[]): OnboardingPaymentTermOption[] {
  const options: OnboardingPaymentTermOption[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const id = readPaymentTermId(row);
    if (!id) {
      continue;
    }
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    options.push({ id, label: id });
  }

  return options.sort((a, b) => a.label.localeCompare(b.label));
}

function normalizeTermId(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
}

function resolveDefaultTermId(
  terms: OnboardingPaymentTermOption[],
  configuredDefault: string,
): string {
  if (terms.length === 0) {
    return configuredDefault;
  }

  const exactMatch = terms.find((term) => term.id === configuredDefault);
  if (exactMatch) {
    return exactMatch.id;
  }

  const normalizedDefault = normalizeTermId(configuredDefault);
  const normalizedMatch = terms.find(
    (term) => normalizeTermId(term.id) === normalizedDefault,
  );
  if (normalizedMatch) {
    return normalizedMatch.id;
  }

  const net30Match = terms.find((term) => normalizeTermId(term.id) === "NET30");
  if (net30Match) {
    return net30Match.id;
  }

  return terms[0]?.id ?? configuredDefault;
}

export async function buildOnboardingRequestResponse(
  request: OnboardingRequestRecord,
): Promise<OnboardingPendingRequestResponse> {
  const account = await serviceFetchBusinessAccountById(null, request.businessAccountId);
  if (!isRecord(account)) {
    throw new HttpError(404, "Business account not found.");
  }

  const env = getEnv();
  let paymentTerms: OnboardingPaymentTermOption[] = [];
  let paymentTermsError: string | null = null;

  try {
    const paymentTermRows = await serviceFetchPaymentTerms(null, {
      select: ["TermID", "TermsID", "CreditTermsID", "Terms", "Description"],
    });
    paymentTerms = normalizePaymentTerms(paymentTermRows);
  } catch {
    try {
      const paymentTermRows = await serviceFetchPaymentTerms(null);
      paymentTerms = normalizePaymentTerms(paymentTermRows);
    } catch (fallbackError) {
      const message =
        fallbackError instanceof HttpError ? fallbackError.message : "";
      if (/optimization cannot be performed/i.test(message) || /bql delegate/i.test(message)) {
        paymentTermsError =
          "Acumatica blocked the Credit Terms list due to an optimization error (BQL delegate). Create a simple GI for credit terms or mark the Terms graph as NonOptimizable.";
      } else if (/entity/i.test(message) && /not found/i.test(message)) {
        paymentTermsError =
          "Credit terms are not exposed in the Acumatica endpoint yet. Please add Credit Terms (CS206500) to the lightspeed endpoint.";
      } else {
        paymentTermsError =
          "Payment terms are temporarily unavailable. Please keep the default terms or contact MeadowBrook for changes.";
      }
    }
  }

  if (paymentTerms.length === 0) {
    paymentTerms = [
      {
        id: env.ONBOARDING_DEFAULT_TERMS_ID,
        label: env.ONBOARDING_DEFAULT_TERMS_ID,
      },
    ];
  }
  const defaultPaymentTermId = resolveDefaultTermId(
    paymentTerms,
    env.ONBOARDING_DEFAULT_TERMS_ID,
  );

  return {
    status: "pending",
    token: request.id,
    companyName: readNullableWrappedString(account, "Name"),
    businessAccountId: request.businessAccountId,
    opportunityId: request.opportunityId,
    billingAddress: readAddress(account),
    contacts: readContacts(account),
    defaultInvoiceContactId: readPrimaryContactId(account),
    paymentTerms,
    defaultPaymentTermId,
    paymentTermsError,
  };
}
