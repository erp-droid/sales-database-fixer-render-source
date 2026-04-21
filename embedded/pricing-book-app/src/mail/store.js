import { readFileSync } from "node:fs";

import { Firestore } from "@google-cloud/firestore";

import { config } from "../config.js";
import {
  cleanString,
  decryptText,
  encryptText,
  nowIso,
  normalizeComparable,
  toMailboxKey
} from "./utils.js";

let firestore = null;
let memoryStore = null;
let resolvedFirestoreProjectId = null;
let resolvedFirestoreOptions = null;

function useFirestore() {
  return Boolean(resolveFirestoreProjectId());
}

function getFirestore() {
  if (!useFirestore()) {
    return null;
  }
  if (!firestore) {
    firestore = new Firestore({
      ...resolveFirestoreOptionsObject(),
      preferRest: true
    });
  }
  return firestore;
}

function getServiceAccountKeyFile() {
  return cleanString(
    process.env.MAIL_FIRESTORE_CREDENTIALS_KEY_FILE ||
      process.env.MAIL_GOOGLE_SERVICE_ACCOUNT_KEY_FILE ||
      process.env.QUOTE_DOC_GOOGLE_SERVICE_ACCOUNT_KEY_FILE ||
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS
  );
}

function getServiceAccountJson() {
  return cleanString(
    process.env.MAIL_FIRESTORE_CREDENTIALS_JSON ||
      process.env.MAIL_GOOGLE_SERVICE_ACCOUNT_JSON ||
      process.env.QUOTE_DOC_GOOGLE_SERVICE_ACCOUNT_JSON ||
      process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
      process.env.GCP_SERVICE_ACCOUNT_JSON
  );
}

function readServiceAccountFile(path = "") {
  const keyFile = cleanString(path);
  if (!keyFile) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(keyFile, "utf8"));
  } catch (_error) {
    return null;
  }
}

function resolveFirestoreOptionsObject() {
  if (resolvedFirestoreOptions) {
    return { ...resolvedFirestoreOptions };
  }

  const explicitProjectId = cleanString(config.mail.firestoreProjectId);
  const serviceAccountJson = getServiceAccountJson();
  const serviceAccountKeyFile = getServiceAccountKeyFile();

  let parsedCredentials = null;
  if (serviceAccountJson) {
    try {
      parsedCredentials = JSON.parse(serviceAccountJson);
    } catch (_error) {
      parsedCredentials = null;
    }
  }

  if (!parsedCredentials && serviceAccountKeyFile) {
    parsedCredentials = readServiceAccountFile(serviceAccountKeyFile);
  }

  const inferredProjectId =
    explicitProjectId ||
    cleanString(parsedCredentials?.project_id || parsedCredentials?.projectId);
  resolvedFirestoreProjectId = inferredProjectId;

  const nextOptions = {};
  if (inferredProjectId) {
    nextOptions.projectId = inferredProjectId;
  }

  const clientEmail = cleanString(parsedCredentials?.client_email || parsedCredentials?.clientEmail);
  const privateKey = String(parsedCredentials?.private_key || parsedCredentials?.privateKey || "")
    .replace(/\\n/g, "\n")
    .trim();
  if (clientEmail && privateKey) {
    nextOptions.credentials = {
      client_email: clientEmail,
      private_key: privateKey
    };
  } else if (
    normalizeComparable(parsedCredentials?.type) === "authorized_user" &&
    cleanString(parsedCredentials?.client_id) &&
    cleanString(parsedCredentials?.client_secret) &&
    cleanString(parsedCredentials?.refresh_token)
  ) {
    nextOptions.credentials = {
      type: "authorized_user",
      client_id: cleanString(parsedCredentials.client_id),
      client_secret: cleanString(parsedCredentials.client_secret),
      refresh_token: cleanString(parsedCredentials.refresh_token)
    };
    const quotaProjectId = cleanString(
      parsedCredentials?.quota_project_id || parsedCredentials?.quotaProjectId
    );
    if (quotaProjectId) {
      nextOptions.credentials.quota_project_id = quotaProjectId;
    }
  } else if (serviceAccountKeyFile) {
    nextOptions.keyFilename = serviceAccountKeyFile;
  }

  resolvedFirestoreOptions = nextOptions;
  return { ...nextOptions };
}

function resolveFirestoreProjectId() {
  if (resolvedFirestoreProjectId !== null) {
    return resolvedFirestoreProjectId;
  }
  resolveFirestoreOptionsObject();
  return resolvedFirestoreProjectId || "";
}

function getMemoryStore() {
  if (!memoryStore) {
    memoryStore = {
      connections: new Map(),
      threads: new Map(),
      messages: new Map()
    };
  }
  return memoryStore;
}

function connectionDocId(loginName) {
  return toMailboxKey(loginName);
}

function threadDocId(loginName, threadId) {
  return `${toMailboxKey(loginName)}__${cleanString(threadId)}`;
}

function messageDocId(loginName, messageId) {
  return `${toMailboxKey(loginName)}__${cleanString(messageId)}`;
}

function serializeConnection(connection) {
  return {
    ...connection,
    mailboxKey: toMailboxKey(connection.loginName),
    senderEmail: normalizeComparable(connection.senderEmail),
    refreshTokenEncrypted: connection.refreshToken
      ? encryptText(connection.refreshToken, config.mail.encryptionSecret)
      : cleanString(connection.refreshTokenEncrypted),
    updatedAt: nowIso()
  };
}

function deserializeConnection(stored) {
  if (!stored) return null;
  const refreshToken =
    cleanString(stored.refreshToken) ||
    decryptText(stored.refreshTokenEncrypted, config.mail.encryptionSecret);
  return {
    ...stored,
    refreshToken
  };
}

async function firestoreUpsert(collectionName, docId, payload) {
  const db = getFirestore();
  await db.collection(collectionName).doc(docId).set(payload, { merge: true });
}

async function firestoreGet(collectionName, docId) {
  const db = getFirestore();
  const snapshot = await db.collection(collectionName).doc(docId).get();
  return snapshot.exists ? snapshot.data() : null;
}

export async function getMailConnection(loginName) {
  const mailboxKey = connectionDocId(loginName);
  if (useFirestore()) {
    return deserializeConnection(await firestoreGet("mail_connections", mailboxKey));
  }
  return deserializeConnection(getMemoryStore().connections.get(mailboxKey) || null);
}

export async function getMailConnectionBySenderEmail(senderEmail) {
  const wantedEmail = normalizeComparable(senderEmail);
  if (useFirestore()) {
    const db = getFirestore();
    const snapshot = await db
      .collection("mail_connections")
      .where("senderEmail", "==", wantedEmail)
      .limit(1)
      .get();
    if (snapshot.empty) return null;
    return deserializeConnection(snapshot.docs[0]?.data() || null);
  }

  const values = [...getMemoryStore().connections.values()];
  return deserializeConnection(
    values.find((connection) => normalizeComparable(connection.senderEmail) === wantedEmail) || null
  );
}

export async function upsertMailConnection(connection) {
  const payload = serializeConnection(connection);
  const mailboxKey = connectionDocId(connection.loginName);
  if (useFirestore()) {
    await firestoreUpsert("mail_connections", mailboxKey, payload);
    return deserializeConnection(payload);
  }
  getMemoryStore().connections.set(mailboxKey, payload);
  return deserializeConnection(payload);
}

export async function deleteMailConnection(loginName) {
  const mailboxKey = connectionDocId(loginName);
  if (useFirestore()) {
    const db = getFirestore();
    await db.collection("mail_connections").doc(mailboxKey).delete().catch(() => {});
    return;
  }
  getMemoryStore().connections.delete(mailboxKey);
}

export async function listMailConnections() {
  if (useFirestore()) {
    const db = getFirestore();
    const snapshot = await db.collection("mail_connections").get();
    return snapshot.docs
      .map((doc) => deserializeConnection(doc.data()))
      .filter(Boolean);
  }

  return [...getMemoryStore().connections.values()]
    .map((item) => deserializeConnection(item))
    .filter(Boolean);
}

export async function upsertMailThread(loginName, thread) {
  const payload = {
    ...thread,
    mailboxKey: toMailboxKey(loginName),
    threadId: cleanString(thread.threadId),
    updatedAt: nowIso()
  };
  const docId = threadDocId(loginName, payload.threadId);
  if (useFirestore()) {
    await firestoreUpsert("mail_threads", docId, payload);
    return payload;
  }
  getMemoryStore().threads.set(docId, payload);
  return payload;
}

export async function getMailThread(loginName, threadId) {
  const docId = threadDocId(loginName, threadId);
  if (useFirestore()) {
    return await firestoreGet("mail_threads", docId);
  }
  return getMemoryStore().threads.get(docId) || null;
}

export async function listMailThreads(loginName, { folder = "inbox", q = "", limit = 25 } = {}) {
  const mailboxKey = toMailboxKey(loginName);
  const normalizedQuery = normalizeComparable(q);
  let rows = [];

  if (useFirestore()) {
    const db = getFirestore();
    const snapshot = await db
      .collection("mail_threads")
      .where("mailboxKey", "==", mailboxKey)
      .get();
    rows = snapshot.docs.map((doc) => doc.data());
  } else {
    rows = [...getMemoryStore().threads.values()].filter((item) => item.mailboxKey === mailboxKey);
  }

  rows = rows.filter((row) => {
    if (folder === "starred") {
      return Boolean(row.starred);
    }
    return row.folder === folder;
  });

  if (normalizedQuery) {
    rows = rows.filter((row) =>
      normalizeComparable(
        [row.subject, row.snippet, ...(Array.isArray(row.participants) ? row.participants : [])]
          .filter(Boolean)
          .join(" ")
      ).includes(normalizedQuery)
    );
  }

  rows.sort((left, right) => String(right.lastMessageAt || "").localeCompare(String(left.lastMessageAt || "")));
  const items = rows.slice(0, limit);
  return {
    items,
    nextCursor: rows.length > limit ? items[items.length - 1]?.threadId || null : null,
    total: rows.length
  };
}

export async function upsertMailMessage(loginName, message) {
  const payload = {
    ...message,
    mailboxKey: toMailboxKey(loginName),
    messageId: cleanString(message.messageId),
    threadId: cleanString(message.threadId),
    updatedAt: nowIso()
  };
  const docId = messageDocId(loginName, payload.messageId);
  if (useFirestore()) {
    await firestoreUpsert("mail_messages", docId, payload);
    return payload;
  }
  getMemoryStore().messages.set(docId, payload);
  return payload;
}

export async function getMailMessage(loginName, messageId) {
  const docId = messageDocId(loginName, messageId);
  if (useFirestore()) {
    return await firestoreGet("mail_messages", docId);
  }
  return getMemoryStore().messages.get(docId) || null;
}

export async function listMailMessages(loginName, threadId) {
  const mailboxKey = toMailboxKey(loginName);
  let rows = [];
  if (useFirestore()) {
    const db = getFirestore();
    const snapshot = await db
      .collection("mail_messages")
      .where("mailboxKey", "==", mailboxKey)
      .get();
    rows = snapshot.docs
      .map((doc) => doc.data())
      .filter((item) => item.threadId === cleanString(threadId));
  } else {
    rows = [...getMemoryStore().messages.values()].filter(
      (item) => item.mailboxKey === mailboxKey && item.threadId === cleanString(threadId)
    );
  }
  rows.sort((left, right) => String(left.sortTimestamp || "").localeCompare(String(right.sortTimestamp || "")));
  return rows;
}

export async function listMailboxMessages(loginName, { limit = 5000 } = {}) {
  const mailboxKey = toMailboxKey(loginName);
  let rows = [];

  if (useFirestore()) {
    const db = getFirestore();
    const snapshot = await db
      .collection("mail_messages")
      .where("mailboxKey", "==", mailboxKey)
      .get();
    rows = snapshot.docs.map((doc) => doc.data());
  } else {
    rows = [...getMemoryStore().messages.values()].filter((item) => item.mailboxKey === mailboxKey);
  }

  rows.sort((left, right) => String(right.sortTimestamp || "").localeCompare(String(left.sortTimestamp || "")));
  if (Number.isFinite(limit) && limit > 0) {
    rows = rows.slice(0, Math.trunc(limit));
  }
  return rows;
}
