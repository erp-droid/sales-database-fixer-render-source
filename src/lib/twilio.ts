import twilio from "twilio";

import { getEnv } from "@/lib/env";
import { formatPhoneForTwilioDial } from "@/lib/phone";

type SessionUser = {
  id: string;
  name: string;
} | null;

export type TwilioVoiceConfig = {
  accountSid: string;
  apiKeySid: string;
  apiKeySecret: string;
  authToken: string;
  twimlAppSid: string;
  callerId: string;
  edge: string;
};

export type TwilioRestConfig = {
  accountSid: string;
  authToken: string;
};

export type TwilioPhoneInventory = {
  accountType: string;
  allowedCallerIds: Set<string>;
  voiceNumbers: string[];
};

let cachedInventory:
  | {
      expiresAt: number;
      inventory: TwilioPhoneInventory;
    }
  | null = null;

export function clearTwilioPhoneInventoryCache(): void {
  cachedInventory = null;
}

export function getTwilioVoiceConfig(): TwilioVoiceConfig | null {
  const env = getEnv();
  if (
    !env.TWILIO_ACCOUNT_SID ||
    !env.TWILIO_API_KEY_SID ||
    !env.TWILIO_API_KEY_SECRET ||
    !env.TWILIO_AUTH_TOKEN ||
    !env.TWILIO_TWIML_APP_SID ||
    !env.TWILIO_CALLER_ID
  ) {
    return null;
  }

  return {
    accountSid: env.TWILIO_ACCOUNT_SID,
    apiKeySid: env.TWILIO_API_KEY_SID,
    apiKeySecret: env.TWILIO_API_KEY_SECRET,
    authToken: env.TWILIO_AUTH_TOKEN,
    twimlAppSid: env.TWILIO_TWIML_APP_SID,
    callerId: env.TWILIO_CALLER_ID,
    edge: env.TWILIO_EDGE ?? "ashburn",
  };
}

export function getTwilioRestConfig(): TwilioRestConfig | null {
  const env = getEnv();
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
    return null;
  }

  return {
    accountSid: env.TWILIO_ACCOUNT_SID,
    authToken: env.TWILIO_AUTH_TOKEN,
  };
}

export function createTwilioRestClient(): ReturnType<typeof twilio> | null {
  const config = getTwilioRestConfig();
  if (!config) {
    return null;
  }

  return twilio(config.accountSid, config.authToken);
}

export function normalizeTwilioPhoneNumber(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return formatPhoneForTwilioDial(value);
}

export async function readTwilioPhoneInventory(
  options?: {
    forceRefresh?: boolean;
  },
): Promise<TwilioPhoneInventory> {
  if (!options?.forceRefresh && cachedInventory && cachedInventory.expiresAt > Date.now()) {
    return cachedInventory.inventory;
  }

  const client = createTwilioRestClient();
  const config = getTwilioRestConfig();
  if (!client || !config) {
    throw new Error("Twilio outbound calling is not configured.");
  }

  const [account, incomingNumbers, outgoingCallerIds] = await Promise.all([
    client.api.accounts(config.accountSid).fetch(),
    client.incomingPhoneNumbers.list({ limit: 50 }),
    client.outgoingCallerIds.list({ limit: 50 }),
  ]);

  const allowedCallerIds = new Set<string>();
  const voiceNumbers = incomingNumbers
    .filter((item) => item.capabilities?.voice)
    .map((item) => normalizeTwilioPhoneNumber(item.phoneNumber))
    .filter((item): item is string => Boolean(item));

  for (const voiceNumber of voiceNumbers) {
    allowedCallerIds.add(voiceNumber);
  }

  for (const outgoingCallerId of outgoingCallerIds) {
    const normalized = normalizeTwilioPhoneNumber(outgoingCallerId.phoneNumber);
    if (normalized) {
      allowedCallerIds.add(normalized);
    }
  }

  const inventory = {
    accountType: account.type ?? "",
    allowedCallerIds,
    voiceNumbers,
  };

  cachedInventory = {
    expiresAt: Date.now() + 5 * 60_000,
    inventory,
  };

  return inventory;
}

export function buildTwilioIdentity(user: SessionUser): string {
  const base =
    user?.id?.trim() ||
    user?.name?.trim() ||
    "authenticated-user";

  const sanitized = base
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

  return sanitized || "authenticated-user";
}
