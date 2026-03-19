import { getEnv } from "@/lib/env";
import { readWrappedString } from "@/lib/acumatica";
import type {
  OpportunityClassOption,
  OpportunityCreateOptionsResponse,
  OpportunityCreateRequest,
  OpportunityProjectType,
} from "@/types/opportunity-create";

export const OPPORTUNITY_PROJECT_TYPE_OPTIONS: Array<{
  value: OpportunityProjectType;
  label: OpportunityProjectType;
}> = [
  { value: "Construct", label: "Construct" },
  { value: "Electrical", label: "Electrical" },
  { value: "HVAC", label: "HVAC" },
  { value: "M-Trade", label: "M-Trade" },
  { value: "Plumbing", label: "Plumbing" },
];

function readText(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toIsoWithOffset(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function dedupeClassOptions(values: Array<string | null | undefined>): OpportunityClassOption[] {
  const byComparable = new Map<string, OpportunityClassOption>();

  values.forEach((value) => {
    const normalized = readText(value);
    if (!normalized) {
      return;
    }

    const comparable = normalized.toLowerCase();
    if (!byComparable.has(comparable)) {
      byComparable.set(comparable, {
        value: normalized,
        label: normalized,
      });
    }
  });

  return [...byComparable.values()];
}

export function buildOpportunityClassOptions(): OpportunityClassOption[] {
  const env = getEnv();

  return dedupeClassOptions([
    env.ACUMATICA_OPPORTUNITY_CLASS_DEFAULT,
    env.ACUMATICA_OPPORTUNITY_CLASS_SERVICE,
    env.ACUMATICA_OPPORTUNITY_CLASS_GLENDALE,
    "PRODUCTION",
    "SERVICE",
    "GLENDALE",
  ]);
}

export function buildOpportunityCreateOptions(): OpportunityCreateOptionsResponse {
  const env = getEnv();
  const classOptions = buildOpportunityClassOptions();

  return {
    classOptions,
    defaultClassId:
      readText(env.ACUMATICA_OPPORTUNITY_CLASS_DEFAULT) ??
      classOptions[0]?.value ??
      "PRODUCTION",
    defaultStage:
      readText(env.ACUMATICA_OPPORTUNITY_STAGE_DEFAULT) ?? "Awaiting Estimate",
    defaultLocation: readText(env.ACUMATICA_OPPORTUNITY_LOCATION_DEFAULT) ?? "",
    defaultOwnerName: readText(env.ACUMATICA_OPPORTUNITY_OWNER_DEFAULT),
    defaultEstimationDate: toIsoWithOffset(
      env.ACUMATICA_OPPORTUNITY_ESTIMATION_OFFSET_DAYS,
    ),
    defaultLinkToDrive: "",
    projectTypeOptions: OPPORTUNITY_PROJECT_TYPE_OPTIONS,
    requiredAttributeLabels: {
      willWinJob: env.ACUMATICA_OPPORTUNITY_ATTR_WIN_JOB_ID,
      linkToDrive: env.ACUMATICA_OPPORTUNITY_ATTR_LINK_TO_DRIVE_ID,
      projectType: env.ACUMATICA_OPPORTUNITY_ATTR_PROJECT_TYPE_ID,
    },
  };
}

export function resolveOpportunityLocation(rawAccount: unknown): string {
  const fallback = getEnv().ACUMATICA_OPPORTUNITY_LOCATION_DEFAULT;

  return (
    readText(readWrappedString(rawAccount, "Location")) ||
    readText(readWrappedString(rawAccount, "LocationID")) ||
    readText(readWrappedString(rawAccount, "LocationCD")) ||
    readText(readWrappedString(rawAccount, "DefaultLocation")) ||
    readText(fallback) ||
    ""
  );
}

export function buildRequiredOpportunityAttributes(
  request: Pick<
    OpportunityCreateRequest,
    "willWinJob" | "linkToDrive" | "projectType"
  >,
): Array<Record<string, { value: string }>> {
  const env = getEnv();

  return [
    {
      AttributeID: {
        value: env.ACUMATICA_OPPORTUNITY_ATTR_WIN_JOB_ID,
      },
      Value: {
        value: request.willWinJob,
      },
    },
    {
      AttributeID: {
        value: env.ACUMATICA_OPPORTUNITY_ATTR_LINK_TO_DRIVE_ID,
      },
      Value: {
        value: request.linkToDrive,
      },
    },
    {
      AttributeID: {
        value: env.ACUMATICA_OPPORTUNITY_ATTR_PROJECT_TYPE_ID,
      },
      Value: {
        value: request.projectType,
      },
    },
  ];
}

export function buildOpportunityCreatePayload(input: {
  request: OpportunityCreateRequest;
  ownerValue?: string | null;
}): Record<string, unknown> {
  const ownerValue = readText(input.ownerValue);
  const note = readText(input.request.note);
  const stageValue =
    readText(input.request.stage) ??
    buildOpportunityCreateOptions().defaultStage;

  return {
    ClassID: {
      value: input.request.classId,
    },
    BusinessAccount: {
      value: input.request.businessAccountId,
    },
    Location: {
      value: input.request.location,
    },
    ContactID: {
      value: String(input.request.contactId),
    },
    StageID: {
      value: stageValue,
    },
    Subject: {
      value: input.request.subject,
    },
    Estimation: {
      value: input.request.estimationDate,
    },
    ...(note
      ? {
          note: {
            value: note,
          },
        }
      : {}),
    ...(ownerValue
      ? {
          Owner: {
            value: ownerValue,
          },
        }
      : {}),
    Attributes: buildRequiredOpportunityAttributes(input.request),
  };
}

export function isOpportunityOwnerNotFoundErrorMessage(
  message: string | null | undefined,
): boolean {
  if (!message) {
    return false;
  }

  const normalized = message.trim().toLowerCase();
  return (
    normalized.includes("owner") &&
    (normalized.includes("cannot be found") ||
      normalized.includes("not found") ||
      normalized.includes("does not exist") ||
      normalized.includes("is invalid"))
  );
}
