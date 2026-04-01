import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildDeletedContactRowKey,
  buildDeletedContactRowKeys,
  fetchSelectedContactsForMerge,
  setBusinessAccountPrimaryContact,
  validateContactMergeScope,
} from "@/lib/contact-merge-server";
import { HttpError } from "@/lib/errors";

const {
  fetchBusinessAccountByIdMock,
  fetchContactByIdMock,
  invokeBusinessAccountActionMock,
  updateBusinessAccountMock,
  updateCustomerMock,
} = vi.hoisted(() => ({
  fetchBusinessAccountByIdMock: vi.fn(),
  fetchContactByIdMock: vi.fn(),
  invokeBusinessAccountActionMock: vi.fn(),
  updateBusinessAccountMock: vi.fn(),
  updateCustomerMock: vi.fn(),
}));

vi.mock("@/lib/acumatica", async () => {
  const actual = await vi.importActual<typeof import("@/lib/acumatica")>("@/lib/acumatica");
  return {
    ...actual,
    fetchBusinessAccountById: fetchBusinessAccountByIdMock,
    fetchContactById: fetchContactByIdMock,
    invokeBusinessAccountAction: invokeBusinessAccountActionMock,
    updateBusinessAccount: updateBusinessAccountMock,
    updateCustomer: updateCustomerMock,
  };
});

function makeRawAccount(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "account-1",
    BusinessAccountID: { value: "AC-100" },
    Name: { value: "Alpha Inc" },
    LastModifiedDateTime: { value: "2026-03-05T14:00:00.000+00:00" },
    PrimaryContact: {
      ContactID: { value: 157497 },
      DisplayName: { value: "Jorge Serrano" },
    },
    Contacts: [],
    ...overrides,
  };
}

function makeRawContact(
  contactId: number,
  overrides?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    id: `contact-${contactId}`,
    ContactID: { value: contactId },
    BusinessAccount: { value: "AC-100" },
    DisplayName: { value: "Jorge Serrano" },
    Email: { value: `contact-${contactId}@example.com` },
    LastModifiedDateTime: { value: "2026-03-05T14:00:00.000+00:00" },
    ...overrides,
  };
}

describe("contact merge server helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("validates same-account scope even when account contacts are not preloaded", () => {
    const scope = validateContactMergeScope(
      makeRawAccount(),
      makeRawContact(157497),
      [makeRawContact(157497), makeRawContact(158410), makeRawContact(158499)],
    );

    expect(scope.keepIsPrimary).toBe(true);
    expect(scope.primaryContactId).toBe(157497);
    expect(scope.warnings).toEqual([]);
  });

  it("rejects cross-account selections", () => {
    expect(() =>
      validateContactMergeScope(
        makeRawAccount(),
        makeRawContact(157497),
        [
          makeRawContact(157497),
          makeRawContact(158410, {
            BusinessAccount: { value: "AC-999" },
          }),
        ],
      ),
    ).toThrow("All selected contacts must belong to the selected business account");
  });

  it("falls back to deterministic deleted row keys when contacts are unavailable", () => {
    expect(buildDeletedContactRowKey(makeRawAccount(), 158410)).toBe(
      "account-1:contact:158410",
    );
    expect(buildDeletedContactRowKeys(makeRawAccount(), [158410, 158499])).toEqual([
      "account-1:contact:158410",
      "account-1:contact:158499",
    ]);
  });

  it("loads selected contacts individually while preserving the requested order", async () => {
    fetchContactByIdMock.mockImplementation(async (_cookieValue, contactId: number) =>
      makeRawContact(contactId, {
        DisplayName: { value: `Fetched ${contactId}` },
      }),
    );

    const selectedContacts = await fetchSelectedContactsForMerge(
      "cookie",
      [158410, 157497, 158410],
      { value: null },
    );

    expect(fetchContactByIdMock).toHaveBeenCalledTimes(2);
    expect(
      selectedContacts.map(
        (contact) =>
          (contact as {
            ContactID?: { value?: number | null };
          }).ContactID?.value ?? null,
      ),
    ).toEqual([158410, 157497, 158410]);
  });

  it("uses body-first business-account fallback when forcing a primary contact switch", async () => {
    const baseAccount = makeRawAccount({
      Contacts: [makeRawContact(157497), makeRawContact(158410)],
    });
    const switchedAccount = makeRawAccount({
      PrimaryContact: {
        ContactID: { value: 158410 },
        DisplayName: { value: "Jorge Serrano" },
      },
      Contacts: [makeRawContact(157497), makeRawContact(158410)],
    });

    fetchBusinessAccountByIdMock
      .mockResolvedValueOnce(baseAccount)
      .mockResolvedValueOnce(switchedAccount);
    updateCustomerMock.mockRejectedValueOnce(new Error("Customer update rejected"));
    invokeBusinessAccountActionMock.mockRejectedValueOnce(new Error("Action rejected"));
    updateBusinessAccountMock.mockResolvedValueOnce(undefined);

    await setBusinessAccountPrimaryContact(
      "cookie",
      {
        rawAccount: baseAccount,
        rawAccountWithContacts: baseAccount,
        resolvedRecordId: "account-1",
        updateIdentifiers: ["AC-100", "account-1"],
        identityPayload: {
          id: "account-1",
          BusinessAccountID: { value: "AC-100" },
        },
      },
      158410,
      { value: null },
      makeRawContact(158410),
    );

    expect(updateBusinessAccountMock).toHaveBeenCalledWith(
      "cookie",
      ["AC-100", "account-1"],
      expect.objectContaining({
        BusinessAccountID: { value: "AC-100" },
      }),
      { value: null },
      {
        strategy: "body-first",
      },
    );
  });

  it("continues to later fallback payloads after a non-auth Acumatica error", async () => {
    const baseAccount = makeRawAccount({
      Contacts: [makeRawContact(157497), makeRawContact(158410)],
    });
    const switchedAccount = makeRawAccount({
      PrimaryContact: {
        ContactID: { value: 158410 },
        DisplayName: { value: "Jorge Serrano" },
      },
      Contacts: [makeRawContact(157497), makeRawContact(158410)],
    });

    fetchBusinessAccountByIdMock
      .mockResolvedValueOnce(baseAccount)
      .mockResolvedValueOnce(switchedAccount);
    updateCustomerMock.mockRejectedValueOnce(new Error("Customer update rejected"));
    invokeBusinessAccountActionMock.mockRejectedValueOnce(new Error("Action rejected"));
    updateBusinessAccountMock
      .mockRejectedValueOnce(
        new HttpError(500, "Sequence contains more than one matching element"),
      )
      .mockResolvedValueOnce(undefined);

    await setBusinessAccountPrimaryContact(
      "cookie",
      {
        rawAccount: baseAccount,
        rawAccountWithContacts: baseAccount,
        resolvedRecordId: "account-1",
        updateIdentifiers: ["AC-100", "account-1"],
        identityPayload: {
          id: "account-1",
          BusinessAccountID: { value: "AC-100" },
        },
      },
      158410,
      { value: null },
      makeRawContact(158410),
    );

    expect(updateBusinessAccountMock).toHaveBeenCalledTimes(2);
  });
});
