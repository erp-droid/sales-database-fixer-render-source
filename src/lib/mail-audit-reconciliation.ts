import { logMailSendAudit } from "@/lib/audit-log-store";
import { readCallEmployeeDirectory } from "@/lib/call-analytics/employee-directory";
import { buildMailProxyAssertion } from "@/lib/mail-auth";
import { getReadModelDb } from "@/lib/read-model/db";
import type { MailLinkedContact } from "@/types/mail";
import type { MailMatchedContact, MailRecipient } from "@/types/mail-compose";

const DASHBOARD_SALES_REPS = new Set([
  "bkoczka",
  "jsettle",
  "kallen",
  "kpareek",
  "smesshah",
  "smessih",
  "stita",
]);

type StoredMailboxMessage = {
  messageId: string;
  internetMessageId: string;
  threadId: string;
  subject: string;
  sentAt: string | null;
  to: MailRecipient[];
  cc: MailRecipient[];
  bcc: MailRecipient[];
  linkedContact: MailLinkedContact | null;
  matchedContacts: MailMatchedContact[];
  activitySyncStatus: "pending" | "synced" | "failed" | "not_linked";
};

type StoredMailboxMessagesResponse = {
  items: StoredMailboxMessage[];
  total: number;
};

type ExistingEmailAudit = {
  id: string;
  actor_login_name: string | null;
  result_code: string;
};

export type MailboxAuditReconciliationResult = {
  mailboxesChecked: number;
  mailboxesFailed: number;
  messagesChecked: number;
  recovered: number;
  reattributed: number;
};

function clean(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function readExistingEmailAudit(messageId: string): ExistingEmailAudit | null {
  const row = getReadModelDb()
    .prepare(
      `
      SELECT id, actor_login_name, result_code
      FROM audit_events
      WHERE item_type = 'email'
        AND action_group = 'email_send'
        AND email_message_id = ?
      ORDER BY occurred_at DESC, id DESC
      LIMIT 1
      `,
    )
    .get(messageId) as ExistingEmailAudit | undefined;
  return row ?? null;
}

function isMailboxMessageResponse(value: unknown): value is StoredMailboxMessagesResponse {
  return Boolean(
    value &&
      typeof value === "object" &&
      Array.isArray((value as { items?: unknown }).items),
  );
}

function buildLocalMailServiceUrl(query: URLSearchParams): string {
  const port = clean(process.env.PORT) || "10000";
  const rawMountPath = clean(process.env.MBQ_BASE_PATH) || "/quotes";
  const mountPath = `/${rawMountPath.replace(/^\/+|\/+$/g, "")}`;
  return `http://127.0.0.1:${port}${mountPath}/api/mail/sent-app-messages?${query.toString()}`;
}

async function requestLocalMailboxMessages(employee: {
  loginName: string;
  displayName: string;
  email: string;
}): Promise<Response> {
  const assertion = buildMailProxyAssertion({
    loginName: employee.loginName,
    displayName: employee.displayName,
    senderEmail: employee.email,
  });
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);

  try {
    return await fetch(
      buildLocalMailServiceUrl(new URLSearchParams({ limit: "500" })),
      {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${assertion}`,
        },
        cache: "no-store",
        signal: controller.signal,
      },
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

async function reconcileEmployeeMailbox(employee: {
  loginName: string;
  displayName: string;
  email: string;
}): Promise<Omit<MailboxAuditReconciliationResult, "mailboxesChecked">> {
  const response = await requestLocalMailboxMessages(employee);

  if (!response.ok) {
    return { mailboxesFailed: 1, messagesChecked: 0, recovered: 0, reattributed: 0 };
  }

  const payload = await response.json().catch(() => null);
  if (!isMailboxMessageResponse(payload)) {
    return { mailboxesFailed: 1, messagesChecked: 0, recovered: 0, reattributed: 0 };
  }

  let recovered = 0;
  let reattributed = 0;
  let messagesChecked = 0;
  const normalizedLoginName = employee.loginName.trim().toLowerCase();

  for (const message of payload.items) {
    const messageId = clean(message.messageId);
    const threadId = clean(message.threadId);
    const sentAt = clean(message.sentAt);
    if (!messageId || !threadId || !sentAt || !Number.isFinite(Date.parse(sentAt))) {
      continue;
    }
    messagesChecked += 1;

    const existing = readExistingEmailAudit(messageId);
    const existingActor = clean(existing?.actor_login_name).toLowerCase();
    if (
      existing &&
      existingActor === normalizedLoginName &&
      ["succeeded", "partial"].includes(existing.result_code)
    ) {
      continue;
    }

    const activitySyncStatus = message.activitySyncStatus || "not_linked";
    logMailSendAudit({
      actor: {
        loginName: employee.loginName,
        name: employee.displayName,
      },
      payload: {
        subject: clean(message.subject),
        to: Array.isArray(message.to) ? message.to : [],
        cc: Array.isArray(message.cc) ? message.cc : [],
        bcc: Array.isArray(message.bcc) ? message.bcc : [],
        linkedContact: message.linkedContact ?? undefined,
        matchedContacts: Array.isArray(message.matchedContacts) ? message.matchedContacts : [],
        attachments: [],
        sourceSurface: "mail",
      },
      resultCode: activitySyncStatus === "synced" ? "succeeded" : "partial",
      response: {
        sent: true,
        threadId,
        messageId,
        draftId: null,
        activitySyncStatus,
      },
      auditEventId: existing?.id ?? `email-mailbox:${normalizedLoginName}:${messageId}`,
      occurredAt: sentAt,
    });

    if (existing && existingActor !== normalizedLoginName) {
      reattributed += 1;
    } else {
      recovered += 1;
    }
  }

  return { mailboxesFailed: 0, messagesChecked, recovered, reattributed };
}

export async function reconcileDeliveredMailboxAudits(): Promise<MailboxAuditReconciliationResult> {
  const employees = readCallEmployeeDirectory()
    .filter((employee) => employee.isActive)
    .map((employee) => ({
      loginName: employee.loginName.trim().toLowerCase(),
      displayName: employee.displayName.trim() || employee.loginName.trim(),
      email: clean(employee.email).toLowerCase(),
    }))
    .filter(
      (employee) =>
        DASHBOARD_SALES_REPS.has(employee.loginName) &&
        employee.email.includes("@"),
    );

  const mailboxResults = await Promise.all(
    employees.map(async (employee) => {
      try {
        const result = await reconcileEmployeeMailbox(employee);
        console.log("[mail-audit-reconciliation] mailbox checked", {
          loginName: employee.loginName,
          ...result,
        });
        return result;
      } catch {
        const result = {
          mailboxesFailed: 1,
          messagesChecked: 0,
          recovered: 0,
          reattributed: 0,
        };
        console.error("[mail-audit-reconciliation] mailbox failed", {
          loginName: employee.loginName,
        });
        return result;
      }
    }),
  );

  return mailboxResults.reduce<MailboxAuditReconciliationResult>(
    (total, result) => ({
      mailboxesChecked: total.mailboxesChecked + 1,
      mailboxesFailed: total.mailboxesFailed + result.mailboxesFailed,
      messagesChecked: total.messagesChecked + result.messagesChecked,
      recovered: total.recovered + result.recovered,
      reattributed: total.reattributed + result.reattributed,
    }),
    {
      mailboxesChecked: 0,
      mailboxesFailed: 0,
      messagesChecked: 0,
      recovered: 0,
      reattributed: 0,
    },
  );
}
