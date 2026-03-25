import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const validateRequestMock = vi.fn();

vi.mock("twilio", () => ({
  default: {
    validateRequest: validateRequestMock,
  },
}));

describe("validateTwilioWebhookRequest", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    validateRequestMock.mockReset();
    process.env.AUTH_PROVIDER = "acumatica";
    process.env.ACUMATICA_BASE_URL = "https://example.acumatica.com";
    process.env.ACUMATICA_ENTITY_PATH = "/entity/lightspeed/24.200.001";
    process.env.ACUMATICA_COMPANY = "MeadowBrook Live";
    process.env.ACUMATICA_LOCALE = "en-US";
    process.env.AUTH_COOKIE_NAME = ".ASPXAUTH";
    process.env.AUTH_COOKIE_SECURE = "false";
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  it("accepts the APP_BASE_URL callback url when the incoming request url is internal", async () => {
    process.env.APP_BASE_URL = "https://sales-meadowb.onrender.com";
    validateRequestMock.mockImplementation(
      (_token, _signature, url) =>
        url === "https://sales-meadowb.onrender.com/api/twilio/voice/status?sessionId=call-1&leg=root",
    );

    const { validateTwilioWebhookRequest } = await import("@/lib/twilio-webhook-validation");
    const request = new NextRequest("http://127.0.0.1:10000/api/twilio/voice/status?sessionId=call-1&leg=root", {
      method: "POST",
      headers: {
        "x-twilio-signature": "valid",
        host: "127.0.0.1:10000",
        "x-forwarded-host": "sales-meadowb.onrender.com",
        "x-forwarded-proto": "https",
      },
    });

    const result = validateTwilioWebhookRequest(request, { CallSid: "CA123" }, "twilio-token");

    expect(result.isValid).toBe(true);
    expect(result.matchedUrl).toBe(
      "https://sales-meadowb.onrender.com/api/twilio/voice/status?sessionId=call-1&leg=root",
    );
  });

  it("falls back to forwarded host and protocol when APP_BASE_URL is unset", async () => {
    validateRequestMock.mockImplementation(
      (_token, _signature, url) =>
        url === "https://sales-meadowb.onrender.com/api/twilio/voice/recording?sessionId=call-1",
    );

    const { validateTwilioWebhookRequest } = await import("@/lib/twilio-webhook-validation");
    const request = new NextRequest("http://127.0.0.1:10000/api/twilio/voice/recording?sessionId=call-1", {
      method: "POST",
      headers: {
        "x-twilio-signature": "valid",
        host: "127.0.0.1:10000",
        "x-forwarded-host": "sales-meadowb.onrender.com",
        "x-forwarded-proto": "https",
      },
    });

    const result = validateTwilioWebhookRequest(request, { RecordingSid: "RE123" }, "twilio-token");

    expect(result.isValid).toBe(true);
    expect(result.matchedUrl).toBe("https://sales-meadowb.onrender.com/api/twilio/voice/recording?sessionId=call-1");
  });
});
