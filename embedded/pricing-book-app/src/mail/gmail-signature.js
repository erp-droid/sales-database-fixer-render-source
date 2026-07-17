import { cleanString } from "./utils.js";

function cleanEmailAddress(value) {
  return cleanString(value).toLowerCase();
}

export function selectSignatureFromSendAsAliases(sendAsAliases, expectedEmail) {
  const aliases = Array.isArray(sendAsAliases) ? sendAsAliases : [];
  const expected = cleanEmailAddress(expectedEmail);
  const candidates = [
    aliases.find(
      (alias) =>
        cleanEmailAddress(alias?.sendAsEmail) === expected &&
        cleanString(alias?.signature)
    ),
    aliases.find((alias) => alias?.isDefault && cleanString(alias?.signature)),
    aliases.find((alias) => alias?.isPrimary && cleanString(alias?.signature)),
    aliases.find((alias) => cleanString(alias?.signature))
  ];

  return cleanString(candidates.find(Boolean)?.signature) || null;
}
