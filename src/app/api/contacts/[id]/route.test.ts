import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAuthCookieValue = vi.fn(() => "cookie");
const setAuthCookie = vi.fn();
const resolveDeferredActionActor = vi.fn(async () => ({
  loginName: "jserrano",
  name: "Jorge Serrano",
}));
const enqueueDeferredContactDeleteAction = vi.fn(() => ({
  id: "action-1",
  executeAfterAt: "2026-03-13T21:00:00.000Z",
}));
const getReadModelDb = vi.fn(() => ({
  prepare: () => ({
    get: () => ({
      payload_json: JSON.stringify({
        accountRecordId: "record-1",
        businessAccountId: "BA0001",
        companyName: "Alpha Foods",
        primaryContactName: "Jorge Serrano",
        rowKey: "row-1",
      }),
    }),
  }),
}));

vi.mock("@/lib/auth", () => ({
  requireAuthCookieValue,
  setAuthCookie,
}));

vi.mock("@/lib/deferred-action-actor", () => ({
  resolveDeferredActionActor,
}));

vi.mock("@/lib/deferred-actions-store", () => ({
  enqueueDeferredContactDeleteAction,
}));

vi.mock("@/lib/read-model/db", () => ({
  getReadModelDb,
}));

describe("DELETE /api/contacts/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires a JSON body with reason", async () => {
    const { DELETE } = await import("@/app/api/contacts/[id]/route");

    const response = await DELETE(
      new NextRequest("http://localhost/api/contacts/157497?source=accounts", {
        method: "DELETE",
        body: JSON.stringify({ reason: "   " }),
        headers: {
          "content-type": "application/json",
        },
      }),
      {
        params: Promise.resolve({
          id: "157497",
        }),
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid delete request payload",
    });
    expect(enqueueDeferredContactDeleteAction).not.toHaveBeenCalled();
  });

  it("queues the delete and echoes the reason", async () => {
    const { DELETE } = await import("@/app/api/contacts/[id]/route");

    const response = await DELETE(
      new NextRequest("http://localhost/api/contacts/157497?source=accounts", {
        method: "DELETE",
        body: JSON.stringify({ reason: "Duplicate contact" }),
        headers: {
          "content-type": "application/json",
        },
      }),
      {
        params: Promise.resolve({
          id: "157497",
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      queued: true,
      actionId: "action-1",
      actionType: "deleteContact",
      contactId: 157497,
      reason: "Duplicate contact",
      executeAfterAt: "2026-03-13T21:00:00.000Z",
      status: "pending_review",
    });
    expect(enqueueDeferredContactDeleteAction).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: 157497,
        reason: "Duplicate contact",
        sourceSurface: "accounts",
      }),
    );
  });
});
