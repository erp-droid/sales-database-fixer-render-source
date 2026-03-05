import {
  buildDeletedContactRowKey,
  validateContactMergeScope,
} from "@/lib/contact-merge-server";

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
    DisplayName: { value: contactId === 157497 ? "Jorge Serrano" : "JORGE SERRANO" },
    Email: { value: contactId === 157497 ? "jorge@example.com" : "jorge.alt@example.com" },
    LastModifiedDateTime: { value: "2026-03-05T14:00:00.000+00:00" },
    ...overrides,
  };
}

describe("contact merge server helpers", () => {
  it("validates same-account scope even when account contacts are not preloaded", () => {
    const scope = validateContactMergeScope(
      makeRawAccount(),
      makeRawContact(157497),
      makeRawContact(158410),
    );

    expect(scope.keepIsPrimary).toBe(true);
    expect(scope.deleteIsPrimary).toBe(false);
    expect(scope.warnings).toEqual([]);
  });

  it("falls back to a deterministic deleted row key when contacts are unavailable", () => {
    expect(buildDeletedContactRowKey(makeRawAccount(), 158410)).toBe(
      "account-1:contact:158410",
    );
  });
});
