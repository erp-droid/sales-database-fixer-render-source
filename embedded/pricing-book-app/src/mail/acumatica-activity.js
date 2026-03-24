import { AcumaticaClient } from "../acumatica.js";
import { config } from "../config.js";
import {
  getMailThread,
  listMailMessages,
  listMailThreads,
  upsertMailMessage,
  upsertMailThread
} from "./store.js";
import { cleanString, dedupeBy, nowIso } from "./utils.js";

const MAIL_ACTIVITY_REQUEST_TIMEOUT_MS = Math.max(
  Number(config.acumatica?.requestTimeoutMs || 45000),
  120000
);

const sharedAcumaticaClient = new AcumaticaClient({
  ...config.acumatica,
  requestTimeoutMs: MAIL_ACTIVITY_REQUEST_TIMEOUT_MS
});

const EMAIL_ENTITY_CANDIDATES = ["Email"];
const EMAIL_RELATED_CONTACT_ENTITY = "PX.Objects.CR.Contact";
const EMAIL_PROCESSED_STATUS = "Processed";

const FIELD_CANDIDATES = {
  id: ["NoteID", "ActivityID", "TaskID", "ID"],
  subject: ["Subject", "Summary"],
  bodyHtml: ["Body", "HtmlBody", "HTMLText", "MailBody"],
  bodyText: ["Description", "Details", "Note", "TextBody", "PlainText"],
  startDate: ["StartDate", "StartDate_Time", "Date", "CreatedDateTime"],
  endDate: ["EndDate", "EndDate_Time", "CompletedDateTime"],
  mailFrom: ["MailFrom", "EmailFrom", "From"],
  mailTo: ["MailTo", "EmailTo", "To"],
  mailCc: ["MailCc", "EmailCc", "Cc"],
  mailBcc: ["MailBcc", "EmailBcc", "Bcc"],
  incoming: [config.mail.activityIncomingFlagField, "Incoming", "IsIncome", "IncomingMail"],
  relatedEntityType: ["RelatedEntityType", "EntityType"],
  relatedEntityNoteId: ["RelatedEntityNoteID", "RelatedEntityNoteId", "RefNoteID", "ParentNoteID"],
  mailStatus: ["MailStatus", "Status"]
};

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizeEmail(value) {
  return cleanString(value).toLowerCase();
}

function resolveFieldName(fields, candidates) {
  const normalized = new Map();
  (fields || []).forEach((field) => {
    const name = field?.name || field?.fieldName || field?.displayName;
    if (name) {
      normalized.set(normalizeName(name), name);
    }
  });

  for (const candidate of candidates || []) {
    const match = normalized.get(normalizeName(candidate));
    if (match) {
      return match;
    }
  }

  return "";
}

function buildFieldMap(fields) {
  return {
    id: resolveFieldName(fields, FIELD_CANDIDATES.id),
    subject: resolveFieldName(fields, FIELD_CANDIDATES.subject),
    bodyHtml: resolveFieldName(fields, FIELD_CANDIDATES.bodyHtml),
    bodyText: resolveFieldName(fields, FIELD_CANDIDATES.bodyText),
    startDate: resolveFieldName(fields, FIELD_CANDIDATES.startDate),
    endDate: resolveFieldName(fields, FIELD_CANDIDATES.endDate),
    mailFrom: resolveFieldName(fields, FIELD_CANDIDATES.mailFrom),
    mailTo: resolveFieldName(fields, FIELD_CANDIDATES.mailTo),
    mailCc: resolveFieldName(fields, FIELD_CANDIDATES.mailCc),
    mailBcc: resolveFieldName(fields, FIELD_CANDIDATES.mailBcc),
    incoming: resolveFieldName(fields, FIELD_CANDIDATES.incoming),
    relatedEntityType: resolveFieldName(fields, FIELD_CANDIDATES.relatedEntityType),
    relatedEntityNoteId: resolveFieldName(fields, FIELD_CANDIDATES.relatedEntityNoteId),
    mailStatus: resolveFieldName(fields, FIELD_CANDIDATES.mailStatus)
  };
}

function wrapValue(value) {
  return { value };
}

function unwrapValue(value) {
  if (value && typeof value === "object" && "value" in value) {
    return value.value;
  }
  return value;
}

function stripHtml(value) {
  return cleanString(value)
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatAddress(recipient) {
  const email = cleanString(recipient?.email);
  if (!email) {
    return "";
  }

  const name = cleanString(recipient?.name);
  return name ? `${name} <${email}>` : email;
}

function formatAddressList(recipients) {
  return (Array.isArray(recipients) ? recipients : [])
    .map((recipient) => formatAddress(recipient))
    .filter(Boolean)
    .join(", ");
}

function buildCorrelationBlock(message, linkedContact) {
  return [
    "",
    "---",
    `Gmail Message ID: ${cleanString(message.messageId) || "-"}`,
    `Gmail Thread ID: ${cleanString(message.threadId) || "-"}`,
    `Direction: ${cleanString(message.direction) || "-"}`,
    `Linked Contact ID: ${linkedContact?.contactId ?? "-"}`,
    `Linked Business Account: ${cleanString(linkedContact?.businessAccountId) || "-"}`
  ].join("\n");
}

function readRawFieldValue(record, fieldName) {
  if (!record || typeof record !== "object" || !cleanString(fieldName)) {
    return "";
  }

  return cleanString(unwrapValue(record[fieldName]));
}

function buildActivityHtml(message, linkedContact) {
  const messageBody = cleanString(message.htmlBody) || `<pre>${cleanString(message.textBody)}</pre>`;
  const meta = [
    ["From", formatAddress(message.from)],
    ["To", formatAddressList(message.to)],
    ["Cc", formatAddressList(message.cc)],
    ["Bcc", formatAddressList(message.bcc)],
    ["Sent", cleanString(message.sentAt || message.receivedAt)],
    ["Gmail Message ID", cleanString(message.messageId)],
    ["Gmail Thread ID", cleanString(message.threadId)],
    ["Direction", cleanString(message.direction)],
    ["Linked Contact ID", linkedContact?.contactId ?? ""],
    ["Linked Account", cleanString(linkedContact?.businessAccountId)]
  ]
    .filter(([, value]) => cleanString(String(value)))
    .map(([label, value]) => `<div><strong>${label}:</strong> ${String(value)}</div>`)
    .join("");

  return `${meta}${messageBody}`;
}

function extractActivityId(response) {
  const candidates = ["NoteID", "ActivityID", "TaskID", "ID", "id"];
  for (const fieldName of candidates) {
    const direct = cleanString(unwrapValue(response?.[fieldName]));
    if (direct) {
      return direct;
    }
  }
  return "";
}

function readContactNoteIdFromRaw(raw) {
  return (
    readRawFieldValue(raw, "NoteID") ||
    readRawFieldValue(raw, "NoteId") ||
    readRawFieldValue(raw, "RefNoteID")
  );
}

function activityTargetKey(target) {
  return [
    Number(target?.contactId) || "",
    cleanString(target?.businessAccountRecordId) || cleanString(target?.businessAccountId) || ""
  ].join("::");
}

function normalizeActivityTarget(target) {
  const contactId = Number(target?.contactId);
  if (!Number.isFinite(contactId) || contactId <= 0) {
    return null;
  }

  return {
    contactId,
    businessAccountRecordId: cleanString(target?.businessAccountRecordId) || null,
    businessAccountId: cleanString(target?.businessAccountId) || null,
    contactName: cleanString(target?.contactName) || null,
    companyName: cleanString(target?.companyName) || null,
    email: normalizeEmail(target?.email) || null,
    noteId: cleanString(target?.noteId) || null
  };
}

function collectMessageMatchEmails(message) {
  const recipients =
    cleanString(message?.direction) === "incoming"
      ? [message?.from]
      : [...(Array.isArray(message?.to) ? message.to : [])];

  return dedupeBy(
    recipients.map((recipient) => normalizeEmail(recipient?.email)).filter(Boolean),
    (value) => value
  );
}

async function resolveMessageActivityTargets(thread, message) {
  const emailMatches = new Set(collectMessageMatchEmails(message));
  const explicitLinkedContact = normalizeActivityTarget(
    message?.linkedContact?.contactId ? message.linkedContact : thread?.linkedContact
  );
  const matchedContacts = Array.isArray(message?.matchedContacts)
    ? message.matchedContacts
        .map((contact) => normalizeActivityTarget(contact))
        .filter((contact) => contact && (!contact.email || emailMatches.size === 0 || emailMatches.has(contact.email)))
    : [];
  const targets = [];

  if (explicitLinkedContact) {
    targets.push(explicitLinkedContact);
  }

  matchedContacts.forEach((contact) => {
    targets.push(contact);
  });

  return dedupeBy(
    targets.map((target) => normalizeActivityTarget(target)).filter(Boolean),
    (target) => activityTargetKey(target)
  );
}

function createCookieBackedAcumaticaClient(cookieHeader) {
  const client = new AcumaticaClient({
    ...config.acumatica,
    requestTimeoutMs: MAIL_ACTIVITY_REQUEST_TIMEOUT_MS,
    username: "",
    password: ""
  });
  client.cookie = cleanString(cookieHeader);
  return client;
}

async function resolveEmailMeta(client) {
  const preferred = cleanString(config.mail.activityEntity);
  const candidates = dedupeBy(
    [preferred, ...EMAIL_ENTITY_CANDIDATES].filter((value) => normalizeName(value) === normalizeName("Email")),
    (value) => normalizeName(value)
  );

  for (const entityName of candidates) {
    try {
      const meta = await client.getEntityMeta(entityName);
      return {
        entityName,
        fieldMap: buildFieldMap(meta?.fields || meta?.Fields || [])
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || "Unknown error");
      if (!/\((404|405|406)\)/.test(message)) {
        throw error;
      }
    }
  }

  throw new Error("Could not resolve the Acumatica Email entity for mail logging.");
}

async function resolveContactNoteId(client, linkedContact) {
  const businessAccountRef =
    cleanString(linkedContact?.businessAccountId) ||
    cleanString(linkedContact?.businessAccountRecordId);
  const contactId = Number(linkedContact?.contactId);
  if (!businessAccountRef || !Number.isFinite(contactId) || contactId <= 0) {
    return "";
  }

  const contacts = await client.listBusinessAccountContacts(businessAccountRef, { maxRecords: 500 });
  const scopedContact =
    contacts.find((contact) => Number(contact?.id) === contactId) ||
    contacts.find((contact) => cleanString(contact?.id) === String(contactId)) ||
    null;

  if (!scopedContact?.raw) {
    return "";
  }

  return (
    readContactNoteIdFromRaw(scopedContact.raw)
  );
}

async function createEntityRecord(client, entityName, payload) {
  const attempts = [];
  for (const method of ["PUT", "POST"]) {
    try {
      const response = await client.request(entityName, {
        method,
        body: payload
      });
      return {
        response,
        activityId: extractActivityId(response)
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || "Unknown error");
      attempts.push(`${entityName} (${method}): ${message}`);
      if (!/\((404|405|406)\)/.test(message)) {
        throw new Error(attempts.join(" | "));
      }
    }
  }

  throw new Error(`Mail activity create failed for attempted entities. ${attempts.join(" | ")}`);
}

async function updateEmailStatus(client, entityName, fieldMap, activityId, mailStatus) {
  const payload = {};
  const idFieldName = cleanString(fieldMap.id) || "id";
  const statusFieldName = cleanString(fieldMap.mailStatus) || "MailStatus";
  payload[idFieldName] = wrapValue(activityId);
  payload[statusFieldName] = wrapValue(mailStatus);
  await client.request(entityName, {
    method: "PUT",
    body: payload
  });
}

function buildEmailPayload(message, linkedContact, contactNoteId, fieldMap) {
  const payload = {};
  const timestamp = cleanString(message.sentAt || message.receivedAt || nowIso());
  const subject = cleanString(message.subject) || "(no subject)";
  const htmlBody = buildActivityHtml(message, linkedContact);
  const textBody =
    cleanString(message.textBody) ||
    stripHtml(cleanString(message.htmlBody)) ||
    "(no body)";
  const correlationBlock = buildCorrelationBlock(message, linkedContact);

  const setField = (fieldName, value) => {
    if (!cleanString(fieldName)) {
      return;
    }
    payload[fieldName] = wrapValue(value);
  };

  if (fieldMap.subject) {
    setField(fieldMap.subject, subject);
  } else {
    setField("Summary", subject);
    setField("Subject", subject);
  }
  if (fieldMap.bodyHtml) {
    setField(fieldMap.bodyHtml, htmlBody);
  } else {
    setField("Body", htmlBody);
    setField("Description", htmlBody);
  }
  if (fieldMap.bodyText) {
    setField(fieldMap.bodyText, `${textBody}${correlationBlock}`);
  } else {
    setField("Description", `${textBody}${correlationBlock}`);
  }
  if (fieldMap.startDate) {
    setField(fieldMap.startDate, timestamp);
  } else {
    setField("StartDate", timestamp);
  }
  if (fieldMap.endDate) {
    setField(fieldMap.endDate, timestamp);
  } else {
    setField("EndDate", timestamp);
  }
  if (message.from) {
    if (fieldMap.mailFrom) {
      setField(fieldMap.mailFrom, formatAddress(message.from));
    } else {
      setField("MailFrom", formatAddress(message.from));
    }
  }
  if (Array.isArray(message.to) && message.to.length > 0) {
    if (fieldMap.mailTo) {
      setField(fieldMap.mailTo, formatAddressList(message.to));
    } else {
      setField("MailTo", formatAddressList(message.to));
    }
  }
  if (Array.isArray(message.cc) && message.cc.length > 0) {
    if (fieldMap.mailCc) {
      setField(fieldMap.mailCc, formatAddressList(message.cc));
    } else {
      setField("MailCc", formatAddressList(message.cc));
    }
  }
  if (Array.isArray(message.bcc) && message.bcc.length > 0) {
    if (fieldMap.mailBcc) {
      setField(fieldMap.mailBcc, formatAddressList(message.bcc));
    } else {
      setField("MailBcc", formatAddressList(message.bcc));
    }
  }
  if (fieldMap.incoming) {
    setField(fieldMap.incoming, message.direction === "incoming");
  }
  if (fieldMap.relatedEntityType) {
    setField(fieldMap.relatedEntityType, EMAIL_RELATED_CONTACT_ENTITY);
  } else {
    setField("RelatedEntityType", EMAIL_RELATED_CONTACT_ENTITY);
  }
  if (fieldMap.relatedEntityNoteId) {
    setField(fieldMap.relatedEntityNoteId, contactNoteId);
  } else {
    setField("RelatedEntityNoteID", contactNoteId);
  }

  return payload;
}

function computeThreadSyncStatus(thread, messages) {
  if (messages.some((message) => cleanString(message.activitySyncStatus) === "failed")) {
    return "failed";
  }
  if (messages.some((message) => cleanString(message.activitySyncStatus) === "pending")) {
    return "pending";
  }
  if (messages.some((message) => cleanString(message.activitySyncStatus) === "synced")) {
    return "synced";
  }
  return "not_linked";
}

async function syncMessageActivity(thread, message, client = sharedAcumaticaClient) {
  const targets = await resolveMessageActivityTargets(thread, message);
  const primaryTarget = targets[0] || null;

  if (targets.length === 0) {
    const notLinkedMessage = {
      ...message,
      linkedContact: primaryTarget || {
        contactId: null,
        businessAccountRecordId: null,
        businessAccountId: null,
        contactName: null,
        companyName: null
      },
      activityId: null,
      activityIds: [],
      activityTargets: [],
      activityEntityName: null,
      activityLoggedAt: null,
      activityError: null,
      activitySyncStatus: "not_linked"
    };
    await upsertMailMessage(thread.loginName, notLinkedMessage);
    return notLinkedMessage;
  }

  if (
    cleanString(message.activitySyncStatus) === "synced" &&
    (cleanString(message.activityId) ||
      (Array.isArray(message.activityIds) && message.activityIds.some((value) => cleanString(value))))
  ) {
    return {
      ...message,
      linkedContact: primaryTarget,
      activityTargets: Array.isArray(message.activityTargets) ? message.activityTargets : targets
    };
  }

  try {
    const meta = await resolveEmailMeta(client);
    const syncedTargets = [];
    const failures = [];

    for (const target of targets) {
      try {
        const contactNoteId =
          cleanString(target.noteId) || (await resolveContactNoteId(client, target));
        if (!contactNoteId) {
          throw new Error(
            `Could not resolve Acumatica contact NoteID for contact ${target.contactId} on account ${target.businessAccountId || target.businessAccountRecordId || "-"}.`
          );
        }

        const payload = buildEmailPayload(
          {
            ...message,
            linkedContact: target
          },
          target,
          contactNoteId,
          meta.fieldMap
        );
        const created = await createEntityRecord(client, meta.entityName, payload);
        const createdActivityId = cleanString(created.activityId);
        if (!createdActivityId) {
          throw new Error("Acumatica Email creation succeeded but did not return a NoteID.");
        }
        await updateEmailStatus(
          client,
          meta.entityName,
          meta.fieldMap,
          createdActivityId,
          EMAIL_PROCESSED_STATUS
        );
        syncedTargets.push({
          ...target,
          noteId: contactNoteId,
          activityId: createdActivityId,
          activityEntityName: cleanString(meta.entityName) || "Email",
          activityLoggedAt: nowIso(),
          error: null
        });
      } catch (error) {
        failures.push(
          `Contact ${target.contactId}: ${error instanceof Error ? error.message : String(error || "Unknown error")}`
        );
        syncedTargets.push({
          ...target,
          activityId: null,
          activityEntityName: null,
          activityLoggedAt: null,
          error: error instanceof Error ? error.message : String(error || "Unknown error")
        });
      }
    }

    const successfulTargets = syncedTargets.filter((target) => cleanString(target.activityId));
    if (successfulTargets.length === 0) {
      throw new Error(failures.join(" | ") || "No Acumatica Email records were created.");
    }

    const nextPrimaryTarget = successfulTargets[0] || primaryTarget;
    const syncedMessage = {
      ...message,
      linkedContact: nextPrimaryTarget,
      activitySyncStatus: failures.length > 0 ? "failed" : "synced",
      activityId: cleanString(successfulTargets[0]?.activityId) || cleanString(message.activityId),
      activityIds: successfulTargets
        .map((target) => cleanString(target.activityId))
        .filter(Boolean),
      activityTargets: syncedTargets,
      activityEntityName:
        cleanString(successfulTargets[0]?.activityEntityName) || cleanString(meta.entityName) || "Email",
      activityLoggedAt: cleanString(successfulTargets[0]?.activityLoggedAt) || nowIso(),
      activityError: failures.length > 0 ? failures.join(" | ") : null
    };
    await upsertMailMessage(thread.loginName, syncedMessage);
    return syncedMessage;
  } catch (error) {
    const failedMessage = {
      ...message,
      linkedContact: primaryTarget,
      activityId: null,
      activityIds: [],
      activityTargets: targets,
      activityEntityName: null,
      activityLoggedAt: null,
      activitySyncStatus: "failed",
      activityError: error instanceof Error ? error.message : String(error || "Unknown error")
    };
    await upsertMailMessage(thread.loginName, failedMessage);
    return failedMessage;
  }
}

export async function syncThreadActivities(loginName, threadId, client = sharedAcumaticaClient) {
  const thread = await getMailThread(loginName, threadId);
  if (!thread) {
    return null;
  }

  const messages = await listMailMessages(loginName, threadId);
  const threadWithLogin = {
    ...thread,
    loginName
  };
  const nextMessages = [];
  for (const message of messages) {
    const updatedMessage = await syncMessageActivity(threadWithLogin, {
      ...message,
      linkedContact: message?.linkedContact?.contactId ? message.linkedContact : thread.linkedContact
    }, client);
    nextMessages.push(updatedMessage);
  }

  const nextThread = {
    ...thread,
    activitySyncStatus: computeThreadSyncStatus(thread, nextMessages),
    updatedAt: nowIso()
  };
  await upsertMailThread(loginName, nextThread);
  return {
    thread: nextThread,
    messages: nextMessages
  };
}

export async function linkThreadToContact(
  loginName,
  threadId,
  linkedContact,
  client = sharedAcumaticaClient
) {
  const thread = await getMailThread(loginName, threadId);
  if (!thread) {
    return null;
  }

  const messages = await listMailMessages(loginName, threadId);
  const normalizedLinkedContact = {
    contactId: linkedContact?.contactId ?? null,
    businessAccountRecordId: cleanString(linkedContact?.businessAccountRecordId) || null,
    businessAccountId: cleanString(linkedContact?.businessAccountId) || null,
    contactName: cleanString(linkedContact?.contactName) || thread?.linkedContact?.contactName || null,
    companyName: cleanString(linkedContact?.companyName) || thread?.linkedContact?.companyName || null
  };

  const nextThread = {
    ...thread,
    linkedContact: normalizedLinkedContact,
    activitySyncStatus: normalizedLinkedContact.contactId ? "pending" : "not_linked"
  };
  await upsertMailThread(loginName, nextThread);

  for (const message of messages) {
    await upsertMailMessage(loginName, {
      ...message,
      linkedContact: normalizedLinkedContact,
      activitySyncStatus: normalizedLinkedContact.contactId ? "pending" : "not_linked",
      activityError: null
    });
  }

  return syncThreadActivities(loginName, threadId, client);
}

export async function syncPendingMailboxActivities(loginName, client = sharedAcumaticaClient) {
  const threadIds = new Set();
  const folders = ["inbox", "sent", "drafts", "starred"];
  for (const folder of folders) {
    const response = await listMailThreads(loginName, {
      folder,
      limit: 50
    });
    response.items.forEach((thread) => {
      if (["pending", "failed"].includes(cleanString(thread.activitySyncStatus))) {
        threadIds.add(thread.threadId);
      }
    });
  }

  const results = [];
  for (const threadId of threadIds) {
    const synced = await syncThreadActivities(loginName, threadId, client);
    if (synced) {
      results.push(synced);
    }
  }
  return results;
}

export function getMailActivityAcumaticaClient(options = {}) {
  const cookieHeader = cleanString(options?.cookieHeader);
  if (cookieHeader) {
    return createCookieBackedAcumaticaClient(cookieHeader);
  }

  return sharedAcumaticaClient;
}
