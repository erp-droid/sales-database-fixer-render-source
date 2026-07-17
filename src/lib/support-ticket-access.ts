import type { SupportTicketRecord } from "@/lib/support-ticket-store";

function normalizeLogin(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

export function supportOwnerLogins(): Set<string> {
  const configured = process.env.TICKET_SUPPORT_OWNER_LOGINS ?? process.env.TICKET_AGENT_SENDER_LOGIN ?? "";
  return new Set(
    configured
      .split(",")
      .map(normalizeLogin)
      .filter(Boolean),
  );
}

export function isSupportOwner(loginName: string): boolean {
  return supportOwnerLogins().has(normalizeLogin(loginName));
}

export function canViewSupportTicket(
  loginName: string,
  ticket: Pick<SupportTicketRecord, "submittedByLogin">,
): boolean {
  const normalized = normalizeLogin(loginName);
  return Boolean(normalized) && (
    normalizeLogin(ticket.submittedByLogin) === normalized || isSupportOwner(normalized)
  );
}
