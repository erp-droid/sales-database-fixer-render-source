import crypto from "node:crypto";
import { google } from "googleapis";

import { config } from "../config.js";
import {
  getMailThread,
  listMailMessages,
  upsertMailConnection,
  upsertMailMessage,
  upsertMailThread
} from "./store.js";
import {
  chunk,
  cleanString,
  dedupeBy,
  normalizeComparable,
  nowIso
} from "./utils.js";

export function hasOauthConfig() {
  return Boolean(
    cleanString(config.mail.oauthClientId) &&
      cleanString(config.mail.oauthClientSecret) &&
      cleanString(config.mail.oauthRedirectUrl)
  );
}

function requireOauthConfig() {
  if (
    !hasOauthConfig()
  ) {
    throw new Error(
      "MeadowBrook Gmail OAuth is not configured. Add a MeadowBrook-owned Google OAuth client before connecting Gmail."
    );
  }
}

function createOauthClient() {
  requireOauthConfig();
  return new google.auth.OAuth2(
    config.mail.oauthClientId,
    config.mail.oauthClientSecret,
    config.mail.oauthRedirectUrl
  );
}

function cleanEmailAddress(email) {
  return cleanString(email).toLowerCase();
}

function parseAddressList(value) {
  const text = cleanString(value);
  if (!text) return [];
  return text
    .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    .map((part) => {
      const match = part.match(/^(.*)<([^>]+)>$/);
      if (match) {
        return {
          name: cleanString(match[1]).replace(/^"|"$/g, "") || null,
          email: cleanEmailAddress(match[2]),
          contactId: null,
          businessAccountRecordId: null,
          businessAccountId: null
        };
      }
      return {
        name: null,
        email: cleanEmailAddress(part),
        contactId: null,
        businessAccountRecordId: null,
        businessAccountId: null
      };
    })
    .filter((item) => item.email);
}

function readHeader(headers, name) {
  const match = (headers || []).find(
    (header) => normalizeComparable(header?.name) === normalizeComparable(name)
  );
  return cleanString(match?.value);
}

function decodeBodyData(data) {
  const raw = cleanString(data);
  if (!raw) return "";
  return Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function flattenParts(payload) {
  const queue = payload?.parts ? [...payload.parts] : [];
  const items = [];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    items.push(current);
    if (Array.isArray(current.parts)) {
      queue.push(...current.parts);
    }
  }
  return items;
}

function extractBodies(payload) {
  const body = decodeBodyData(payload?.body?.data);
  const parts = flattenParts(payload);
  const htmlPart = parts.find((part) => cleanString(part.mimeType).toLowerCase() === "text/html");
  const textPart = parts.find((part) => cleanString(part.mimeType).toLowerCase() === "text/plain");
  return {
    htmlBody: decodeBodyData(htmlPart?.body?.data) || (cleanString(payload?.mimeType).toLowerCase() === "text/html" ? body : ""),
    textBody: decodeBodyData(textPart?.body?.data) || (cleanString(payload?.mimeType).toLowerCase() === "text/plain" ? body : "")
  };
}

function stripHtml(value) {
  return cleanString(value)
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function primaryFolderFromLabels(labels = []) {
  const normalized = new Set((labels || []).map((label) => cleanString(label).toUpperCase()));
  if (normalized.has("DRAFT")) return "drafts";
  if (normalized.has("SENT")) return "sent";
  if (normalized.has("INBOX")) return "inbox";
  if (normalized.has("STARRED")) return "starred";
  return "inbox";
}

function hasLabel(labels, wanted) {
  return (labels || []).some((label) => cleanString(label).toUpperCase() === wanted);
}

function messageTimestamp(payload) {
  const internalDate = Number(payload?.internalDate);
  if (Number.isFinite(internalDate) && internalDate > 0) {
    return new Date(internalDate).toISOString();
  }

  const dateHeader = readHeader(payload?.payload?.headers, "Date");
  const parsed = Date.parse(dateHeader);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : nowIso();
}

function normalizeMessageRecord(mailbox, messagePayload, overrides = {}) {
  const headers = messagePayload?.payload?.headers || [];
  const bodies = extractBodies(messagePayload?.payload || {});
  const subject = cleanString(readHeader(headers, "Subject")) || cleanString(overrides.subject);
  const from = parseAddressList(readHeader(headers, "From"))[0] || overrides.from || null;
  const to = overrides.to || parseAddressList(readHeader(headers, "To"));
  const cc = overrides.cc || parseAddressList(readHeader(headers, "Cc"));
  const bcc = overrides.bcc || parseAddressList(readHeader(headers, "Bcc"));
  const timestamp = overrides.timestamp || messageTimestamp(messagePayload);
  const labels = messagePayload?.labelIds || [];
  const htmlBody = cleanString(overrides.htmlBody) || cleanString(bodies.htmlBody);
  const textBody = cleanString(overrides.textBody) || cleanString(bodies.textBody) || stripHtml(htmlBody);
  const linkedContact = overrides.linkedContact || overrides.threadLinkedContact || {
    contactId: null,
    businessAccountRecordId: null,
    businessAccountId: null,
    contactName: null,
    companyName: null
  };
  const matchedContacts = Array.isArray(overrides.matchedContacts)
    ? overrides.matchedContacts
    : Array.isArray(overrides.threadMatchedContacts)
      ? overrides.threadMatchedContacts
      : [];
  const hasActivityTargets =
    Number(linkedContact?.contactId) > 0 ||
    matchedContacts.some((contact) => Number(contact?.contactId) > 0);

  return {
    mailboxKey: mailbox.mailboxKey,
    messageId: cleanString(messagePayload?.id || overrides.messageId),
    threadId: cleanString(messagePayload?.threadId || overrides.threadId),
    draftId: cleanString(overrides.draftId) || null,
    internetMessageId: cleanString(readHeader(headers, "Message-ID")) || null,
    direction:
      overrides.direction ||
      (cleanEmailAddress(from?.email) === cleanEmailAddress(mailbox.senderEmail) ? "outgoing" : "incoming"),
    subject,
    htmlBody,
    textBody,
    from,
    to,
    cc,
    bcc,
    sentAt: timestamp,
    receivedAt: timestamp,
    unread: !hasLabel(labels, "UNREAD") ? false : true,
    hasAttachments: flattenParts(messagePayload?.payload || {}).some((part) => cleanString(part.filename)),
    sortTimestamp: timestamp,
    activitySyncStatus:
      cleanString(overrides.activitySyncStatus) || (hasActivityTargets ? "pending" : "not_linked"),
    linkedContact,
    matchedContacts
  };
}

function normalizeThreadRecord(mailbox, gmailThread, messages, existingThread = null, overrides = {}) {
  const orderedMessages = [...messages].sort((left, right) =>
    String(left.sortTimestamp || "").localeCompare(String(right.sortTimestamp || ""))
  );
  const lastMessage = orderedMessages[orderedMessages.length - 1] || null;
  const linkedContact = overrides.linkedContact || existingThread?.linkedContact || {
    contactId: null,
    businessAccountRecordId: null,
    businessAccountId: null,
    contactName: null,
    companyName: null
  };
  const matchedContacts = Array.isArray(overrides.matchedContacts)
    ? overrides.matchedContacts
    : Array.isArray(existingThread?.matchedContacts)
      ? existingThread.matchedContacts
      : [];
  const hasActivityTargets =
    Number(linkedContact?.contactId) > 0 ||
    matchedContacts.some((contact) => Number(contact?.contactId) > 0);
  return {
    mailboxKey: mailbox.mailboxKey,
    threadId: cleanString(gmailThread?.id || overrides.threadId),
    subject: cleanString(lastMessage?.subject) || cleanString(gmailThread?.snippet) || "(no subject)",
    snippet: cleanString(gmailThread?.snippet) || stripHtml(lastMessage?.textBody || lastMessage?.htmlBody || ""),
    folder: overrides.folder || primaryFolderFromLabels(lastMessage?.labelIds || gmailThread?.messages?.[gmailThread?.messages?.length - 1]?.labelIds || []),
    unread: orderedMessages.some((message) => message.unread),
    starred:
      orderedMessages.some((message) => hasLabel(message.labelIds || [], "STARRED")) ||
      hasLabel(gmailThread?.messages?.[gmailThread?.messages?.length - 1]?.labelIds || [], "STARRED"),
    lastMessageAt: lastMessage?.sortTimestamp || nowIso(),
    participants: dedupeBy(
      orderedMessages
        .flatMap((message) => [
          message.from?.email,
          ...message.to.map((item) => item.email),
          ...message.cc.map((item) => item.email)
        ])
        .filter(Boolean),
      (value) => normalizeComparable(value)
    ),
    linkedContact,
    matchedContacts,
    activitySyncStatus:
      orderedMessages.find((message) => cleanString(message.activitySyncStatus) === "failed")?.activitySyncStatus ||
      orderedMessages.find((message) => cleanString(message.activitySyncStatus) === "pending")?.activitySyncStatus ||
      (hasActivityTargets ? "synced" : "not_linked")
  };
}

function formatAddressHeader(recipients) {
  return (recipients || [])
    .map((recipient) => {
      const email = cleanString(recipient?.email);
      if (!email) return "";
      const name = cleanString(recipient?.name);
      return name ? `${name} <${email}>` : email;
    })
    .filter(Boolean)
    .join(", ");
}

function chunkBase64(value) {
  return String(value || "").replace(/(.{76})/g, "$1\r\n");
}

function extractInlineImages(html) {
  let outputHtml = String(html || "");
  const inlineAttachments = [];
  outputHtml = outputHtml.replace(
    /src=(['"])data:([^;]+);base64,([^'"]+)\1/gi,
    (_match, quote, mimeType, base64Data) => {
      const cid = `${crypto.randomUUID()}@mail.inline`;
      inlineAttachments.push({
        fileName: `inline-${inlineAttachments.length + 1}.${mimeType.split("/")[1] || "bin"}`,
        mimeType,
        sizeBytes: Buffer.from(base64Data, "base64").length,
        base64Data,
        inline: true,
        contentId: cid
      });
      return `src=${quote}cid:${cid}${quote}`;
    }
  );

  return {
    htmlBody: outputHtml,
    inlineAttachments
  };
}

function buildRawMime(mailbox, payload, options = {}) {
  const mixedBoundary = `mix_${crypto.randomUUID()}`;
  const altBoundary = `alt_${crypto.randomUUID()}`;
  const relatedBoundary = `rel_${crypto.randomUUID()}`;
  const { htmlBody: htmlWithInlineCid, inlineAttachments } = extractInlineImages(payload.htmlBody);
  const regularAttachments = Array.isArray(payload.attachments) ? payload.attachments : [];
  const allAttachments = [...inlineAttachments, ...regularAttachments];
  const hasInline = inlineAttachments.length > 0;
  const hasAttachments = allAttachments.length > 0;
  const messageId = `<${crypto.randomUUID()}@${cleanString(config.mail.internalDomain) || "meadowb.com"}>`;
  const references = cleanString(options.references || "");
  const inReplyTo = cleanString(options.inReplyTo || "");
  const textBody = cleanString(payload.textBody) || stripHtml(htmlWithInlineCid);
  const lines = [];

  lines.push(`From: ${payload.fromHeader || `${mailbox.displayName} <${mailbox.senderEmail}>`}`);
  lines.push(`To: ${formatAddressHeader(payload.to)}`);
  if (payload.cc?.length) lines.push(`Cc: ${formatAddressHeader(payload.cc)}`);
  if (payload.bcc?.length) lines.push(`Bcc: ${formatAddressHeader(payload.bcc)}`);
  lines.push(`Subject: ${cleanString(payload.subject) || "(no subject)"}`);
  lines.push(`MIME-Version: 1.0`);
  lines.push(`Date: ${new Date().toUTCString()}`);
  lines.push(`Message-ID: ${messageId}`);
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`);
  if (references) lines.push(`References: ${references}`);

  if (hasAttachments) {
    lines.push(`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`);
    lines.push("");
    lines.push(`--${mixedBoundary}`);
  }

  if (hasInline) {
    lines.push(`Content-Type: multipart/related; boundary="${relatedBoundary}"`);
    lines.push("");
    lines.push(`--${relatedBoundary}`);
  }

  lines.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
  lines.push("");
  lines.push(`--${altBoundary}`);
  lines.push(`Content-Type: text/plain; charset="UTF-8"`);
  lines.push(`Content-Transfer-Encoding: 7bit`);
  lines.push("");
  lines.push(textBody || "");
  lines.push(`--${altBoundary}`);
  lines.push(`Content-Type: text/html; charset="UTF-8"`);
  lines.push(`Content-Transfer-Encoding: 7bit`);
  lines.push("");
  lines.push(htmlWithInlineCid || "<div></div>");
  lines.push(`--${altBoundary}--`);

  if (hasInline) {
    inlineAttachments.forEach((attachment) => {
      lines.push(`--${relatedBoundary}`);
      lines.push(`Content-Type: ${attachment.mimeType}; name="${attachment.fileName}"`);
      lines.push(`Content-Transfer-Encoding: base64`);
      lines.push(`Content-ID: <${attachment.contentId}>`);
      lines.push(`Content-Disposition: inline; filename="${attachment.fileName}"`);
      lines.push("");
      lines.push(chunkBase64(attachment.base64Data));
    });
    lines.push(`--${relatedBoundary}--`);
  }

  if (hasAttachments) {
    regularAttachments.forEach((attachment) => {
      lines.push(`--${mixedBoundary}`);
      lines.push(`Content-Type: ${attachment.mimeType}; name="${attachment.fileName}"`);
      lines.push(`Content-Transfer-Encoding: base64`);
      lines.push(`Content-Disposition: attachment; filename="${attachment.fileName}"`);
      lines.push("");
      lines.push(chunkBase64(attachment.base64Data));
    });
    lines.push(`--${mixedBoundary}--`);
  }

  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

export function buildGoogleOauthUrl(state) {
  const oauth = createOauthClient();
  return oauth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.compose"
    ],
    state
  });
}

export async function exchangeGoogleCode(code) {
  const oauth = createOauthClient();
  const { tokens } = await oauth.getToken(code);
  oauth.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: "v2", auth: oauth });
  const profileResponse = await oauth2.userinfo.get();
  return {
    tokens,
    googleEmail: cleanEmailAddress(profileResponse.data?.email),
    googleDisplayName: cleanString(profileResponse.data?.name)
  };
}

function buildAuthorizedClients(connection) {
  const oauth = createOauthClient();
  oauth.setCredentials({
    refresh_token: cleanString(connection.refreshToken),
    access_token: cleanString(connection.accessToken),
    expiry_date: connection.expiryDate || undefined
  });
  return {
    oauth,
    gmail: google.gmail({ version: "v1", auth: oauth })
  };
}

export async function ensureMailboxWatch(connection) {
  if (!cleanString(config.mail.pubsubTopic)) {
    return connection;
  }
  const { gmail } = buildAuthorizedClients(connection);
  const response = await gmail.users.watch({
    userId: "me",
    requestBody: {
      labelIds: config.mail.watchLabelIds,
      labelFilterAction: "include",
      topicName: config.mail.pubsubTopic
    }
  });
  const updated = await upsertMailConnection({
    ...connection,
    historyId: cleanString(response.data?.historyId) || connection.historyId || null,
    watchExpiration: response.data?.expiration ? Number(response.data.expiration) : null
  });
  return updated;
}

async function fetchThread(connection, threadId) {
  const { gmail } = buildAuthorizedClients(connection);
  const response = await gmail.users.threads.get({
    userId: "me",
    id: threadId,
    format: "full"
  });
  return response.data;
}

async function persistThread(connection, gmailThread, overrides = {}) {
  const existingThread = await getMailThread(connection.loginName, gmailThread.id);
  const messages = [];
  for (const gmailMessage of gmailThread.messages || []) {
    const storedMessage = normalizeMessageRecord(connection, gmailMessage, {
      linkedContact: overrides.linkedContact || existingThread?.linkedContact || null,
      matchedContacts: overrides.matchedContacts || existingThread?.matchedContacts || [],
      threadMatchedContacts: overrides.matchedContacts || existingThread?.matchedContacts || [],
      activitySyncStatus: overrides.activitySyncStatus
    });
    storedMessage.labelIds = gmailMessage.labelIds || [];
    await upsertMailMessage(connection.loginName, storedMessage);
    messages.push(storedMessage);
  }

  const storedThread = normalizeThreadRecord(connection, gmailThread, messages, existingThread, overrides);
  await upsertMailThread(connection.loginName, storedThread);
  return {
    thread: storedThread,
    messages
  };
}

export async function syncMailboxSnapshot(connection, { maxThreads = 40 } = {}) {
  const { gmail } = buildAuthorizedClients(connection);
  const labelConfigs = [
    { labelIds: ["INBOX"], folder: "inbox" },
    { labelIds: ["SENT"], folder: "sent" },
    { labelIds: ["DRAFT"], folder: "drafts" }
  ];
  const threadIds = [];
  for (const configItem of labelConfigs) {
    const response = await gmail.users.threads.list({
      userId: "me",
      labelIds: configItem.labelIds,
      maxResults: Math.max(1, Math.floor(maxThreads / labelConfigs.length))
    });
    (response.data?.threads || []).forEach((thread) => {
      if (thread?.id) {
        threadIds.push({ threadId: thread.id, folder: configItem.folder });
      }
    });
  }

  for (const item of dedupeBy(threadIds, (entry) => cleanString(entry.threadId))) {
    const gmailThread = await fetchThread(connection, item.threadId);
    await persistThread(connection, gmailThread, { folder: item.folder });
  }
}

export async function syncMailboxHistory(connection, startHistoryId = "") {
  const historyId = cleanString(startHistoryId || connection.historyId);
  if (!historyId) {
    await syncMailboxSnapshot(connection);
    return;
  }

  const { gmail } = buildAuthorizedClients(connection);
  let pageToken = "";
  let highestHistoryId = historyId;
  const threadIds = [];

  do {
    const response = await gmail.users.history.list({
      userId: "me",
      startHistoryId: historyId,
      historyTypes: ["messageAdded", "messageDeleted", "labelAdded", "labelRemoved"],
      pageToken: pageToken || undefined,
      maxResults: 100
    });

    pageToken = cleanString(response.data?.nextPageToken);
    const currentHistoryId = cleanString(response.data?.historyId);
    if (currentHistoryId) {
      highestHistoryId = currentHistoryId;
    }

    (response.data?.history || []).forEach((historyItem) => {
      const candidates = [
        ...(historyItem.messages || []),
        ...(historyItem.messagesAdded || []).map((item) => item.message),
        ...(historyItem.labelsAdded || []).map((item) => item.message),
        ...(historyItem.labelsRemoved || []).map((item) => item.message)
      ];
      candidates.forEach((message) => {
        if (message?.threadId) {
          threadIds.push(message.threadId);
        }
      });
    });
  } while (pageToken);

  for (const threadId of dedupeBy(threadIds, (value) => cleanString(value))) {
    const gmailThread = await fetchThread(connection, threadId);
    await persistThread(connection, gmailThread);
  }

  await upsertMailConnection({
    ...connection,
    historyId: highestHistoryId
  });
}

async function syncSendResult(connection, responseThreadId, overrides = {}) {
  const gmailThread = await fetchThread(connection, responseThreadId);
  return persistThread(connection, gmailThread, overrides);
}

export async function saveDraft(connection, payload) {
  const { gmail } = buildAuthorizedClients(connection);
  const raw = buildRawMime(connection, payload);
  let response;
  if (cleanString(payload.draftId)) {
    response = await gmail.users.drafts.update({
      userId: "me",
      id: payload.draftId,
      requestBody: {
        id: payload.draftId,
        message: {
          raw,
          threadId: cleanString(payload.threadId) || undefined
        }
      }
    });
  } else {
    response = await gmail.users.drafts.create({
      userId: "me",
      requestBody: {
        message: {
          raw,
          threadId: cleanString(payload.threadId) || undefined
        }
      }
    });
  }

  const draftId = cleanString(response.data?.id || response.data?.message?.id);
  const threadId = cleanString(response.data?.message?.threadId || payload.threadId);
  if (threadId) {
    await syncSendResult(connection, threadId, {
      linkedContact: payload.linkedContact,
      matchedContacts: payload.matchedContacts
    });
  }

  return {
    saved: true,
    draftId,
    threadId: threadId || null
  };
}

export async function sendMessage(connection, payload, options = {}) {
  const { gmail } = buildAuthorizedClients(connection);
  const previousMessages = cleanString(payload.threadId)
    ? await listMailMessages(connection.loginName, payload.threadId)
    : [];
  const lastMessage = previousMessages[previousMessages.length - 1] || null;
  const raw = buildRawMime(connection, payload, {
    inReplyTo: cleanString(options.inReplyTo || lastMessage?.internetMessageId),
    references: cleanString(options.references || lastMessage?.internetMessageId)
  });
  const response = await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw,
      threadId: cleanString(options.threadId || payload.threadId) || undefined
    }
  });

  const threadId = cleanString(response.data?.threadId || payload.threadId);
  const synced = await syncSendResult(connection, threadId, {
    linkedContact: payload.linkedContact,
    matchedContacts: payload.matchedContacts
  });
  const sentMessage =
    synced.messages[synced.messages.length - 1] ||
    normalizeMessageRecord(connection, response.data, {
      linkedContact: payload.linkedContact,
      direction: "outgoing",
      subject: payload.subject,
      htmlBody: payload.htmlBody,
      textBody: payload.textBody,
      to: payload.to,
      cc: payload.cc,
      bcc: payload.bcc,
      matchedContacts: payload.matchedContacts,
      activitySyncStatus: payload.linkedContact?.contactId ? "pending" : "not_linked"
    });

  return {
    sent: true,
    threadId,
    messageId: cleanString(sentMessage.messageId || response.data?.id),
    draftId: null,
    activitySyncStatus: sentMessage.activitySyncStatus || "not_linked"
  };
}

export async function sendDraft(connection, draftId) {
  const { gmail } = buildAuthorizedClients(connection);
  const response = await gmail.users.drafts.send({
    userId: "me",
    requestBody: {
      id: draftId
    }
  });
  const threadId = cleanString(response.data?.threadId);
  const synced = await syncSendResult(connection, threadId);
  const sentMessage = synced.messages[synced.messages.length - 1] || null;
  return {
    sent: true,
    threadId,
    messageId: cleanString(sentMessage?.messageId || response.data?.id),
    draftId: null,
    activitySyncStatus: cleanString(sentMessage?.activitySyncStatus) || "not_linked"
  };
}
