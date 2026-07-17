import type { BusinessAccountRow } from "@/types/business-account";

export type JeffSpecialVisitDefinition = {
  accountRecordId: string;
  businessAccountId: string;
  companyName: string;
  time: string;
  notes: string;
};

export type JeffSpecialReportSnapshot = {
  companyName: string;
  address: string;
  city: string;
  companyPhone: string;
  contactName: string;
  contactJobTitle: string;
  contactPhone: string;
  contactExtension: string;
  contactEmail: string;
};

export type JeffSpecialResolvedVisit = JeffSpecialVisitDefinition & {
  matched: boolean;
  original: JeffSpecialReportSnapshot;
  address: string;
  city: string;
  companyPhone: string;
  contactName: string;
  contactJobTitle: string;
  contactPhone: string;
  contactExtension: string;
  contactEmail: string;
};

export type JeffSpecialReportDifference = {
  week: number;
  time: string;
  companyName: string;
  field: string;
  originalValue: string;
  currentValue: string;
  result: "Added" | "Changed" | "Removed" | "CRM record missing";
};

export type JeffSpecialReportWeek = {
  week: number;
  visits: JeffSpecialResolvedVisit[];
};

export type JeffSpecialReportPlan = {
  generatedAt: string;
  accountTotal: number;
  matchedAccountTotal: number;
  missingAccountTotal: number;
  missingCompanyNames: string[];
  differences: JeffSpecialReportDifference[];
  weeks: JeffSpecialReportWeek[];
};

// Fixed membership and visit instructions from the source workbook:
// "Jeff Customer Visits — July 14–15, 2026".
export const JEFF_SPECIAL_REPORT_VISITS: ReadonlyArray<{
  week: number;
  visits: ReadonlyArray<JeffSpecialVisitDefinition>;
}> = [
  {
    week: 1,
    visits: [
      {
        accountRecordId: "93976f17-7eed-f011-8370-025dbe72350a",
        businessAccountId: "B20204",
        companyName: "CuBE Plastics",
        time: "9:00-9:30",
        notes: "Jeff to meet with David to introduce himself, touch on MeadowBrook's company-wide trade facility services, and check in with how our dock and door service assessment went. David, thank you again for your time on the phone, and we look forward to meeting with you. Jeff can be reached at: (416) 819-3800. David can be reached at: (416) 834-5542.",
      },
      {
        accountRecordId: "local-account-129629d9-bd87-45fa-91e4-811ec616c067",
        businessAccountId: "LOCAL-1595F13D-4FD",
        companyName: "Simply Goodz / Compass Food",
        time: "9:45-10:00",
        notes: "Jeff, this is a new building. Let me know if they manufacture and if they are worth keeping. We still need a verified point of contact.",
      },
      {
        accountRecordId: "local-jeff-import-20260605-706a5b3a5b580e2acb",
        businessAccountId: "LOCAL-JEFF-0256",
        companyName: "Piramal Pharma Solutions",
        time: "10:15-10:30",
        notes: "Jeff, Tyler Clements might be our point of contact. We have not been able to speak with him because the call never goes through.",
      },
      {
        accountRecordId: "local-jeff-import-20260605-7078a3d47b03b929bf",
        businessAccountId: "LOCAL-JEFF-0348",
        companyName: "Transcontinental Aurora",
        time: "10:45-11:00",
        notes: "Tim Vanslingerland may be our point of contact. Reception mentioned that he was, but we have not spoken with him. His cell is: (416) 788-6391.",
      },
      {
        accountRecordId: "local-jeff-import-20260605-606b4b6288b597a4c4",
        businessAccountId: "LOCAL-JEFF-0345",
        companyName: "General Conveyor Inc.",
        time: "11:15-11:30",
        notes: "Jeff, we have not been able to confirm a point of contact. Lindy in reception says a person named Gord might be our contact.",
      },
      {
        accountRecordId: "local-jeff-import-20260605-aac62dcc18943bdaba",
        businessAccountId: "LOCAL-JEFF-0344",
        companyName: "Louisville Ladder",
        time: "11:45-12:00",
        notes: "David Martinez might be our point of contact. We need to confirm that and determine whether the account is worth keeping.",
      },
      {
        accountRecordId: "local-account-d33b0370-e0a3-4dd8-a41b-5705826d6029",
        businessAccountId: "LOCAL-68EC69FE-2FB",
        companyName: "C-P Flexible Packaging",
        time: "12:15-12:30",
        notes: "Jeff, this is a new company. We have not found a point of contact and want to see whether the account is worth pursuing.",
      },
      {
        accountRecordId: "local-account-80a4fd25-f936-41bb-b2c6-3e6aa7415439",
        businessAccountId: "LOCAL-1DB6C960-4C0",
        companyName: "Kirchhoff Automotive",
        time: "12:45-1:00",
        notes: "Rajeev Ganju might be our point of contact. Please confirm during the visit.",
      },
      {
        accountRecordId: "c5b019dc-4142-f111-8374-025dbe72350a",
        businessAccountId: "B200002527",
        companyName: "Cam Slide West",
        time: "1:15-1:30",
        notes: "Sumanth Kundula is our point of contact. We have not spoken with him and would like Jeff to make an introduction.",
      },
      {
        accountRecordId: "local-jeff-import-20260612-b003dec309829fdabf",
        businessAccountId: "LOCAL-JEFF-0916",
        companyName: "Norseman Solutions",
        time: "1:45-2:00",
        notes: "We need a verified point of contact and confirmation that the account is worth keeping.",
      },
      {
        accountRecordId: "local-jeff-import-20260605-ac2355364f58b3a1f3",
        businessAccountId: "LOCAL-JEFF-0350",
        companyName: "Stairfab",
        time: "2:15-2:30",
        notes: "Claudio may be our point of contact. Reception usually says he is away, so please confirm during the visit.",
      },
    ],
  },
  {
    week: 2,
    visits: [
      {
        accountRecordId: "local-jeff-import-20260605-0903c18948263fdef9",
        businessAccountId: "LOCAL-JEFF-0403",
        companyName: "Alloy Fusion Inc",
        time: "9:00-9:30",
        notes: "Jeff to meet with Sandra or Sergio to introduce himself, re-introduce MeadowBrook's company-wide trade facility services, review how we can support their operations, and hand over our trade facility package. Jeff can be reached at: (416) 819-3800. Sergio can be reached at: (647) 979-2956.",
      },
      {
        accountRecordId: "local-jeff-import-20260612-07302c7113bf075db4",
        businessAccountId: "LOCAL-JEFF-0987",
        companyName: "TS Tech Canada",
        time: "10:00-10:30",
        notes: "Jeff to meet with Stuart to introduce himself, re-introduce MeadowBrook's company-wide trade facility services, review how we can support their operations, and hand over our trade facility package. Jeff can be reached at: (416) 819-3800. Stuart can be reached at: (289) 383-6031.",
      },
      {
        accountRecordId: "local-jeff-import-20260605-1ae9cfe709216bd28a",
        businessAccountId: "LOCAL-JEFF-0408",
        companyName: "Ce De Candy Company Limited",
        time: "10:45-11:00",
        notes: "Andrew Kam is our point of contact. Jeff met with him previously, so this is a check-in while in the area.",
      },
      {
        accountRecordId: "local-account-9dab422f-63fd-4de9-b781-8e86697c4001",
        businessAccountId: "LOCAL-9A4F2760-BE9",
        companyName: "Canadian Plastics Group LTD",
        time: "11:15-11:30",
        notes: "Mike is a potential point of contact but has been difficult to reach. Please make an introduction or leave the trade facility package.",
      },
      {
        accountRecordId: "local-account-1075b52b-75e6-471d-af44-d978dd8fa245",
        businessAccountId: "LOCAL-0B89EFD3-296",
        companyName: "Mars Incorporated",
        time: "11:45-12:00",
        notes: "We need a verified point of contact and confirmation that this location manufactures.",
      },
      {
        accountRecordId: "local-jeff-import-20260605-97be26d79398c078cf",
        businessAccountId: "LOCAL-JEFF-0405",
        companyName: "Tri Star Metal Stamping",
        time: "12:15-12:30",
        notes: "We do not have a verified point of contact. Please confirm whether they manufacture, whether the account is worth keeping, and who the correct contact is.",
      },
      {
        accountRecordId: "928d4945-3242-f111-8374-025dbe72350a",
        businessAccountId: "B200002526",
        companyName: "Agility Tooling",
        time: "12:45-1:00",
        notes: "Jeff met with Stefan Mouradian previously. This visit is a check-in and package drop-off.",
      },
      {
        accountRecordId: "647f7196-a548-f111-bb0e-0255004b97ab",
        businessAccountId: "B200002548",
        companyName: "Descon Conveyor Systems",
        time: "1:15-1:30",
        notes: "Steve Nixon is our point of contact.",
      },
      {
        accountRecordId: "local-account-0dd24734-df3b-41e1-82b6-717cf4143127",
        businessAccountId: "LOCAL-CF7679A4-E28",
        companyName: "Acushnet Canada, Inc.",
        time: "1:45-2:00",
        notes: "We need a verified point of contact because we have not been able to get through to anyone.",
      },
    ],
  },
] as const;

const JEFF_SPECIAL_BASELINE_BY_ACCOUNT_RECORD_ID: Record<string, JeffSpecialReportSnapshot> = {
  "93976f17-7eed-f011-8370-025dbe72350a": {
    companyName: "CuBE Plastics",
    address: "200 Industrial Pkwy N, Aurora, ON L4G 4C3",
    city: "Aurora",
    companyPhone: "905-750-2823",
    contactName: "David Rubio",
    contactJobTitle: "Maintenance Manager",
    contactPhone: "877-260-2823",
    contactExtension: "",
    contactEmail: "david.rubio@cubep.com",
  },
  "local-account-129629d9-bd87-45fa-91e4-811ec616c067": {
    companyName: "Simply Goodz / Compass Food",
    address: "260 Industrial Pky N, Aurora, ON L4G 4C3",
    city: "Aurora",
    companyPhone: "905-713-0167",
    contactName: "Contact needed",
    contactJobTitle: "",
    contactPhone: "",
    contactExtension: "",
    contactEmail: "",
  },
  "local-jeff-import-20260605-706a5b3a5b580e2acb": {
    companyName: "Piramal Pharma Solutions",
    address: "110 Industrial Pky N, Aurora, ON L4G 4C3",
    city: "Aurora",
    companyPhone: "800-266-6444",
    contactName: "Tyler Clements",
    contactJobTitle: "",
    contactPhone: "",
    contactExtension: "",
    contactEmail: "tyler.clements@piramal.com",
  },
  "local-jeff-import-20260605-7078a3d47b03b929bf": {
    companyName: "Transcontinental Aurora",
    address: "275 Wellington St E, Aurora, ON L4G 6J9",
    city: "Aurora",
    companyPhone: "905-841-4400",
    contactName: "Tim Vanslingerland",
    contactJobTitle: "",
    contactPhone: "416-788-6391",
    contactExtension: "",
    contactEmail: "",
  },
  "local-jeff-import-20260605-606b4b6288b597a4c4": {
    companyName: "General Conveyor Inc.",
    address: "245 Industrial Pky S, Aurora, ON L4G 3V5",
    city: "Aurora",
    companyPhone: "905-727-7922",
    contactName: "Gord",
    contactJobTitle: "",
    contactPhone: "",
    contactExtension: "",
    contactEmail: "",
  },
  "local-jeff-import-20260605-aac62dcc18943bdaba": {
    companyName: "Louisville Ladder",
    address: "100 Engelhard Dr, Aurora, ON L4G 3V2",
    city: "Aurora",
    companyPhone: "800-666-2811",
    contactName: "David Martinez",
    contactJobTitle: "",
    contactPhone: "",
    contactExtension: "",
    contactEmail: "",
  },
  "local-account-d33b0370-e0a3-4dd8-a41b-5705826d6029": {
    companyName: "C-P Flexible Packaging",
    address: "285 Industrial Pky S, Aurora, ON L4G 3V8",
    city: "Aurora",
    companyPhone: "905-727-0121",
    contactName: "Contact needed",
    contactJobTitle: "",
    contactPhone: "",
    contactExtension: "",
    contactEmail: "",
  },
  "local-account-80a4fd25-f936-41bb-b2c6-3e6aa7415439": {
    companyName: "Kirchhoff Automotive",
    address: "200 Vandorf Siderd, Aurora, ON L4G 0A2",
    city: "Aurora",
    companyPhone: "905-727-8686",
    contactName: "Rajeev Ganju",
    contactJobTitle: "Procurement",
    contactPhone: "905-751-9995",
    contactExtension: "",
    contactEmail: "rajeev.ganju@kirchhoff-automotive.com",
  },
  "c5b019dc-4142-f111-8374-025dbe72350a": {
    companyName: "Cam Slide West",
    address: "550 Newpark Blvd, Newmarket, ON L3X 2S2",
    city: "Newmarket",
    companyPhone: "905-895-4701",
    contactName: "Sumanth Kundula",
    contactJobTitle: "Maintenance Manager",
    contactPhone: "905-895-4701",
    contactExtension: "",
    contactEmail: "sumanth.kundula@magna.com",
  },
  "local-jeff-import-20260612-b003dec309829fdabf": {
    companyName: "Norseman Solutions",
    address: "6-402 Mulock Dr, Newmarket, ON L3Y 9B8",
    city: "Newmarket",
    companyPhone: "905-895-9956",
    contactName: "Contact needed",
    contactJobTitle: "",
    contactPhone: "",
    contactExtension: "",
    contactEmail: "",
  },
  "local-jeff-import-20260605-ac2355364f58b3a1f3": {
    companyName: "Stairfab",
    address: "A-450 Kent Dr, Newmarket, ON L3Y 4Y9",
    city: "Newmarket",
    companyPhone: "905-895-1050",
    contactName: "Claudio",
    contactJobTitle: "",
    contactPhone: "",
    contactExtension: "",
    contactEmail: "",
  },
  "local-jeff-import-20260605-0903c18948263fdef9": {
    companyName: "Alloy Fusion Inc",
    address: "395 Harry Walker Pky S, Newmarket, ON L3Y 8T3",
    city: "Newmarket",
    companyPhone: "905-750-0003",
    contactName: "Sergio / Sandra",
    contactJobTitle: "",
    contactPhone: "647-979-2956",
    contactExtension: "",
    contactEmail: "",
  },
  "local-jeff-import-20260612-07302c7113bf075db4": {
    companyName: "TS Tech Canada",
    address: "17855 Leslie St, Newmarket, ON L3Y 3E3",
    city: "Newmarket",
    companyPhone: "905-953-0098",
    contactName: "Stuart Craig",
    contactJobTitle: "Maintenance",
    contactPhone: "289-383-6031",
    contactExtension: "",
    contactEmail: "stuart.craig@tstech.com",
  },
  "local-jeff-import-20260605-1ae9cfe709216bd28a": {
    companyName: "Ce De Candy Company Limited",
    address: "150 Harry Walker Pky N, Newmarket, ON L3Y 7B2",
    city: "Newmarket",
    companyPhone: "905-853-7171",
    contactName: "Andrew Kam",
    contactJobTitle: "Maintenance Manager",
    contactPhone: "905-853-7171",
    contactExtension: "128",
    contactEmail: "akam@cedecandy.ca",
  },
  "local-account-9dab422f-63fd-4de9-b781-8e86697c4001": {
    companyName: "Canadian Plastics Group LTD",
    address: "265 Pony Dr, Newmarket, ON L3Y 7B5",
    city: "Newmarket",
    companyPhone: "905-715-7826",
    contactName: "Michael Waddington",
    contactJobTitle: "VP of Operations",
    contactPhone: "",
    contactExtension: "",
    contactEmail: "",
  },
  "local-account-1075b52b-75e6-471d-af44-d978dd8fa245": {
    companyName: "Mars Incorporated",
    address: "285 Harry Walker Pky N, Newmarket, ON L3Y 7B3",
    city: "Newmarket",
    companyPhone: "905-853-6000",
    contactName: "Contact needed",
    contactJobTitle: "",
    contactPhone: "",
    contactExtension: "",
    contactEmail: "",
  },
  "local-jeff-import-20260605-97be26d79398c078cf": {
    companyName: "Tri Star Metal Stamping",
    address: "1-1267 Kerrisdale Blvd, Newmarket, ON L3Y 8W1",
    city: "Newmarket",
    companyPhone: "905-853-5583",
    contactName: "Contact needed",
    contactJobTitle: "",
    contactPhone: "",
    contactExtension: "",
    contactEmail: "",
  },
  "928d4945-3242-f111-8374-025dbe72350a": {
    companyName: "Agility Tooling",
    address: "1215 Kerrisdale Blvd, Newmarket, ON L3Y 8W1",
    city: "Newmarket",
    companyPhone: "905-830-0701",
    contactName: "Stefan Mouradian",
    contactJobTitle: "Maintenance Manager",
    contactPhone: "",
    contactExtension: "",
    contactEmail: "stefan.mouradian@agilitytooling.com",
  },
  "647f7196-a548-f111-bb0e-0255004b97ab": {
    companyName: "Descon Conveyor Systems",
    address: "1-1274 Ringwell Dr, Newmarket, ON L3Y 9C7",
    city: "Newmarket",
    companyPhone: "905-953-0455",
    contactName: "Steve Nixon",
    contactJobTitle: "",
    contactPhone: "",
    contactExtension: "",
    contactEmail: "",
  },
  "local-account-0dd24734-df3b-41e1-82b6-717cf4143127": {
    companyName: "Acushnet Canada, Inc.",
    address: "500 Harry Walker Pky N, East Gwillimbury, ON L9N 0M9",
    city: "East Gwillimbury",
    companyPhone: "905-898-7575",
    contactName: "Contact needed",
    contactJobTitle: "",
    contactPhone: "",
    contactExtension: "",
    contactEmail: "",
  },
};

function normalizeText(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function normalizeComparable(value: string | null | undefined): string {
  return normalizeText(value).toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function rowAccountRecordId(row: BusinessAccountRow): string {
  return normalizeText(row.accountRecordId) || normalizeText(row.id);
}

function groupRowsBy(
  rows: BusinessAccountRow[],
  valueForRow: (row: BusinessAccountRow) => string,
): Map<string, BusinessAccountRow[]> {
  const grouped = new Map<string, BusinessAccountRow[]>();
  for (const row of rows) {
    const value = normalizeComparable(valueForRow(row));
    if (!value) {
      continue;
    }
    const group = grouped.get(value) ?? [];
    group.push(row);
    grouped.set(value, group);
  }
  return grouped;
}

function contactCompleteness(row: BusinessAccountRow): number {
  return [
    sanitizeContactName(row.primaryContactName),
    sanitizeJobTitle(row.primaryContactJobTitle),
    sanitizePhone(row.primaryContactPhone),
    row.primaryContactExtension,
    sanitizeEmail(row.primaryContactEmail),
  ].filter((value) => normalizeText(value).length > 0).length;
}

function sanitizeContactName(value: string | null | undefined): string {
  const text = normalizeText(value);
  return /^(unknown|uknown|unkown|contact needed|no contact)$/i.test(text) ? "" : text;
}

function sanitizeJobTitle(value: string | null | undefined): string {
  const text = normalizeText(value);
  return /^(unknown|uknown|unkown|n\/a)$/i.test(text) ? "" : text;
}

function sanitizePhone(value: string | null | undefined): string {
  const text = normalizeText(value);
  const digits = text.replace(/\D/g, "");
  if (!digits || /^0+$/.test(digits)) {
    return "";
  }
  const nationalDigits = digits.length === 11 && digits.startsWith("1")
    ? digits.slice(1)
    : digits;
  return nationalDigits.length === 10
    ? `${nationalDigits.slice(0, 3)}-${nationalDigits.slice(3, 6)}-${nationalDigits.slice(6)}`
    : text;
}

function sanitizeEmail(value: string | null | undefined): string {
  const text = normalizeText(value);
  return /(?:unknown|uknown|unkown|dontknow|do-not-reply|noemail)/i.test(text) ? "" : text;
}

const COMPARISON_FIELDS: ReadonlyArray<{
  key: keyof JeffSpecialReportSnapshot;
  label: string;
  kind: "text" | "address" | "phone" | "contact" | "email";
}> = [
  { key: "companyName", label: "Company Name", kind: "text" },
  { key: "address", label: "Address", kind: "address" },
  { key: "city", label: "City", kind: "text" },
  { key: "companyPhone", label: "Company Phone", kind: "phone" },
  { key: "contactName", label: "Contact Name", kind: "contact" },
  { key: "contactJobTitle", label: "Job Title", kind: "text" },
  { key: "contactPhone", label: "Contact Phone", kind: "phone" },
  { key: "contactExtension", label: "Extension", kind: "phone" },
  { key: "contactEmail", label: "Email Address", kind: "email" },
];

function normalizeComparisonValue(
  value: string,
  kind: (typeof COMPARISON_FIELDS)[number]["kind"],
): string {
  if (kind === "phone") {
    const digits = value.replace(/\D/g, "");
    return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  }
  if (kind === "contact") {
    return normalizeComparable(sanitizeContactName(value));
  }
  if (kind === "email") {
    return sanitizeEmail(value).toLocaleLowerCase();
  }
  const comparable = normalizeComparable(value);
  return kind === "address"
    ? comparable.replace(/\s+(?:ca|canada)$/, "").trim()
    : comparable;
}

function currentSnapshot(visit: JeffSpecialResolvedVisit): JeffSpecialReportSnapshot {
  return {
    companyName: visit.companyName,
    address: visit.address,
    city: visit.city,
    companyPhone: visit.companyPhone,
    contactName: visit.contactName,
    contactJobTitle: visit.contactJobTitle,
    contactPhone: visit.contactPhone,
    contactExtension: visit.contactExtension,
    contactEmail: visit.contactEmail,
  };
}

function buildDifferences(weeks: JeffSpecialReportWeek[]): JeffSpecialReportDifference[] {
  const differences: JeffSpecialReportDifference[] = [];
  for (const week of weeks) {
    for (const visit of week.visits) {
      if (!visit.matched) {
        differences.push({
          week: week.week,
          time: visit.time,
          companyName: visit.original.companyName,
          field: "CRM Record",
          originalValue: visit.original.companyName,
          currentValue: "Not found",
          result: "CRM record missing",
        });
        continue;
      }

      const current = currentSnapshot(visit);
      for (const field of COMPARISON_FIELDS) {
        const originalValue = visit.original[field.key];
        const currentValue = current[field.key];
        const originalComparable = normalizeComparisonValue(originalValue, field.kind);
        const currentComparable = normalizeComparisonValue(currentValue, field.kind);
        if (originalComparable === currentComparable) {
          continue;
        }
        differences.push({
          week: week.week,
          time: visit.time,
          companyName: visit.original.companyName,
          field: field.label,
          originalValue,
          currentValue,
          result: !originalComparable
            ? "Added"
            : !currentComparable
              ? "Removed"
              : "Changed",
        });
      }
    }
  }
  return differences;
}

function addressCompleteness(row: BusinessAccountRow): number {
  return [
    row.addressLine1,
    row.addressLine2,
    row.city,
    row.state,
    row.postalCode,
    row.country,
  ].filter((value) => normalizeText(value).length > 0).length;
}

function chooseAccountRow(rows: BusinessAccountRow[]): BusinessAccountRow {
  return [...rows].sort(
    (left, right) =>
      addressCompleteness(right) - addressCompleteness(left) ||
      Number(Boolean(right.companyPhone)) - Number(Boolean(left.companyPhone)) ||
      normalizeText(left.rowKey).localeCompare(normalizeText(right.rowKey)),
  )[0];
}

function chooseContactRow(rows: BusinessAccountRow[]): BusinessAccountRow {
  return [...rows].sort(
    (left, right) =>
      contactCompleteness(right) +
        (right.isPrimaryContact && contactCompleteness(right) > 0 ? 6 : 0) -
        (contactCompleteness(left) +
          (left.isPrimaryContact && contactCompleteness(left) > 0 ? 6 : 0)) ||
      normalizeText(left.primaryContactName).localeCompare(normalizeText(right.primaryContactName)),
  )[0];
}

function fullAddress(row: BusinessAccountRow): string {
  const street = [normalizeText(row.addressLine1), normalizeText(row.addressLine2)]
    .filter(Boolean)
    .join(", ");
  const locality = [normalizeText(row.city), normalizeText(row.state), normalizeText(row.postalCode)]
    .filter(Boolean)
    .join(" ");
  const structuredAddress = [street, locality, normalizeText(row.country)].filter(Boolean).join(", ");
  const savedAddress = normalizeText(row.address);
  return savedAddress && (!normalizeText(row.state) || !normalizeText(row.country))
    ? savedAddress
    : structuredAddress || savedAddress;
}

function firstText(values: Array<string | null | undefined>): string {
  return values.map(normalizeText).find(Boolean) ?? "";
}

function resolveVisit(
  definition: JeffSpecialVisitDefinition,
  rowsByAccountRecordId: Map<string, BusinessAccountRow[]>,
  rowsByBusinessAccountId: Map<string, BusinessAccountRow[]>,
  rowsByCompanyName: Map<string, BusinessAccountRow[]>,
): JeffSpecialResolvedVisit {
  const original = JEFF_SPECIAL_BASELINE_BY_ACCOUNT_RECORD_ID[definition.accountRecordId] ?? {
    companyName: definition.companyName,
    address: "",
    city: "",
    companyPhone: "",
    contactName: "",
    contactJobTitle: "",
    contactPhone: "",
    contactExtension: "",
    contactEmail: "",
  };
  const matchingRows =
    rowsByAccountRecordId.get(normalizeComparable(definition.accountRecordId)) ??
    rowsByBusinessAccountId.get(normalizeComparable(definition.businessAccountId)) ??
    rowsByCompanyName.get(normalizeComparable(definition.companyName)) ??
    [];
  if (matchingRows.length === 0) {
    return {
      ...definition,
      matched: false,
      original,
      address: "",
      city: "",
      companyPhone: "",
      contactName: "",
      contactJobTitle: "",
      contactPhone: "",
      contactExtension: "",
      contactEmail: "",
    };
  }

  const accountRow = chooseAccountRow(matchingRows);
  const contactRow = chooseContactRow(matchingRows);
  return {
    ...definition,
    accountRecordId: rowAccountRecordId(accountRow) || definition.accountRecordId,
    businessAccountId: normalizeText(accountRow.businessAccountId) || definition.businessAccountId,
    companyName: normalizeText(accountRow.companyName) || definition.companyName,
    matched: true,
    original,
    address: fullAddress(accountRow),
    city: normalizeText(accountRow.city),
    companyPhone: sanitizePhone(
      firstText(matchingRows.map((row) => row.companyPhone ?? row.phoneNumber)),
    ),
    contactName: sanitizeContactName(contactRow.primaryContactName),
    contactJobTitle: sanitizeJobTitle(contactRow.primaryContactJobTitle),
    contactPhone: sanitizePhone(contactRow.primaryContactPhone),
    contactExtension: normalizeText(contactRow.primaryContactExtension),
    contactEmail: sanitizeEmail(contactRow.primaryContactEmail),
  };
}

export function buildJeffSpecialReportPlan(
  rows: BusinessAccountRow[],
  generatedAt: Date = new Date(),
): JeffSpecialReportPlan {
  const rowsByAccountRecordId = groupRowsBy(rows, rowAccountRecordId);
  const rowsByBusinessAccountId = groupRowsBy(rows, (row) => normalizeText(row.businessAccountId));
  const rowsByCompanyName = groupRowsBy(rows, (row) => normalizeText(row.companyName));
  const weeks = JEFF_SPECIAL_REPORT_VISITS.map((week) => ({
    week: week.week,
    visits: week.visits.map((visit) =>
      resolveVisit(visit, rowsByAccountRecordId, rowsByBusinessAccountId, rowsByCompanyName),
    ),
  }));
  const visits = weeks.flatMap((week) => week.visits);
  const missingCompanyNames = visits
    .filter((visit) => !visit.matched)
    .map((visit) => visit.companyName);
  return {
    generatedAt: generatedAt.toISOString(),
    accountTotal: visits.length,
    matchedAccountTotal: visits.length - missingCompanyNames.length,
    missingAccountTotal: missingCompanyNames.length,
    missingCompanyNames,
    differences: buildDifferences(weeks),
    weeks,
  };
}
