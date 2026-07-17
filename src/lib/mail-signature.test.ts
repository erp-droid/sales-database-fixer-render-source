import { describe, expect, it } from "vitest";

import { appendGmailSignatureToComposeHtml } from "@/lib/mail-signature";

describe("appendGmailSignatureToComposeHtml", () => {
  const signature = "<div>Jorge Serrano<br>MeadowBrook</div>";

  it("adds a Gmail signature below an empty compose body", () => {
    expect(appendGmailSignatureToComposeHtml("", signature)).toBe(
      '<div><br></div><div data-mb-gmail-signature="true"><div>Jorge Serrano<br>MeadowBrook</div></div>',
    );
  });

  it("treats placeholder line breaks as an empty compose body", () => {
    expect(appendGmailSignatureToComposeHtml("<div><br /></div>", signature)).toBe(
      '<div><br></div><div data-mb-gmail-signature="true"><div>Jorge Serrano<br>MeadowBrook</div></div>',
    );
  });

  it("keeps prefilled content and appends the signature", () => {
    expect(
      appendGmailSignatureToComposeHtml("<div>Hello Pat,</div>", signature),
    ).toBe(
      '<div>Hello Pat,</div><div><br></div><div data-mb-gmail-signature="true"><div>Jorge Serrano<br>MeadowBrook</div></div>',
    );
  });

  it("does not duplicate an existing CRM-inserted signature", () => {
    const existing =
      '<div>Hello</div><div data-mb-gmail-signature="true"><div>Jorge</div></div>';
    expect(appendGmailSignatureToComposeHtml(existing, signature)).toBe(existing);
  });
});
