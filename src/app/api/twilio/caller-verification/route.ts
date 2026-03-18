export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { type AuthCookieRefreshState, validateSessionWithAcumatica } from "@/lib/acumatica";
import { withServiceAcumaticaSession } from "@/lib/acumatica-service-auth";
import {
  readCallerIdVerification,
  saveFailedCallerIdVerification,
  savePendingCallerIdVerification,
  saveVerifiedCallerIdVerification,
} from "@/lib/caller-id-verifications";
import {
  readCallerPhoneOverride,
  saveCallerPhoneOverride,
} from "@/lib/caller-phone-overrides";
import { resolveSignedInCallerIdentity } from "@/lib/caller-identity";
import {
  getAuthCookieValue,
  getStoredLoginName,
  normalizeSessionIdentity,
  setAuthCookie,
} from "@/lib/auth";
import { HttpError, getErrorMessage } from "@/lib/errors";
import {
  clearTwilioPhoneInventoryCache,
  createTwilioRestClient,
  readTwilioPhoneInventory,
} from "@/lib/twilio";

type VerificationResponse =
  | {
      status: "idle";
      phoneNumber: null;
    }
  | {
      status: "pending";
      phoneNumber: string;
      validationCode: string;
      callSid: string;
      updatedAt: string;
    }
  | {
      status: "verified";
      phoneNumber: string;
      verifiedAt: string | null;
      updatedAt: string;
    }
  | {
      status: "failed";
      phoneNumber: string;
      message: string;
      updatedAt: string;
    };

async function resolveSignedInEmployeePhone(
  cookieValue: string,
  loginName: string,
  authCookieRefresh: AuthCookieRefreshState,
  employeeId: string | null,
) {
  try {
    return await resolveSignedInCallerIdentity(cookieValue, loginName, authCookieRefresh, {
      preferredEmployeeId: employeeId,
    });
  } catch (error) {
    if (!(error instanceof HttpError) || ![403, 422].includes(error.status)) {
      throw error;
    }

    return withServiceAcumaticaSession(null, (serviceCookieValue, serviceAuthCookieRefresh) =>
      resolveSignedInCallerIdentity(
        serviceCookieValue,
        loginName,
        serviceAuthCookieRefresh,
        {
          allowFullDirectorySync: false,
          preferredEmployeeId: employeeId,
        },
      ),
    );
  }
}

function buildResponse(record: ReturnType<typeof readCallerIdVerification>): VerificationResponse {
  if (!record) {
    return {
      status: "idle",
      phoneNumber: null,
    };
  }

  if (record.status === "verified") {
    return {
      status: "verified",
      phoneNumber: record.phoneNumber,
      verifiedAt: record.verifiedAt,
      updatedAt: record.updatedAt,
    };
  }

  if (record.status === "failed") {
    return {
      status: "failed",
      phoneNumber: record.phoneNumber,
      message: record.failureMessage ?? "Verification failed.",
      updatedAt: record.updatedAt,
    };
  }

  return {
    status: "pending",
    phoneNumber: record.phoneNumber,
    validationCode: record.validationCode ?? "",
    callSid: record.callSid ?? "",
    updatedAt: record.updatedAt,
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const cookieValue = getAuthCookieValue(request);
  const loginName = getStoredLoginName(request);
  if (!cookieValue || !loginName) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  try {
    let record = readCallerIdVerification(loginName);
    if (record?.status === "pending") {
      const inventory = await readTwilioPhoneInventory({ forceRefresh: true });
      if (inventory.allowedCallerIds.has(record.phoneNumber)) {
        clearTwilioPhoneInventoryCache();
        saveCallerPhoneOverride(loginName, record.phoneNumber);
        record = saveVerifiedCallerIdVerification({
          loginName,
          phoneNumber: record.phoneNumber,
        });
      }
    }

    return NextResponse.json(buildResponse(record));
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: error instanceof HttpError ? error.status : 500 },
    );
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const cookieValue = getAuthCookieValue(request);
  if (!cookieValue) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const loginName = getStoredLoginName(request);
  if (!loginName) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const authCookieRefresh: AuthCookieRefreshState = { value: null };
  const storedOverridePhone = readCallerPhoneOverride(loginName)?.phoneNumber ?? null;
  let resolvedPhoneNumber: string | null = storedOverridePhone;
  let callerDisplayName = loginName;

  try {
    if (!storedOverridePhone) {
      const sessionPayload = await validateSessionWithAcumatica(cookieValue, authCookieRefresh);
      const sessionIdentity = normalizeSessionIdentity(sessionPayload);
      const callerIdentity = await resolveSignedInEmployeePhone(
        authCookieRefresh.value ?? cookieValue,
        loginName,
        authCookieRefresh,
        sessionIdentity?.employeeId ?? null,
      );
      resolvedPhoneNumber = callerIdentity.userPhone;
      callerDisplayName = callerIdentity.displayName;
      saveCallerPhoneOverride(loginName, callerIdentity.userPhone);
    }

    if (!resolvedPhoneNumber) {
      throw new HttpError(
        422,
        "Calling is unavailable until your phone number is configured.",
      );
    }

    const inventory = await readTwilioPhoneInventory({ forceRefresh: true });
    if (inventory.allowedCallerIds.has(resolvedPhoneNumber)) {
      clearTwilioPhoneInventoryCache();
      const verified = saveVerifiedCallerIdVerification({
        loginName,
        phoneNumber: resolvedPhoneNumber,
      });
      const response = NextResponse.json(buildResponse(verified));
      if (authCookieRefresh.value) {
        setAuthCookie(response, authCookieRefresh.value);
      }
      return response;
    }

    const existing = readCallerIdVerification(loginName);
    const existingUpdatedAtMs = existing ? Date.parse(existing.updatedAt) : Number.NaN;
    if (
      existing?.status === "pending" &&
      existing.phoneNumber === resolvedPhoneNumber &&
      Number.isFinite(existingUpdatedAtMs) &&
      Date.now() - existingUpdatedAtMs < 2 * 60_000 &&
      existing.validationCode &&
      existing.callSid
    ) {
      const response = NextResponse.json(buildResponse(existing));
      if (authCookieRefresh.value) {
        setAuthCookie(response, authCookieRefresh.value);
      }
      return response;
    }

    const client = createTwilioRestClient();
    if (!client) {
      throw new HttpError(503, "Twilio outbound calling is not configured.");
    }

    const validation = await client.validationRequests.create({
      phoneNumber: resolvedPhoneNumber,
      friendlyName: callerDisplayName.slice(0, 64),
    });

    const pending = savePendingCallerIdVerification({
      loginName,
      phoneNumber: validation.phoneNumber,
      validationCode: validation.validationCode,
      callSid: validation.callSid,
    });

    const response = NextResponse.json(buildResponse(pending));
    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }
    return response;
  } catch (error) {
    const response =
      error instanceof HttpError
        ? NextResponse.json({ error: error.message, details: error.details }, { status: error.status })
        : NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });

    if (resolvedPhoneNumber && error instanceof Error) {
      saveFailedCallerIdVerification({
        loginName,
        phoneNumber: resolvedPhoneNumber,
        failureMessage: error.message,
      });
    }

    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }
    return response;
  }
}
