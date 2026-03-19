import { readAllAccountRowsFromReadModel } from "@/lib/read-model/accounts";
import { extractNormalizedPhoneDigits, formatPhoneForTwilioDial } from "@/lib/phone";
import { resolveCompanyPhone } from "@/lib/business-accounts";
import type { CallPhoneMatchType } from "@/lib/call-analytics/types";
import type { BusinessAccountRow } from "@/types/business-account";

export type PhoneMatchCandidate = {
  rowKey: string;
  businessAccountId: string;
  companyName: string;
  contactId: number | null;
  contactName: string | null;
  phoneType: CallPhoneMatchType;
  isPrimaryContact: boolean;
};

export type PhoneMatchResult = {
  matchedContactId: number | null;
  matchedContactName: string | null;
  matchedBusinessAccountId: string | null;
  matchedCompanyName: string | null;
  phoneMatchType: CallPhoneMatchType;
  phoneMatchAmbiguityCount: number;
};

function pushCandidate(
  index: Map<string, Map<string, PhoneMatchCandidate>>,
  phone: string | null | undefined,
  candidate: PhoneMatchCandidate,
): void {
  const dial = formatPhoneForTwilioDial(phone);
  const digits = extractNormalizedPhoneDigits(phone);
  for (const key of [dial, digits]) {
    if (!key) {
      continue;
    }

    const existing = index.get(key) ?? new Map<string, PhoneMatchCandidate>();
    existing.set(buildCandidateKeyFromCandidate(candidate), candidate);
    index.set(key, existing);
  }
}

function buildCandidateKeyFromCandidate(candidate: PhoneMatchCandidate): string {
  return `${candidate.rowKey}:${candidate.phoneType}:${candidate.contactId ?? "none"}`;
}

export type PhoneMatchIndex = Map<string, Map<string, PhoneMatchCandidate>>;

export function buildPhoneMatchIndex(): PhoneMatchIndex {
  const index = new Map<string, Map<string, PhoneMatchCandidate>>();
  const rows = readAllAccountRowsFromReadModel();

  for (const row of rows) {
    pushCandidate(index, row.primaryContactPhone, {
      rowKey: row.rowKey ?? row.id,
      businessAccountId: row.businessAccountId,
      companyName: row.companyName,
      contactId: row.primaryContactId,
      contactName: row.primaryContactName,
      phoneType: "contact_phone",
      isPrimaryContact: true,
    });

    if (row.contactId !== null && row.contactId !== undefined) {
      pushCandidate(index, row.phoneNumber, {
        rowKey: row.rowKey ?? row.id,
        businessAccountId: row.businessAccountId,
        companyName: row.companyName,
        contactId: row.contactId,
        contactName: row.primaryContactName,
        phoneType: "contact_phone",
        isPrimaryContact: Boolean(row.isPrimaryContact),
      });
    }

    pushCandidate(index, resolveCompanyPhone(row), {
      rowKey: row.rowKey ?? row.id,
      businessAccountId: row.businessAccountId,
      companyName: row.companyName,
      contactId: null,
      contactName: null,
      phoneType: "company_phone",
      isPrimaryContact: false,
    });
  }

  return index;
}

function chooseBestCandidate(candidates: PhoneMatchCandidate[]): PhoneMatchCandidate | null {
  if (candidates.length === 0) {
    return null;
  }

  const sorted = [...candidates].sort((left, right) => {
    if (left.phoneType !== right.phoneType) {
      return left.phoneType === "contact_phone" ? -1 : 1;
    }

    if (left.isPrimaryContact !== right.isPrimaryContact) {
      return left.isPrimaryContact ? -1 : 1;
    }

    const contactCompare = (left.contactName ?? "").localeCompare(right.contactName ?? "", undefined, {
      sensitivity: "base",
    });
    if (contactCompare !== 0) {
      return contactCompare;
    }

    return left.companyName.localeCompare(right.companyName, undefined, {
      sensitivity: "base",
    });
  });

  return sorted[0] ?? null;
}

export function matchPhoneToAccountWithIndex(
  index: PhoneMatchIndex,
  phone: string | null | undefined,
): PhoneMatchResult {
  const keys = [formatPhoneForTwilioDial(phone), extractNormalizedPhoneDigits(phone)].filter(
    (value): value is string => Boolean(value),
  );
  if (keys.length === 0) {
    return {
      matchedContactId: null,
      matchedContactName: null,
      matchedBusinessAccountId: null,
      matchedCompanyName: null,
      phoneMatchType: "none",
      phoneMatchAmbiguityCount: 0,
    };
  }

  const candidatesByKey = new Map<string, PhoneMatchCandidate>();
  for (const key of keys) {
    const candidates = index.get(key);
    if (!candidates) {
      continue;
    }

    for (const [candidateKey, candidate] of candidates.entries()) {
      candidatesByKey.set(candidateKey, candidate);
    }
  }

  const candidates = [...candidatesByKey.values()];
  const best = chooseBestCandidate(candidates);
  if (!best) {
    return {
      matchedContactId: null,
      matchedContactName: null,
      matchedBusinessAccountId: null,
      matchedCompanyName: null,
      phoneMatchType: "none",
      phoneMatchAmbiguityCount: 0,
    };
  }

  return {
    matchedContactId: best.phoneType === "contact_phone" ? best.contactId : null,
    matchedContactName: best.phoneType === "contact_phone" ? best.contactName : null,
    matchedBusinessAccountId: best.businessAccountId,
    matchedCompanyName: best.companyName,
    phoneMatchType: best.phoneType,
    phoneMatchAmbiguityCount: candidates.length,
  };
}

export function matchPhoneToAccount(phone: string | null | undefined): PhoneMatchResult {
  return matchPhoneToAccountWithIndex(buildPhoneMatchIndex(), phone);
}
