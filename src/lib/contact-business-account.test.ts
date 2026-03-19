import {
  readContactBusinessAccountCode,
  readContactCompanyName,
} from "@/lib/contact-business-account";

function readWrappedString(record: unknown, key: string): string | null {
  if (!record || typeof record !== "object") {
    return null;
  }

  const field = (record as Record<string, unknown>)[key];
  if (!field || typeof field !== "object") {
    return null;
  }

  const value = (field as Record<string, unknown>).value;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

describe("readContactBusinessAccountCode", () => {
  it("falls back across the supported contact account id fields", () => {
    expect(
      readContactBusinessAccountCode(
        {
          BusinessAccountID: { value: "BA-100" },
        },
        readWrappedString,
      ),
    ).toBe("BA-100");

    expect(
      readContactBusinessAccountCode(
        {
          BAccountID: { value: "BA-200" },
        },
        readWrappedString,
      ),
    ).toBe("BA-200");
  });
});

describe("readContactCompanyName", () => {
  it("falls back across the supported company name fields", () => {
    expect(
      readContactCompanyName(
        {
          BusinessAccountName: { value: "Alpha Fabrication" },
        },
        readWrappedString,
      ),
    ).toBe("Alpha Fabrication");

    expect(
      readContactCompanyName(
        {
          Company: { value: "Bravo Metals" },
        },
        readWrappedString,
      ),
    ).toBe("Bravo Metals");
  });
});
