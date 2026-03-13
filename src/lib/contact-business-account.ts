type WrappedStringReader = (
  record: unknown,
  key: string,
) => string | null | undefined;

function pickFirstText(values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

export function readContactBusinessAccountCode(
  record: unknown,
  readWrappedString: WrappedStringReader,
): string | null {
  return pickFirstText([
    readWrappedString(record, "BusinessAccount"),
    readWrappedString(record, "BusinessAccountID"),
    readWrappedString(record, "BAccountID"),
    readWrappedString(record, "AccountCD"),
  ]);
}

export function readContactCompanyName(
  record: unknown,
  readWrappedString: WrappedStringReader,
): string | null {
  return pickFirstText([
    readWrappedString(record, "CompanyName"),
    readWrappedString(record, "BusinessAccountName"),
    readWrappedString(record, "AcctName"),
    readWrappedString(record, "Company"),
  ]);
}
