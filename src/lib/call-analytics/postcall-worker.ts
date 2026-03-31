import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { NextRequest } from "next/server";

import {
  readWrappedString,
  type RawActivity,
  type RawBusinessAccount,
  type RawContact,
} from "@/lib/acumatica";
import {
  serviceCreateActivity,
  serviceFetchBusinessAccountById,
  serviceFetchContactsByBusinessAccountIds,
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
import { extractNormalizedPhoneDigits } from "@/lib/phone";
import {
  readCallLegsBySessionId,
  readCallSessionById,
  readCallSessions,
} from "@/lib/call-analytics/sessionize";
import { validateTwilioWebhookRequest } from "@/lib/twilio-webhook-validation";
import {
  createTwilioRestClient,
  getTwilioRestConfig,
} from "@/lib/twilio";

export type ResolvedActivityTarget = {
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

const RECENT_CALL_ACTIVITY_SYNC_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const OPENAI_TRANSCRIPTION_FALLBACK_MODELS = [
  "gpt-4o-transcribe",
  "gpt-4o-mini-transcribe",
  "whisper-1",
];
const BACKGROUND_SERVICE_LOGIN_NAME: string | null = null;

function cleanText(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function logCallActivitySyncResult(
  sessionId: string,
  result: CallActivitySyncRecord | null,
  context: string,
): void {
  if (!result) {
    return;
  }

  const payload = {
    sessionId,
    context,
    status: result.status,
    attempts: result.attempts,
    recordingSid: cleanText(result.recordingSid) || null,
    activityId: cleanText(result.activityId) || null,
    error: cleanText(result.error) || null,
  };

  if (result.status === "failed") {
    console.error("[call-activity-sync] Job failed.", payload);
    return;
  }

  if (result.status === "queued" || result.status === "skipped") {
    console.warn("[call-activity-sync] Job not yet synced.", payload);
    return;
  }

  console.info("[call-activity-sync] Job completed.", payload);
}

function normalizeComparableName(value: string | null | undefined): string {
  return cleanText(value).replace(/\s+/g, " ").toLowerCase();
}

function readContactDisplayName(contact: RawContact): string {
  const preferred = cleanText(readWrappedString(contact, "DisplayName"));
  if (preferred) {
    return preferred;
  }

  return [cleanText(readWrappedString(contact, "FirstName")), cleanText(readWrappedString(contact, "LastName"))]
    .filter(Boolean)
    .join(" ");
}

function readContactPhones(contact: RawContact): string[] {
  return [
    cleanText(readWrappedString(contact, "Phone1")),
    cleanText(readWrappedString(contact, "Phone2")),
    cleanText(readWrappedString(contact, "Phone3")),
    cleanText(readWrappedString(contact, "Phone")),
  ].filter(Boolean);
}

function resolveRelatedContactByPhoneOrName(
  session: CallSessionRecord,
  contacts: RawContact[],
): RawContact | null {
  const sessionPhoneDigits = new Set(
    [extractNormalizedPhoneDigits(session.counterpartyPhone), extractNormalizedPhoneDigits(session.targetPhone)].filter(
      Boolean,
    ),
  );
  if (sessionPhoneDigits.size > 0) {
    const phoneMatches = contacts.filter((contact) =>
      readContactPhones(contact).some((phone) => sessionPhoneDigits.has(extractNormalizedPhoneDigits(phone))),
    );
    if (phoneMatches.length === 1) {
      return phoneMatches[0] ?? null;
    }
  }

  const targetName = normalizeComparableName(session.matchedContactName);
  if (!targetName) {
    return null;
  }

  const nameMatches = contacts.filter(
    (contact) => normalizeComparableName(readContactDisplayName(contact)) === targetName,
  );
  return nameMatches.length === 1 ? (nameMatches[0] ?? null) : null;
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

export function buildActivitySummary(session: CallSessionRecord): string {
  const value = `Phone call with ${readSummaryTarget(session)}`.trim();
  return value.length > 255 ? `${value.slice(0, 252).trim()}...` : value;
}

function buildFallbackSummaryText(transcriptText: string): string {
  const normalized = cleanText(transcriptText).replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "AI summary unavailable. See transcript below.";
  }

  const sentences = (normalized.match(/[^.!?]+[.!?]?/g) ?? [])
    .map((value) => value.trim())
    .filter(Boolean);
  const excerpt = (sentences.slice(0, 2).join(" ") || normalized).trim();
  const prefix = "AI summary unavailable. ";
  const maxLength = 500;
  if (excerpt.length <= maxLength - prefix.length) {
    return `${prefix}${excerpt}`;
  }

  return `${prefix}${excerpt.slice(0, maxLength - prefix.length - 3).trim()}...`;
}

function buildTranscriptionUnavailableSummaryText(): string {
  return "Automatic transcription unavailable. The recording was captured, but a transcript could not be generated.";
}

function buildTranscriptionUnavailableTranscriptText(): string {
  return "Automatic transcription was unavailable for this call recording.";
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
    ["Call session ID", cleanText(session.sessionId) || "-"],
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

export function buildActivityBodyHtml(
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

function shouldSyncWithoutTranscript(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return (
    shouldUseLocalTranscriptionFallback(error) ||
    message.includes("openai transcription failed") ||
    message.includes("local transcription failed") ||
    message.includes("transcription returned an empty transcript")
  );
}

async function transcribeAudioWithOpenAiModel(
  recordingSid: string,
  audioBlob: Blob,
  model: string,
): Promise<string> {
  const apiKey = readOpenAiApiKey();
  const formData = new FormData();
  formData.append("model", model);
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

async function transcribeAudioWithOpenAi(recordingSid: string, audioBlob: Blob): Promise<string> {
  const preferredModel = getEnv().OPENAI_TRANSCRIPTION_MODEL;
  const models = [...new Set([preferredModel, ...OPENAI_TRANSCRIPTION_FALLBACK_MODELS])];
  let lastError: Error | null = null;

  for (const model of models) {
    try {
      return await transcribeAudioWithOpenAiModel(recordingSid, audioBlob, model);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(getErrorMessage(error));
      if (!shouldUseLocalTranscriptionFallback(lastError)) {
        throw lastError;
      }
    }
  }

  throw lastError ?? new Error("OpenAI transcription failed.");
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
  let openAiError: Error | null = null;

  try {
    return await transcribeAudioWithOpenAi(recordingSid, audioBlob);
  } catch (error) {
    const normalizedError = error instanceof Error ? error : new Error(getErrorMessage(error));
    if (!shouldUseLocalTranscriptionFallback(normalizedError)) {
      throw normalizedError;
    }
    openAiError = normalizedError;
  }

  try {
    return await transcribeAudioLocally(recordingSid, audioBlob);
  } catch (error) {
    const localError = error instanceof Error ? error : new Error(getErrorMessage(error));
    if (!openAiError) {
      throw localError;
    }

    throw new Error(
      `${getErrorMessage(openAiError)}; local fallback failed: ${getErrorMessage(localError)}`,
    );
  }
}

async function summarizeTranscriptWithModel(
  session: CallSessionRecord,
  transcriptText: string,
  model: string,
): Promise<string> {
  const apiKey = readOpenAiApiKey();
  const userPrompt = [
    `Employee: ${cleanText(session.employeeDisplayName) || cleanText(session.employeeLoginName) || "Unknown"}`,
    `Company: ${cleanText(session.matchedCompanyName) || "Unknown"}`,
    `Contact: ${cleanText(session.matchedContactName) || "Unknown"}`,
    `Phone: ${cleanText(session.counterpartyPhone) || cleanText(session.targetPhone) || "Unknown"}`,
    `Started: ${formatDateTime(session.startedAt)}`,
    `Talk duration: ${formatDuration(session.talkDurationSeconds)}`,
    "",
    "Transcript:",
    transcriptText,
  ].join("\n");

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
          content: userPrompt,
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

export async function resolveActivityTarget(
  session: CallSessionRecord,
): Promise<ResolvedActivityTarget | null> {
  const candidateContactIds = [...new Set([session.linkedContactId, session.matchedContactId])]
    .filter((value): value is number => typeof value === "number" && Number.isInteger(value) && value > 0);

  const candidateBusinessAccountIds = [
    ...new Set([
      cleanText(session.linkedBusinessAccountId),
      cleanText(session.matchedBusinessAccountId),
    ]),
  ].filter(Boolean);

  if (candidateBusinessAccountIds.length > 0) {
    try {
      const contacts = (await serviceFetchContactsByBusinessAccountIds(
        BACKGROUND_SERVICE_LOGIN_NAME,
        candidateBusinessAccountIds,
      )) as RawContact[];
      const resolvedContact = resolveRelatedContactByPhoneOrName(session, contacts);
      const noteId = resolvedContact ? readRecordIdentity(resolvedContact) : null;
      if (noteId) {
        return {
          relatedEntityNoteId: noteId,
          relatedEntityType: "PX.Objects.CR.Contact",
        };
      }
    } catch {
      // Fall through to explicit contact ids or a business-account-level target.
    }
  }

  const candidateContacts: RawContact[] = [];
  for (const contactId of candidateContactIds) {
    try {
      const contact = (await serviceFetchContactById(
        BACKGROUND_SERVICE_LOGIN_NAME,
        contactId,
      )) as RawContact;
      candidateContacts.push(contact);
    } catch {
      // Fall through to the next candidate.
    }
  }

  const resolvedCandidateContact = resolveRelatedContactByPhoneOrName(session, candidateContacts);
  const resolvedCandidateContactNoteId = resolvedCandidateContact
    ? readRecordIdentity(resolvedCandidateContact)
    : null;
  if (resolvedCandidateContactNoteId) {
    return {
      relatedEntityNoteId: resolvedCandidateContactNoteId,
      relatedEntityType: "PX.Objects.CR.Contact",
    };
  }

  for (const contact of candidateContacts) {
    const noteId = readRecordIdentity(contact);
    if (noteId) {
      return {
        relatedEntityNoteId: noteId,
        relatedEntityType: "PX.Objects.CR.Contact",
      };
    }
  }

  if (candidateBusinessAccountIds.length > 0) {
    try {
      const contacts = (await serviceFetchContactsByBusinessAccountIds(
        BACKGROUND_SERVICE_LOGIN_NAME,
        candidateBusinessAccountIds,
      )) as RawContact[];
      const resolvedContact = resolveRelatedContactByPhoneOrName(session, contacts);
      const noteId = resolvedContact ? readRecordIdentity(resolvedContact) : null;
      if (noteId) {
        return {
          relatedEntityNoteId: noteId,
          relatedEntityType: "PX.Objects.CR.Contact",
        };
      }
    } catch {
      // Fall through to a business-account-level target.
    }
  }

  for (const businessAccountId of candidateBusinessAccountIds) {
    try {
      const businessAccount = (await serviceFetchBusinessAccountById(
        BACKGROUND_SERVICE_LOGIN_NAME,
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
  const activity = await serviceCreateActivity(BACKGROUND_SERVICE_LOGIN_NAME, {
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

function queueRecentEligibleCallActivitySyncJobs(
  limit = 25,
  lookbackMs = RECENT_CALL_ACTIVITY_SYNC_LOOKBACK_MS,
): void {
  const maxCandidates = Math.max(1, Math.trunc(limit));
  const earliestStartedAtMs = Date.now() - Math.max(0, Math.trunc(lookbackMs));
  let consideredCount = 0;

  for (const session of readCallSessions()) {
    if (
      session.source !== "app_bridge" ||
      !session.answered ||
      !session.endedAt ||
      session.outcome === "in_progress"
    ) {
      continue;
    }

    const sessionStartedAtMs = Date.parse(session.startedAt ?? session.endedAt ?? session.updatedAt);
    if (Number.isFinite(sessionStartedAtMs) && sessionStartedAtMs < earliestStartedAtMs) {
      continue;
    }

    const existing = readCallActivitySyncBySessionId(session.sessionId);
    if (
      existing &&
      (existing.status === "synced" ||
        existing.status === "skipped" ||
        existing.status === "processing")
    ) {
      continue;
    }

    consideredCount += 1;
    if (!existing) {
      upsertQueuedCallActivitySync({
        sessionId: session.sessionId,
        recordingSid: null,
        recordingStatus: null,
        recordingDurationSeconds: null,
      });
    }

    if (consideredCount >= maxCandidates) {
      break;
    }
  }
}

export async function processCallActivitySyncJob(
  sessionId: string,
): Promise<CallActivitySyncRecord | null> {
  const claimed = claimCallActivitySyncJob(sessionId);
  if (!claimed) {
    const current = readCallActivitySyncBySessionId(sessionId);
    logCallActivitySyncResult(sessionId, current, "already_claimed");
    return current;
  }

  try {
    const finish = (result: CallActivitySyncRecord | null, context = "process") => {
      logCallActivitySyncResult(sessionId, result, context);
      return result;
    };

    let session = readCallSessionById(sessionId);
    if (session && (!session.endedAt || session.outcome === "in_progress")) {
      session = (await reconcileTwilioSession(sessionId)) ?? session;
    }

    if (!session || !session.endedAt || session.outcome === "in_progress") {
      return finish(
        requeueCallActivitySyncJob(sessionId, "Waiting for the call session to finish syncing."),
        "waiting_for_session",
      );
    }

    if (!session.answered) {
      return finish(markCallActivitySyncSkipped(sessionId, "Call was not answered."), "unanswered");
    }

    const target = await resolveActivityTarget(session);
    if (!target) {
      return finish(
        markCallActivitySyncSkipped(
          sessionId,
          "No related contact or business account could be resolved for this call.",
        ),
        "no_target",
      );
    }

    let transcriptText = cleanText(claimed.transcriptText);
    let summaryText = cleanText(claimed.summaryText);
    let recordingSid = cleanText(claimed.recordingSid);

    if (!transcriptText) {
      if (!recordingSid) {
        const resolvedRecording = await resolveRecordingForSession(sessionId);
        if (!resolvedRecording?.recordingSid) {
          return finish(
            requeueCallActivitySyncJob(
              sessionId,
              "Waiting for the call recording to be available.",
            ),
            "waiting_for_recording",
          );
        }

        const updated = markCallActivitySyncRecordingResolved(sessionId, resolvedRecording);
        recordingSid = cleanText(updated.recordingSid);
      }

      try {
        transcriptText = await transcribeRecording(recordingSid);
      } catch (error) {
        if (!shouldSyncWithoutTranscript(error)) {
          throw error;
        }

        transcriptText = buildTranscriptionUnavailableTranscriptText();
        if (!summaryText) {
          summaryText = buildTranscriptionUnavailableSummaryText();
        }
        console.warn(
          "[call-activity-sync] Transcription unavailable; syncing activity with fallback note.",
          {
            sessionId,
            recordingSid,
            error: getErrorMessage(error),
          },
        );
      }
    }

    if (!summaryText) {
      try {
        summaryText = await summarizeTranscriptWithOpenAi(session, transcriptText);
      } catch (error) {
        summaryText = buildFallbackSummaryText(transcriptText);
        console.warn("[call-activity-sync] AI summary unavailable; using transcript fallback.", {
          sessionId,
          error: getErrorMessage(error),
        });
      }
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

    return finish(synced, "synced");
  } catch (error) {
    const failed = markCallActivitySyncFailed(sessionId, getErrorMessage(error));
    logCallActivitySyncResult(sessionId, failed, "failed");
    return failed;
  }
}

export async function runDueCallActivitySyncJobs(limit = 25): Promise<{
  processedCount: number;
  syncedCount: number;
  failedCount: number;
  skippedCount: number;
}> {
  queueRecentEligibleCallActivitySyncJobs(limit);
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

  const formData = await request.formData();
  const params = Object.fromEntries(
    [...formData.entries()].map(([key, value]) => [key, typeof value === "string" ? value : ""]),
  ) as Record<string, string>;

  const validation = validateTwilioWebhookRequest(request, params, config.authToken);
  if (!validation.isValid) {
    console.warn("[twilio] Rejected recording callback due to invalid signature.", {
      path: request.nextUrl.pathname,
      requestUrl: request.url,
      candidateUrls: validation.candidateUrls,
    });
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

export function queueCallActivitySyncForSession(
  sessionId: string,
): CallActivitySyncRecord | null {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) {
    return null;
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

  return job;
}
