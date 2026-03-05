import {
  formatPhoneDraftValue,
  normalizePhoneForSave,
  phoneValuesEquivalent,
} from "@/lib/phone";

describe("phone helpers", () => {
  it("formats draft values as ###-###-####", () => {
    expect(formatPhoneDraftValue("4162304681")).toBe("416-230-4681");
    expect(formatPhoneDraftValue("(416) 230-4681")).toBe("416-230-4681");
  });

  it("supports partial draft formatting while typing", () => {
    expect(formatPhoneDraftValue("4162")).toBe("416-2");
    expect(formatPhoneDraftValue("416230")).toBe("416-230");
    expect(formatPhoneDraftValue("4162304")).toBe("416-230-4");
  });

  it("normalizes save values to ###-###-####", () => {
    expect(normalizePhoneForSave("4162304681")).toBe("416-230-4681");
    expect(normalizePhoneForSave("(416) 230-4681")).toBe("416-230-4681");
    expect(normalizePhoneForSave("")).toBeNull();
  });

  it("rejects save values that do not contain exactly ten digits", () => {
    expect(normalizePhoneForSave("416230468")).toBeNull();
    expect(normalizePhoneForSave("41623046812")).toBeNull();
  });

  it("treats equivalent phone formats as the same number", () => {
    expect(phoneValuesEquivalent("4162304681", "416-230-4681")).toBe(true);
    expect(phoneValuesEquivalent("(416) 230-4681", "416-230-4681")).toBe(true);
    expect(phoneValuesEquivalent("416-230-4681", "416-230-9999")).toBe(false);
  });
});
