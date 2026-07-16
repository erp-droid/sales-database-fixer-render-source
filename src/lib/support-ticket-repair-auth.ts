import crypto from "node:crypto";

import { HttpError } from "@/lib/errors";

export function requireTicketRepairSecret(providedValue: string | null) {
  const expected = (process.env.TICKET_REPAIR_CALLBACK_SECRET ?? "").trim();
  const provided = (providedValue ?? "").trim();
  if (!expected || !provided) {
    throw new HttpError(401, "Not authenticated.");
  }
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (
    expectedBuffer.length !== providedBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, providedBuffer)
  ) {
    throw new HttpError(401, "Not authenticated.");
  }
}
