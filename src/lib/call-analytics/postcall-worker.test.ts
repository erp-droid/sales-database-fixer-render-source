import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CallLegRecord, CallSessionRecord } from "@/lib/call-analytics/types";

const validateRequestMock = vi.fn();
const readCallLegsBySessionIdMock = vi.fn<() => CallLegRecord[]>();
const readCallSessionByIdMock = vi.fn<(sessionId: string) => CallSessionRecord | null>();
const readCallSessionsMock = vi.fn<() => CallSessionRecord[]>();
const serviceFetchContactByIdMock = vi.fn();
const serviceFetchContactsByBusinessAccountIdsMock = vi.fn();
const serviceFetchBusinessAccountByIdMock = vi.fn();
const serviceCreateActivityMock = vi.fn();
const getTwilioRestConfigMock = vi.fn();
const createTwilioRestClientMock = vi.fn();
const recordingsListMock = vi.fn();
const recordingsRemoveMock = vi.fn();
const execFileMock = vi.fn();

vi.mock("twilio", () => ({
  default: {
    validateRequest: validateRequestMock,
  },
}));

vi.mock("@/lib/call-analytics/sessionize", () => ({
  readCallLegsBySessionId: readCallLegsBySessionIdMock,
  readCallSessionById: readCallSessionByIdMock,
  readCallSessions: readCallSessionsMock,
}));

vi.mock("@/lib/acumatica-service-auth", () => ({
  serviceFetchContactById: serviceFetchContactByIdMock,
  serviceFetchContactsByBusinessAccountIds: serviceFetchContactsByBusinessAccountIdsMock,
  serviceFetchBusinessAccountById: serviceFetchBusinessAccountByIdMock,
  serviceCreateActivity: serviceCreateActivityMock,
}));

vi.mock("@/lib/twilio", () => ({
  getTwilioRestConfig: getTwilioRestConfigMock,
  createTwilioRestClient: createTwilioRestClientMock,
}));

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));

function buildSession(overrides: Partial<CallSessionRecord> = {}): CallSessionRecord {
  return {
    sessionId: overrides.sessionId ?? "call-1",
    rootCallSid: overrides.rootCallSid ?? "CA-root",
    primaryLegSid: overrides.primaryLegSid ?? "CA-child",
    source: overrides.source ?? "app_bridge",
    direction: overrides.direction ?? "outbound",
    outcome: overrides.outcome ?? "answered",
    answered: overrides.answered ?? true,
    startedAt: overrides.startedAt ?? "2026-03-11T14:00:00.000Z",
    answeredAt: overrides.answeredAt ?? "2026-03-11T14:00:03.000Z",
    endedAt: overrides.endedAt ?? "2026-03-11T14:10:00.000Z",
    talkDurationSeconds: overrides.talkDurationSeconds ?? 597,
    ringDurationSeconds: overrides.ringDurationSeconds ?? 3,
    employeeLoginName: overrides.employeeLoginName ?? "jserrano",
    employeeDisplayName: overrides.employeeDisplayName ?? "Jorge Serrano",
    employeeContactId: overrides.employeeContactId ?? 157497,
    employeePhone: overrides.employeePhone ?? "+14162304681",
    recipientEmployeeLoginName: overrides.recipientEmployeeLoginName ?? null,
    recipientEmployeeDisplayName: overrides.recipientEmployeeDisplayName ?? null,
    presentedCallerId: overrides.presentedCallerId ?? "+14162304681",
    bridgeNumber: overrides.bridgeNumber ?? "+16474929859",
    targetPhone: overrides.targetPhone ?? "+14163153228",
    counterpartyPhone: overrides.counterpartyPhone ?? "+14163153228",
    matchedContactId: overrides.matchedContactId ?? 91,
    matchedContactName: overrides.matchedContactName ?? "Alex Prospect",
    matchedBusinessAccountId: overrides.matchedBusinessAccountId ?? "B2001",
    matchedCompanyName: overrides.matchedCompanyName ?? "Prospect Co",
    phoneMatchType: overrides.phoneMatchType ?? "contact_phone",
    phoneMatchAmbiguityCount: overrides.phoneMatchAmbiguityCount ?? 1,
    initiatedFromSurface: overrides.initiatedFromSurface ?? "accounts",
    linkedAccountRowKey: overrides.linkedAccountRowKey ?? "row-1",
    linkedBusinessAccountId: overrides.linkedBusinessAccountId ?? "B2001",
    linkedContactId: overrides.linkedContactId ?? 91,
    metadataJson: overrides.metadataJson ?? "{}",
    updatedAt: overrides.updatedAt ?? "2026-03-11T14:10:00.000Z",
  };
}

function buildLeg(overrides: Partial<CallLegRecord> = {}): CallLegRecord {
  return {
    sid: overrides.sid ?? "CA-root",
    parentSid: overrides.parentSid ?? null,
    sessionId: overrides.sessionId ?? "call-1",
    direction: overrides.direction ?? "outbound-api",
    fromNumber: overrides.fromNumber ?? "+16474929859",
    toNumber: overrides.toNumber ?? "+14162304681",
    status: overrides.status ?? "completed",
    answered: overrides.answered ?? true,
    answeredAt: overrides.answeredAt ?? "2026-03-11T14:00:03.000Z",
    startedAt: overrides.startedAt ?? "2026-03-11T14:00:00.000Z",
    endedAt: overrides.endedAt ?? "2026-03-11T14:10:00.000Z",
    durationSeconds: overrides.durationSeconds ?? 597,
    ringDurationSeconds: overrides.ringDurationSeconds ?? 3,
    price: overrides.price ?? null,
    priceUnit: overrides.priceUnit ?? null,
    source: overrides.source ?? "app_bridge",
    legType: overrides.legType ?? "root",
    rawJson: overrides.rawJson ?? "{}",
    updatedAt: overrides.updatedAt ?? "2026-03-11T14:10:00.000Z",
  };
}

function setPostCallEnv(sqlitePath: string): void {
  process.env.AUTH_PROVIDER = "acumatica";
  process.env.ACUMATICA_BASE_URL = "https://example.acumatica.com";
  process.env.ACUMATICA_ENTITY_PATH = "/entity/lightspeed/24.200.001";
  process.env.ACUMATICA_COMPANY = "MeadowBrook Live";
  process.env.ACUMATICA_LOCALE = "en-US";
  process.env.AUTH_COOKIE_NAME = ".ASPXAUTH";
  process.env.AUTH_COOKIE_SECURE = "false";
  process.env.READ_MODEL_SQLITE_PATH = sqlitePath;
  process.env.OPENAI_API_KEY = "test-openai-key";
  process.env.OPENAI_TRANSCRIPTION_MODEL = "gpt-4o-transcribe";
  process.env.OPENAI_SUMMARY_MODEL = "gpt-4.1-mini";
  process.env.ACUMATICA_PHONE_CALL_ACTIVITY_TYPE = "P";
  process.env.CALL_ACTIVITY_BODY_MAX_CHARS = "25000";
}

describe("post-call activity sync worker", () => {
  const originalEnv = { ...process.env };
  let tempDir = "";

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "postcall-worker-"));
    vi.resetModules();
    validateRequestMock.mockReset();
    validateRequestMock.mockReturnValue(true);
    readCallLegsBySessionIdMock.mockReset();
    readCallLegsBySessionIdMock.mockReturnValue([
      buildLeg(),
      buildLeg({
        sid: "CA-child",
        parentSid: "CA-root",
        legType: "destination",
      }),
    ]);
    readCallSessionByIdMock.mockReset();
    readCallSessionsMock.mockReset();
    readCallSessionsMock.mockReturnValue([]);
    serviceFetchContactByIdMock.mockReset();
    serviceFetchContactsByBusinessAccountIdsMock.mockReset();
    serviceFetchContactsByBusinessAccountIdsMock.mockResolvedValue([]);
    serviceFetchBusinessAccountByIdMock.mockReset();
    serviceCreateActivityMock.mockReset();
    getTwilioRestConfigMock.mockReset();
    getTwilioRestConfigMock.mockReturnValue({
      accountSid: "AC123",
      authToken: "twilio-token",
    });
    createTwilioRestClientMock.mockReset();
    recordingsListMock.mockReset();
    recordingsListMock.mockResolvedValue([]);
    recordingsRemoveMock.mockReset();
    recordingsRemoveMock.mockResolvedValue(true);
    execFileMock.mockReset();
    createTwilioRestClientMock.mockReturnValue({
      recordings: Object.assign(
        vi.fn(() => ({
          remove: recordingsRemoveMock,
        })),
        {
          list: recordingsListMock,
        },
      ),
    });
    setPostCallEnv(path.join(tempDir, "read-model.sqlite"));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    rmSync(tempDir, { recursive: true, force: true });
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  it("enqueues one durable job for duplicate Twilio recording callbacks", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    readCallSessionByIdMock.mockReturnValue(null);

    const { processTwilioRecordingCallback } = await import("@/lib/call-analytics/postcall-worker");
    const { getReadModelDb } = await import("@/lib/read-model/db");

    const body = new URLSearchParams({
      RecordingSid: "RE123",
      RecordingStatus: "completed",
      RecordingDuration: "42",
    });

    const firstRequest = new NextRequest("http://localhost/api/twilio/voice/recording?sessionId=call-1", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": "valid",
      },
      body,
    });
    const secondRequest = new NextRequest("http://localhost/api/twilio/voice/recording?sessionId=call-1", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": "valid",
      },
      body: new URLSearchParams(body),
    });

    await processTwilioRecordingCallback(firstRequest);
    await processTwilioRecordingCallback(secondRequest);
    await Promise.resolve();

    const countRow = getReadModelDb()
      .prepare("SELECT COUNT(*) AS count FROM call_activity_sync")
      .get() as { count: number };
    expect(countRow.count).toBe(1);
  });

  it("accepts recording callbacks validated against APP_BASE_URL instead of the internal request url", async () => {
    process.env.APP_BASE_URL = "https://sales-meadowb.onrender.com";
    validateRequestMock.mockImplementation(
      (_token, _signature, url) =>
        url === "https://sales-meadowb.onrender.com/api/twilio/voice/recording?sessionId=call-1",
    );
    readCallSessionByIdMock.mockReturnValue(null);

    const { processTwilioRecordingCallback } = await import("@/lib/call-analytics/postcall-worker");
    const { readCallActivitySyncBySessionId } = await import("@/lib/call-analytics/postcall-store");

    const request = new NextRequest("http://127.0.0.1:10000/api/twilio/voice/recording?sessionId=call-1", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": "valid",
        host: "127.0.0.1:10000",
        "x-forwarded-host": "sales-meadowb.onrender.com",
        "x-forwarded-proto": "https",
      },
      body: new URLSearchParams({
        RecordingSid: "RE123",
        RecordingStatus: "completed",
        RecordingDuration: "42",
      }),
    });

    const result = await processTwilioRecordingCallback(request);

    expect(result?.sessionId).toBe("call-1");
    expect(readCallActivitySyncBySessionId("call-1")?.recordingSid).toBe("RE123");
  });

  it("creates one Acumatica phone activity with summary first and transcript second", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/Recordings/")) {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "audio/mpeg" },
        });
      }

      if (url === "https://api.openai.com/v1/audio/transcriptions") {
        return new Response(JSON.stringify({ text: "Customer asked about project timeline and next steps." }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (url === "https://api.openai.com/v1/chat/completions") {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content:
                    "Discussed project timing and confirmed the customer wants a follow-up estimate.",
                },
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      return new Response("Unexpected fetch", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    readCallSessionByIdMock.mockReturnValue(buildSession());
    serviceFetchContactByIdMock.mockResolvedValue({
      id: "contact-note-id",
      NoteID: { value: "contact-note-id" },
    });
    serviceCreateActivityMock.mockResolvedValue({
      id: "activity-1",
      NoteID: { value: "activity-1" },
    });

    const { upsertQueuedCallActivitySync, readCallActivitySyncBySessionId } = await import(
      "@/lib/call-analytics/postcall-store"
    );
    const { processCallActivitySyncJob } = await import("@/lib/call-analytics/postcall-worker");

    upsertQueuedCallActivitySync({
      sessionId: "call-1",
      recordingSid: "RE123",
      recordingStatus: "completed",
      recordingDurationSeconds: 42,
    });

    const result = await processCallActivitySyncJob("call-1");
    const stored = readCallActivitySyncBySessionId("call-1");

    expect(result?.status).toBe("synced");
    expect(stored?.activityId).toBe("activity-1");
    expect(stored?.recordingDeletedAt).toBeTruthy();
    expect(serviceCreateActivityMock).toHaveBeenCalledWith(
      "jserrano",
      expect.objectContaining({
        type: "P",
        status: "Completed",
        summary: "Phone call with Alex Prospect",
      }),
    );

    const bodyHtml = serviceCreateActivityMock.mock.calls[0]?.[1]?.bodyHtml as string;
    expect(bodyHtml.indexOf("Call Summary")).toBeLessThan(bodyHtml.indexOf("Transcript"));
    expect(bodyHtml).toContain("Discussed project timing");
    expect(bodyHtml).toContain("Customer asked about project timeline");
  });

  it("queues and syncs a finished call even when the recording webhook never arrives", async () => {
    recordingsListMock.mockResolvedValue([
      {
        sid: "RE999",
        status: "completed",
        duration: "42",
        dateCreated: "2026-03-11T14:10:05.000Z",
      },
    ]);

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/Recordings/RE999.mp3")) {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "audio/mpeg" },
        });
      }

      if (url === "https://api.openai.com/v1/audio/transcriptions") {
        return new Response(JSON.stringify({ text: "Customer confirmed the scope and next step." }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (url === "https://api.openai.com/v1/chat/completions") {
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "Confirmed scope and agreed to follow up with pricing." } }],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      return new Response("Unexpected fetch", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    readCallSessionByIdMock.mockReturnValue(buildSession());
    serviceFetchContactByIdMock.mockResolvedValue({
      id: "contact-note-id",
      NoteID: { value: "contact-note-id" },
    });
    serviceCreateActivityMock.mockResolvedValue({
      id: "activity-fallback",
      NoteID: { value: "activity-fallback" },
    });

    const { ensureCallActivitySyncQueuedForSession } = await import("@/lib/call-analytics/postcall-worker");
    const { readCallActivitySyncBySessionId } = await import("@/lib/call-analytics/postcall-store");

    const result = await ensureCallActivitySyncQueuedForSession("call-1");
    const stored = readCallActivitySyncBySessionId("call-1");

    expect(result?.status).toBe("synced");
    expect(stored?.recordingSid).toBe("RE999");
    expect(stored?.activityId).toBe("activity-fallback");
    expect(recordingsListMock).toHaveBeenCalled();
    expect(serviceCreateActivityMock).toHaveBeenCalledWith(
      "jserrano",
      expect.objectContaining({
        summary: "Phone call with Alex Prospect",
        type: "P",
      }),
    );
  });

  it("re-resolves the contact from the matched business account when the stored contact id is stale", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/Recordings/")) {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "audio/mpeg" },
        });
      }

      if (url === "https://api.openai.com/v1/audio/transcriptions") {
        return new Response(JSON.stringify({ text: "Talked through timeline and materials." }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (url === "https://api.openai.com/v1/chat/completions") {
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "Reviewed timing and agreed to send pricing." } }],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      return new Response("Unexpected fetch", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    readCallSessionByIdMock.mockReturnValue(
      buildSession({
        matchedContactId: 555,
        linkedContactId: null,
        matchedContactName: "Kris Wawak",
        matchedCompanyName: "Linex Manufacturing",
        matchedBusinessAccountId: "LINEX-1",
        linkedBusinessAccountId: null,
        counterpartyPhone: "+19055551234",
        targetPhone: "+19055551234",
      }),
    );
    serviceFetchContactByIdMock.mockRejectedValue(new Error("Contact not found"));
    serviceFetchContactsByBusinessAccountIdsMock.mockResolvedValue([
      {
        id: "contact-note-kris",
        NoteID: { value: "contact-note-kris" },
        DisplayName: { value: "Kris Wawak" },
        Phone1: { value: "905-555-1234" },
      },
    ]);
    serviceCreateActivityMock.mockResolvedValue({
      id: "activity-contact-fallback",
      NoteID: { value: "activity-contact-fallback" },
    });

    const { upsertQueuedCallActivitySync } = await import("@/lib/call-analytics/postcall-store");
    const { processCallActivitySyncJob } = await import("@/lib/call-analytics/postcall-worker");

    upsertQueuedCallActivitySync({
      sessionId: "call-1",
      recordingSid: "RE123",
      recordingStatus: "completed",
      recordingDurationSeconds: 42,
    });

    const result = await processCallActivitySyncJob("call-1");

    expect(result?.status).toBe("synced");
    expect(serviceFetchContactsByBusinessAccountIdsMock).toHaveBeenCalledWith("jserrano", ["B2001", "LINEX-1"]);
    expect(serviceCreateActivityMock).toHaveBeenCalledWith(
      "jserrano",
      expect.objectContaining({
        relatedEntityNoteId: "contact-note-kris",
        relatedEntityType: "PX.Objects.CR.Contact",
      }),
    );
  });

  it("marks unanswered calls as skipped", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    readCallSessionByIdMock.mockReturnValue(
      buildSession({
        answered: false,
        outcome: "no_answer",
        talkDurationSeconds: 0,
      }),
    );

    const { upsertQueuedCallActivitySync } = await import("@/lib/call-analytics/postcall-store");
    const { processCallActivitySyncJob } = await import("@/lib/call-analytics/postcall-worker");

    upsertQueuedCallActivitySync({
      sessionId: "call-1",
      recordingSid: "RE123",
      recordingStatus: "completed",
      recordingDurationSeconds: 0,
    });

    const result = await processCallActivitySyncJob("call-1");

    expect(result?.status).toBe("skipped");
    expect(serviceCreateActivityMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("marks calls without a resolved contact or company as skipped", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    readCallSessionByIdMock.mockReturnValue(
      buildSession({
        linkedContactId: null,
        matchedContactId: null,
        linkedBusinessAccountId: null,
        matchedBusinessAccountId: null,
      }),
    );

    const { upsertQueuedCallActivitySync } = await import("@/lib/call-analytics/postcall-store");
    const { processCallActivitySyncJob } = await import("@/lib/call-analytics/postcall-worker");

    upsertQueuedCallActivitySync({
      sessionId: "call-1",
      recordingSid: "RE123",
      recordingStatus: "completed",
      recordingDurationSeconds: 42,
    });

    const result = await processCallActivitySyncJob("call-1");

    expect(result?.status).toBe("skipped");
    expect(serviceCreateActivityMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("marks transcription failures as failed", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/Recordings/")) {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "audio/mpeg" },
        });
      }

      if (url === "https://api.openai.com/v1/audio/transcriptions") {
        return new Response(
          JSON.stringify({
            error: {
              message: "Audio file could not be transcribed.",
            },
          }),
          {
            status: 500,
            headers: { "content-type": "application/json" },
          },
        );
      }

      return new Response("Unexpected fetch", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);
    readCallSessionByIdMock.mockReturnValue(buildSession());
    serviceFetchContactByIdMock.mockResolvedValue({
      id: "contact-note-id",
      NoteID: { value: "contact-note-id" },
    });

    const { upsertQueuedCallActivitySync } = await import("@/lib/call-analytics/postcall-store");
    const { processCallActivitySyncJob } = await import("@/lib/call-analytics/postcall-worker");

    upsertQueuedCallActivitySync({
      sessionId: "call-1",
      recordingSid: "RE123",
      recordingStatus: "completed",
      recordingDurationSeconds: 42,
    });

    const result = await processCallActivitySyncJob("call-1");

    expect(result?.status).toBe("failed");
    expect(result?.error).toContain("OpenAI transcription failed");
    expect(serviceCreateActivityMock).not.toHaveBeenCalled();
  });

  it("falls back to local transcription when the OpenAI project lacks audio models", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/Recordings/")) {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "audio/mpeg" },
        });
      }

      if (url === "https://api.openai.com/v1/audio/transcriptions") {
        return new Response(
          JSON.stringify({
            error: {
              message: "Project does not have access to model gpt-4o-mini-transcribe",
              code: "model_not_found",
            },
          }),
          {
            status: 404,
            headers: { "content-type": "application/json" },
          },
        );
      }

      if (url === "https://api.openai.com/v1/chat/completions") {
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "Local transcript summary." } }],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      return new Response("Unexpected fetch", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);
    execFileMock.mockImplementation((file, args, options, callback) => {
      callback?.(null, JSON.stringify({ text: "Transcript from local fallback." }), "");
      return {} as never;
    });

    readCallSessionByIdMock.mockReturnValue(buildSession());
    serviceFetchContactByIdMock.mockResolvedValue({
      id: "contact-note-id",
      NoteID: { value: "contact-note-id" },
    });
    serviceCreateActivityMock.mockResolvedValue({
      id: "activity-local",
      NoteID: { value: "activity-local" },
    });

    const { upsertQueuedCallActivitySync } = await import("@/lib/call-analytics/postcall-store");
    const { processCallActivitySyncJob } = await import("@/lib/call-analytics/postcall-worker");

    upsertQueuedCallActivitySync({
      sessionId: "call-1",
      recordingSid: "RE123",
      recordingStatus: "completed",
      recordingDurationSeconds: 42,
    });

    const result = await processCallActivitySyncJob("call-1");

    expect(result?.status).toBe("synced");
    expect(execFileMock).toHaveBeenCalled();
    expect(serviceCreateActivityMock).toHaveBeenCalledWith(
      "jserrano",
      expect.objectContaining({
        summary: "Phone call with Alex Prospect",
      }),
    );

    const bodyHtml = serviceCreateActivityMock.mock.calls[0]?.[1]?.bodyHtml as string;
    expect(bodyHtml).toContain("Local transcript summary.");
    expect(bodyHtml).toContain("Transcript from local fallback.");
  });

  it("preserves transcript and summary on Acumatica failure and retries without retranscribing", async () => {
    let fetchCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      fetchCount += 1;
      const url = String(input);
      if (url.includes("/Recordings/")) {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "audio/mpeg" },
        });
      }

      if (url === "https://api.openai.com/v1/audio/transcriptions") {
        return new Response(JSON.stringify({ text: "Transcript from the first pass." }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (url === "https://api.openai.com/v1/chat/completions") {
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "Summary from the first pass." } }],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      return new Response("Unexpected fetch", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    readCallSessionByIdMock.mockReturnValue(buildSession());
    serviceFetchContactByIdMock.mockResolvedValue({
      id: "contact-note-id",
      NoteID: { value: "contact-note-id" },
    });
    serviceCreateActivityMock
      .mockRejectedValueOnce(new Error("Acumatica request failed"))
      .mockResolvedValueOnce({
        id: "activity-2",
        NoteID: { value: "activity-2" },
      });

    const { upsertQueuedCallActivitySync, readCallActivitySyncBySessionId } = await import(
      "@/lib/call-analytics/postcall-store"
    );
    const { processCallActivitySyncJob } = await import("@/lib/call-analytics/postcall-worker");

    upsertQueuedCallActivitySync({
      sessionId: "call-1",
      recordingSid: "RE123",
      recordingStatus: "completed",
      recordingDurationSeconds: 42,
    });

    const failed = await processCallActivitySyncJob("call-1");
    const afterFailure = readCallActivitySyncBySessionId("call-1");

    expect(failed?.status).toBe("failed");
    expect(afterFailure?.transcriptText).toBe("Transcript from the first pass.");
    expect(afterFailure?.summaryText).toBe("Summary from the first pass.");
    expect(fetchCount).toBe(3);

    const retried = await processCallActivitySyncJob("call-1");

    expect(retried?.status).toBe("synced");
    expect(retried?.activityId).toBe("activity-2");
    expect(fetchCount).toBe(3);
  });

  it("backfills recent answered app-bridge calls when due jobs are run", async () => {
    recordingsListMock.mockResolvedValue([
      {
        sid: "RE-BACKFILL",
        status: "completed",
        duration: "31",
        dateCreated: "2026-03-11T14:10:05.000Z",
      },
    ]);

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/Recordings/RE-BACKFILL.mp3")) {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "audio/mpeg" },
        });
      }

      if (url === "https://api.openai.com/v1/audio/transcriptions") {
        return new Response(JSON.stringify({ text: "Customer reviewed the scope." }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (url === "https://api.openai.com/v1/chat/completions") {
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "Reviewed scope and agreed to next steps." } }],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      return new Response("Unexpected fetch", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const session = buildSession({
      startedAt: "2026-03-24T14:00:00.000Z",
      answeredAt: "2026-03-24T14:00:03.000Z",
      endedAt: "2026-03-24T14:10:00.000Z",
      updatedAt: "2026-03-24T14:10:00.000Z",
    });
    readCallSessionsMock.mockReturnValue([session]);
    readCallSessionByIdMock.mockImplementation((sessionId: string) =>
      sessionId === session.sessionId ? session : null,
    );
    serviceFetchContactByIdMock.mockResolvedValue({
      id: "contact-note-id",
      NoteID: { value: "contact-note-id" },
    });
    serviceCreateActivityMock.mockResolvedValue({
      id: "activity-backfill",
      NoteID: { value: "activity-backfill" },
    });

    const { readCallActivitySyncBySessionId } = await import("@/lib/call-analytics/postcall-store");
    const { runDueCallActivitySyncJobs } = await import("@/lib/call-analytics/postcall-worker");

    const result = await runDueCallActivitySyncJobs();
    const stored = readCallActivitySyncBySessionId(session.sessionId);

    expect(result).toEqual({
      processedCount: 1,
      syncedCount: 1,
      failedCount: 0,
      skippedCount: 0,
    });
    expect(stored?.status).toBe("synced");
    expect(stored?.activityId).toBe("activity-backfill");
  });
});
