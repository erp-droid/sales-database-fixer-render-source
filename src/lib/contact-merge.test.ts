import {
  buildContactMergePreviewFields,
  buildMergedContactPayload,
  buildSelectedMergeFieldMap,
  derivePrimaryRecommendation,
  normalizeRawContactForMerge,
  optimisticTimestampMatches,
} from "@/lib/contact-merge";

function makeRawContact(
  contactId: number,
  overrides?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    id: `contact-${contactId}`,
    ContactID: { value: contactId },
    BusinessAccount: { value: "AC-100" },
    CompanyName: { value: "Alpha Inc" },
    DisplayName: { value: `Contact ${contactId}` },
    FirstName: { value: `First ${contactId}` },
    MiddleName: {},
    LastName: { value: "Serrano" },
    JobTitle: { value: "Sales Rep" },
    Email: { value: `contact-${contactId}@example.com` },
    Phone1: { value: "4162304681" },
    Phone2: { value: "" },
    Phone3: { value: "" },
    WebSite: { value: "https://example.com" },
    note: { value: "Keep me" },
    LastModifiedDateTime: { value: "2026-03-04T16:39:08.13+00:00" },
    ...overrides,
  };
}

describe("contact merge helpers", () => {
  it("builds preview fields for 3 selected contacts", () => {
    const fields = buildContactMergePreviewFields(
      [
        normalizeRawContactForMerge(
          makeRawContact(157497, {
            Email: { value: "" },
          }),
        ),
        normalizeRawContactForMerge(
          makeRawContact(158410, {
            Email: { value: "" },
          }),
        ),
        normalizeRawContactForMerge(
          makeRawContact(158499, {
            Email: { value: "merged@example.com" },
          }),
        ),
      ],
      157497,
    );

    const emailField = fields.find((field) => field.field === "email");
    expect(emailField?.values).toEqual([
      { contactId: 157497, value: null },
      { contactId: 158410, value: null },
      { contactId: 158499, value: "merged@example.com" },
    ]);
    expect(emailField?.recommendedSourceContactId).toBe(158499);
    expect(emailField?.valuesDiffer).toBe(true);
  });

  it("primary recommendation is true when a loser is primary", () => {
    expect(derivePrimaryRecommendation(false, true)).toBe(true);
    expect(derivePrimaryRecommendation(true, false)).toBe(false);
  });

  it("builds selected field map from explicit source contact choices", () => {
    const selectedContacts = [
      normalizeRawContactForMerge(
        makeRawContact(157497, {
          JobTitle: { value: "" },
        }),
      ),
      normalizeRawContactForMerge(
        makeRawContact(158410, {
          DisplayName: { value: "Jorge A Serrano" },
          JobTitle: { value: "Director" },
        }),
      ),
      normalizeRawContactForMerge(
        makeRawContact(158499, {
          note: { value: "Merged note" },
        }),
      ),
    ];

    const merged = buildSelectedMergeFieldMap(selectedContacts, 157497, [
      {
        field: "displayName",
        sourceContactId: 158410,
      },
      {
        field: "jobTitle",
        sourceContactId: 158410,
      },
      {
        field: "notes",
        sourceContactId: 158499,
      },
    ]);

    expect(merged.displayName).toBe("Jorge A Serrano");
    expect(merged.jobTitle).toBe("Director");
    expect(merged.notes).toBe("Merged note");
    expect(merged.email).toBe("contact-157497@example.com");
  });

  it("buildMergedContactPayload maps mixed source contacts correctly", () => {
    const payload = buildMergedContactPayload(
      [
        makeRawContact(157497),
        makeRawContact(158410, {
          FirstName: { value: "George" },
          MiddleName: { value: "A" },
          DisplayName: { value: "George A Serrano" },
          Email: { value: "george@example.com" },
        }),
        makeRawContact(158499, {
          JobTitle: { value: "Director" },
          Phone1: { value: "9051111111" },
          Phone2: { value: "9052222222" },
          Phone3: { value: "9053333333" },
          WebSite: { value: "https://merged.example.com" },
          note: { value: "Merged note" },
        }),
      ],
      157497,
      [
        { field: "firstName", sourceContactId: 158410 },
        { field: "middleName", sourceContactId: 158410 },
        { field: "displayName", sourceContactId: 158410 },
        { field: "email", sourceContactId: 158410 },
        { field: "jobTitle", sourceContactId: 158499 },
        { field: "phone1", sourceContactId: 158499 },
        { field: "phone2", sourceContactId: 158499 },
        { field: "phone3", sourceContactId: 158499 },
        { field: "website", sourceContactId: 158499 },
        { field: "notes", sourceContactId: 158499 },
      ],
    );

    expect(payload).toEqual({
      FirstName: { value: "George" },
      MiddleName: { value: "A" },
      LastName: { value: "Serrano" },
      DisplayName: { value: "George A Serrano" },
      JobTitle: { value: "Director" },
      Email: { value: "george@example.com" },
      Phone1: { value: "9051111111" },
      Phone2: { value: "9052222222" },
      Phone3: { value: "9053333333" },
      WebSite: { value: "https://merged.example.com" },
      note: { value: "Merged note" },
    });
  });

  it("treats equivalent optimistic timestamps as a match even with formatting differences", () => {
    expect(
      optimisticTimestampMatches(
        "2026-03-04T16:39:08.13+00:00",
        "2026-03-04T16:39:08.130Z",
      ),
    ).toBe(true);
    expect(
      optimisticTimestampMatches(
        "2026-03-04T16:39:08.130+00:00",
        "2026-03-04T16:39:08Z",
      ),
    ).toBe(true);
    expect(
      optimisticTimestampMatches(
        "2026-03-04T16:39:08.130+00:00",
        "2026-03-04T16:39:09.000Z",
      ),
    ).toBe(false);
  });
});
