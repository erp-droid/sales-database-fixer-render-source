import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const proxyMailJson = vi.fn();
const proxyAuditedMailSendJson = vi.fn();

vi.mock("@/app/api/mail/_helpers", () => ({
  proxyMailJson,
  proxyAuditedMailSendJson,
}));

describe("mail send routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    proxyMailJson.mockResolvedValue(new Response(null, { status: 204 }));
    proxyAuditedMailSendJson.mockResolvedValue(new Response(null, { status: 204 }));
  });

  it("forwards the Acumatica session for direct send", async () => {
    const { POST } = await import("@/app/api/mail/messages/send/route");
    const request = new NextRequest("http://localhost/api/mail/messages/send", {
      method: "POST",
      body: JSON.stringify({ subject: "test" }),
    });

    await POST(request);

    expect(proxyAuditedMailSendJson).toHaveBeenCalledWith(
      request,
      expect.objectContaining({
        path: "/api/mail/messages/send",
        method: "POST",
        forwardAcumaticaSession: true,
      }),
    );
  });

  it("forwards the Acumatica session for reply, forward, draft-send, and link", async () => {
    const request = new NextRequest("http://localhost", {
      method: "POST",
      body: JSON.stringify({ subject: "test" }),
    });

    const replyRoute = await import("@/app/api/mail/threads/[threadId]/reply/route");
    const forwardRoute = await import("@/app/api/mail/threads/[threadId]/forward/route");
    const draftSendRoute = await import("@/app/api/mail/drafts/[draftId]/send/route");
    const linkRoute = await import("@/app/api/mail/threads/[threadId]/link/route");

    await replyRoute.POST(request, {
      params: Promise.resolve({ threadId: "thread-1" }),
    });
    await forwardRoute.POST(request, {
      params: Promise.resolve({ threadId: "thread-1" }),
    });
    await draftSendRoute.POST(request, {
      params: Promise.resolve({ draftId: "draft-1" }),
    });
    await linkRoute.POST(request, {
      params: Promise.resolve({ threadId: "thread-1" }),
    });

    expect(proxyAuditedMailSendJson).toHaveBeenNthCalledWith(
      1,
      request,
      expect.objectContaining({
        path: "/api/mail/threads/thread-1/reply",
        method: "POST",
        forwardAcumaticaSession: true,
      }),
    );
    expect(proxyAuditedMailSendJson).toHaveBeenNthCalledWith(
      2,
      request,
      expect.objectContaining({
        path: "/api/mail/threads/thread-1/forward",
        method: "POST",
        forwardAcumaticaSession: true,
      }),
    );
    expect(proxyAuditedMailSendJson).toHaveBeenNthCalledWith(
      3,
      request,
      expect.objectContaining({
        path: "/api/mail/drafts/draft-1/send",
        method: "POST",
        forwardAcumaticaSession: true,
      }),
    );
    expect(proxyMailJson).toHaveBeenNthCalledWith(
      1,
      request,
      expect.objectContaining({
        path: "/api/mail/threads/thread-1/link",
        method: "POST",
        forwardAcumaticaSession: true,
      }),
    );
  });
});
