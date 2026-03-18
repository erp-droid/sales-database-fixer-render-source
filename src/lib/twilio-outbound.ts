import twilio from "twilio";

import type { AuthCookieRefreshState } from "@/lib/acumatica";
import { withServiceAcumaticaSession } from "@/lib/acumatica-service-auth";
import {
  readCallerPhoneOverride,
  saveCallerPhoneOverride,
} from "@/lib/caller-phone-overrides";
import { readCallEmployeeDirectory } from "@/lib/call-analytics/employee-directory";
import { resolveSignedInCallerIdentity } from "@/lib/caller-identity";
import { HttpError } from "@/lib/errors";
import { createTwilioRestClient, normalizeTwilioPhoneNumber, readTwilioPhoneInventory } from "@/lib/twilio";

export type ResolvedCallerProfile = {
  loginName: string;
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

function readCachedCallerDirectoryItem(loginName: string): {
  contactId: number | null;
  displayName: string;
  email: string | null;
} | null {
  const normalizedLoginName = loginName.trim().toLowerCase();
  if (!normalizedLoginName) {
    return null;
  }

  const item =
    readCallEmployeeDirectory().find(
      (candidate) => candidate.loginName.trim().toLowerCase() === normalizedLoginName,
    ) ?? null;
  if (!item) {
    return null;
  }

  return {
    contactId: item.contactId ?? null,
    displayName: item.displayName.trim() || normalizedLoginName,
    email: item.email ?? null,
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
  let callerIdentity:
    | Awaited<ReturnType<typeof resolveSignedInCallerIdentity>>
    | null = null;
  let callerIdentityError: unknown = null;

  const client = createTwilioRestClient();
  if (!client) {
    throw new HttpError(503, "Twilio outbound calling is not configured.");
  }

  let inventory = await readTwilioPhoneInventory();
  const bridgeNumber = inventory.voiceNumbers[0] ?? null;
  if (!bridgeNumber) {
    throw new HttpError(
      503,
      "Twilio does not have a voice-capable phone number configured for this account.",
    );
  }

  if (cachedOverridePhone) {
    if (!inventory.allowedCallerIds.has(cachedOverridePhone)) {
      inventory = await readTwilioPhoneInventory({ forceRefresh: true });
    }
    if (!inventory.allowedCallerIds.has(cachedOverridePhone)) {
      throw new HttpError(
        422,
        `Twilio cannot present ${cachedOverridePhone} as caller ID for '${normalizedLoginName}'. Verify that employee number in Twilio first.`,
      );
    }

    return {
      loginName: normalizedLoginName,
      contactId: cachedCallerIdentity?.contactId ?? null,
      displayName: cachedCallerIdentity?.displayName ?? normalizedLoginName,
      email: cachedCallerIdentity?.email ?? null,
      userPhone: cachedOverridePhone,
      callerId: cachedOverridePhone,
      bridgeNumber,
    };
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
      "Calling is unavailable until the signed-in employee phone can be read from Acumatica.",
    );
  }

  const resolvedUserPhone = normalizeTwilioPhoneNumber(callerIdentity.userPhone);
  if (!resolvedUserPhone) {
    throw new HttpError(
      422,
      `Calling is unavailable for '${normalizedLoginName}'. Internal employee '${callerIdentity.displayName}' does not have a valid phone number in Acumatica.`,
    );
  }
  if (!inventory.allowedCallerIds.has(resolvedUserPhone)) {
    inventory = await readTwilioPhoneInventory({ forceRefresh: true });
  }
  if (!inventory.allowedCallerIds.has(resolvedUserPhone)) {
    throw new HttpError(
      422,
      `Twilio cannot present ${resolvedUserPhone} as caller ID for '${normalizedLoginName}'. Verify that employee number in Twilio first.`,
    );
  }
  const callerId = resolvedUserPhone;

  if (callerIdentity.userPhone) {
    try {
      saveCallerPhoneOverride(normalizedLoginName, callerIdentity.userPhone);
    } catch {
      // Keep outbound calling resilient even if the local cache write fails.
    }
  }

  return {
    loginName: callerIdentity.loginName,
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

  const inventory = await readTwilioPhoneInventory();
  if (
    inventory.accountType.toLowerCase() === "trial" &&
    !inventory.allowedCallerIds.has(normalizedTargetPhone)
  ) {
    throw new HttpError(
      422,
      `Twilio trial accounts can only call verified numbers. ${normalizedTargetPhone} is not verified in this Twilio account.`,
    );
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

  const call = await client.calls.create({
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
