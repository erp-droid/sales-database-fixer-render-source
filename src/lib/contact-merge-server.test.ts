import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildDeletedContactRowKey,
  buildDeletedContactRowKeys,
  fetchSelectedContactsForMerge,
  validateContactMergeScope,
} from "@/lib/contact-merge-server";

const { fetchContactByIdMock } = vi.hoisted(() => ({
  fetchContactByIdMock: vi.fn(),
}));

vi.mock("@/lib/acumatica", async () => {
  const actual = await vi.importActual<typeof import("@/lib/acumatica")>("@/lib/acumatica");
  return {
    ...actual,
    fetchContactById: fetchContactByIdMock,
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
});
