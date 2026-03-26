/**
 * Watchdog email notifications.
 *
 * Sends a summary email via the mail service when the watchdog
 * detects and acts on errors.
 */

import { getEnv } from "@/lib/env";
import { getErrorMessage } from "@/lib/errors";
import { buildMailServiceAssertion, ensureMailServiceConfigured } from "@/lib/mail-auth";
import type { WatchdogAction, WatchdogReport } from "@/lib/watchdog";

const WATCHDOG_RECIPIENT = "jserrano@meadowb.com";
const WATCHDOG_SENDER_LOGIN = "watchdog";
const WATCHDOG_SENDER_NAME = "Sales App Watchdog";

function buildSubject(report: WatchdogReport): string {
  const fixed = report.actions.filter((a) => a.result === "fixed").length;
  const failed = report.actions.filter((a) => a.result === "failed").length;
  const requeued = report.actions.filter((a) => a.result === "requeued").length;
  const skipped = report.actions.filter((a) => a.result === "skipped").length;

  const parts: string[] = [];
  if (fixed > 0) parts.push(`${fixed} fixed`);
  if (requeued > 0) parts.push(`${requeued} requeued`);
  if (skipped > 0) parts.push(`${skipped} skipped`);
  if (failed > 0) parts.push(`${failed} failed`);

  const summary = parts.join(", ");
  const icon = failed > 0 ? "⚠️" : "✅";
  return `${icon} Watchdog: ${summary}`;
}

function formatAction(action: WatchdogAction): string {
  const badge =
    action.result === "fixed"
      ? "✅"
      : action.result === "requeued"
        ? "🔄"
        : action.result === "skipped"
          ? "⏭️"
          : "❌";

  return [
    `${badge} <strong>${action.sessionId}</strong>`,
    `Issue: ${action.issue}`,
    `Action: ${action.action} → ${action.result}`,
    `Detail: ${action.detail}`,
  ].join("<br>");
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

  const header = `<p>Watchdog ran at <strong>${timestamp}</strong> — checked ${report.checked} jobs in ${report.durationMs}ms.</p>`;

  const sections = report.actions.map(formatAction).join("<hr style='border:none;border-top:1px solid #ddd;margin:12px 0'>");

  return `${header}<div style="font-family:monospace;font-size:13px;line-height:1.6">${sections}</div>`;
}

export async function sendWatchdogNotification(report: WatchdogReport): Promise<void> {
  // Only notify if the watchdog actually did something
  const meaningful = report.actions.filter((a) => a.result !== "skipped");
  if (meaningful.length === 0) {
    return;
  }

  let serviceUrl: string;
  try {
    const config = ensureMailServiceConfigured();
    serviceUrl = config.serviceUrl;
  } catch {
    console.warn("[watchdog] Mail service not configured — skipping notification.");
    return;
  }

  const assertion = buildMailServiceAssertion({
    loginName: WATCHDOG_SENDER_LOGIN,
    senderEmail: WATCHDOG_RECIPIENT,
    displayName: WATCHDOG_SENDER_NAME,
  });

  const normalizedBase = serviceUrl.replace(/\/$/, "");

  try {
    const response = await fetch(`${normalizedBase}/api/mail/messages/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${assertion}`,
      },
      body: JSON.stringify({
        to: WATCHDOG_RECIPIENT,
        subject: buildSubject(report),
        htmlBody: buildBodyHtml(report),
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      const text = await response.text();
      console.warn("[watchdog] Notification email failed.", {
        status: response.status,
        body: text.slice(0, 500),
      });
    }
  } catch (error) {
    console.warn("[watchdog] Notification email error.", {
      error: getErrorMessage(error),
    });
  }
}
