import {
  buildMergedContactPayload,
  buildSelectedMergeFieldMap,
  computeRecommendedFieldSource,
  derivePrimaryRecommendation,
  normalizeRawContactForMerge,
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
    DisplayName: { value: "Jorge Serrano" },
    FirstName: { value: "Jorge" },
    MiddleName: {},
    LastName: { value: "Serrano" },
    JobTitle: { value: "Sales Rep" },
    Email: { value: "jorge@example.com" },
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
  it("default field choice picks keep-side populated value", () => {
    expect(computeRecommendedFieldSource("jorge@example.com", "other@example.com")).toBe(
      "keep",
    );
  });

  it("default field choice picks delete-side value when keep-side blank", () => {
    expect(computeRecommendedFieldSource("", "other@example.com")).toBe("delete");
  });

  it("differing populated values default to keep-side", () => {
    expect(computeRecommendedFieldSource("jorge@example.com", "other@example.com")).toBe(
      "keep",
    );
  });

  it("primary recommendation is true when loser is primary", () => {
    expect(derivePrimaryRecommendation(false, true)).toBe(true);
    expect(derivePrimaryRecommendation(true, false)).toBe(false);
  });

  it("builds selected field map from explicit choices", () => {
    const keepContact = normalizeRawContactForMerge(
      makeRawContact(157497, {
        JobTitle: { value: "" },
      }),
    );
    const deleteContact = normalizeRawContactForMerge(
      makeRawContact(158410, {
        DisplayName: { value: "Jorge A Serrano" },
        JobTitle: { value: "Director" },
      }),
    );

    const merged = buildSelectedMergeFieldMap(keepContact, deleteContact, [
      {
        field: "displayName",
        source: "delete",
      },
      {
        field: "jobTitle",
        source: "delete",
      },
    ]);

    expect(merged.displayName).toBe("Jorge A Serrano");
    expect(merged.jobTitle).toBe("Director");
    expect(merged.email).toBe("jorge@example.com");
  });

  it("buildMergedContactPayload maps all supported contact fields correctly", () => {
    const payload = buildMergedContactPayload(
      makeRawContact(157497),
      makeRawContact(158410, {
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
      }),
      [
        { field: "firstName", source: "delete" },
        { field: "middleName", source: "delete" },
        { field: "lastName", source: "delete" },
        { field: "displayName", source: "delete" },
        { field: "jobTitle", source: "delete" },
        { field: "email", source: "delete" },
        { field: "phone1", source: "delete" },
        { field: "phone2", source: "delete" },
        { field: "phone3", source: "delete" },
        { field: "website", source: "delete" },
        { field: "notes", source: "delete" },
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
});
