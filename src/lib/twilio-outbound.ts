import twilio from "twilio";

import type { AuthCookieRefreshState } from "@/lib/acumatica";
import { withServiceAcumaticaSession } from "@/lib/acumatica-service-auth";
import {
  readCallerPhoneOverride,
  saveCallerPhoneOverride,
} from "@/lib/caller-phone-overrides";
import {
  readCallerIdVerification,
  saveVerifiedCallerIdVerification,
} from "@/lib/caller-id-verifications";
import {
  readCallerIdentityProfile,
  saveCallerIdentityProfile,
} from "@/lib/caller-identity-cache";
import {
  readCallEmployeeDirectory,
  upsertCallEmployeeDirectoryItem,
} from "@/lib/call-analytics/employee-directory";
import { resolveSignedInCallerIdentity } from "@/lib/caller-identity";
import { HttpError, getErrorMessage } from "@/lib/errors";
import {
  createTwilioRestClient,
  getTwilioRestConfig,
  normalizeTwilioPhoneNumber,
  readTwilioPhoneInventory,
  type TwilioPhoneInventory,
} from "@/lib/twilio";

export type ResolvedCallerProfile = {
  loginName: string;
  employeeId: string | null;
  contactId: number | null;
  displayName: string;
  email: string | null;
  userPhone: string;
  callerId: string;
  bridgeNumber: string;
};

export type StartedBridgeCall = {
  sid: string;
  status: string | null;
  userPhone: string;
  targetPhone: string;
  callerId: string;
  bridgeNumber: string;
};

type CachedCallerDirectoryItem = {
  employeeId: string | null;
  contactId: number | null;
  displayName: string;
  email: string | null;
  userPhone: string | null;
};

function readCachedCallerDirectoryItem(loginName: string): {
  employeeId: string | null;
  contactId: number | null;
  displayName: string;
  email: string | null;
  userPhone: string | null;
} | null {
  const normalizedLoginName = loginName.trim().toLowerCase();
  if (!normalizedLoginName) {
    return null;
  }

  const canonicalIdentity = readCallerIdentityProfile(normalizedLoginName);
  const item =
    readCallEmployeeDirectory().find(
      (candidate) => candidate.loginName.trim().toLowerCase() === normalizedLoginName,
    ) ?? null;
  if (!item && !canonicalIdentity) {
    return null;
  }

  return {
    employeeId: canonicalIdentity?.employeeId ?? null,
    contactId: canonicalIdentity?.contactId ?? item?.contactId ?? null,
    displayName:
      canonicalIdentity?.displayName?.trim() ||
      item?.displayName.trim() ||
      normalizedLoginName,
    email: canonicalIdentity?.email ?? item?.email ?? null,
    userPhone:
      normalizeTwilioPhoneNumber(canonicalIdentity?.phoneNumber ?? null) ??
      normalizeTwilioPhoneNumber(item?.normalizedPhone ?? item?.callerIdPhone ?? null),
  };
}

function cacheResolvedCallerDirectoryItem(input: {
  loginName: string;
  employeeId: string | null;
  contactId: number | null;
  displayName: string;
  email: string | null;
  userPhone: string;
}): void {
  const normalizedLoginName = input.loginName.trim().toLowerCase();
  const normalizedUserPhone = normalizeTwilioPhoneNumber(input.userPhone);
  if (!normalizedLoginName || !normalizedUserPhone) {
    return;
  }

  try {
    saveCallerIdentityProfile({
      loginName: normalizedLoginName,
      employeeId: input.employeeId,
      contactId: input.contactId,
      displayName: input.displayName,
      email: input.email,
      phoneNumber: normalizedUserPhone,
    });
    upsertCallEmployeeDirectoryItem({
      loginName: normalizedLoginName,
      contactId: input.contactId ?? null,
      displayName: input.displayName.trim() || normalizedLoginName,
      email: input.email ?? null,
      normalizedPhone: normalizedUserPhone,
      callerIdPhone: normalizedUserPhone,
      isActive: true,
      updatedAt: new Date().toISOString(),
    });
  } catch {
    // Keep outbound calling resilient even if the local cache write fails.
  }
}

function assertAllowedCallerId(
  inventory: TwilioPhoneInventory,
  callerPhone: string,
  loginName: string,
): void {
  if (!inventory.allowedCallerIds.has(callerPhone)) {
    throw new HttpError(
      422,
      `Twilio cannot present ${callerPhone} as caller ID for '${loginName}'. Verify that employee number in Twilio first.`,
    );
  }
}

function readConfiguredBridgeNumber(): string | null {
  return normalizeTwilioPhoneNumber(getTwilioRestConfig()?.callerId ?? null);
}

async function resolveBridgeNumber(
  inventory?: TwilioPhoneInventory | null,
): Promise<{
  bridgeNumber: string;
  inventory: TwilioPhoneInventory | null;
}> {
  const configuredBridgeNumber = readConfiguredBridgeNumber();
  if (configuredBridgeNumber) {
    return {
      bridgeNumber: configuredBridgeNumber,
      inventory: inventory ?? null,
    };
  }

  const resolvedInventory = inventory ?? await readTwilioPhoneInventory();
  const bridgeNumber = resolvedInventory.voiceNumbers[0] ?? null;
  if (!bridgeNumber) {
    throw new HttpError(
      503,
      "Twilio does not have a voice-capable phone number configured for this account.",
    );
  }

  return {
    bridgeNumber,
    inventory: resolvedInventory,
  };
}

function hasVerifiedCallerId(loginName: string, phoneNumber: string): boolean {
  const record = readCallerIdVerification(loginName);
  return (
    record?.status === "verified" &&
    normalizeTwilioPhoneNumber(record.phoneNumber) === phoneNumber
  );
}

function markCallerIdVerified(loginName: string, phoneNumber: string): void {
  try {
    saveVerifiedCallerIdVerification({
      loginName,
      phoneNumber,
    });
  } catch {
    // Keep outbound calling resilient even if the verification cache write fails.
  }
}

async function ensureAllowedCallerId(input: {
  loginName: string;
  callerPhone: string;
  inventory: TwilioPhoneInventory | null;
}): Promise<TwilioPhoneInventory> {
  if (hasVerifiedCallerId(input.loginName, input.callerPhone)) {
    return input.inventory ?? {
      accountType: "",
      allowedCallerIds: new Set([input.callerPhone]),
      voiceNumbers: [],
    };
  }

  let inventory = input.inventory ?? await readTwilioPhoneInventory();
  if (!inventory.allowedCallerIds.has(input.callerPhone)) {
    inventory = await readTwilioPhoneInventory({ forceRefresh: true });
  }
  assertAllowedCallerId(inventory, input.callerPhone, input.loginName);
  markCallerIdVerified(input.loginName, input.callerPhone);
  return inventory;
}

function mapTwilioStartError(error: unknown, targetPhone: string): never {
  const message = getErrorMessage(error);
  const normalized = message.toLowerCase();
  if (
    normalized.includes("trial") &&
    (normalized.includes("verified") || normalized.includes("verify"))
  ) {
    throw new HttpError(
      422,
      `Twilio trial accounts can only call verified numbers. ${targetPhone} is not verified in this Twilio account.`,
    );
  }

  throw error;
}

function buildCachedCallerProfile(input: {
  loginName: string;
  cachedCallerIdentity: CachedCallerDirectoryItem | null;
  userPhone: string;
  bridgeNumber: string;
}): ResolvedCallerProfile {
  const displayName = input.cachedCallerIdentity?.displayName?.trim() || input.loginName;
  cacheResolvedCallerDirectoryItem({
    loginName: input.loginName,
    employeeId: input.cachedCallerIdentity?.employeeId ?? null,
    contactId: input.cachedCallerIdentity?.contactId ?? null,
    displayName,
    email: input.cachedCallerIdentity?.email ?? null,
    userPhone: input.userPhone,
  });

  return {
    loginName: input.loginName,
    employeeId: input.cachedCallerIdentity?.employeeId ?? null,
    contactId: input.cachedCallerIdentity?.contactId ?? null,
    displayName,
    email: input.cachedCallerIdentity?.email ?? null,
    userPhone: input.userPhone,
    callerId: input.userPhone,
    bridgeNumber: input.bridgeNumber,
  };
}

export async function resolveCallerProfile(
  cookieValue: string,
  loginName: string,
  authCookieRefresh?: AuthCookieRefreshState,
  options?: {
    employeeId?: string | null;
  },
): Promise<ResolvedCallerProfile> {
  const normalizedLoginName = loginName.trim().toLowerCase();
  const cachedOverridePhone = normalizeTwilioPhoneNumber(
    readCallerPhoneOverride(normalizedLoginName)?.phoneNumber ?? null,
  );
  const cachedCallerIdentity = readCachedCallerDirectoryItem(normalizedLoginName);
  const cachedIdentityPhone = normalizeTwilioPhoneNumber(cachedCallerIdentity?.userPhone ?? null);
  let callerIdentity:
    | Awaited<ReturnType<typeof resolveSignedInCallerIdentity>>
    | null = null;
  let callerIdentityError: unknown = null;

  const client = createTwilioRestClient();
  if (!client) {
    throw new HttpError(503, "Twilio outbound calling is not configured.");
  }

  const bridge = await resolveBridgeNumber();
  let inventory = bridge.inventory;
  const bridgeNumber = bridge.bridgeNumber;

  if (cachedOverridePhone) {
    inventory = await ensureAllowedCallerId({
      loginName: normalizedLoginName,
      callerPhone: cachedOverridePhone,
      inventory,
    });

    return buildCachedCallerProfile({
      loginName: normalizedLoginName,
      userPhone: cachedOverridePhone,
      cachedCallerIdentity,
      bridgeNumber,
    });
  }

  if (cachedIdentityPhone) {
    inventory = await ensureAllowedCallerId({
      loginName: normalizedLoginName,
      callerPhone: cachedIdentityPhone,
      inventory,
    });

    try {
      saveCallerPhoneOverride(normalizedLoginName, cachedIdentityPhone);
    } catch {
      // Keep outbound calling resilient even if the local cache write fails.
    }

    return buildCachedCallerProfile({
      loginName: normalizedLoginName,
      userPhone: cachedIdentityPhone,
      cachedCallerIdentity,
      bridgeNumber,
    });
  }

  try {
    callerIdentity = await resolveSignedInCallerIdentity(
      cookieValue,
      loginName,
      authCookieRefresh,
      {
        preferredEmployeeId: options?.employeeId ?? null,
      },
    );
  } catch (error) {
    callerIdentityError = error;
    if (
      error instanceof HttpError &&
      [403, 422].includes(error.status)
    ) {
      try {
        callerIdentity = await withServiceAcumaticaSession(
          null,
          (serviceCookieValue, serviceAuthCookieRefresh) =>
            resolveSignedInCallerIdentity(
              serviceCookieValue,
              normalizedLoginName,
              serviceAuthCookieRefresh,
              {
                allowFullDirectorySync: false,
                preferredEmployeeId: options?.employeeId ?? null,
              },
            ),
        );
      } catch (serviceError) {
        callerIdentityError = serviceError;
      }
    } else {
      throw error;
    }
  }

  if (!callerIdentity) {
    if (callerIdentityError instanceof HttpError) {
      throw callerIdentityError;
    }

    throw new HttpError(
      422,
      "Calling is unavailable until the signed-in employee phone can be read from source system.",
    );
  }

  const resolvedUserPhone = normalizeTwilioPhoneNumber(callerIdentity.userPhone);
  if (!resolvedUserPhone) {
    throw new HttpError(
      422,
      `Calling is unavailable for '${normalizedLoginName}'. Internal employee '${callerIdentity.displayName}' does not have a valid phone number in source system.`,
    );
  }
  inventory = await ensureAllowedCallerId({
    loginName: normalizedLoginName,
    callerPhone: resolvedUserPhone,
    inventory,
  });
  const callerId = resolvedUserPhone;

  if (callerIdentity.userPhone) {
    try {
      saveCallerPhoneOverride(normalizedLoginName, callerIdentity.userPhone);
    } catch {
      // Keep outbound calling resilient even if the local cache write fails.
    }
  }

  cacheResolvedCallerDirectoryItem({
    loginName: callerIdentity.loginName,
    employeeId: callerIdentity.employeeId ?? null,
    contactId: callerIdentity.contactId ?? null,
    displayName: callerIdentity.displayName,
    email: callerIdentity.email ?? null,
    userPhone: resolvedUserPhone,
  });

  return {
    loginName: callerIdentity.loginName,
    employeeId: callerIdentity.employeeId ?? null,
    contactId: callerIdentity.contactId ?? null,
    displayName: callerIdentity.displayName,
    email: callerIdentity.email ?? null,
    userPhone: resolvedUserPhone,
    callerId,
    bridgeNumber,
  };
}

export async function startBridgeCall(
  callerProfile: ResolvedCallerProfile,
  targetPhone: string,
  options?: {
    parentStatusCallback?: string;
    childStatusCallback?: string;
    recordingStatusCallback?: string;
  },
): Promise<StartedBridgeCall> {
  const normalizedTargetPhone = normalizeTwilioPhoneNumber(targetPhone);
  if (!normalizedTargetPhone) {
    throw new HttpError(422, "This phone number cannot be called.");
  }

  const client = createTwilioRestClient();
  if (!client) {
    throw new HttpError(503, "Twilio outbound calling is not configured.");
  }

  const response = new twilio.twiml.VoiceResponse();
  response.say("Please wait while we connect your call.");
  const dial = response.dial({
    callerId: callerProfile.callerId,
    answerOnBridge: true,
    ...(options?.recordingStatusCallback
      ? {
          record: "record-from-answer",
          recordingStatusCallback: options.recordingStatusCallback,
          recordingStatusCallbackMethod: "POST",
        }
      : {}),
  });
  if (options?.childStatusCallback) {
    dial.number(
      {
        statusCallback: options.childStatusCallback,
        statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
        statusCallbackMethod: "POST",
      },
      normalizedTargetPhone,
    );
  } else {
    dial.number(normalizedTargetPhone);
  }

  let call: Awaited<ReturnType<typeof client.calls.create>>;
  const startedAt = Date.now();
  try {
    call = await client.calls.create({
      to: callerProfile.userPhone,
      from: callerProfile.bridgeNumber,
      twiml: response.toString(),
      ...(options?.parentStatusCallback
        ? {
            statusCallback: options.parentStatusCallback,
            statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
            statusCallbackMethod: "POST",
          }
        : {}),
    });
  } catch (error) {
    mapTwilioStartError(error, normalizedTargetPhone);
  } finally {
    const durationMs = Date.now() - startedAt;
    if (durationMs >= 1000) {
      console.info("[twilio-call] calls.create timing", {
        durationMs,
      });
    }
  }

  return {
    sid: call.sid,
    status: call.status ?? null,
    userPhone: callerProfile.userPhone,
    targetPhone: normalizedTargetPhone,
    callerId: callerProfile.callerId,
    bridgeNumber: callerProfile.bridgeNumber,
  };
}

export async function endBridgeCall(callSid: string): Promise<void> {
  const trimmed = callSid.trim();
  if (!trimmed) {
    throw new HttpError(400, "Call SID is required.");
  }

  const client = createTwilioRestClient();
  if (!client) {
    throw new HttpError(503, "Twilio outbound calling is not configured.");
  }

  await client.calls(trimmed).update({ status: "completed" });
}
