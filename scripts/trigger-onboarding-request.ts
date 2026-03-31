#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

import { createManualOnboardingRequest } from "@/lib/onboarding-automation";

type Options = {
  businessAccountId: string;
  opportunityId: string;
  contactId: number | null;
  contactEmail: string | null;
  contactName: string | null;
  opportunityStage: string | null;
  opportunityStatus: string | null;
};

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

function parseArgs(argv: string[]): Options {
  const options: Options = {
    businessAccountId: "",
    opportunityId: "",
    contactId: null,
    contactEmail: null,
    contactName: null,
    opportunityStage: null,
    opportunityStatus: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--business-account-id") {
      options.businessAccountId = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--opportunity-id") {
      options.opportunityId = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--contact-id") {
      const raw = argv[index + 1];
      const numeric = raw ? Number(raw) : NaN;
      options.contactId = Number.isFinite(numeric) ? numeric : null;
      index += 1;
      continue;
    }
    if (arg === "--contact-email") {
      options.contactEmail = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === "--contact-name") {
      options.contactName = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === "--stage") {
      options.opportunityStage = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === "--status") {
      options.opportunityStatus = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
  }

  return options;
}

async function main(): Promise<void> {
  const rootDir = path.resolve(__dirname, "..");
  loadLocalEnv(rootDir);
  const options = parseArgs(process.argv.slice(2));

  if (!options.businessAccountId.trim() || !options.opportunityId.trim()) {
    throw new Error(
      "Usage: npx tsx scripts/trigger-onboarding-request.ts --business-account-id <id> --opportunity-id <id> [--contact-email <email>] [--contact-name <name>]",
    );
  }

  const result = await createManualOnboardingRequest({
    businessAccountId: options.businessAccountId,
    opportunityId: options.opportunityId,
    contactId: options.contactId,
    contactEmail: options.contactEmail,
    contactName: options.contactName,
    opportunityStage: options.opportunityStage,
    opportunityStatus: options.opportunityStatus,
  });

  console.log("Onboarding request result:");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
