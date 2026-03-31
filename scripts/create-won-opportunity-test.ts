#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

import { buildCookieHeader } from "@/lib/auth";
import {
  createBusinessAccount,
  createContact,
  createOpportunity,
  fetchOpportunities,
  readOpportunityId,
  readWrappedNumber,
  readWrappedScalarString,
  readWrappedString,
} from "@/lib/acumatica";
import { withServiceAcumaticaSession } from "@/lib/acumatica-service-auth";
import {
  buildBusinessAccountCreatePayload,
  buildContactCreatePayload,
} from "@/lib/business-account-create";
import {
  buildOpportunityCreateOptions,
  buildOpportunityCreatePayload,
} from "@/lib/opportunity-create";
import { getEnv } from "@/lib/env";
import type {
  BusinessAccountCreateRequest,
  BusinessAccountContactCreateRequest,
} from "@/types/business-account-create";
import type { OpportunityCreateRequest } from "@/types/opportunity-create";

type AttemptResult = {
  entity: string;
  statusValue: string | null;
  stageValue: string | null;
};

class AcumaticaRequestError extends Error {
  status: number;
  body: string;

  constructor(status: number, body: string) {
    super(`Acumatica request failed (${status}).`);
    this.status = status;
    this.body = body;
  }
}

function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const content = fs.readFileSync(filePath, "utf8");
  const values: Record<string, string> = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    values[key] = value;
  }

  return values;
}

function loadLocalEnv(rootDir: string): void {
  const envValues = parseEnvFile(path.join(rootDir, ".env.local"));
  for (const [key, value] of Object.entries(envValues)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function buildSuffix(): string {
  const now = new Date();
  return now.toISOString().replace(/[^0-9]/g, "").slice(0, 14);
}

function readBusinessAccountId(raw: unknown): string | null {
  return (
    readWrappedScalarString(raw, "BusinessAccountID") ||
    readWrappedScalarString(raw, "BusinessAccountId") ||
    readWrappedScalarString(raw, "BAccountID") ||
    readWrappedScalarString(raw, "AccountID") ||
    readWrappedScalarString(raw, "AcctCD") ||
    readWrappedString(raw, "BusinessAccount") ||
    null
  );
}

async function requestAcumaticaRaw(
  cookieValue: string,
  resourcePath: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const env = getEnv();
  const normalizedPath = resourcePath.startsWith("/")
    ? resourcePath
    : `/${resourcePath}`;
  const url = `${env.ACUMATICA_BASE_URL}${env.ACUMATICA_ENTITY_PATH}${normalizedPath}`;
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Cookie: buildCookieHeader(cookieValue),
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const text = await response.text();
  if (!response.ok) {
    throw new AcumaticaRequestError(response.status, text);
  }

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function buildOpportunityEntities(): string[] {
  const env = getEnv();
  return [
    env.ACUMATICA_OPPORTUNITY_ENTITY,
    "Opportunity",
    "Opportunities",
    "CROpportunity",
  ]
    .map((value) => value?.trim())
    .filter((value, index, array) => value && array.indexOf(value) === index) as string[];
}

function isRecoverableOpportunityUpdateError(error: unknown): boolean {
  return (
    error instanceof AcumaticaRequestError &&
    [400, 404, 405, 500].includes(error.status)
  );
}

async function markOpportunityWon(
  cookieValue: string,
  opportunityId: string,
): Promise<AttemptResult> {
  const entityCandidates = buildOpportunityEntities();
  const statusValues = ["Won", "Closed Won", "ClosedWon"];
  const stageValues = ["Won", "Closed Won", "ClosedWon"];
  const attempts: Array<{ statusValue: string | null; stageValue: string | null }> = [
    { statusValue: "Won", stageValue: null },
    { statusValue: null, stageValue: "Won" },
    { statusValue: "Won", stageValue: "Won" },
    ...statusValues
      .flatMap((statusValue) =>
        stageValues.map((stageValue) => ({ statusValue, stageValue })),
      )
      .filter(
        (candidate) =>
          candidate.statusValue !== "Won" || candidate.stageValue !== "Won",
      ),
  ];

  let lastError: unknown = null;

  for (const entity of entityCandidates) {
    for (const attempt of attempts) {
      const payload: Record<string, unknown> = {
        OpportunityID: { value: opportunityId },
      };
      if (attempt.statusValue) {
        payload.Status = { value: attempt.statusValue };
      }
      if (attempt.stageValue) {
        payload.StageID = { value: attempt.stageValue };
      }

      try {
        await requestAcumaticaRaw(cookieValue, `/${entity}`, payload);
        return {
          entity,
          statusValue: attempt.statusValue,
          stageValue: attempt.stageValue,
        };
      } catch (error) {
        if (!isRecoverableOpportunityUpdateError(error)) {
          throw error;
        }
        lastError = error;
      }
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }

  throw new Error("Failed to mark the opportunity as won.");
}

async function main(): Promise<void> {
  const rootDir = path.resolve(__dirname, "..");
  loadLocalEnv(rootDir);
  const env = getEnv();
  const suffix = buildSuffix();

  const companyName = `Onboarding Test ${suffix}`;
  const contactDisplayName = `Test Contact ${suffix}`;
  const contactEmail = `onboarding-test-${suffix}@meadowb.com`;

  const businessRequest: BusinessAccountCreateRequest = {
    companyName,
    companyDescription: "Automated onboarding test account.",
    classId: "LEAD",
    salesRepId: null,
    salesRepName: null,
    companyPhone: "555-0100",
    industryType: "Service",
    subCategory: "General",
    companyRegion: "Region 1",
    week: "Week 1",
    category: "A",
    addressLookupId: "manual",
    addressLine1: "123 Test Street",
    addressLine2: "",
    city: "Toronto",
    state: "ON",
    postalCode: "M5V 2T6",
    country: "CA",
  };

  const contactRequest: BusinessAccountContactCreateRequest = {
    displayName: contactDisplayName,
    jobTitle: "Billing",
    email: contactEmail,
    phone1: "555-0100",
    extension: null,
    contactClass: "billing",
  };

  await withServiceAcumaticaSession(null, async (cookieValue, authCookieRefresh) => {
    const createdAccount = await createBusinessAccount(
      cookieValue,
      buildBusinessAccountCreatePayload(businessRequest),
      authCookieRefresh,
    );
    const businessAccountId = readBusinessAccountId(createdAccount);
    if (!businessAccountId) {
      throw new Error("Acumatica did not return a BusinessAccountID.");
    }

    const createdContact = await createContact(
      cookieValue,
      buildContactCreatePayload({
        request: contactRequest,
        businessAccountId,
        companyName,
      }),
      authCookieRefresh,
    );
    const contactId = readWrappedNumber(createdContact, "ContactID");
    if (!contactId) {
      throw new Error("Acumatica did not return a ContactID.");
    }

    const opportunityDefaults = buildOpportunityCreateOptions();
    const opportunityRequest: OpportunityCreateRequest = {
      businessAccountRecordId: businessAccountId,
      businessAccountId,
      contactId,
      subject: `Onboarding Test Opportunity ${suffix}`,
      classId: opportunityDefaults.defaultClassId,
      location: opportunityDefaults.defaultLocation || "MAIN",
      stage: "Won",
      estimationDate: new Date().toISOString(),
      note: "Created by onboarding automation test.",
      willWinJob: "Yes",
      linkToDrive:
        env.ACUMATICA_OPPORTUNITY_LINK_TO_DRIVE_DEFAULT || "N/A",
      projectType: "Construct",
      ownerId: null,
      ownerName: null,
    };

    let createdOpportunity;
    try {
      createdOpportunity = await createOpportunity(
        cookieValue,
        buildOpportunityCreatePayload({ request: opportunityRequest }),
        authCookieRefresh,
      );
    } catch (error) {
      opportunityRequest.stage = opportunityDefaults.defaultStage;
      createdOpportunity = await createOpportunity(
        cookieValue,
        buildOpportunityCreatePayload({ request: opportunityRequest }),
        authCookieRefresh,
      );
    }

    const opportunityId = readOpportunityId(createdOpportunity);
    if (!opportunityId) {
      throw new Error("Acumatica did not return an Opportunity ID.");
    }

    const effectiveCookie = authCookieRefresh.value ?? cookieValue;
    const updateResult = await markOpportunityWon(effectiveCookie, opportunityId);

    console.log("Created test data:");
    console.log(`- Business Account: ${companyName} (${businessAccountId})`);
    console.log(`- Contact: ${contactDisplayName} (ContactID ${contactId})`);
    console.log(`- Opportunity: ${opportunityId}`);
    console.log(
      `- Marked won via ${updateResult.entity} (status=${updateResult.statusValue ?? "n/a"}, stage=${updateResult.stageValue ?? "n/a"})`,
    );
    try {
      const verification = await fetchOpportunities(
        effectiveCookie,
        {
          filter: `OpportunityID eq '${opportunityId.replace(/'/g, "''")}'`,
          maxRecords: 1,
          select: ["OpportunityID", "Stage", "StageID", "Status", "StatusID"],
        },
        authCookieRefresh,
      );

      const verified = verification[0] ?? null;
      const verifiedStage =
        (verified && readWrappedString(verified, "Stage")) ||
        (verified && readWrappedString(verified, "StageID")) ||
        null;
      const verifiedStatus =
        (verified && readWrappedString(verified, "Status")) ||
        (verified && readWrappedString(verified, "StatusID")) ||
        null;

      console.log(
        `- Verified status=${verifiedStatus ?? "n/a"} stage=${verifiedStage ?? "n/a"}`,
      );
    } catch (error) {
      console.log("- Verification skipped (opportunity lookup failed).");
    }
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
