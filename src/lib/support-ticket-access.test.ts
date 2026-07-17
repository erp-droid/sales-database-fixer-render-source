import { afterEach, describe, expect, it } from "vitest";

import { canViewSupportTicket, isSupportOwner } from "@/lib/support-ticket-access";

const originalOwners = process.env.TICKET_SUPPORT_OWNER_LOGINS;
const originalSender = process.env.TICKET_AGENT_SENDER_LOGIN;

afterEach(() => {
  if (originalOwners === undefined) delete process.env.TICKET_SUPPORT_OWNER_LOGINS;
  else process.env.TICKET_SUPPORT_OWNER_LOGINS = originalOwners;
  if (originalSender === undefined) delete process.env.TICKET_AGENT_SENDER_LOGIN;
  else process.env.TICKET_AGENT_SENDER_LOGIN = originalSender;
});

describe("support ticket visibility", () => {
  it("lets only configured support owners see another employee's ticket", () => {
    process.env.TICKET_SUPPORT_OWNER_LOGINS = "jserrano";
    expect(isSupportOwner(" JSERRANO ")).toBe(true);
    expect(canViewSupportTicket("jserrano", { submittedByLogin: "kpareek" })).toBe(true);
    expect(canViewSupportTicket("someone-else", { submittedByLogin: "kpareek" })).toBe(false);
  });

  it("always lets the requester see their own ticket", () => {
    process.env.TICKET_SUPPORT_OWNER_LOGINS = "jserrano";
    expect(canViewSupportTicket(" KPAREEK ", { submittedByLogin: "kpareek" })).toBe(true);
  });

  it("uses the ticket sender login when no separate owner list is configured", () => {
    delete process.env.TICKET_SUPPORT_OWNER_LOGINS;
    process.env.TICKET_AGENT_SENDER_LOGIN = "jserrano";
    expect(isSupportOwner("jserrano")).toBe(true);
  });
});
