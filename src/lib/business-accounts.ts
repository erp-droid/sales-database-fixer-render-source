import {
  CATEGORY_VALUES,
  type BusinessAccountRow,
  type BusinessAccountUpdateRequest,
  type Category,
  type SortBy,
  type SortDir,
} from "@/types/business-account";

type UnknownRecord = Record<string, unknown>;

type QueryOptions = {
  q?: string;
  category?: Category;
  filterCompanyName?: string;
  filterSalesRep?: string;
  filterIndustryType?: string;
  filterSubCategory?: string;
  filterCompanyRegion?: string;
  filterWeek?: string;
  filterAddress?: string;
  filterPrimaryContactName?: string;
  filterPrimaryContactPhone?: string;
  filterPrimaryContactEmail?: string;
  filterCategory?: Category;
  filterLastModified?: string;
  sortBy?: SortBy;
  sortDir?: SortDir;
  page: number;
  pageSize: number;
};

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object";
}

function getField(record: unknown, key: string): unknown {
  if (!isRecord(record)) {
    return undefined;
  }

  return record[key];
}

function readArrayField(record: unknown, key: string): unknown[] {
  const field = getField(record, key);
  if (Array.isArray(field)) {
    return field;
  }

  if (!isRecord(field)) {
    return [];
  }

  const wrappedValue = field.value;
  if (Array.isArray(wrappedValue)) {
    return wrappedValue;
  }

  const wrappedItems = (field as UnknownRecord).Items;
  if (Array.isArray(wrappedItems)) {
    return wrappedItems;
  }

  return [];
}

function readWrappedValue<T>(source: unknown): T | null {
  if (!isRecord(source)) {
    return null;
  }

  if (!("value" in source)) {
    return null;
  }

  const value = source.value;
  if (value === undefined || value === null) {
    return null;
  }

  return value as T;
}

function readString(record: unknown, key: string): string {
  const raw = readWrappedValue<string>(getField(record, key));
  return raw?.trim() ?? "";
}

function readFirstString(record: unknown, keys: string[]): string {
  for (const key of keys) {
    const value = readString(record, key);
    if (value) {
      return value;
    }
  }

  return "";
}

function readNullableString(record: unknown, key: string): string | null {
  const value = readString(record, key);
  return value ? value : null;
}

function readRecordIdentity(record: unknown): string | null {
  if (!isRecord(record)) {
    return null;
  }

  const id = typeof record.id === "string" ? record.id.trim() : "";
  if (id) {
    return id;
  }

  return readNullableString(record, "NoteID");
}

function readNullableNumber(record: unknown, key: string): number | null {
  const wrapped = readWrappedValue<number | string>(getField(record, key));

  if (wrapped == null) {
    return null;
  }

  const numeric = Number(wrapped);
  return Number.isFinite(numeric) ? numeric : null;
}

function toCategory(value: string | null): Category | null {
  if (!value) {
    return null;
  }

  const upper = value.toUpperCase();
  return (CATEGORY_VALUES as readonly string[]).includes(upper)
    ? (upper as Category)
    : null;
}

function formatAddress(parts: {
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}): string {
  const line = [parts.line1, parts.line2].filter(Boolean).join(" ");
  const cityLine = [parts.city, parts.state, parts.postalCode].filter(Boolean).join(" ");
  return [line, cityLine, parts.country].filter(Boolean).join(", ");
}

function composeContactName(record: unknown): string | null {
  const explicit = readFirstString(record, [
    "DisplayName",
    "FullName",
    "ContactName",
    "Attention",
  ]);
  if (explicit) {
    return explicit;
  }

  const first = readString(record, "FirstName");
  const middle = readString(record, "MiddleName");
  const last = readString(record, "LastName");
  const composite = [first, middle, last].filter(Boolean).join(" ").trim();
  return composite || null;
}

function chooseFirst(values: Array<string | null>): string | null {
  for (const value of values) {
    if (value && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function readAccountPhone(record: unknown): string | null {
  const value = readFirstString(record, [
    "Business1",
    "Phone1",
    "BusinessPhone",
    "Phone2",
    "Phone3",
  ]);
  return value || null;
}

function readSalesRepId(record: unknown): string | null {
  return chooseFirst([
    readNullableString(record, "Owner"),
    readNullableString(record, "OwnerID"),
  ]);
}

function readSalesRepName(record: unknown): string | null {
  return chooseFirst([
    readNullableString(record, "OwnerEmployeeName"),
    readNullableString(record, "OwnerName"),
  ]);
}

function normalizePrimaryContact(account: unknown): {
  id: number | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
} {
  const primary = getField(account, "PrimaryContact");
  const primaryContactId = readNullableNumber(primary, "ContactID");
  const primaryContactName = composeContactName(primary);
  const contacts = readArrayField(account, "Contacts");

  const matchingContact =
    primaryContactId !== null
      ? contacts.find(
          (contact) => readNullableNumber(contact, "ContactID") === primaryContactId,
        )
      : primaryContactName
        ? contacts.find((contact) => composeContactName(contact) === primaryContactName)
        : null;

  return {
    id: primaryContactId,
    name: chooseFirst([primaryContactName, composeContactName(matchingContact)]),
    phone: chooseFirst([
      readFirstString(primary, ["Phone1", "Phone2", "Phone3"]),
      readFirstString(matchingContact, ["Phone1", "Phone2", "Phone3"]),
    ]),
    email: chooseFirst([
      readFirstString(primary, ["Email", "EMail"]),
      readFirstString(matchingContact, ["Email", "EMail"]),
    ]),
    notes: chooseFirst([
      readNullableString(primary, "note"),
      readNullableString(matchingContact, "note"),
    ]),
  };
}

function extractCategory(account: unknown): Category | null {
  const attrs = readArrayField(account, "Attributes");
  if (!attrs.length) {
    return null;
  }

  for (const attribute of attrs) {
    const attributeId = readNullableString(attribute, "AttributeID");
    if (attributeId !== "CLIENTTYPE") {
      continue;
    }

    const direct = toCategory(readNullableString(attribute, "Value"));
    if (direct) {
      return direct;
    }

    const description = readNullableString(attribute, "ValueDescription");
    if (!description) {
      return null;
    }

    const match = description.trim().match(/^[A-D]/i);
    return match ? toCategory(match[0].toUpperCase()) : null;
  }

  return null;
}

function extractAttributeValue(account: unknown, attributeId: string): string | null {
  const attrs = readArrayField(account, "Attributes");
  if (!attrs.length) {
    return null;
  }

  for (const attribute of attrs) {
    const currentId = readNullableString(attribute, "AttributeID");
    if (currentId !== attributeId) {
      continue;
    }

    return chooseFirst([
      readNullableString(attribute, "ValueDescription"),
      readNullableString(attribute, "Value"),
    ]);
  }

  return null;
}

function sortValue(row: BusinessAccountRow, sortBy: SortBy): string {
  const value = row[sortBy];
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).toLowerCase();
}

function includesFilter(value: string | null, filter: string | undefined): boolean {
  if (!filter) {
    return true;
  }

  return (value ?? "").toLowerCase().includes(filter.toLowerCase());
}

function includesLastModifiedFilter(
  value: string | null,
  filter: string | undefined,
): boolean {
  if (!filter) {
    return true;
  }

  const raw = (value ?? "").toLowerCase();
  if (raw.includes(filter.toLowerCase())) {
    return true;
  }

  if (!value) {
    return false;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return false;
  }

  const formattedDate = date.toLocaleString().toLowerCase();
  return formattedDate.includes(filter.toLowerCase());
}

export function normalizeBusinessAccount(account: unknown): BusinessAccountRow {
  const mainAddress = getField(account, "MainAddress");

  const addressParts = {
    line1: readString(mainAddress, "AddressLine1"),
    line2: readString(mainAddress, "AddressLine2"),
    city: readString(mainAddress, "City"),
    state: readString(mainAddress, "State"),
    postalCode: readString(mainAddress, "PostalCode"),
    country: readString(mainAddress, "Country"),
  };

  const contact = normalizePrimaryContact(account);

  const id = getField(account, "id");
  const accountNote = readNullableString(account, "note");
  const noteId = readNullableString(account, "NoteID");
  const businessAccountId = readFirstString(account, [
    "BusinessAccountID",
    "BAccountID",
    "AccountCD",
    "AccountID",
    "BusinessAccountCD",
  ]);
  const companyName = readFirstString(account, [
    "Name",
    "CompanyName",
    "AcctName",
    "BusinessAccountName",
  ]);
  const rowId =
    (typeof id === "string" && id) || noteId || businessAccountId || companyName;
  const accountPhone = readAccountPhone(account);
  const salesRepId = readSalesRepId(account);
  const salesRepName = readSalesRepName(account);
  const industryType = extractAttributeValue(account, "INDUSTRY");
  const subCategory = extractAttributeValue(account, "INDSUBCATE");
  const companyRegion = extractAttributeValue(account, "REGION");
  const week = extractAttributeValue(account, "WEEK");

  return {
    id: rowId,
    accountRecordId: rowId,
    rowKey: `${rowId}:primary`,
    contactId: contact.id,
    isPrimaryContact: true,
    phoneNumber: chooseFirst([accountPhone, contact.phone]),
    salesRepId,
    salesRepName,
    industryType,
    subCategory,
    companyRegion,
    week,
    businessAccountId,
    companyName,
    address: formatAddress(addressParts),
    addressLine1: addressParts.line1,
    addressLine2: addressParts.line2,
    city: addressParts.city,
    state: addressParts.state,
    postalCode: addressParts.postalCode,
    country: addressParts.country,
    primaryContactName: contact.name,
    primaryContactPhone: contact.phone,
    primaryContactEmail: contact.email,
    primaryContactId: contact.id,
    category: extractCategory(account),
    notes: contact.notes ?? accountNote,
    lastModifiedIso: readNullableString(account, "LastModifiedDateTime"),
  };
}

export function normalizeBusinessAccountRows(account: unknown): BusinessAccountRow[] {
  const base = normalizeBusinessAccount(account);
  const contacts = readArrayField(account, "Contacts");
  const accountPhone = readAccountPhone(account);
  const primary = getField(account, "PrimaryContact");
  const primaryId = readNullableNumber(primary, "ContactID");
  const primaryFromPayload = composeContactName(primary);
  const primaryEmail = readFirstString(primary, ["Email", "EMail"]) || null;
  const primaryRecordId = readRecordIdentity(primary);
  const rows: BusinessAccountRow[] = [];

  for (let index = 0; index < contacts.length; index += 1) {
    const contact = contacts[index];
    const contactId = readNullableNumber(contact, "ContactID");
    const contactName = composeContactName(contact);
    const contactPhone = readFirstString(contact, ["Phone1", "Phone2", "Phone3"]) || null;
    const contactEmail = readFirstString(contact, ["Email", "EMail"]) || null;
    const contactRecordId = readRecordIdentity(contact);
    const isPrimaryById = primaryId !== null && contactId !== null && contactId === primaryId;
    const isPrimaryByRecordId =
      !isPrimaryById &&
      Boolean(primaryRecordId) &&
      Boolean(contactRecordId) &&
      primaryRecordId!.toLowerCase() === contactRecordId!.toLowerCase();
    const isPrimaryByEmail =
      !isPrimaryById &&
      !isPrimaryByRecordId &&
      Boolean(primaryEmail) &&
      Boolean(contactEmail) &&
      primaryEmail!.toLowerCase() === contactEmail!.toLowerCase();
    const isPrimaryByName =
      !isPrimaryById &&
      !isPrimaryByRecordId &&
      !isPrimaryByEmail &&
      Boolean(primaryFromPayload) &&
      Boolean(contactName) &&
      primaryFromPayload === contactName;
    const isPrimary = isPrimaryById || isPrimaryByRecordId || isPrimaryByEmail || isPrimaryByName;

    rows.push({
      ...base,
      rowKey: `${base.id}:contact:${contactId ?? index}`,
      accountRecordId: base.id,
      contactId,
      isPrimaryContact: isPrimary,
      primaryContactName: chooseFirst([
        contactName,
        isPrimary ? base.primaryContactName : null,
      ]),
      primaryContactPhone: chooseFirst([
        contactPhone,
        isPrimary ? base.primaryContactPhone : null,
      ]),
      primaryContactEmail: chooseFirst([
        contactEmail,
        isPrimary ? base.primaryContactEmail : null,
      ]),
      notes: chooseFirst([readNullableString(contact, "note"), isPrimary ? base.notes : null]),
      phoneNumber: chooseFirst([accountPhone, contactPhone, base.primaryContactPhone]),
    });
  }

  if (rows.length === 0) {
    return [
      {
        ...base,
        rowKey: `${base.id}:primary`,
        accountRecordId: base.id,
        contactId: base.primaryContactId,
        isPrimaryContact: Boolean(base.primaryContactId || base.primaryContactName),
        phoneNumber: chooseFirst([accountPhone, base.primaryContactPhone]),
      },
    ];
  }

  return rows;
}

export function queryBusinessAccounts(
  rows: BusinessAccountRow[],
  options: QueryOptions,
): { items: BusinessAccountRow[]; total: number; page: number; pageSize: number } {
  const normalizedSearch = options.q?.trim().toLowerCase() ?? "";
  const effectiveCategory = options.filterCategory ?? options.category;

  const filtered = rows.filter((row) => {
    if (effectiveCategory && row.category !== effectiveCategory) {
      return false;
    }

    if (!includesFilter(row.companyName, options.filterCompanyName)) {
      return false;
    }

    if (!includesFilter(row.salesRepName, options.filterSalesRep)) {
      return false;
    }

    if (!includesFilter(row.industryType, options.filterIndustryType)) {
      return false;
    }

    if (!includesFilter(row.subCategory, options.filterSubCategory)) {
      return false;
    }

    if (!includesFilter(row.companyRegion, options.filterCompanyRegion)) {
      return false;
    }

    if (!includesFilter(row.week, options.filterWeek)) {
      return false;
    }

    if (!includesFilter(row.address, options.filterAddress)) {
      return false;
    }

    if (!includesFilter(row.primaryContactName, options.filterPrimaryContactName)) {
      return false;
    }

    if (!includesFilter(row.primaryContactPhone, options.filterPrimaryContactPhone)) {
      return false;
    }

    if (!includesFilter(row.primaryContactEmail, options.filterPrimaryContactEmail)) {
      return false;
    }

    if (!includesLastModifiedFilter(row.lastModifiedIso, options.filterLastModified)) {
      return false;
    }

    if (!normalizedSearch) {
      return true;
    }

    const haystack = [
      row.companyName,
      row.salesRepName,
      row.industryType,
      row.subCategory,
      row.companyRegion,
      row.week,
      row.address,
      row.primaryContactName,
      row.primaryContactPhone,
      row.primaryContactEmail,
      row.businessAccountId,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return haystack.includes(normalizedSearch);
  });

  const sortBy = options.sortBy ?? "companyName";
  const sortDir = options.sortDir ?? "asc";

  const sorted = [...filtered].sort((left, right) => {
    const leftValue = sortValue(left, sortBy);
    const rightValue = sortValue(right, sortBy);

    const compare = leftValue.localeCompare(rightValue, undefined, {
      numeric: true,
      sensitivity: "base",
    });

    return sortDir === "asc" ? compare : -compare;
  });

  const total = sorted.length;
  const page = Math.max(options.page, 1);
  const pageSize = Math.max(options.pageSize, 1);
  const start = (page - 1) * pageSize;
  const items = sorted.slice(start, start + pageSize);

  return {
    items,
    total,
    page,
    pageSize,
  };
}

export function sanitizeNullableInput(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function hasPrimaryContactChanges(
  existing: BusinessAccountRow,
  incoming: BusinessAccountUpdateRequest,
): boolean {
  return (
    sanitizeNullableInput(incoming.primaryContactName) !==
      sanitizeNullableInput(existing.primaryContactName) ||
    sanitizeNullableInput(incoming.primaryContactPhone) !==
      sanitizeNullableInput(existing.primaryContactPhone) ||
    sanitizeNullableInput(incoming.primaryContactEmail) !==
      sanitizeNullableInput(existing.primaryContactEmail) ||
    sanitizeNullableInput(incoming.notes) !== sanitizeNullableInput(existing.notes)
  );
}

export function hasAddressChanges(
  existing: BusinessAccountRow,
  incoming: BusinessAccountUpdateRequest,
): boolean {
  return (
    existing.addressLine1.trim() !== incoming.addressLine1.trim() ||
    existing.addressLine2.trim() !== incoming.addressLine2.trim() ||
    existing.city.trim() !== incoming.city.trim() ||
    existing.state.trim() !== incoming.state.trim() ||
    existing.postalCode.trim() !== incoming.postalCode.trim() ||
    existing.country.trim().toUpperCase() !== incoming.country.trim().toUpperCase()
  );
}

export function buildBusinessAccountUpdatePayload(
  existingRawAccount: unknown,
  update: BusinessAccountUpdateRequest,
): Record<string, unknown> {
  const attributes = [...readArrayField(existingRawAccount, "Attributes")];

  let hasClientType = false;
  const updatedAttributes = attributes.map((attribute) => {
    const id = readNullableString(attribute, "AttributeID");
    if (id !== "CLIENTTYPE") {
      return attribute;
    }

    hasClientType = true;
    return {
      ...(isRecord(attribute) ? attribute : {}),
      AttributeID: {
        value: "CLIENTTYPE",
      },
      Value: {
        value: update.category ?? "",
      },
    };
  });

  if (!hasClientType) {
    updatedAttributes.push({
      AttributeID: {
        value: "CLIENTTYPE",
      },
      Value: {
        value: update.category ?? "",
      },
    });
  }

  return {
    Name: {
      value: update.companyName,
    },
    Owner: {
      value: update.salesRepId ?? "",
    },
    MainAddress: {
      AddressLine1: {
        value: update.addressLine1,
      },
      AddressLine2: {
        value: update.addressLine2,
      },
      City: {
        value: update.city,
      },
      State: {
        value: update.state,
      },
      PostalCode: {
        value: update.postalCode,
      },
      Country: {
        value: update.country,
      },
    },
    Attributes: updatedAttributes,
  };
}

export function buildPrimaryContactUpdatePayload(
  update: BusinessAccountUpdateRequest,
): Record<string, unknown> {
  return {
    DisplayName: {
      value: update.primaryContactName ?? "",
    },
    Phone1: {
      value: update.primaryContactPhone ?? "",
    },
    Email: {
      value: update.primaryContactEmail ?? "",
    },
    note: {
      value: update.notes ?? "",
    },
  };
}

export function withPrimaryContact(
  businessAccount: unknown,
  primaryContact: unknown,
): unknown {
  if (!isRecord(businessAccount)) {
    return businessAccount;
  }

  return {
    ...businessAccount,
    PrimaryContact: primaryContact,
  };
}
