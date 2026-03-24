import { readFileSync } from "node:fs";

import { Firestore } from "@google-cloud/firestore";

import { config } from "./config.js";

const COLLECTIONS = {
  files: "estimate_library_files",
  syncRuns: "estimate_library_sync_runs",
  quotes: "estimate_library_quotes",
  lineItems: "estimate_library_line_items",
  presets: "estimate_library_presets",
  reviews: "estimate_library_reviews"
};

let firestore = null;
let memoryStore = null;
let resolvedFirestoreProjectId = null;
let resolvedFirestoreOptions = null;

function cleanString(value) {
  return String(value ?? "").trim();
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function nowIso() {
  return new Date().toISOString();
}

function useFirestore() {
  return Boolean(resolveFirestoreProjectId());
}

function getFirestore() {
  if (!useFirestore()) return null;
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
    process.env.QUOTE_DOC_GOOGLE_SERVICE_ACCOUNT_KEY_FILE ||
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS
  );
}

function getServiceAccountJson() {
  return cleanString(
    process.env.QUOTE_DOC_GOOGLE_SERVICE_ACCOUNT_JSON ||
      process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
      process.env.GCP_SERVICE_ACCOUNT_JSON
  );
}

function readServiceAccountFile(path = "") {
  const keyFile = cleanString(path);
  if (!keyFile) return null;
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

  const explicitProjectId = cleanString(config.estimateLibrary.firestoreProjectId);
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
    explicitProjectId || cleanString(parsedCredentials?.project_id || parsedCredentials?.projectId);
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
      [COLLECTIONS.files]: new Map(),
      [COLLECTIONS.syncRuns]: new Map(),
      [COLLECTIONS.quotes]: new Map(),
      [COLLECTIONS.lineItems]: new Map(),
      [COLLECTIONS.presets]: new Map(),
      [COLLECTIONS.reviews]: new Map()
    };
  }
  return memoryStore;
}

function cloneSerializable(value) {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function sortByUpdatedAtDesc(items = []) {
  return [...items].sort((left, right) => {
    const leftValue = cleanString(left?.updatedAt || left?.completedAt || left?.startedAt);
    const rightValue = cleanString(right?.updatedAt || right?.completedAt || right?.startedAt);
    return rightValue.localeCompare(leftValue);
  });
}

async function firestoreSet(collectionName, docId, payload) {
  const db = getFirestore();
  await db.collection(collectionName).doc(docId).set(payload, { merge: true });
}

async function firestoreDeleteDoc(collectionName, docId) {
  const db = getFirestore();
  await db.collection(collectionName).doc(docId).delete().catch(() => {});
}

async function firestoreGet(collectionName, docId) {
  const db = getFirestore();
  const snapshot = await db.collection(collectionName).doc(docId).get();
  return snapshot.exists ? snapshot.data() : null;
}

async function firestoreDeleteByQuery(query) {
  const snapshot = await query.get();
  if (snapshot.empty) return 0;
  const docs = snapshot.docs;
  const db = getFirestore();
  let deleted = 0;
  for (let index = 0; index < docs.length; index += 450) {
    const batch = db.batch();
    docs.slice(index, index + 450).forEach((doc) => {
      batch.delete(doc.ref);
      deleted += 1;
    });
    await batch.commit();
  }
  return deleted;
}

async function firestoreSetMany(collectionName, rows = []) {
  if (!rows.length) return;
  const db = getFirestore();
  for (let index = 0; index < rows.length; index += 400) {
    const batch = db.batch();
    rows.slice(index, index + 400).forEach((row) => {
      if (!row?.id) return;
      batch.set(db.collection(collectionName).doc(cleanString(row.id)), row, { merge: true });
    });
    await batch.commit();
  }
}

function memorySet(collectionName, docId, payload) {
  getMemoryStore()[collectionName].set(cleanString(docId), cloneSerializable(payload));
}

function memoryDelete(collectionName, docId) {
  getMemoryStore()[collectionName].delete(cleanString(docId));
}

function memoryGet(collectionName, docId) {
  const value = getMemoryStore()[collectionName].get(cleanString(docId));
  return value ? cloneSerializable(value) : null;
}

function memoryFilter(collectionName, predicate) {
  return [...getMemoryStore()[collectionName].values()]
    .filter((item) => predicate(item || {}))
    .map((item) => cloneSerializable(item));
}

export function getEstimateLibraryStoreInfo() {
  return {
    firestoreEnabled: useFirestore(),
    firestoreProjectId: cleanString(resolveFirestoreProjectId())
  };
}

export async function upsertEstimateLibrarySyncRun(run = {}) {
  const payload = {
    ...cloneSerializable(run),
    id: cleanString(run.id),
    updatedAt: cleanString(run.updatedAt || nowIso())
  };
  if (!payload.id) return null;
  if (useFirestore()) {
    await firestoreSet(COLLECTIONS.syncRuns, payload.id, payload);
    return payload;
  }
  memorySet(COLLECTIONS.syncRuns, payload.id, payload);
  return payload;
}

export async function getEstimateLibrarySyncRun(runId = "") {
  const id = cleanString(runId);
  if (!id) return null;
  if (useFirestore()) {
    return await firestoreGet(COLLECTIONS.syncRuns, id);
  }
  return memoryGet(COLLECTIONS.syncRuns, id);
}

export async function getLatestEstimateLibrarySyncRun() {
  if (useFirestore()) {
    const db = getFirestore();
    const snapshot = await db
      .collection(COLLECTIONS.syncRuns)
      .orderBy("updatedAt", "desc")
      .limit(1)
      .get();
    if (snapshot.empty) return null;
    return snapshot.docs[0]?.data() || null;
  }
  return sortByUpdatedAtDesc([...getMemoryStore()[COLLECTIONS.syncRuns].values()])[0] || null;
}

export async function getEstimateLibraryFileRecord(fileId = "") {
  const id = cleanString(fileId);
  if (!id) return null;
  if (useFirestore()) {
    return await firestoreGet(COLLECTIONS.files, id);
  }
  return memoryGet(COLLECTIONS.files, id);
}

export async function upsertEstimateLibraryFileRecord(fileRecord = {}) {
  const payload = {
    ...cloneSerializable(fileRecord),
    id: cleanString(fileRecord.id || fileRecord.fileId),
    fileId: cleanString(fileRecord.fileId || fileRecord.id),
    updatedAt: cleanString(fileRecord.updatedAt || nowIso())
  };
  if (!payload.id) return null;
  if (useFirestore()) {
    await firestoreSet(COLLECTIONS.files, payload.id, payload);
    return payload;
  }
  memorySet(COLLECTIONS.files, payload.id, payload);
  return payload;
}

export async function upsertEstimateLibraryQuote(quote = {}) {
  const payload = {
    ...cloneSerializable(quote),
    id: cleanString(quote.id || quote.quoteId || quote.fileId),
    updatedAt: cleanString(quote.updatedAt || nowIso())
  };
  if (!payload.id) return null;
  if (useFirestore()) {
    await firestoreSet(COLLECTIONS.quotes, payload.id, payload);
    return payload;
  }
  memorySet(COLLECTIONS.quotes, payload.id, payload);
  return payload;
}

export async function deleteEstimateLibraryQuote(quoteId = "") {
  const id = cleanString(quoteId);
  if (!id) return;
  if (useFirestore()) {
    await firestoreDeleteDoc(COLLECTIONS.quotes, id);
    return;
  }
  memoryDelete(COLLECTIONS.quotes, id);
}

export async function replaceEstimateLibraryLineItemsForFile(fileId = "", items = []) {
  const normalizedFileId = cleanString(fileId);
  if (!normalizedFileId) return 0;
  if (useFirestore()) {
    const db = getFirestore();
    await firestoreDeleteByQuery(
      db.collection(COLLECTIONS.lineItems).where("sourceFileId", "==", normalizedFileId)
    );
    await firestoreSetMany(COLLECTIONS.lineItems, toArray(items));
    return items.length;
  }

  const collection = getMemoryStore()[COLLECTIONS.lineItems];
  [...collection.entries()].forEach(([docId, item]) => {
    if (cleanString(item?.sourceFileId) === normalizedFileId) {
      collection.delete(docId);
    }
  });
  toArray(items).forEach((item) => {
    if (!item?.id) return;
    collection.set(cleanString(item.id), cloneSerializable(item));
  });
  return items.length;
}

export async function listEstimateLibraryLineItemsByPresetKey(presetKey = "") {
  const key = cleanString(presetKey);
  if (!key) return [];
  if (useFirestore()) {
    const db = getFirestore();
    const snapshot = await db.collection(COLLECTIONS.lineItems).where("presetKey", "==", key).get();
    return snapshot.docs.map((doc) => doc.data());
  }
  return memoryFilter(COLLECTIONS.lineItems, (item) => cleanString(item?.presetKey) === key);
}

export async function replaceEstimateLibraryReviewsForFile(fileId = "", reviews = []) {
  const normalizedFileId = cleanString(fileId);
  if (!normalizedFileId) return 0;
  if (useFirestore()) {
    const db = getFirestore();
    await firestoreDeleteByQuery(
      db.collection(COLLECTIONS.reviews).where("sourceFileId", "==", normalizedFileId)
    );
    await firestoreSetMany(COLLECTIONS.reviews, toArray(reviews));
    return reviews.length;
  }

  const collection = getMemoryStore()[COLLECTIONS.reviews];
  [...collection.entries()].forEach(([docId, item]) => {
    if (cleanString(item?.sourceFileId) === normalizedFileId) {
      collection.delete(docId);
    }
  });
  toArray(reviews).forEach((item) => {
    if (!item?.id) return;
    collection.set(cleanString(item.id), cloneSerializable(item));
  });
  return reviews.length;
}

export async function listEstimateLibraryOpenReviews(limit = 25) {
  const safeLimit = Math.max(1, Number(limit) || 25);
  if (useFirestore()) {
    const db = getFirestore();
    const snapshot = await db
      .collection(COLLECTIONS.reviews)
      .where("status", "==", "open")
      .limit(safeLimit)
      .get();
    return snapshot.docs.map((doc) => doc.data());
  }
  return sortByUpdatedAtDesc(
    memoryFilter(COLLECTIONS.reviews, (item) => cleanString(item?.status || "open") === "open")
  ).slice(0, safeLimit);
}

export async function upsertEstimateLibraryPreset(preset = {}) {
  const payload = {
    ...cloneSerializable(preset),
    id: cleanString(preset.id || preset.presetId),
    updatedAt: cleanString(preset.updatedAt || nowIso())
  };
  if (!payload.id) return null;
  if (useFirestore()) {
    await firestoreSet(COLLECTIONS.presets, payload.id, payload);
    return payload;
  }
  memorySet(COLLECTIONS.presets, payload.id, payload);
  return payload;
}

export async function deleteEstimateLibraryPreset(presetId = "") {
  const id = cleanString(presetId);
  if (!id) return;
  if (useFirestore()) {
    await firestoreDeleteDoc(COLLECTIONS.presets, id);
    return;
  }
  memoryDelete(COLLECTIONS.presets, id);
}

export async function listEstimateLibraryPresetsByTrade(trade = "", limit = 500) {
  const normalizedTrade = cleanString(trade);
  const safeLimit = Math.max(1, Number(limit) || 500);
  if (!normalizedTrade) return [];
  if (useFirestore()) {
    const db = getFirestore();
    const snapshot = await db
      .collection(COLLECTIONS.presets)
      .where("trade", "==", normalizedTrade)
      .limit(safeLimit)
      .get();
    return snapshot.docs.map((doc) => doc.data());
  }
  return memoryFilter(COLLECTIONS.presets, (item) => cleanString(item?.trade) === normalizedTrade).slice(0, safeLimit);
}

export async function listEstimateLibraryQuotesByTrade(trade = "", limit = 200) {
  const normalizedTrade = cleanString(trade);
  const safeLimit = Math.max(1, Number(limit) || 200);
  if (!normalizedTrade) return [];
  if (useFirestore()) {
    const db = getFirestore();
    const snapshot = await db
      .collection(COLLECTIONS.quotes)
      .where("sectionTrades", "array-contains", normalizedTrade)
      .limit(safeLimit)
      .get();
    return snapshot.docs.map((doc) => doc.data());
  }
  return sortByUpdatedAtDesc(
    memoryFilter(
      COLLECTIONS.quotes,
      (item) =>
        Array.isArray(item?.sectionTrades) &&
        item.sectionTrades.some((candidate) => cleanString(candidate) === normalizedTrade)
    )
  ).slice(0, safeLimit);
}

export async function listEstimateLibraryLineItemsByQuoteAndTrade(quoteId = "", trade = "", limit = 500) {
  const normalizedQuoteId = cleanString(quoteId);
  const normalizedTrade = cleanString(trade);
  const safeLimit = Math.max(1, Number(limit) || 500);
  if (!normalizedQuoteId || !normalizedTrade) return [];
  if (useFirestore()) {
    const db = getFirestore();
    const snapshot = await db
      .collection(COLLECTIONS.lineItems)
      .where("quoteId", "==", normalizedQuoteId)
      .where("trade", "==", normalizedTrade)
      .limit(safeLimit)
      .get();
    return snapshot.docs.map((doc) => doc.data());
  }
  return memoryFilter(
    COLLECTIONS.lineItems,
    (item) =>
      cleanString(item?.quoteId) === normalizedQuoteId &&
      cleanString(item?.trade) === normalizedTrade
  ).slice(0, safeLimit);
}

export const __test__ = {
  resetMemoryStore() {
    firestore = null;
    memoryStore = null;
    resolvedFirestoreProjectId = null;
    resolvedFirestoreOptions = null;
  }
};
