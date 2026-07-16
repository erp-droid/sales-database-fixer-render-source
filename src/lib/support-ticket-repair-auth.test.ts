import { afterEach, describe, expect, it } from "vitest";

import { requireTicketRepairSecret } from "@/lib/support-ticket-repair-auth";

const originalSecret = process.env.TICKET_REPAIR_CALLBACK_SECRET;

afterEach(() => {
  if (originalSecret === undefined) {
    delete process.env.TICKET_REPAIR_CALLBACK_SECRET;
  } else {
    process.env.TICKET_REPAIR_CALLBACK_SECRET = originalSecret;
  }
});

describe("ticket repair callback authentication", () => {
  it("accepts only the exact configured secret", () => {
    process.env.TICKET_REPAIR_CALLBACK_SECRET = "a-long-random-repair-secret";
    expect(() => requireTicketRepairSecret("a-long-random-repair-secret")).not.toThrow();
    expect(() => requireTicketRepairSecret("a-long-random-repair-secreu")).toThrow("Not authenticated");
    expect(() => requireTicketRepairSecret(null)).toThrow("Not authenticated");
  });

  it("fails closed when the server secret is missing", () => {
    delete process.env.TICKET_REPAIR_CALLBACK_SECRET;
    expect(() => requireTicketRepairSecret("anything")).toThrow("Not authenticated");
  });
});
