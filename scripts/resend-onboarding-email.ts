#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

import { getEnv } from "@/lib/env";
import { HttpError } from "@/lib/errors";
import { sendOnboardingEmail } from "@/lib/onboarding-mailer";
import { getOnboardingRequest, updateOnboardingRequest } from "@/lib/onboarding-store";

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

function buildOnboardingUrl(token: string): string {
  const env = getEnv();
  if (!env.APP_BASE_URL) {
    throw new HttpError(500, "APP_BASE_URL must be configured.");
  }
  const base = env.APP_BASE_URL.replace(/\/$/, "");
  return `${base}/onboarding/${token}`;
}

async function main(): Promise<void> {
  const rootDir = path.resolve(__dirname, "..");
  loadLocalEnv(rootDir);

  const token = process.argv[2]?.trim();
  if (!token) {
    throw new Error("Usage: npx tsx scripts/resend-onboarding-email.ts <token>");
  }

  const record = await getOnboardingRequest(token);
  if (!record) {
    throw new Error(`Onboarding request not found for token ${token}.`);
  }

  const onboardingUrl = record.onboardingUrl || buildOnboardingUrl(token);
  const fallbackEmail =
    record.primaryContactEmail ||
    getEnv().ONBOARDING_EMAIL_OVERRIDE_TO ||
    "";
  if (!fallbackEmail) {
    throw new Error("No contact email is available to send the onboarding email.");
  }

  const mailResult = await sendOnboardingEmail({
    companyName: record.companyName,
    contactName: record.primaryContactName,
    contactEmail: fallbackEmail,
    onboardingUrl,
    opportunityId: record.opportunityId,
  });

  await updateOnboardingRequest(token, {
    emailSentAt: new Date().toISOString(),
    emailTo: mailResult.to,
    emailOverrideTo: mailResult.overrideTo,
    onboardingUrl,
  });

  console.log("Onboarding email resent.");
  console.log(`To: ${mailResult.to}`);
  console.log(`Subject: ${mailResult.subject}`);
  console.log(`Onboarding URL: ${onboardingUrl}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
