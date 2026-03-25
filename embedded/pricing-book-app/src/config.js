const env = process.env;

function cleanString(value) {
  return String(value || "").trim();
}

function unwrapValue(value) {
  if (value && typeof value === "object" && "value" in value) {
    return value.value;
  }
  return value;
}

function parseOpportunityAttributes(raw) {
  const text = String(raw || "").trim();
  if (!text) return [];

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_error) {
    throw new Error("ACU_OPP_ATTRIBUTES_JSON must be valid JSON.");
  }

  if (Array.isArray(parsed)) {
    return parsed
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const attributeId = unwrapValue(item.attributeId || item.AttributeID || item.id);
        const value = unwrapValue(item.value ?? item.Value ?? item.attributeValue);
        if (!attributeId || value === undefined || value === null || value === "") return null;
        return { attributeId: String(attributeId), value };
      })
      .filter(Boolean);
  }

  if (parsed && typeof parsed === "object") {
    return Object.entries(parsed)
      .map(([attributeId, value]) => {
        const cleanId = String(attributeId || "").trim();
        const cleanValue = unwrapValue(value);
        if (!cleanId || cleanValue === undefined || cleanValue === null || cleanValue === "") return null;
        return { attributeId: cleanId, value: cleanValue };
      })
      .filter(Boolean);
  }

  throw new Error("ACU_OPP_ATTRIBUTES_JSON must be a JSON object or array.");
}

function parseInteger(raw, fallback = 0) {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function parseBoolean(raw, fallback = false) {
  const text = String(raw ?? "").trim().toLowerCase();
  if (!text) return fallback;
  if (["1", "true", "yes", "on"].includes(text)) return true;
  if (["0", "false", "no", "off"].includes(text)) return false;
  return fallback;
}

function parseCsvList(raw, fallback = []) {
  const text = String(raw ?? "").trim();
  if (!text) return Array.isArray(fallback) ? [...fallback] : [];
  return text
    .split(",")
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function parseEntityPath(raw) {
  const text = String(raw || "").trim();
  const match = text.match(/^\/?entity\/([^/]+)\/([^/?#]+)/i);
  if (!match) {
    return {
      endpointName: "",
      endpointVersion: ""
    };
  }
  return {
    endpointName: String(match[1] || "").trim(),
    endpointVersion: String(match[2] || "").trim()
  };
}

const opportunityAttributes = parseOpportunityAttributes(env.ACU_OPP_ATTRIBUTES_JSON);
const parsedAcumaticaEntityPath = parseEntityPath(env.ACUMATICA_ENTITY_PATH);

export const config = {
  port: Number(env.PORT || 8080),
  masterSheetId: env.MASTER_SHEET_ID || "1Gc0Hy7I2wt0BcrjU2iYU6R4dNaxYJj2nUVnBFcL7cSM",
  openaiApiKey: env.OPENAI_API_KEY || "",
  openaiModel: env.OPENAI_MODEL || "gpt-4o-mini",
  acumatica: {
    baseUrl: env.ACU_BASE_URL || env.ACUMATICA_BASE_URL || "https://meadowbrook.acumatica.com",
    endpointName: env.ACU_ENDPOINT_NAME || parsedAcumaticaEntityPath.endpointName || "lightspeed",
    endpointVersion: env.ACU_ENDPOINT_VERSION || parsedAcumaticaEntityPath.endpointVersion || "24.200.001",
    company: env.ACU_COMPANY || env.ACUMATICA_COMPANY || "MeadowBrook Live",
    quoteScreenId: env.ACU_QUOTE_SCREEN_ID || "PM304500",
    username: env.ACU_USERNAME || env.ACUMATICA_SERVICE_USERNAME || env.ACUMATICA_USERNAME || "",
    password: env.ACU_PASSWORD || env.ACUMATICA_SERVICE_PASSWORD || env.ACUMATICA_PASSWORD || "",
    quoteEntity: env.ACU_QUOTE_ENTITY || "ProjectQuotes",
    quoteKeyField: env.ACU_QUOTE_KEY_FIELD || "QuoteNbr",
    taskDetailName: env.ACU_TASK_DETAIL_NAME || "",
    lineDetailName: env.ACU_LINE_DETAIL_NAME || "",
    defaultInventoryId: env.ACU_DEFAULT_INVENTORY_ID || "",
    allowedUoms: parseCsvList(env.ACU_ALLOWED_UOMS, [
      "BOTTLE",
      "CAN",
      "EA",
      "EACH",
      "HOUR",
      "ITEM",
      "KG",
      "KM",
      "LB",
      "LITER",
      "METER",
      "MINUTE",
      "PACK",
      "PALLET",
      "PIECE"
    ]),
    requestTimeoutMs: parseInteger(env.ACU_REQUEST_TIMEOUT_MS, 45000),
    opportunity: {
      entity: env.ACU_OPP_ENTITY || env.ACUMATICA_OPPORTUNITY_ENTITY || "Opportunity",
      classId: env.ACU_OPP_CLASS_ID || env.ACUMATICA_OPPORTUNITY_CLASS_DEFAULT || "",
      serviceClassId: env.ACU_OPP_CLASS_ID_SERVICE || env.ACUMATICA_OPPORTUNITY_CLASS_SERVICE || "SERVICE",
      glendaleClassId: env.ACU_OPP_CLASS_ID_GLENDALE || env.ACUMATICA_OPPORTUNITY_CLASS_GLENDALE || "GLENDALE",
      stage: env.ACU_OPP_STAGE || env.ACUMATICA_OPPORTUNITY_STAGE_DEFAULT || "",
      owner: env.ACU_OPP_OWNER || env.ACUMATICA_OPPORTUNITY_OWNER_DEFAULT || "",
      location: env.ACU_OPP_LOCATION || env.ACUMATICA_OPPORTUNITY_LOCATION_DEFAULT || "",
      attributes: opportunityAttributes,
      requiredAttributeIds: {
        winJob:
          env.ACU_OPP_ATTR_WIN_JOB_ID ||
          env.ACUMATICA_OPPORTUNITY_ATTR_WIN_JOB_ID ||
          "Do you think we are going to win this job?",
        linkToDrive: env.ACU_OPP_ATTR_LINK_TO_DRIVE_ID || env.ACUMATICA_OPPORTUNITY_ATTR_LINK_TO_DRIVE_ID || "Link to Drive",
        projectType: env.ACU_OPP_ATTR_PROJECT_TYPE_ID || env.ACUMATICA_OPPORTUNITY_ATTR_PROJECT_TYPE_ID || "Project Type"
      },
      pendingDriveValue: env.ACU_OPP_ATTR_LINK_TO_DRIVE_PENDING || "Pending - generated by quoting app",
      projectTypeByDivision: {
        construction: env.ACU_OPP_PROJECT_TYPE_CONSTRUCTION || "Construct",
        electrical: env.ACU_OPP_PROJECT_TYPE_ELECTRICAL || "Electrical",
        plumbing: env.ACU_OPP_PROJECT_TYPE_PLUMBING || "Plumbing",
        hvac: env.ACU_OPP_PROJECT_TYPE_HVAC || "HVAC",
        glendale: env.ACU_OPP_PROJECT_TYPE_GLENDALE || "M-Trade"
      },
      projectTypeByMode: {
        production: env.ACU_OPP_PROJECT_TYPE_PRODUCTION || "M-Trade",
        service: env.ACU_OPP_PROJECT_TYPE_SERVICE || "M-Trade",
        glendale: env.ACU_OPP_PROJECT_TYPE_MODE_GLENDALE || "M-Trade"
      },
      multiTradeProjectType: env.ACU_OPP_PROJECT_TYPE_MULTI || "M-Trade",
      estimationOffsetDays: parseInteger(
        env.ACU_OPP_ESTIMATION_OFFSET_DAYS || env.ACUMATICA_OPPORTUNITY_ESTIMATION_OFFSET_DAYS,
        0
      )
    },
    pricingBook: {
      autoCreate: parseBoolean(env.ACU_AUTO_CREATE_PRICING_BOOK, true),
      required: parseBoolean(env.ACU_PRICING_BOOK_REQUIRED, true),
      actionName: env.ACU_PRICING_BOOK_ACTION || "CreatePricingBook"
    }
  },
  quotePdf: {
    templatePath: env.QUOTE_PDF_TEMPLATE_PATH || "assets/abb-quote-template.pdf",
    taxRate: Number(env.QUOTE_PDF_TAX_RATE || 0.13),
    attachOnCreate: parseBoolean(env.QUOTE_ATTACH_ON_CREATE, true),
    attachRequired: parseBoolean(env.QUOTE_ATTACH_REQUIRED, false),
    templateDocId: env.QUOTE_DOC_TEMPLATE_ID || "",
    templateDocUrl:
      env.QUOTE_DOC_TEMPLATE_URL ||
      "https://docs.google.com/document/d/17Z3JGGLyyd4gbz9yFLku3R7BeLGBzS8RpOQS6r0NGG0/edit",
    outputFolderId: env.QUOTE_DOC_OUTPUT_FOLDER_ID || "",
    driveRequired: parseBoolean(env.QUOTE_DOC_DRIVE_REQUIRED, true),
    keepGeneratedDoc: parseBoolean(env.QUOTE_DOC_KEEP_GENERATED, false),
    storePdfInDrive: parseBoolean(env.QUOTE_DOC_STORE_PDF_IN_DRIVE, true)
  },
  pricingBookService: {
    enabled: parseBoolean(env.PRICING_BOOK_SEED_ENABLED, true),
    baseUrl:
      env.PRICING_BOOK_SERVICE_URL ||
      "https://pricing-book-service-720902901526.us-central1.run.app",
    token:
      env.PRICING_BOOK_SERVICE_TOKEN ||
      env.PRICING_BOOK_TOKEN ||
      env.ACU_PRICING_BOOK_TOKEN ||
      "mbq-da9413f6d4274a3f",
    seedPath: env.PRICING_BOOK_SEED_PATH || "/pricing-books/seed",
    seedMaxAttempts: parseInteger(env.PRICING_BOOK_SEED_MAX_ATTEMPTS, 12),
    seedRetryBaseMs: parseInteger(env.PRICING_BOOK_SEED_RETRY_BASE_MS, 750)
  },
  estimateLibrary: {
    driveFolderId:
      env.ESTIMATE_LIBRARY_DRIVE_FOLDER_ID ||
      env.ESTIMATE_LIBRARY_FOLDER_ID ||
      "0AE7uQ5JCesZCUk9PVA",
    firestoreProjectId:
      env.ESTIMATE_LIBRARY_FIRESTORE_PROJECT_ID ||
      env.GOOGLE_FIRESTORE_PROJECT_ID ||
      "",
    embeddingModel: env.ESTIMATE_LIBRARY_EMBEDDING_MODEL || "text-embedding-3-small",
    syncMaxFilesPerRun: parseInteger(env.ESTIMATE_LIBRARY_SYNC_MAX_FILES, 25),
    presetTradeLimit: parseInteger(env.ESTIMATE_LIBRARY_PRESET_TRADE_LIMIT, 500),
    suggestMatchLimit: parseInteger(env.ESTIMATE_LIBRARY_SUGGEST_MATCH_LIMIT, 3),
    autoSyncEnabled: parseBoolean(env.ESTIMATE_LIBRARY_AUTO_SYNC_ENABLED, true),
    autoSyncStartupDelayMs: parseInteger(env.ESTIMATE_LIBRARY_AUTO_SYNC_STARTUP_DELAY_MS, 15000),
    autoSyncIntervalMs: parseInteger(env.ESTIMATE_LIBRARY_AUTO_SYNC_INTERVAL_MS, 1000 * 60 * 60),
    autoSyncResumeDelayMs: parseInteger(env.ESTIMATE_LIBRARY_AUTO_SYNC_RESUME_DELAY_MS, 15000),
    autoSyncQuotaBackoffMs: parseInteger(env.ESTIMATE_LIBRARY_AUTO_SYNC_QUOTA_BACKOFF_MS, 70000),
    autoSyncErrorBackoffMs: parseInteger(env.ESTIMATE_LIBRARY_AUTO_SYNC_ERROR_BACKOFF_MS, 1000 * 60 * 5),
    autoSyncMaxFilesPerRun: parseInteger(env.ESTIMATE_LIBRARY_AUTO_SYNC_MAX_FILES, 1000)
  },
  mail: {
    proxySharedSecret: env.MAIL_PROXY_SHARED_SECRET || "",
    encryptionSecret:
      env.MAIL_ENCRYPTION_SECRET ||
      env.MAIL_PROXY_SHARED_SECRET ||
      env.AUTH_TOKEN_SECRET ||
      "mail-local-secret",
    oauthClientId: env.GOOGLE_OAUTH_CLIENT_ID || "",
    oauthClientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET || "",
    oauthRedirectUrl: env.MBQ_GOOGLE_OAUTH_REDIRECT_URL || env.GOOGLE_OAUTH_REDIRECT_URL || "",
    allowedDomain: env.GOOGLE_OAUTH_ALLOWED_DOMAIN || "meadowb.com",
    firestoreProjectId: env.GOOGLE_FIRESTORE_PROJECT_ID || "",
    pubsubTopic: env.GMAIL_PUBSUB_TOPIC || "",
    watchLabelIds: String(env.GMAIL_WATCH_LABEL_IDS || "INBOX,SENT,DRAFT")
      .split(",")
      .map((value) => cleanString(value))
      .filter(Boolean),
    watchRenewalMinutes: parseInteger(env.GMAIL_WATCH_RENEWAL_MINUTES, 60 * 24 * 5),
    reconcileIntervalMinutes: parseInteger(env.MAIL_SYNC_RECONCILE_INTERVAL_MINUTES, 10),
    internalDomain: env.MAIL_INTERNAL_DOMAIN || "meadowb.com",
    activityEntity: env.ACU_ACTIVITY_ENTITY || "CRActivity",
    activityClassId: env.ACU_ACTIVITY_EMAIL_CLASS_ID || "Email",
    activityType: env.ACU_ACTIVITY_EMAIL_TYPE || "Email",
    activityIncomingFlagField: env.ACU_ACTIVITY_INCOMING_FIELD || "Incoming",
    activityOutgoingFlagField: env.ACU_ACTIVITY_OUTGOING_FIELD || "Outgoing"
  }
};
