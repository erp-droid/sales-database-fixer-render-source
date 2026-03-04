import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { requireAuthCookieValue, setAuthCookie } from "@/lib/auth";
import {
  fetchBusinessAccountById,
  fetchBusinessAccounts,
  fetchBusinessAccountsByBusinessAccountIds,
  fetchContactById,
  fetchContacts,
} from "@/lib/acumatica";
import { HttpError, getErrorMessage } from "@/lib/errors";
import {
  normalizeBusinessAccount,
  normalizeBusinessAccountRows,
  queryBusinessAccounts,
} from "@/lib/business-accounts";
import type { BusinessAccountRow } from "@/types/business-account";
import { parseListQuery } from "@/lib/validation";

type AuthCookieRefresh = {
  value: string | null;
};

type RawRecord = Record<string, unknown>;

function readArrayField(record: unknown, key: string): unknown[] {
  if (!record || typeof record !== "object") {
    return [];
  }

  const field = (record as RawRecord)[key];
  if (Array.isArray(field)) {
    return field;
  }

  if (!field || typeof field !== "object") {
    return [];
  }

  const wrappedValue = (field as RawRecord).value;
  if (Array.isArray(wrappedValue)) {
    return wrappedValue;
  }

  const wrappedItems = (field as RawRecord).Items;
  if (Array.isArray(wrappedItems)) {
    return wrappedItems;
  }

  return [];
}

function readWrappedString(record: unknown, key: string): string | null {
  if (!record || typeof record !== "object") {
    return null;
  }

  const field = (record as RawRecord)[key];
  if (!field || typeof field !== "object") {
    return null;
  }

  const value = (field as RawRecord).value;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readContactDisplayName(record: unknown): string | null {
  const explicit = [
    "DisplayName",
    "FullName",
    "ContactName",
    "Attention",
  ]
    .map((key) => readWrappedString(record, key))
    .find((value) => Boolean(value));
  if (explicit) {
    return explicit;
  }

  const first = readWrappedString(record, "FirstName");
  const middle = readWrappedString(record, "MiddleName");
  const last = readWrappedString(record, "LastName");
  const full = [first, middle, last].filter(Boolean).join(" ").trim();
  return full || null;
}

function readContactEmail(record: unknown): string | null {
  const email = readWrappedString(record, "Email") ?? readWrappedString(record, "EMail");
  return email && email.trim() ? email.trim() : null;
}

function readWrappedNumber(record: unknown, key: string): number | null {
  if (!record || typeof record !== "object") {
    return null;
  }

  const field = (record as RawRecord)[key];
  if (!field || typeof field !== "object") {
    return null;
  }

  const value = (field as RawRecord).value;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function readRecordIdentity(record: unknown): string | null {
  if (!record || typeof record !== "object") {
    return null;
  }

  const id = (record as RawRecord).id;
  if (typeof id === "string" && id.trim()) {
    return id.trim();
  }

  return readWrappedString(record, "NoteID");
}

function readPrimaryContactDetailsFromAccountPayload(account: unknown): {
  name: string | null;
  email: string | null;
} {
  if (!account || typeof account !== "object") {
    return {
      name: null,
      email: null,
    };
  }

  const accountRecord = account as RawRecord;
  const primaryContact = accountRecord.PrimaryContact;
  const primaryName = readContactDisplayName(primaryContact);
  const primaryEmail = readContactEmail(primaryContact);
  if (primaryName || primaryEmail) {
    return {
      name: primaryName,
      email: primaryEmail,
    };
  }

  const primaryContactId = readWrappedNumber(primaryContact, "ContactID");
  const contacts = readArrayField(accountRecord, "Contacts");
  if (contacts.length === 0) {
    return {
      name: null,
      email: null,
    };
  }

  const matchingContact =
    primaryContactId !== null
      ? contacts.find((contact) => readWrappedNumber(contact, "ContactID") === primaryContactId)
      : null;
  const fallbackContact = matchingContact ?? contacts[0];
  return {
    name: readContactDisplayName(fallbackContact),
    email: readContactEmail(fallbackContact),
  };
}

function normalizeComparable(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  return value.trim().toLowerCase();
}

function hasText(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function pickFirstText(values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (hasText(value)) {
      return value;
    }
  }

  return null;
}

function readBusinessAccountCode(record: unknown): string | null {
  return (
    readWrappedString(record, "BusinessAccountID") ??
    readWrappedString(record, "BAccountID") ??
    readWrappedString(record, "AccountCD")
  );
}

function readContactPhone(record: unknown): string | null {
  return (
    readWrappedString(record, "Phone1") ??
    readWrappedString(record, "Phone2") ??
    readWrappedString(record, "Phone3")
  );
}

function buildFallbackRowFromContact(contact: unknown, index: number): BusinessAccountRow {
  const contactId = readWrappedNumber(contact, "ContactID");
  const contactRecordId = readRecordIdentity(contact) ?? `contact-${contactId ?? index}`;
  const contactName = readContactDisplayName(contact);
  const contactEmail = readContactEmail(contact);
  const contactPhone = readContactPhone(contact);
  const companyName =
    pickFirstText([
      readWrappedString(contact, "CompanyName"),
      readWrappedString(contact, "BusinessAccount"),
      contactName,
    ]) ?? "Unknown company";

  return {
    id: contactRecordId,
    accountRecordId: contactRecordId,
    rowKey: `${contactRecordId}:contact:${contactId ?? index}`,
    contactId,
    isPrimaryContact: false,
    phoneNumber: contactPhone,
    salesRepId: null,
    salesRepName: null,
    industryType: null,
    subCategory: null,
    companyRegion: null,
    week: null,
    businessAccountId: readWrappedString(contact, "BusinessAccount") ?? "",
    companyName,
    address: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    state: "",
    postalCode: "",
    country: "",
    primaryContactName: contactName,
    primaryContactPhone: contactPhone,
    primaryContactEmail: contactEmail,
    primaryContactId: contactId,
    category: null,
    notes: readWrappedString(contact, "note"),
    lastModifiedIso: readWrappedString(contact, "LastModifiedDateTime"),
  };
}

function buildSyncRowsFromContacts(
  rawContacts: unknown[],
  rawAccounts: unknown[],
): BusinessAccountRow[] {
  const accountByBusinessId = new Map<string, unknown>();
  rawAccounts.forEach((account) => {
    const businessId = readBusinessAccountCode(account);
    if (businessId) {
      accountByBusinessId.set(businessId, account);
    }
  });

  const rows: BusinessAccountRow[] = rawContacts.map((contact, index) => {
    const businessAccountCode = readWrappedString(contact, "BusinessAccount");
    const rawAccount = businessAccountCode
      ? accountByBusinessId.get(businessAccountCode)
      : undefined;

    const base = rawAccount
      ? normalizeBusinessAccount(rawAccount)
      : buildFallbackRowFromContact(contact, index);

    const primaryRaw =
      rawAccount && typeof rawAccount === "object"
        ? (rawAccount as RawRecord).PrimaryContact
        : undefined;
    const primaryContactId = readWrappedNumber(primaryRaw, "ContactID") ?? base.primaryContactId;
    const primaryContactName = readContactDisplayName(primaryRaw) ?? base.primaryContactName;
    const primaryContactEmail = readContactEmail(primaryRaw) ?? base.primaryContactEmail;
    const primaryRecordId = readRecordIdentity(primaryRaw);

    const contactId = readWrappedNumber(contact, "ContactID");
    const contactName = readContactDisplayName(contact);
    const contactPhone = readContactPhone(contact);
    const contactEmail = readContactEmail(contact);
    const contactNotes = readWrappedString(contact, "note");
    const contactRecordId = readRecordIdentity(contact);
    const isPrimaryById =
      primaryContactId !== null &&
      contactId !== null &&
      primaryContactId === contactId;
    const isPrimaryByRecordId =
      !isPrimaryById &&
      hasText(primaryRecordId) &&
      hasText(contactRecordId) &&
      normalizeComparable(primaryRecordId) === normalizeComparable(contactRecordId);
    const isPrimaryByEmail =
      !isPrimaryById &&
      !isPrimaryByRecordId &&
      hasText(primaryContactEmail) &&
      hasText(contactEmail) &&
      normalizeComparable(primaryContactEmail) === normalizeComparable(contactEmail);
    const isPrimaryByName =
      !isPrimaryById &&
      !isPrimaryByRecordId &&
      !isPrimaryByEmail &&
      hasText(primaryContactName) &&
      hasText(contactName) &&
      normalizeComparable(primaryContactName) === normalizeComparable(contactName);
    const isPrimaryContact =
      isPrimaryById || isPrimaryByRecordId || isPrimaryByEmail || isPrimaryByName;

    return {
      ...base,
      rowKey: `${base.accountRecordId ?? base.id}:contact:${contactId ?? index}`,
      accountRecordId: base.accountRecordId ?? base.id,
      businessAccountId: businessAccountCode ?? base.businessAccountId,
      companyName:
        pickFirstText([
          base.companyName,
          readWrappedString(contact, "CompanyName"),
          businessAccountCode,
          contactName,
        ]) ?? "Unknown company",
      contactId,
      isPrimaryContact,
      primaryContactName: pickFirstText([
        contactName,
        isPrimaryContact ? base.primaryContactName : null,
      ]),
      primaryContactPhone: pickFirstText([
        contactPhone,
        isPrimaryContact ? base.primaryContactPhone : null,
      ]),
      primaryContactEmail: pickFirstText([
        contactEmail,
        isPrimaryContact ? base.primaryContactEmail : null,
      ]),
      notes: pickFirstText([contactNotes, isPrimaryContact ? base.notes : null]),
      phoneNumber: pickFirstText([base.phoneNumber, contactPhone, base.primaryContactPhone]),
    };
  });

  return rows.filter(
    (row) =>
      Boolean(
        row.id ||
          row.accountRecordId ||
          row.businessAccountId ||
          row.companyName ||
          row.primaryContactName,
      ),
  );
}

function needsPrimaryContactNameResolution(row: BusinessAccountRow): boolean {
  if (!hasText(row.primaryContactName)) {
    return true;
  }

  return normalizeComparable(row.primaryContactName) === normalizeComparable(row.companyName);
}

function needsPrimaryContactEmailResolution(row: BusinessAccountRow): boolean {
  return !hasText(row.primaryContactEmail);
}

function shouldResolvePrimaryContactName(row: BusinessAccountRow): boolean {
  if (row.isPrimaryContact === false) {
    return false;
  }

  return needsPrimaryContactNameResolution(row) || needsPrimaryContactEmailResolution(row);
}

async function runWithConcurrency<T>(
  values: T[],
  limit: number,
  worker: (value: T) => Promise<void>,
): Promise<void> {
  if (values.length === 0) {
    return;
  }

  const concurrency = Math.max(1, Math.trunc(limit));
  let nextIndex = 0;

  async function consume(): Promise<void> {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      await worker(values[currentIndex]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => consume()),
  );
}

async function enrichPagePrimaryContacts(
  cookieValue: string,
  rows: BusinessAccountRow[],
  authCookieRefresh: AuthCookieRefresh,
): Promise<BusinessAccountRow[]> {
  const targets = rows.filter((row) => shouldResolvePrimaryContactName(row));
  if (targets.length === 0) {
    return rows;
  }

  const contactLookup = new Map<number, { name: string | null; email: string | null }>();
  const accountLookup = new Map<string, { name: string | null; email: string | null }>();

  await runWithConcurrency(targets, 8, async (row) => {
    const contactId = row.contactId ?? row.primaryContactId;
    if (contactId === null || contactLookup.has(contactId)) {
      return;
    }

    try {
      const contact = await fetchContactById(
        cookieValue,
        contactId,
        authCookieRefresh,
      );
      contactLookup.set(contactId, {
        name: readContactDisplayName(contact),
        email: readContactEmail(contact),
      });
    } catch {
      contactLookup.set(contactId, {
        name: null,
        email: null,
      });
    }
  });

  await runWithConcurrency(targets, 6, async (row) => {
    const accountId = row.accountRecordId ?? row.id;
    if (!accountId || accountLookup.has(accountId)) {
      return;
    }

    const contactId = row.contactId ?? row.primaryContactId;
    const resolvedFromContact = contactId !== null ? contactLookup.get(contactId) : undefined;
    const shouldFetchAccountForName =
      needsPrimaryContactNameResolution(row) && !hasText(resolvedFromContact?.name);
    const shouldFetchAccountForEmail =
      needsPrimaryContactEmailResolution(row) && !hasText(resolvedFromContact?.email);
    if (!shouldFetchAccountForName && !shouldFetchAccountForEmail) {
      return;
    }

    try {
      const account = await fetchBusinessAccountById(
        cookieValue,
        accountId,
        authCookieRefresh,
      );
      accountLookup.set(
        accountId,
        readPrimaryContactDetailsFromAccountPayload(account),
      );
    } catch {
      accountLookup.set(accountId, {
        name: null,
        email: null,
      });
    }
  });

  return rows.map((row) => {
    if (!shouldResolvePrimaryContactName(row)) {
      return row;
    }

    const contactId = row.contactId ?? row.primaryContactId;
    const resolvedFromContact = contactId !== null ? contactLookup.get(contactId) : undefined;
    const accountId = row.accountRecordId ?? row.id;
    const resolvedFromAccount = accountId ? accountLookup.get(accountId) : undefined;
    const resolvedName = resolvedFromContact?.name ?? resolvedFromAccount?.name ?? null;
    const resolvedEmail = resolvedFromContact?.email ?? resolvedFromAccount?.email ?? null;

    const currentName = row.primaryContactName;
    const shouldReplaceName = needsPrimaryContactNameResolution(row);
    const nextName = shouldReplaceName && hasText(resolvedName)
      ? resolvedName
      : currentName;
    const nextEmail =
      hasText(row.primaryContactEmail)
        ? row.primaryContactEmail
        : hasText(resolvedEmail)
          ? resolvedEmail
          : row.primaryContactEmail;

    if (nextName === row.primaryContactName && nextEmail === row.primaryContactEmail) {
      return row;
    }

    return {
      ...row,
      primaryContactName: nextName,
      primaryContactEmail: nextEmail,
    };
  });
}

async function queryAccountsWithCookie(
  cookieValue: string,
  params: ReturnType<typeof parseListQuery>,
  authCookieRefresh: AuthCookieRefresh,
  options?: {
    full?: boolean;
  },
) {
  const isFullDatasetRequest = Boolean(options?.full);
  const rawAccounts = await fetchBusinessAccounts(
    cookieValue,
    {
      batchSize: isFullDatasetRequest ? 300 : 180,
      ensureMainAddress: true,
      ensurePrimaryContact: true,
      ensureAttributes: true,
      ensureContacts: true,
    },
    authCookieRefresh,
  );

  const normalizedRows = rawAccounts
    .flatMap((item) => normalizeBusinessAccountRows(item))
    .filter((item) => Boolean(item.id || item.businessAccountId || item.companyName));
  const queried = queryBusinessAccounts(normalizedRows, {
    ...params,
    page: isFullDatasetRequest ? 1 : params.page,
    pageSize: isFullDatasetRequest
      ? Math.max(1, normalizedRows.length)
      : params.pageSize,
  });

  if (isFullDatasetRequest) {
    return queried;
  }

  const activeCookie = authCookieRefresh.value ?? cookieValue;
  const enrichedItems = await enrichPagePrimaryContacts(
    activeCookie,
    queried.items,
    authCookieRefresh,
  );

  return {
    ...queried,
    items: enrichedItems,
  };
}

async function querySyncBatchWithCookie(
  cookieValue: string,
  params: ReturnType<typeof parseListQuery>,
  authCookieRefresh: AuthCookieRefresh,
) {
  const page = Math.max(1, params.page);
  const pageSize = Math.max(1, params.pageSize);
  const skip = (page - 1) * pageSize;

  const rawContacts = await fetchContacts(
    cookieValue,
    {
      batchSize: pageSize,
      maxRecords: pageSize,
      initialSkip: skip,
    },
    authCookieRefresh,
  );

  const businessAccountIds = rawContacts
    .map((contact) => readWrappedString(contact, "BusinessAccount"))
    .filter((id): id is string => Boolean(id));

  const rawAccounts = await fetchBusinessAccountsByBusinessAccountIds(
    cookieValue,
    businessAccountIds,
    authCookieRefresh,
  );

  const normalizedRows = buildSyncRowsFromContacts(rawContacts, rawAccounts);
  const queried = queryBusinessAccounts(normalizedRows, {
    ...params,
    page: 1,
    pageSize: Math.max(1, normalizedRows.length),
  });
  const hasMore = rawContacts.length === pageSize;
  const estimatedTotal = hasMore
    ? skip + rawContacts.length + pageSize
    : skip + rawContacts.length;

  return {
    items: queried.items,
    total: estimatedTotal,
    page,
    pageSize,
    hasMore,
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authCookieRefresh: AuthCookieRefresh = { value: null };
  let cookieValue: string | null = null;
  let params: ReturnType<typeof parseListQuery> | null = null;
  const fullDataset =
    request.nextUrl.searchParams.get("full") === "1" ||
    request.nextUrl.searchParams.get("full") === "true";
  const syncBatch =
    request.nextUrl.searchParams.get("sync") === "1" ||
    request.nextUrl.searchParams.get("sync") === "true";

  try {
    cookieValue = requireAuthCookieValue(request);
    params = parseListQuery(request.nextUrl.searchParams);
    const result = syncBatch
      ? await querySyncBatchWithCookie(cookieValue, params, authCookieRefresh)
      : await queryAccountsWithCookie(
          cookieValue,
          params,
          authCookieRefresh,
          { full: fullDataset },
        );

    const response = NextResponse.json(result);
    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }

    return response;
  } catch (requestError) {
    let error = requestError;

    if (
      error instanceof HttpError &&
      error.status === 401 &&
      cookieValue &&
      params
    ) {
      const retryAuthCookieRefresh: AuthCookieRefresh = { value: null };
      const retryCookieValue = authCookieRefresh.value ?? cookieValue;
      try {
        const retryResult = syncBatch
          ? await querySyncBatchWithCookie(
              retryCookieValue,
              params,
              retryAuthCookieRefresh,
            )
          : await queryAccountsWithCookie(
              retryCookieValue,
              params,
              retryAuthCookieRefresh,
              { full: fullDataset },
            );

        const response = NextResponse.json(retryResult);
        if (retryAuthCookieRefresh.value) {
          setAuthCookie(response, retryAuthCookieRefresh.value);
        } else if (authCookieRefresh.value) {
          setAuthCookie(response, authCookieRefresh.value);
        }
        return response;
      } catch (retryError) {
        error = retryError;
        if (retryAuthCookieRefresh.value) {
          authCookieRefresh.value = retryAuthCookieRefresh.value;
        }
      }
    }

    let response: NextResponse;
    if (error instanceof ZodError) {
      response = NextResponse.json(
        {
          error: "Invalid query parameters",
          details: error.flatten(),
        },
        { status: 400 },
      );
    } else if (error instanceof HttpError) {
      response = NextResponse.json(
        {
          error: error.message,
          details: error.details,
        },
        { status: error.status },
      );
    } else {
      response = NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }

    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }

    return response;
  }
}
