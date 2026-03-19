import {
  formatPhoneForDisplay,
  formatPhoneForTwilioDial,
  formatPhoneDraftValue,
  isExtensionLikeValue,
  looksLikeFullNorthAmericanPhone,
  normalizeExtensionForSave,
  normalizePhoneForSave,
  parsePhoneWithExtension,
  phoneValuesEquivalent,
  resolvePrimaryContactPhoneFields,
} from "@/lib/phone";

describe("phone helpers", () => {
  it("formats draft values as ###-###-####", () => {
    expect(formatPhoneDraftValue("4162304681")).toBe("416-230-4681");
    expect(formatPhoneDraftValue("(416) 230-4681")).toBe("416-230-4681");
    expect(formatPhoneDraftValue("14162304681")).toBe("416-230-4681");
  });

  it("supports partial draft formatting while typing", () => {
    expect(formatPhoneDraftValue("4162")).toBe("416-2");
    expect(formatPhoneDraftValue("416230")).toBe("416-230");
    expect(formatPhoneDraftValue("4162304")).toBe("416-230-4");
  });

  it("normalizes save values to ###-###-####", () => {
    expect(normalizePhoneForSave("4162304681")).toBe("416-230-4681");
    expect(normalizePhoneForSave("(416) 230-4681")).toBe("416-230-4681");
    expect(normalizePhoneForSave("14162304681")).toBe("416-230-4681");
    expect(normalizePhoneForSave("")).toBeNull();
  });

  it("rejects save values that are not a 10-digit number or an 11-digit number starting with 1", () => {
    expect(normalizePhoneForSave("416230468")).toBeNull();
    expect(normalizePhoneForSave("24162304681")).toBeNull();
    expect(normalizePhoneForSave("41623046812")).toBeNull();
  });

  it("treats equivalent phone formats as the same number", () => {
    expect(phoneValuesEquivalent("4162304681", "416-230-4681")).toBe(true);
    expect(phoneValuesEquivalent("(416) 230-4681", "416-230-4681")).toBe(true);
    expect(phoneValuesEquivalent("14162304681", "416-230-4681")).toBe(true);
    expect(phoneValuesEquivalent("416-230-4681", "416-230-9999")).toBe(false);
  });

  it("converts North American phone numbers to E.164 for Twilio dialing", () => {
    expect(formatPhoneForTwilioDial("416-230-4681")).toBe("+14162304681");
    expect(formatPhoneForTwilioDial("14162304681")).toBe("+14162304681");
    expect(formatPhoneForTwilioDial("416230468")).toBeNull();
  });

  it("formats exact 10-digit numbers for display without mangling other values", () => {
    expect(formatPhoneForDisplay("9053195579")).toBe("905-319-5579");
    expect(formatPhoneForDisplay("19053195579")).toBe("905-319-5579");
    expect(formatPhoneForDisplay("905-319-5579")).toBe("905-319-5579");
    expect(formatPhoneForDisplay("905-319-5579 x204")).toBe("905-319-5579 x204");
  });

  it("parses standard phone-and-extension strings", () => {
    expect(parsePhoneWithExtension("(905) 326-8100 x 3008")).toEqual({
      kind: "phone_with_extension",
      phone: "905-326-8100",
      extension: "3008",
    });
    expect(parsePhoneWithExtension("905-337-0800 ext. 101")).toEqual({
      kind: "phone_with_extension",
      phone: "905-337-0800",
      extension: "101",
    });
    expect(parsePhoneWithExtension("+19058453577 ext 5200")).toEqual({
      kind: "phone_with_extension",
      phone: "905-845-3577",
      extension: "5200",
    });
  });

  it("flags ambiguous extension and multi-number strings", () => {
    expect(parsePhoneWithExtension("416-798-1235 x126/120")).toEqual({
      kind: "ambiguous_multiple_extensions",
      phone: null,
      extension: null,
    });
    expect(
      parsePhoneWithExtension("T: (416) 299-4000 x 305\nM: (416) 678-9423"),
    ).toEqual({
      kind: "ambiguous_multiple_numbers",
      phone: null,
      extension: null,
    });
  });

  it("normalizes and recognizes extensions separately from full phone numbers", () => {
    expect(normalizeExtensionForSave("ext. 3008")).toBe("3008");
    expect(isExtensionLikeValue("3008")).toBe(true);
    expect(isExtensionLikeValue("ext 204")).toBe(true);
    expect(isExtensionLikeValue("905-555-0100")).toBe(false);
    expect(looksLikeFullNorthAmericanPhone("905-555-0100")).toBe(true);
    expect(looksLikeFullNorthAmericanPhone("3008")).toBe(false);
  });

  it("treats Phone2 as an extension only when Phone1 is present", () => {
    expect(
      resolvePrimaryContactPhoneFields({
        phone1: "905-326-8100",
        phone2: "3008",
        phone3: null,
      }),
    ).toEqual({
      phone: "905-326-8100",
      extension: "3008",
    });

    expect(
      resolvePrimaryContactPhoneFields({
        phone1: null,
        phone2: "3008",
        phone3: "905-555-0100",
      }),
    ).toEqual({
      phone: "905-555-0100",
      extension: null,
    });
  });
});
