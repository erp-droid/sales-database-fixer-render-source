export const runtime = "nodejs";

import { writeFile } from "node:fs/promises";

import { NextRequest, NextResponse } from "next/server";

import { fetchContactById, readWrappedString } from "@/lib/acumatica";
import {
  getStoredLoginName,
  requireAuthCookieValue,
  setAuthCookie,
} from "@/lib/auth";
import { readCallEmployeeDirectory } from "@/lib/call-analytics/employee-directory";
import { getErrorMessage } from "@/lib/errors";
import { repairMailActivitySync } from "@/lib/mail-activity-sync";
import { attachMatchedContactsToMailPayload } from "@/lib/mail-recipient-matches";
import { requestMailService } from "@/lib/mail-proxy";

const TEST_RESULT_PATH = "/tmp/meadowbrook-mail-activity-test.json";
const TEST_ACCOUNT_ID = "02670D2595";
const TEST_CONTACT_NAME = "Jorge Serrano";
const TEST_CONTACT_EMAIL = "jserrano@meadowb.com";
const TEST_EXTERNAL_RECIPIENT_EMAIL = "activity-log-test@example.com";

type AuthCookieRefreshState = {
  value: string | null;
};

async function readJsonResponse(response: Response): Promise<unknown> {
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.includes("application/json")) {
    return null;
  }

  return response.json().catch(() => null);
}

async function persistResult(payload: unknown): Promise<void> {
  await writeFile(TEST_RESULT_PATH, JSON.stringify(payload, null, 2), "utf8");
}

function buildHtmlBody(bodyText: string): string {
  const escaped = bodyText
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
  return `<p>${escaped}</p>`;
}

async function buildSenderMatchedRequestBody(
  request: NextRequest,
  basePayload: Record<string, unknown>,
  authCookieRefresh: AuthCookieRefreshState,
): Promise<Record<string, unknown>> {
  const loginName = getStoredLoginName(request)?.trim().toLowerCase() ?? "";
  if (!loginName) {
    return attachMatchedContactsToMailPayload(request, basePayload, authCookieRefresh);
  }

  const employee =
    readCallEmployeeDirectory().find(
      (candidate) => candidate.loginName.trim().toLowerCase() === loginName,
    ) ?? null;
  if (!employee?.contactId) {
    return attachMatchedContactsToMailPayload(request, basePayload, authCookieRefresh);
  }

  try {
    const cookieValue = requireAuthCookieValue(request);
    const contact = await fetchContactById(
      cookieValue,
      employee.contactId,
      authCookieRefresh,
    );
    return {
      ...basePayload,
      matchedContacts: [
        {
          contactId: employee.contactId,
          businessAccountRecordId: null,
          businessAccountId:
            readWrappedString(contact, "BusinessAccountID") ||
            readWrappedString(contact, "BusinessAccount") ||
            null,
          contactName:
            readWrappedString(contact, "DisplayName") ||
            employee.displayName ||
            null,
          companyName: readWrappedString(contact, "CompanyName") || null,
          email:
            readWrappedString(contact, "Email") ||
            employee.email ||
            null,
        },
      ],
    };
  } catch {
    return attachMatchedContactsToMailPayload(request, basePayload, authCookieRefresh);
  }
}

export async function GET(request: NextRequest) {
  const authCookieRefresh: AuthCookieRefreshState = { value: null };
  const mode = request.nextUrl.searchParams.get("mode")?.trim().toLowerCase() || "direct";
  const senderMatchMode = mode === "sender-match";
  const subject =
    request.nextUrl.searchParams.get("subject")?.trim() ||
    `Acumatica email activity test ${senderMatchMode ? "sender-match" : "direct"} ${new Date().toISOString()}`;
  const bodyText =
    request.nextUrl.searchParams.get("body")?.trim() ||
    "This is a MeadowBrook Acumatica email activity verification entry created without sending Gmail.";

  try {
    const basePayload = {
      businessAccountId: senderMatchMode ? null : TEST_ACCOUNT_ID,
      businessAccountRecordId: senderMatchMode ? null : TEST_ACCOUNT_ID,
      contactName: senderMatchMode ? null : TEST_CONTACT_NAME,
      contactEmail: senderMatchMode ? null : TEST_CONTACT_EMAIL,
      subject,
      textBody: bodyText,
      htmlBody: buildHtmlBody(bodyText),
      to: [
        senderMatchMode
          ? {
              email: TEST_EXTERNAL_RECIPIENT_EMAIL,
              name: "Activity Log Test Recipient",
              contactId: null,
              businessAccountRecordId: null,
              businessAccountId: null,
            }
          : {
              email: TEST_CONTACT_EMAIL,
              name: TEST_CONTACT_NAME,
              contactId: null,
              businessAccountRecordId: TEST_ACCOUNT_ID,
              businessAccountId: TEST_ACCOUNT_ID,
            },
      ],
      linkedContact: senderMatchMode
        ? {
            contactId: null,
            businessAccountRecordId: null,
            businessAccountId: null,
            contactName: null,
            companyName: null,
          }
        : {
            contactId: null,
            businessAccountRecordId: TEST_ACCOUNT_ID,
            businessAccountId: TEST_ACCOUNT_ID,
            contactName: TEST_CONTACT_NAME,
            companyName: "MeadowBrook Construction - Internal",
          },
      sourceSurface: "accounts" as const,
      cc: [],
      bcc: [],
      attachments: [],
      threadId: null,
      draftId: null,
    };
    const requestBody = senderMatchMode
      ? await buildSenderMatchedRequestBody(request, basePayload, authCookieRefresh)
      : basePayload;

    const logResponse = await requestMailService(request, {
      path: "/api/mail/activities/log",
      method: "POST",
      forwardAcumaticaSession: true,
      authCookieRefresh,
      body: requestBody,
    });
    const rawLogPayload = await readJsonResponse(logResponse);
    const logPayload = await repairMailActivitySync(
      request,
      requestBody,
      rawLogPayload,
      authCookieRefresh,
    );

    const lastEmailedResponse = await requestMailService(request, {
      path: "/api/mail/last-emailed",
      method: "POST",
      forwardAcumaticaSession: true,
      authCookieRefresh,
      body: {
        accounts: [
          {
            businessAccountRecordId: TEST_ACCOUNT_ID,
            businessAccountId: TEST_ACCOUNT_ID,
          },
        ],
      },
    });
    const lastEmailedPayload = await readJsonResponse(lastEmailedResponse);

    const result = {
      logged: logResponse.ok,
      verified:
        logResponse.ok &&
        typeof logPayload === "object" &&
        logPayload !== null &&
        "activitySyncStatus" in logPayload &&
        (logPayload as { activitySyncStatus?: string }).activitySyncStatus === "synced" &&
        "activityId" in logPayload &&
        Boolean((logPayload as { activityId?: string | null }).activityId),
      account: TEST_ACCOUNT_ID,
      mode,
      contact: {
        name: TEST_CONTACT_NAME,
        email: TEST_CONTACT_EMAIL,
      },
      matchedContacts:
        requestBody && typeof requestBody === "object" && "matchedContacts" in requestBody
          ? (requestBody as { matchedContacts?: unknown }).matchedContacts ?? []
          : [],
      subject,
      bodyText,
      logStatus: logResponse.status,
      logPayload,
      lastEmailedStatus: lastEmailedResponse.status,
      lastEmailedPayload,
      resultPath: TEST_RESULT_PATH,
      createdAt: new Date().toISOString(),
    };

    await persistResult(result);

    const response = NextResponse.json(result, {
      status: result.verified ? 200 : 502,
    });
    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }

    return response;
  } catch (error) {
    const payload = {
      logged: false,
      verified: false,
      account: TEST_ACCOUNT_ID,
      contact: {
        name: TEST_CONTACT_NAME,
        email: TEST_CONTACT_EMAIL,
      },
      subject,
      bodyText,
      error: getErrorMessage(error),
      resultPath: TEST_RESULT_PATH,
      createdAt: new Date().toISOString(),
    };
    await persistResult(payload);

    const response = NextResponse.json(payload, { status: 500 });
    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }

    return response;
  }
}
