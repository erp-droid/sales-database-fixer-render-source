import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HttpError } from "@/lib/errors";
import type { MailThreadListResponse } from "@/types/mail-thread";

const setAuthCookie = vi.fn();
const requestMailService = vi.fn();
const resolveMailSenderForRequest = vi.fn();

vi.mock("@/lib/auth", () => ({
  setAuthCookie,
}));

vi.mock("@/lib/mail-auth", () => ({
  resolveMailSenderForRequest,
}));

vi.mock("@/lib/mail-proxy", () => ({
  buildMailServiceOauthStartUrl: vi.fn(),
  requestMailService,
}));

describe("GET /api/mail/threads", () => {
  const threadListPayload: MailThreadListResponse = {
    items: [
      {
        threadId: "thread-1",
        subject: "Hello",
        snippet: "Latest message",
        folder: "inbox",
        unread: true,
        starred: false,
        lastMessageAt: "2026-03-11T17:00:00.000Z",
        participants: ["Jorge Serrano", "Jane Doe"],
        linkedContact: {
          contactId: 123,
          businessAccountRecordId: "account-1",
          businessAccountId: "02670D2595",
          contactName: "Jane Doe",
          companyName: "Acme",
        },
        activitySyncStatus: "synced",
      },
    ],
    nextCursor: null,
    total: 1,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    resolveMailSenderForRequest.mockResolvedValue({
      loginName: "jserrano",
      senderEmail: "jserrano@meadowb.com",
      displayName: "Jorge Serrano",
    });
  });

  it("passes through the upstream thread list when the mail service succeeds", async () => {
    requestMailService.mockResolvedValue(
      new Response(JSON.stringify(threadListPayload), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }),
    );

    const { GET } = await import("@/app/api/mail/threads/route");
    const response = await GET(
      new NextRequest("http://localhost/api/mail/threads?folder=inbox&limit=20"),
    );
    const payload = (await response.json()) as MailThreadListResponse;

    expect(response.status).toBe(200);
    expect(payload).toEqual(threadListPayload);
  });

  it("returns cached threads when the mail service times out after a previous success", async () => {
    requestMailService.mockResolvedValueOnce(
      new Response(JSON.stringify(threadListPayload), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }),
    );
    requestMailService.mockRejectedValueOnce(
      new HttpError(
        504,
        "Mailbox threads are taking longer than expected. Retry in a few seconds.",
      ),
    );

    const { GET } = await import("@/app/api/mail/threads/route");
    const request = new NextRequest("http://localhost/api/mail/threads?folder=inbox&limit=20");

    const firstResponse = await GET(request);
    expect(firstResponse.status).toBe(200);
    expect((await firstResponse.json()) as MailThreadListResponse).toEqual(threadListPayload);

    const secondResponse = await GET(request);
    expect(secondResponse.status).toBe(200);
    expect((await secondResponse.json()) as MailThreadListResponse).toEqual(threadListPayload);
  });

  it("returns cached threads when the mail service responds with 429 after a previous success", async () => {
    requestMailService.mockResolvedValueOnce(
      new Response(JSON.stringify(threadListPayload), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }),
    );
    requestMailService.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "busy" }), {
        status: 429,
        headers: {
          "content-type": "application/json",
        },
      }),
    );

    const { GET } = await import("@/app/api/mail/threads/route");
    const request = new NextRequest("http://localhost/api/mail/threads?folder=inbox&limit=20");

    await GET(request);
    const secondResponse = await GET(request);

    expect(secondResponse.status).toBe(200);
    expect((await secondResponse.json()) as MailThreadListResponse).toEqual(threadListPayload);
  });
});
