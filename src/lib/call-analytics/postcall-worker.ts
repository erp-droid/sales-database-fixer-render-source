import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { NextRequest } from "next/server";
import twilio from "twilio";

import {
  readWrappedString,
  type RawActivity,
  type RawBusinessAccount,
  type RawContact,
} from "@/lib/acumatica";
import {
  serviceCreateActivity,
  serviceFetchBusinessAccountById,
  serviceFetchContactById,
} from "@/lib/acumatica-service-auth";
import { buildTwilioRecordingCallbackUrl, reconcileTwilioSession } from "@/lib/call-analytics/ingest";
import {
  claimCallActivitySyncJob,
  listPendingCallActivitySyncJobs,
  markCallActivitySyncFailed,
  markCallActivitySyncRecordingDeleted,
  markCallActivitySyncRecordingResolved,
  markCallActivitySyncSkipped,
  markCallActivitySyncSynced,
  markCallActivitySyncTranscribed,
  readCallActivitySyncBySessionId,
  requeueCallActivitySyncJob,
  upsertQueuedCallActivitySync,
} from "@/lib/call-analytics/postcall-store";
import type {
  CallActivitySyncRecord,
  CallSessionRecord,
} from "@/lib/call-analytics/types";
import { getEnv } from "@/lib/env";
import { HttpError, getErrorMessage } from "@/lib/errors";
import { readCallLegsBySessionId, readCallSessionById } from "@/lib/call-analytics/sessionize";
import {
  createTwilioRestClient,
  getTwilioRestConfig,
} from "@/lib/twilio";

type ResolvedActivityTarget = {
  relatedEntityNoteId: string;
  relatedEntityType: "PX.Objects.CR.Contact" | "PX.Objects.CR.BAccount";
};

type RecordingCallbackPayload = {
  recordingSid: string | null;
  recordingStatus: string | null;
  recordingDurationSeconds: number | null;
};

type TwilioRecordingLike = {
  sid?: string | null;
  status?: string | null;
  duration?: string | number | null;
  dateCreated?: Date | string | null;
  dateUpdated?: Date | string | null;
};

function cleanText(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function readRecordIdentity(record: Record<string, unknown> | null | undefined): string | null {
  if (!record) {
    return null;
  }

  const rawId = typeof record.id === "string" ? record.id.trim() : "";
  if (rawId) {
    return rawId;
  }

  return cleanText(readWrappedString(record, "NoteID")) || null;
}

function readOpenAiApiKey(): string {
  const apiKey = getEnv().OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for call transcription.");
  }
  return apiKey;
}

function readPhoneCallActivityType(): string {
  const type = getEnv().ACUMATICA_PHONE_CALL_ACTIVITY_TYPE?.trim();
  if (!type) {
    throw new Error("ACUMATICA_PHONE_CALL_ACTIVITY_TYPE is required for phone call activity sync.");
  }
  return type;
}

function readSummaryTarget(session: CallSessionRecord): string {
  return (
    cleanText(session.matchedContactName) ||
    cleanText(session.matchedCompanyName) ||
    cleanText(session.counterpartyPhone) ||
    cleanText(session.targetPhone) ||
    "unknown party"
  );
}

function buildActivitySummary(session: CallSessionRecord): string {
  const value = `Phone call with ${readSummaryTarget(session)}`.trim();
  return value.length > 255 ? `${value.slice(0, 252).trim()}...` : value;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "Unknown";
  }

  const numeric = Date.parse(value);
  if (!Number.isFinite(numeric)) {
    return "Unknown";
  }

  return new Date(numeric).toLocaleString("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) {
    return "0m";
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes > 0 && remainingSeconds === 0) {
    return `${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${remainingSeconds}s`;
}

function waitForDelay(milliseconds: number): Promise<void> {
  if (milliseconds <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function execFileWithOutput(
  file: string,
  args: string[],
  options: {
    maxBuffer?: number;
    timeout?: number;
  },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }

      const stdoutValue: unknown = stdout;
      const stderrValue: unknown = stderr;
      resolve({
        stdout:
          typeof stdoutValue === "string"
            ? stdoutValue
            : Buffer.isBuffer(stdoutValue)
              ? stdoutValue.toString("utf8")
              : "",
        stderr:
          typeof stderrValue === "string"
            ? stderrValue
            : Buffer.isBuffer(stderrValue)
              ? stderrValue.toString("utf8")
              : "",
      });
    });
  });
}

function toEpochMilliseconds(value: Date | string | null | undefined): number {
  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value !== "string" || !value.trim()) {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readRecordingDurationSeconds(value: string | number | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.trunc(parsed));
    }
  }

  return null;
}

function buildDetailsHtml(session: CallSessionRecord): string {
  const rows = [
    ["Employee", cleanText(session.employeeDisplayName) || cleanText(session.recipientEmployeeDisplayName) || "Unattributed"],
    ["Phone", cleanText(session.counterpartyPhone) || cleanText(session.targetPhone) || "-"],
    ["Started", formatDateTime(session.startedAt)],
    ["Ended", formatDateTime(session.endedAt)],
    ["Talk duration", formatDuration(session.talkDurationSeconds)],
  ];

  const items = rows
    .map(([label, value]) => `<li><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</li>`)
    .join("");

  return `<h3>Call Details</h3><ul>${items}</ul>`;
}

function buildTranscriptSection(transcriptText: string, truncated: boolean): string {
  const suffix = truncated ? "\n\n[Transcript truncated to fit Acumatica activity body.]" : "";
  return `<h3>Transcript</h3><div style="white-space:pre-wrap">${escapeHtml(
    transcriptText + suffix,
  )}</div>`;
}

function buildActivityBodyHtml(
  session: CallSessionRecord,
  summaryText: string,
  transcriptText: string,
): string {
  const summaryHtml = `<h3>Call Summary</h3><p>${escapeHtml(summaryText)}</p>`;
  const detailsHtml = buildDetailsHtml(session);
  const baseHtml = `${summaryHtml}${detailsHtml}`;
  const maxChars = getEnv().CALL_ACTIVITY_BODY_MAX_CHARS;
  const fullHtml = `${baseHtml}${buildTranscriptSection(transcriptText, false)}`;
  if (fullHtml.length <= maxChars) {
    return fullHtml;
  }

  let low = 0;
  let high = transcriptText.length;
  let best = buildTranscriptSection("", true);

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = `${baseHtml}${buildTranscriptSection(transcriptText.slice(0, middle), true)}`;
    if (candidate.length <= maxChars) {
      best = buildTranscriptSection(transcriptText.slice(0, middle), true);
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return `${baseHtml}${best}`;
}

function parseOpenAiError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") {
    return fallback;
  }

  const record = payload as Record<string, unknown>;
  const error = record.error;
  if (typeof error === "string" && error.trim()) {
    return error;
  }

  if (error && typeof error === "object") {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }

  return fallback;
}

function parseChatCompletionText(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const choices = (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices;
  const content = choices?.[0]?.message?.content;
  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (!item || typeof item !== "object") {
          return "";
        }

        const text = (item as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      })
      .join("")
      .trim();
  }

  return "";
}

async function fetchTwilioRecordingAudio(recordingSid: string): Promise<Blob> {
  const config = getTwilioRestConfig();
  if (!config) {
    throw new Error("Twilio is not configured.");
  }

  const basicAuth = Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64");
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Recordings/${encodeURIComponent(recordingSid)}.mp3`,
    {
      headers: {
        Authorization: `Basic ${basicAuth}`,
      },
      cache: "no-store",
    },
  );

  if (!response.ok) {
    const message = await response.text();
    throw new Error(
      `Unable to download Twilio recording ${recordingSid} (${response.status}): ${message || "Unknown error"}`,
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  return new Blob([arrayBuffer], { type: "audio/mpeg" });
}

function shouldUseLocalTranscriptionFallback(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes("model_not_found") ||
    message.includes("does not have access to model") ||
    message.includes("openai transcription failed (403)") ||
    message.includes("openai transcription failed (404)") ||
    message.includes("openai_api_key is required")
  );
}

async function transcribeAudioWithOpenAi(recordingSid: string, audioBlob: Blob): Promise<string> {
  const apiKey = readOpenAiApiKey();
  const formData = new FormData();
  formData.append("model", getEnv().OPENAI_TRANSCRIPTION_MODEL);
  formData.append("file", audioBlob, `${recordingSid}.mp3`);

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
    cache: "no-store",
  });

  const bodyText = await response.text();
  const payload = parseJsonObject(bodyText);
  if (!response.ok) {
    throw new Error(
      `OpenAI transcription failed (${response.status}): ${parseOpenAiError(payload, bodyText || "Unknown error")}`,
    );
  }

  const transcript = typeof payload?.text === "string" ? payload.text.trim() : "";
  if (!transcript) {
    throw new Error("OpenAI transcription returned an empty transcript.");
  }

  return transcript;
}

async function transcribeAudioLocally(recordingSid: string, audioBlob: Blob): Promise<string> {
  const tempDir = await mkdtemp(path.join(tmpdir(), "call-transcribe-"));
  const audioPath = path.join(tempDir, `${recordingSid}.mp3`);
  const scriptPath = path.join(process.cwd(), "scripts", "transcribe_audio.py");

  try {
    const audioBuffer = Buffer.from(await audioBlob.arrayBuffer());
    await writeFile(audioPath, audioBuffer);

    const { stdout, stderr } = await execFileWithOutput(
      "python3",
      [scriptPath, audioPath, "--model", "base"],
      {
        maxBuffer: 10 * 1024 * 1024,
        timeout: 15 * 60 * 1000,
      },
    );
    const payload = parseJsonObject(stdout);
    const transcript = typeof payload?.text === "string" ? payload.text.trim() : "";
    if (!transcript) {
      const errorText =
        (typeof payload?.error === "string" && payload.error.trim()) ||
        stderr.trim() ||
        "Local transcription returned an empty transcript.";
      throw new Error(errorText);
    }

    return transcript;
  } catch (error) {
    throw new Error(`Local transcription failed: ${getErrorMessage(error)}`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function transcribeRecording(recordingSid: string): Promise<string> {
  const audioBlob = await fetchTwilioRecordingAudio(recordingSid);

  try {
    return await transcribeAudioWithOpenAi(recordingSid, audioBlob);
  } catch (error) {
    if (!shouldUseLocalTranscriptionFallback(error)) {
      throw error;
    }
  }

  return transcribeAudioLocally(recordingSid, audioBlob);
}

async function summarizeTranscriptWithModel(
  session: CallSessionRecord,
  transcriptText: string,
  model: string,
): Promise<string> {
  const apiKey = readOpenAiApiKey();
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content:
            "You summarize business phone calls. Return plain text only. Write 2 to 4 concise factual sentences. Do not invent facts. Mention follow-up commitments only if they are explicitly present in the transcript.",
        },
        {
          role: "user",
          content: [
            `Employee: ${cleanText(session.employeeDisplayName) || cleanText(session.employeeLoginName) || "Unknown"}`,
            `Company: ${cleanText(session.matchedCompanyName) || "Unknown"}`,
            `Contact: ${cleanText(session.matchedContactName) || "Unknown"}`,
            `Phone: ${cleanText(session.counterpartyPhone) || cleanText(session.targetPhone) || "Unknown"}`,
            `Started: ${formatDateTime(session.startedAt)}`,
            `Talk duration: ${formatDuration(session.talkDurationSeconds)}`,
            "",
            "Transcript:",
            transcriptText,
          ].join("\n"),
        },
      ],
    }),
    cache: "no-store",
  });

  const bodyText = await response.text();
  const payload = parseJsonObject(bodyText);
  if (!response.ok) {
    throw new Error(
      `OpenAI summary failed (${response.status}): ${parseOpenAiError(payload, bodyText || "Unknown error")}`,
    );
  }

  const summaryText = parseChatCompletionText(payload);
  if (!summaryText) {
    throw new Error("OpenAI summary returned empty content.");
  }

  return summaryText;
}

async function summarizeTranscriptWithOpenAi(
  session: CallSessionRecord,
  transcriptText: string,
): Promise<string> {
  const preferredModel = getEnv().OPENAI_SUMMARY_MODEL;
  const fallbackModels = ["gpt-4o-mini", "gpt-5-mini", "gpt-4o"];
  const models = [...new Set([preferredModel, ...fallbackModels])];
  let lastError: Error | null = null;

  for (const model of models) {
    try {
      return await summarizeTranscriptWithModel(session, transcriptText, model);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(getErrorMessage(error));
      if (!shouldUseLocalTranscriptionFallback(lastError)) {
        throw lastError;
      }
    }
  }

  throw lastError ?? new Error("OpenAI summary failed.");
}

async function deleteTwilioRecording(recordingSid: string): Promise<void> {
  const client = createTwilioRestClient();
  if (!client) {
    throw new Error("Twilio is not configured.");
  }

  await client.recordings(recordingSid).remove();
}

async function resolveRecordingForSession(
  sessionId: string,
): Promise<RecordingCallbackPayload | null> {
  const client = createTwilioRestClient();
  if (!client) {
    throw new Error("Twilio is not configured.");
  }

  const callSids = [...new Set(
    readCallLegsBySessionId(sessionId)
      .map((leg) => leg.sid.trim())
      .filter(Boolean),
  )];
  if (callSids.length === 0) {
    return null;
  }

  let bestMatch:
    | (RecordingCallbackPayload & {
        sortTime: number;
      })
    | null = null;

  for (const callSid of callSids) {
    const recordings = (await client.recordings.list({
      callSid,
      limit: 20,
    })) as TwilioRecordingLike[];

    for (const recording of recordings) {
      const recordingSid = cleanText(recording.sid);
      if (!recordingSid) {
        continue;
      }

      const recordingStatus = cleanText(recording.status).toLowerCase();
      if (recordingStatus !== "completed") {
        continue;
      }

      const sortTime = Math.max(
        toEpochMilliseconds(recording.dateCreated),
        toEpochMilliseconds(recording.dateUpdated),
      );
      if (bestMatch && bestMatch.sortTime >= sortTime) {
        continue;
      }

      bestMatch = {
        recordingSid,
        recordingStatus,
        recordingDurationSeconds: readRecordingDurationSeconds(recording.duration),
        sortTime,
      };
    }
  }

  if (!bestMatch) {
    return null;
  }

  return {
    recordingSid: bestMatch.recordingSid,
    recordingStatus: bestMatch.recordingStatus,
    recordingDurationSeconds: bestMatch.recordingDurationSeconds,
  };
}

async function resolveActivityTarget(
  session: CallSessionRecord,
): Promise<ResolvedActivityTarget | null> {
  const candidateContactIds = [...new Set([session.linkedContactId, session.matchedContactId])]
    .filter((value): value is number => typeof value === "number" && Number.isInteger(value) && value > 0);

  for (const contactId of candidateContactIds) {
    try {
      const contact = (await serviceFetchContactById(session.employeeLoginName, contactId)) as RawContact;
      const noteId = readRecordIdentity(contact);
      if (noteId) {
        return {
          relatedEntityNoteId: noteId,
          relatedEntityType: "PX.Objects.CR.Contact",
        };
      }
    } catch {
      // Fall through to the next candidate.
    }
  }

  const candidateBusinessAccountIds = [
    ...new Set([
      cleanText(session.linkedBusinessAccountId),
      cleanText(session.matchedBusinessAccountId),
    ]),
  ].filter(Boolean);

  for (const businessAccountId of candidateBusinessAccountIds) {
    try {
      const businessAccount = (await serviceFetchBusinessAccountById(
        session.employeeLoginName,
        businessAccountId,
      )) as RawBusinessAccount;
      const noteId = readRecordIdentity(businessAccount);
      if (noteId) {
        return {
          relatedEntityNoteId: noteId,
          relatedEntityType: "PX.Objects.CR.BAccount",
        };
      }
    } catch {
      // Fall through to the next candidate.
    }
  }

  return null;
}

function readActivityId(record: RawActivity): string | null {
  const identity = readRecordIdentity(record) ?? cleanText(readWrappedString(record, "NoteID"));
  return identity || null;
}

function parseRecordingCallback(
  request: NextRequest,
  params: Record<string, string>,
): { sessionId: string; payload: RecordingCallbackPayload } {
  const sessionId = request.nextUrl.searchParams.get("sessionId")?.trim();
  if (!sessionId) {
    throw new HttpError(400, "Twilio recording callback is missing sessionId.");
  }

  const recordingSid = params.RecordingSid?.trim() || null;
  if (!recordingSid) {
    throw new HttpError(400, "Twilio recording callback is missing RecordingSid.");
  }

  const recordingStatus = params.RecordingStatus?.trim() || null;
  const durationValue = Number(params.RecordingDuration ?? "");

  return {
    sessionId,
    payload: {
      recordingSid,
      recordingStatus,
      recordingDurationSeconds: Number.isFinite(durationValue) ? Math.max(0, Math.trunc(durationValue)) : null,
    },
  };
}

async function createPhoneCallActivity(
  session: CallSessionRecord,
  target: ResolvedActivityTarget,
  transcriptText: string,
  summaryText: string,
): Promise<string | null> {
  const activity = await serviceCreateActivity(session.employeeLoginName, {
    summary: buildActivitySummary(session),
    bodyHtml: buildActivityBodyHtml(session, summaryText, transcriptText),
    relatedEntityNoteId: target.relatedEntityNoteId,
    relatedEntityType: target.relatedEntityType,
    type: readPhoneCallActivityType(),
    status: "Completed",
    dateIso: session.startedAt,
  });

  return readActivityId(activity);
}

export async function processCallActivitySyncJob(
  sessionId: string,
): Promise<CallActivitySyncRecord | null> {
  const claimed = claimCallActivitySyncJob(sessionId);
  if (!claimed) {
    return readCallActivitySyncBySessionId(sessionId);
  }

  try {
    let session = readCallSessionById(sessionId);
    if (session && (!session.endedAt || session.outcome === "in_progress")) {
      session = (await reconcileTwilioSession(sessionId)) ?? session;
    }

    if (!session || !session.endedAt || session.outcome === "in_progress") {
      return requeueCallActivitySyncJob(sessionId, "Waiting for the call session to finish syncing.");
    }

    if (!session.answered) {
      return markCallActivitySyncSkipped(sessionId, "Call was not answered.");
    }

    const target = await resolveActivityTarget(session);
    if (!target) {
      return markCallActivitySyncSkipped(
        sessionId,
        "No related contact or business account could be resolved for this call.",
      );
    }

    let transcriptText = cleanText(claimed.transcriptText);
    let summaryText = cleanText(claimed.summaryText);
    let recordingSid = cleanText(claimed.recordingSid);

    if (!transcriptText) {
      if (!recordingSid) {
        const resolvedRecording = await resolveRecordingForSession(sessionId);
        if (!resolvedRecording?.recordingSid) {
          return requeueCallActivitySyncJob(
            sessionId,
            "Waiting for the call recording to be available.",
          );
        }

        const updated = markCallActivitySyncRecordingResolved(sessionId, resolvedRecording);
        recordingSid = cleanText(updated.recordingSid);
      }

      transcriptText = await transcribeRecording(recordingSid);
    }

    if (!summaryText) {
      summaryText = await summarizeTranscriptWithOpenAi(session, transcriptText);
    }

    if (!cleanText(claimed.transcriptText) || !cleanText(claimed.summaryText)) {
      markCallActivitySyncTranscribed(sessionId, {
        transcriptText,
        summaryText,
      });
    }

    const activityId = await createPhoneCallActivity(session, target, transcriptText, summaryText);
    let synced = markCallActivitySyncSynced(sessionId, { activityId });

    if (recordingSid) {
      try {
        await deleteTwilioRecording(recordingSid);
        synced = markCallActivitySyncRecordingDeleted(sessionId);
      } catch {
        // The activity already exists upstream; do not downgrade sync status.
      }
    }

    return synced;
  } catch (error) {
    return markCallActivitySyncFailed(sessionId, getErrorMessage(error));
  }
}

export async function runDueCallActivitySyncJobs(limit = 25): Promise<{
  processedCount: number;
  syncedCount: number;
  failedCount: number;
  skippedCount: number;
}> {
  const jobs = listPendingCallActivitySyncJobs(limit);
  let processedCount = 0;
  let syncedCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  for (const job of jobs) {
    const result = await processCallActivitySyncJob(job.sessionId);
    if (!result) {
      continue;
    }

    processedCount += 1;
    if (result.status === "synced") {
      syncedCount += 1;
    } else if (result.status === "failed") {
      failedCount += 1;
    } else if (result.status === "skipped") {
      skippedCount += 1;
    }
  }

  return {
    processedCount,
    syncedCount,
    failedCount,
    skippedCount,
  };
}

export async function processTwilioRecordingCallback(
  request: NextRequest,
): Promise<CallActivitySyncRecord | null> {
  const config = getTwilioRestConfig();
  if (!config) {
    throw new HttpError(503, "Twilio is not configured.");
  }

  const signature = request.headers.get("x-twilio-signature") ?? "";
  const formData = await request.formData();
  const params = Object.fromEntries(
    [...formData.entries()].map(([key, value]) => [key, typeof value === "string" ? value : ""]),
  ) as Record<string, string>;

  const isValid = twilio.validateRequest(config.authToken, signature, request.url, params);
  if (!isValid) {
    throw new HttpError(403, "Invalid Twilio signature.");
  }

  const recordingStatus = params.RecordingStatus?.trim().toLowerCase() ?? "";
  if (recordingStatus !== "completed") {
    return null;
  }

  const parsed = parseRecordingCallback(request, params);
  const job = upsertQueuedCallActivitySync({
    sessionId: parsed.sessionId,
    recordingSid: parsed.payload.recordingSid,
    recordingStatus: parsed.payload.recordingStatus,
    recordingDurationSeconds: parsed.payload.recordingDurationSeconds,
  });

  void processCallActivitySyncJob(parsed.sessionId).catch(() => undefined);
  return job;
}

export function buildRecordingCallbackUrl(
  requestOrUrl: string | URL | NextRequest,
  sessionId: string,
): string {
  return buildTwilioRecordingCallbackUrl(requestOrUrl, { sessionId });
}

export async function ensureCallActivitySyncQueuedForSession(
  sessionId: string,
): Promise<CallActivitySyncRecord | null> {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) {
    return null;
  }

  let session = readCallSessionById(normalizedSessionId);
  if (session && (!session.endedAt || session.outcome === "in_progress")) {
    session = (await reconcileTwilioSession(normalizedSessionId)) ?? session;
  }

  if (!session || !session.endedAt || session.outcome === "in_progress") {
    return readCallActivitySyncBySessionId(normalizedSessionId);
  }

  let job = readCallActivitySyncBySessionId(normalizedSessionId);
  if (!job) {
    job = upsertQueuedCallActivitySync({
      sessionId: normalizedSessionId,
      recordingSid: null,
      recordingStatus: null,
      recordingDurationSeconds: null,
    });
  }

  if (!session.answered || job.status === "synced" || job.status === "skipped" || job.status === "processing") {
    return job;
  }

  let latestResult: CallActivitySyncRecord | null = job;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const result = await processCallActivitySyncJob(normalizedSessionId);
    if (result) {
      latestResult = result;
    }

    if (!result || result.status !== "queued") {
      return result;
    }

    await waitForDelay(2_000);
  }

  return latestResult;
}
