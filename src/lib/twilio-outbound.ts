import twilio from "twilio";

import {
  type AuthCookieRefreshState,
  findContactsByEmailSubstring,
  type RawContact,
} from "@/lib/acumatica";
import { HttpError } from "@/lib/errors";
import { getEnv } from "@/lib/env";
import {
  isExcludedInternalCompanyName,
  isExcludedInternalContactEmail,
} from "@/lib/internal-records";
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

function readWrappedString(record: RawContact, key: string): string | null {
  if (!record || typeof record !== "object") {
    return null;
  }

  const field = record[key];
  if (!field || typeof field !== "object") {
    return null;
  }

  const value = (field as Record<string, unknown>).value;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readWrappedNumber(record: RawContact, key: string): number | null {
  if (!record || typeof record !== "object") {
    return null;
  }

  const field = record[key];
  if (!field || typeof field !== "object") {
    return null;
  }

  const value = (field as Record<string, unknown>).value;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function readWrappedBoolean(record: RawContact, key: string): boolean {
  if (!record || typeof record !== "object") {
    return false;
  }

  const field = record[key];
  if (!field || typeof field !== "object") {
    return false;
  }

  return Boolean((field as Record<string, unknown>).value);
}

function readContactPhone(record: RawContact): string | null {
  return (
    readWrappedString(record, "Phone1") ??
    readWrappedString(record, "Phone2") ??
    readWrappedString(record, "Phone3")
  );
}

function readContactEmail(record: RawContact): string | null {
  return readWrappedString(record, "Email") ?? readWrappedString(record, "EMail");
}

function readContactDisplayName(record: RawContact): string | null {
  return (
    readWrappedString(record, "DisplayName") ??
    readWrappedString(record, "FullName") ??
    readWrappedString(record, "ContactName")
  );
}

function readContactCompanyName(record: RawContact): string | null {
  return readWrappedString(record, "CompanyName");
}

function readContactLocalPart(email: string | null): string {
  if (!email) {
    return "";
  }

  const trimmed = email.trim().toLowerCase();
  const atIndex = trimmed.indexOf("@");
  return atIndex >= 0 ? trimmed.slice(0, atIndex) : trimmed;
}

function scoreCandidate(record: RawContact, loginName: string): number {
  const normalizedLogin = loginName.trim().toLowerCase();
  const email = readContactEmail(record);
  const companyName = readContactCompanyName(record);
  const displayName = readContactDisplayName(record);
  const phone = readContactPhone(record);

  let score = 0;
  if (isExcludedInternalContactEmail(email)) {
    score += 100;
  }
  if (isExcludedInternalCompanyName(companyName)) {
    score += 75;
  }
  if (readContactLocalPart(email) === normalizedLogin) {
    score += 50;
  }
  if (displayName?.trim()) {
    score += 10;
  }
  if (phone?.trim()) {
    score += 10;
  }
  if (readWrappedBoolean(record, "Active")) {
    score += 5;
  }

  return score;
}


export async function resolveCallerProfile(
  cookieValue: string,
  loginName: string,
  authCookieRefresh?: AuthCookieRefreshState,
): Promise<ResolvedCallerProfile> {
  const normalizedLogin = loginName.trim().toLowerCase();
  if (!normalizedLogin) {
    throw new HttpError(401, "Signed-in username is unavailable. Sign out and sign in again.");
  }

  const contacts = await findContactsByEmailSubstring(
    cookieValue,
    normalizedLogin,
    authCookieRefresh,
  );
  if (contacts.length === 0) {
    throw new HttpError(
      404,
      `No Acumatica contact was found for signed-in user '${normalizedLogin}'.`,
    );
  }

  const bestCandidate = [...contacts]
    .sort((left, right) => scoreCandidate(right, normalizedLogin) - scoreCandidate(left, normalizedLogin))
    .find((record) => normalizeTwilioPhoneNumber(readContactPhone(record)) !== null);

  if (!bestCandidate) {
    throw new HttpError(
      422,
      `The signed-in user '${normalizedLogin}' does not have a valid phone number in Acumatica.`,
    );
  }

  const userPhone = normalizeTwilioPhoneNumber(readContactPhone(bestCandidate));
  if (!userPhone) {
    throw new HttpError(
      422,
      `The signed-in user '${normalizedLogin}' does not have a valid phone number in Acumatica.`,
    );
  }

  const client = createTwilioRestClient();
  if (!client) {
    throw new HttpError(503, "Twilio outbound calling is not configured.");
  }

  const inventory = await readTwilioPhoneInventory();
  const bridgeNumber = inventory.voiceNumbers[0] ?? null;
  if (!bridgeNumber) {
    throw new HttpError(
      503,
      "Twilio does not have a voice-capable phone number configured for this account.",
    );
  }

  const callerId =
    inventory.allowedCallerIds.has(userPhone)
      ? userPhone
      : normalizeTwilioPhoneNumber(getEnv().TWILIO_CALLER_ID);
  if (!callerId) {
    throw new HttpError(
      422,
      `Twilio cannot present ${userPhone} as caller ID. Verify that number in Twilio first.`,
    );
  }

  return {
    loginName: normalizedLogin,
    contactId: readWrappedNumber(bestCandidate, "ContactID"),
    displayName: readContactDisplayName(bestCandidate) ?? normalizedLogin,
    email: readContactEmail(bestCandidate),
    userPhone,
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
