import {
  readWrappedNumber,
  readWrappedString,
  type RawContact,
} from "@/lib/acumatica";
import {
  serviceCreateActivity,
  serviceCreateContact,
  serviceFetchBusinessAccountById,
  serviceFetchContactById,
  serviceInvokeBusinessAccountAction,
  serviceUpdateBusinessAccount,
  serviceUpdateCustomer,
} from "@/lib/acumatica-service-auth";
import { resolveBusinessAccountRecordId } from "@/lib/business-accounts";
import { getEnv } from "@/lib/env";
import { HttpError } from "@/lib/errors";
import { sendPaymentTermsOverrideEmail } from "@/lib/onboarding-mailer";
import {
  acceptOnboardingSubmission,
  type OnboardingRequestRecord,
} from "@/lib/onboarding-store";
import type { OnboardingFormPayload } from "@/types/onboarding";

type ResolvedContact = {
  contactId: number;
  name: string;
  email: string;
};

async function runOnboardingStep<T>(
  label: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof HttpError) {
      throw new HttpError(error.status, `${label}: ${error.message}`, error.details);
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label}: ${message}`);
  }
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

function splitContactName(value: string): { firstName: string; lastName: string } {
  const parts = value.trim().split(/\s+/);
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: "" };
  }
  const lastName = parts.pop() ?? "";
  return { firstName: parts.join(" "), lastName };
}

async function resolveExistingContact(contactId: number): Promise<ResolvedContact> {
  const contact = await serviceFetchContactById(null, contactId);
  const name = readContactName(contact) ?? `Contact ${contactId}`;
  const email = readContactEmail(contact) ?? "";
  return {
    contactId,
    name,
    email,
  };
}

async function createNewContact(
  businessAccountId: string,
  name: string,
  email: string,
  phone: string,
): Promise<ResolvedContact> {
  const { firstName, lastName } = splitContactName(name);
  const payload = {
    BusinessAccount: { value: businessAccountId },
    DisplayName: { value: name },
    FirstName: { value: firstName },
    LastName: { value: lastName },
    Email: { value: email },
    Phone1: { value: phone },
    Phone1Type: { value: "Business 1" },
  };

  const created = (await serviceCreateContact(null, payload)) as RawContact;
  const contactId = readWrappedNumber(created, "ContactID");
  if (!contactId) {
    throw new HttpError(502, "Acumatica did not return a contact ID.");
  }

  return {
    contactId,
    name,
    email,
  };
}

async function resolveContactSelection(
  selection: OnboardingFormPayload["invoiceContact"],
  businessAccountId: string,
): Promise<ResolvedContact> {
  if (selection.mode === "existing") {
    return resolveExistingContact(selection.contactId);
  }

  return createNewContact(
    businessAccountId,
    selection.name,
    selection.email,
    selection.phone,
  );
}

function buildBusinessAccountUpdatePayload(payload: OnboardingFormPayload): Record<string, unknown> {
  return {
    Name: { value: payload.billingName },
    MainAddress: {
      AddressLine1: { value: payload.billingAddress.line1 },
      AddressLine2: { value: payload.billingAddress.line2 },
      City: { value: payload.billingAddress.city },
      State: { value: payload.billingAddress.state },
      PostalCode: { value: payload.billingAddress.postalCode },
      Country: { value: payload.billingAddress.country },
    },
  };
}

function isRecoverableActionError(error: unknown): boolean {
  if (!(error instanceof HttpError)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    [400, 404, 405, 500].includes(error.status) &&
    (message.includes("not found") ||
      message.includes("does not exist") ||
      message.includes("invalid"))
  );
}

async function convertBusinessAccountToCustomer(businessAccountId: string): Promise<void> {
  const actionCandidates = [
    "ConvertBusinessAccountToCustomer",
    "convertBusinessAccountToCustomer",
  ];

  let lastError: unknown = null;
  for (const actionName of actionCandidates) {
    try {
      await serviceInvokeBusinessAccountAction(
        null,
        actionName,
        {
          BusinessAccountID: { value: businessAccountId },
        },
        {},
      );
      return;
    } catch (error) {
      if (!isRecoverableActionError(error)) {
        throw error;
      }
      lastError = error;
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
}

function shouldRetryFieldError(error: unknown, fieldName: string): boolean {
  if (!(error instanceof HttpError)) {
    return false;
  }

  const normalized = error.message.toLowerCase();
  return (
    [400, 404, 500].includes(error.status) &&
    normalized.includes(fieldName.toLowerCase()) &&
    (normalized.includes("not found") ||
      normalized.includes("endpoint") ||
      normalized.includes("does not exist"))
  );
}

async function updateCustomerWithFallbacks(input: {
  customerId: string;
  primaryContactId: number | null;
  paymentTermId: string;
  poRequired: boolean;
  note: string | null;
}): Promise<void> {
  const env = getEnv();
  const termFieldCandidates = [
    env.ONBOARDING_CUSTOMER_TERMS_FIELD,
    "CreditTermsID",
    "TermsID",
    "Terms",
    "TermID",
  ].filter(Boolean) as string[];
  const uniqueTermFields = [...new Set(termFieldCandidates)];

  const poField = env.ONBOARDING_CUSTOMER_PO_REQUIRED_FIELD;
  const noteValue = input.note?.trim() || null;
  let includeNote = Boolean(noteValue);

  const basePayload: Record<string, unknown> = {
    CustomerID: { value: input.customerId },
  };

  if (input.primaryContactId) {
    basePayload.PrimaryContactID = { value: input.primaryContactId };
  }

  const buildNotePayload = (): Record<string, unknown> =>
    includeNote && noteValue ? { note: { value: noteValue } } : {};

  let lastError: unknown = null;

  for (const termField of uniqueTermFields) {
    const directPayload = {
      ...basePayload,
      ...buildNotePayload(),
      [termField]: { value: input.paymentTermId },
      [poField]: { value: input.poRequired },
    };

    try {
      await serviceUpdateCustomer(null, directPayload);
      return;
    } catch (error) {
      lastError = error;
      if (includeNote && shouldRetryFieldError(error, "note")) {
        includeNote = false;
        continue;
      }
      if (shouldRetryFieldError(error, termField) || shouldRetryFieldError(error, poField)) {
        // retry below
      } else {
        throw error;
      }
    }

    const customPayload = {
      ...basePayload,
      ...buildNotePayload(),
      [termField]: { value: input.paymentTermId },
      custom: {
        [poField]: { value: input.poRequired },
      },
    };

    try {
      await serviceUpdateCustomer(null, customPayload);
      return;
    } catch (error) {
      lastError = error;
      if (includeNote && shouldRetryFieldError(error, "note")) {
        includeNote = false;
        continue;
      }
      if (shouldRetryFieldError(error, termField) || shouldRetryFieldError(error, poField)) {
        continue;
      }
      throw error;
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildOnboardingNoteText(input: {
  invoiceContact: ResolvedContact;
  collectionsContact: ResolvedContact;
  poRequired: boolean;
  poInstructions: string | null;
  paymentTermId: string;
  paymentTermsDifferent: boolean;
  submittedAt: string;
}): string {
  const instructions = input.poInstructions?.trim();
  const lines = [
    "Customer onboarding",
    `PO Required: ${input.poRequired ? "Yes" : "No"}`,
    instructions ? `PO Process: ${instructions}` : null,
    `Payment Terms: ${input.paymentTermId}`,
    `Payment terms override requested: ${input.paymentTermsDifferent ? "Yes" : "No"}`,
    `Invoice/Portal Contact: ${input.invoiceContact.name} | ${input.invoiceContact.email}`,
    `Payment inquiries contact: ${input.collectionsContact.name} | ${input.collectionsContact.email}`,
    `Submitted On: ${input.submittedAt}`,
  ];

  return lines.filter(Boolean).join("\n");
}

function buildOnboardingNoteHtml(input: {
  invoiceContact: ResolvedContact;
  collectionsContact: ResolvedContact;
  poRequired: boolean;
  poInstructions: string | null;
  paymentTermId: string;
  paymentTermsDifferent: boolean;
  submittedAt: string;
}): string {
  const poLine = input.poRequired ? "PO required: Yes" : "PO required: No";
  const overrideLine = input.paymentTermsDifferent
    ? "Payment terms override requested: Yes"
    : "Payment terms override requested: No";
  const instructions = input.poInstructions?.trim();

  const lines = [
    "<strong>Customer onboarding submission</strong>",
    `<p>${escapeHtml(poLine)}</p>`,
    instructions ? `<p>PO process: ${escapeHtml(instructions)}</p>` : "",
    `<p>Payment terms: ${escapeHtml(input.paymentTermId)}</p>`,
    `<p>${escapeHtml(overrideLine)}</p>`,
    `<p>Invoice/portal contact: ${escapeHtml(input.invoiceContact.name)} (${escapeHtml(
      input.invoiceContact.email,
    )})</p>`,
    `<p>Payment inquiries contact: ${escapeHtml(input.collectionsContact.name)} (${escapeHtml(
      input.collectionsContact.email,
    )})</p>`,
    `<p>Submitted on: ${escapeHtml(input.submittedAt)}</p>`,
  ];

  return lines.filter(Boolean).join("");
}

export async function finalizeOnboardingRequestRecord(
  request: OnboardingRequestRecord,
  payload: OnboardingFormPayload,
): Promise<{
  status: "converted";
  conversion: Record<string, unknown>;
}> {
  const submittedAt = request.submittedAt ?? new Date().toISOString();
  const account = await runOnboardingStep("fetch_business_account", () =>
    serviceFetchBusinessAccountById(null, request.businessAccountId),
  );
  const businessAccountRecordId = resolveBusinessAccountRecordId(
    account,
    request.businessAccountRecordId,
  );
  const accountType =
    readNullableWrappedString(account, "Type") ||
    readNullableWrappedString(account, "TypeDescription") ||
    "";

  await runOnboardingStep("update_business_account", () =>
    serviceUpdateBusinessAccount(
      null,
      [request.businessAccountId, businessAccountRecordId],
      buildBusinessAccountUpdatePayload(payload),
    ),
  );

  const invoiceContact = await runOnboardingStep("resolve_invoice_contact", () =>
    resolveContactSelection(
      payload.invoiceContact,
      request.businessAccountId,
    ),
  );

  const collectionsContact =
    payload.collectionsContact.sameAsInvoice || !payload.collectionsContact.selection
      ? invoiceContact
      : await runOnboardingStep("resolve_payment_inquiries_contact", async () => {
          const selection = payload.collectionsContact.selection;
          if (!selection) {
            throw new HttpError(400, "Payment inquiries contact selection is required.");
          }

          return resolveContactSelection(selection, request.businessAccountId);
        });

  if (accountType.trim().toLowerCase() !== "customer") {
    await runOnboardingStep("convert_business_account_to_customer", () =>
      convertBusinessAccountToCustomer(request.businessAccountId),
    );
  }

  await runOnboardingStep("update_customer", () =>
    updateCustomerWithFallbacks({
      customerId: request.businessAccountId,
      primaryContactId: invoiceContact.contactId,
      paymentTermId: payload.paymentTermId,
      poRequired: payload.poRequired,
      note: buildOnboardingNoteText({
        invoiceContact,
        collectionsContact,
        poRequired: payload.poRequired,
        poInstructions: payload.poInstructions ?? null,
        paymentTermId: payload.paymentTermId,
        paymentTermsDifferent: payload.paymentTermsDifferent,
        submittedAt,
      }),
    }),
  );

  await runOnboardingStep("create_activity", () =>
    serviceCreateActivity(null, {
      summary: "Customer onboarding submission",
      bodyHtml: buildOnboardingNoteHtml({
        invoiceContact,
        collectionsContact,
        poRequired: payload.poRequired,
        poInstructions: payload.poInstructions ?? null,
        paymentTermId: payload.paymentTermId,
        paymentTermsDifferent: payload.paymentTermsDifferent,
        submittedAt,
      }),
      relatedEntityNoteId: businessAccountRecordId,
      relatedEntityType: "Customer",
      type: "N",
      status: "Completed",
    }),
  );

  if (payload.paymentTermsDifferent) {
    const env = getEnv();
    const companyName = readNullableWrappedString(account, "Name");
    try {
      await sendPaymentTermsOverrideEmail({
        companyName,
        businessAccountId: request.businessAccountId,
        opportunityId: request.opportunityId || null,
        defaultTermsId: env.ONBOARDING_DEFAULT_TERMS_ID,
        requestedTermsId: payload.paymentTermId,
        invoiceContact: {
          name: invoiceContact.name,
          email: invoiceContact.email,
        },
        paymentContact: {
          name: collectionsContact.name,
          email: collectionsContact.email,
        },
      });
    } catch (notifyError) {
      console.error("Failed to notify AR about payment terms override.", notifyError);
    }
  }

  return {
    status: "converted",
    conversion: {
      convertedAt: new Date().toISOString(),
      invoiceContactId: invoiceContact.contactId,
      collectionsContactId: collectionsContact.contactId,
    },
  };
}

export async function submitOnboardingRequest(
  token: string,
  payload: OnboardingFormPayload,
): Promise<{ status: string }> {
  const submission = await acceptOnboardingSubmission(token, payload);
  return { status: submission.record.status };
}
