import {
  buildAcumaticaBusinessAccountUrl,
  buildAcumaticaContactUrl,
} from "@/lib/acumatica-links";

describe("acumatica deep links", () => {
  it("builds a business account screen url", () => {
    expect(
      buildAcumaticaBusinessAccountUrl(
        "https://meadowbrook.acumatica.com",
        "B200000123",
        "MeadowBrook Live",
      ),
    ).toBe(
      "https://meadowbrook.acumatica.com/Main?ScreenId=CR303000&CompanyID=MeadowBrook+Live&AcctCD=B200000123",
    );
  });

  it("builds a contact screen url", () => {
    expect(
      buildAcumaticaContactUrl(
        "https://meadowbrook.acumatica.com/",
        157847,
        "MeadowBrook Live",
      ),
    ).toBe(
      "https://meadowbrook.acumatica.com/Main?ScreenId=CR302000&CompanyID=MeadowBrook+Live&ContactID=157847",
    );
  });

  it("returns null when required identifiers are blank", () => {
    expect(
      buildAcumaticaBusinessAccountUrl(
        "https://meadowbrook.acumatica.com",
        "",
      ),
    ).toBeNull();
    expect(buildAcumaticaContactUrl("https://meadowbrook.acumatica.com", null)).toBeNull();
  });
});
