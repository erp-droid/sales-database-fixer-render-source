import assert from "node:assert/strict";
import test from "node:test";

import { selectSignatureFromSendAsAliases } from "../src/mail/gmail-signature.js";

test("uses the expected send-as alias when it has a signature", () => {
  assert.equal(
    selectSignatureFromSendAsAliases(
      [
        { sendAsEmail: "alias@meadowb.com", isDefault: true, signature: "Alias" },
        { sendAsEmail: "jorge@meadowb.com", signature: "Jorge" }
      ],
      "jorge@meadowb.com"
    ),
    "Jorge"
  );
});

test("falls back to the non-empty default signature when the expected alias is blank", () => {
  assert.equal(
    selectSignatureFromSendAsAliases(
      [
        { sendAsEmail: "jserrano@meadowb.com", isPrimary: true, signature: "" },
        {
          sendAsEmail: "jorge.serrano@meadowb.com",
          isDefault: true,
          signature: "<div>Regards,<br>Jorge Serrano</div>"
        }
      ],
      "jserrano@meadowb.com"
    ),
    "<div>Regards,<br>Jorge Serrano</div>"
  );
});

test("falls back to any non-empty signature when Gmail flags are absent", () => {
  assert.equal(
    selectSignatureFromSendAsAliases(
      [
        { sendAsEmail: "jserrano@meadowb.com", signature: null },
        { sendAsEmail: "other@meadowb.com", signature: "Available signature" }
      ],
      "jserrano@meadowb.com"
    ),
    "Available signature"
  );
});

test("returns null when Gmail has no non-empty signature", () => {
  assert.equal(
    selectSignatureFromSendAsAliases(
      [{ sendAsEmail: "jserrano@meadowb.com", isDefault: true, signature: "" }],
      "jserrano@meadowb.com"
    ),
    null
  );
});
