/**
 * Watchdog email notifications.
 *
 * Sends a summary email via the configured mail service when the watchdog
 * takes a meaningful repair action.
 */

import { readCallEmployeeDirectory } from "@/lib/call-analytics/employee-directory";
import { getErrorMessage } from "@/lib/errors";
import { buildMailServiceAssertion, ensureMailServiceConfigured } from "@/lib/mail-auth";
import type { MailComposePayload } from "@/types/mail-compose";
import type { WatchdogAction, WatchdogReport } from "@/lib/watchdog";

const WATCHDOG_RECIPIENT_EMAIL = "jserrano@meadowb.com";
const WATCHDOG_RECIPIENT_LOGIN = "jserrano";

type WatchdogMailbox = {
  loginName: string;
  displayName: string;
  senderEmail: string;
  contactId: number;
};

const activeNotificationKeys = new Set<string>();

function normalizeComparable(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function buildSubject(report: WatchdogReport): string {
  const fixed = report.actions.filter((action) => action.result === "fixed").length;
  const failed = report.actions.filter((action) => action.result === "failed").length;
  const requeued = report.actions.filter((action) => action.result === "requeued").length;
  const skipped = report.actions.filter((action) => action.result === "skipped").length;

  const parts: string[] = [];
  if (fixed > 0) parts.push(`${fixed} fixed`);
  if (requeued > 0) parts.push(`${requeued} requeued`);
  if (skipped > 0) parts.push(`${skipped} skipped`);
  if (failed > 0) parts.push(`${failed} failed`);

  return `[watchdog] ${parts.join(", ") || "no changes"}`;
}

function formatActionHtml(action: WatchdogAction): string {
  return [
    `<strong>${action.sessionId}</strong>`,
    `Issue: ${action.issue}`,
    `Action: ${action.action} -> ${action.result}`,
    `Detail: ${action.detail}`,
  ].join("<br>");
}

function formatActionText(action: WatchdogAction): string {
  return [
    action.sessionId,
    `Issue: ${action.issue}`,
    `Action: ${action.action} -> ${action.result}`,
    `Detail: ${action.detail}`,
  ].join("\n");
}

function buildBodyHtml(report: WatchdogReport): string {
  const timestamp = new Date(report.ranAt).toLocaleString("en-CA", {
    timeZone: "America/Toronto",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const header = `<p>Watchdog ran at <strong>${timestamp}</strong>. Checked ${report.checked} jobs in ${report.durationMs}ms.</p>`;
  const sections = report.actions
    .map(formatActionHtml)
    .join("<hr style='border:none;border-top:1px solid #ddd;margin:12px 0'>");

  return `${header}<div style="font-family:monospace;font-size:13px;line-height:1.6">${sections}</div>`;
}

function buildBodyText(report: WatchdogReport): string {
  const header = `Watchdog ran at ${report.ranAt}. Checked ${report.checked} jobs in ${report.durationMs}ms.`;
  const sections = report.actions.map(formatActionText).join("\n\n---\n\n");
  return `${header}\n\n${sections}`.trim();
}

function resolveWatchdogMailbox(): WatchdogMailbox | null {
  const directory = readCallEmployeeDirectory();
  const normalizedEmail = normalizeComparable(WATCHDOG_RECIPIENT_EMAIL);
  const normalizedLogin = normalizeComparable(WATCHDOG_RECIPIENT_LOGIN);

  const employee =
    directory.find((item) => normalizeComparable(item.email) === normalizedEmail) ??
    directory.find((item) => normalizeComparable(item.loginName) === normalizedLogin) ??
    null;

  if (!employee?.email || !employee.contactId) {
    return null;
  }

  return {
    loginName: employee.loginName,
    displayName: employee.displayName || employee.loginName,
    senderEmail: employee.email,
    contactId: employee.contactId,
  };
}

function buildNotificationPayload(
  report: WatchdogReport,
  mailbox: WatchdogMailbox,
): MailComposePayload {
  const recipient = {
    email: mailbox.senderEmail,
    name: mailbox.displayName,
    contactId: mailbox.contactId,
    businessAccountRecordId: null,
    businessAccountId: null,
  };

  return {
    threadId: null,
    draftId: null,
    subject: buildSubject(report),
    htmlBody: buildBodyHtml(report),
    textBody: buildBodyText(report),
    to: [recipient],
    cc: [],
    bcc: [],
    linkedContact: {
      contactId: mailbox.contactId,
      businessAccountRecordId: null,
      businessAccountId: null,
      contactName: mailbox.displayName,
      companyName: null,
    },
    matchedContacts: [
      {
        contactId: mailbox.contactId,
        businessAccountRecordId: null,
        businessAccountId: null,
        contactName: mailbox.displayName,
        companyName: null,
        email: mailbox.senderEmail,
      },
    ],
    attachments: [],
    sourceSurface: "mail",
  };
}

export async function sendWatchdogNotification(report: WatchdogReport): Promise<void> {
  const currentKeys = new Set(
    report.actions
      .map((action) => normalizeComparable(action.notificationKey))
      .filter(Boolean),
  );
  for (const key of [...activeNotificationKeys]) {
    if (!currentKeys.has(key)) {
      activeNotificationKeys.delete(key);
    }
  }

  const meaningful = report.actions.filter((action) => action.result !== "skipped");
  const pending = meaningful.filter((action) => {
    const key = normalizeComparable(action.notificationKey);
    return !key || !activeNotificationKeys.has(key);
  });
  if (pending.length === 0) {
    return;
  }

  let serviceUrl: string;
  try {
    const config = ensureMailServiceConfigured();
    serviceUrl = config.serviceUrl;
  } catch {
    console.warn("[watchdog] mail service is not configured; skipping notification");
    return;
  }

  const mailbox = resolveWatchdogMailbox();
  if (!mailbox) {
    console.warn("[watchdog] notification mailbox is unavailable; skipping email");
    return;
  }

  const assertion = buildMailServiceAssertion({
    loginName: mailbox.loginName,
    senderEmail: mailbox.senderEmail,
    displayName: mailbox.displayName,
  });
  const normalizedBase = serviceUrl.replace(/\/$/, "");
  const payload = buildNotificationPayload(
    {
      ...report,
      actions: pending,
    },
    mailbox,
  );

  try {
    const response = await fetch(`${normalizedBase}/api/mail/messages/send`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${assertion}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    if (!response.ok) {
      const text = await response.text();
      console.warn("[watchdog] notification email failed", {
        status: response.status,
        body: text.slice(0, 500),
      });
      return;
    }

    for (const action of pending) {
      const key = normalizeComparable(action.notificationKey);
      if (key) {
        activeNotificationKeys.add(key);
      }
    }
  } catch (error) {
    console.warn("[watchdog] notification email error", {
      error: getErrorMessage(error),
    });
  }
}
