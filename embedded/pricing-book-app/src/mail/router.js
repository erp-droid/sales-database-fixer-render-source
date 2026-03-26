import crypto from "node:crypto";
import express from "express";

import {
  MailAuthError,
  buildOauthState,
  parseMailAssertionToken,
  parseOauthState,
  requireMailAssertion
} from "./auth.js";
import {
  getMailActivityAcumaticaClient,
  linkThreadToContact,
  syncPendingMailboxActivities,
  syncThreadActivities
} from "./acumatica-activity.js";
import {
  buildGoogleOauthUrl,
  ensureMailboxWatch,
  exchangeGoogleCode,
  hasOauthConfig,
  saveDraft,
  sendDraft,
  sendMessage,
  syncMailboxHistory,
  syncMailboxSnapshot
} from "./gmail.js";
import {
  deleteMailConnection,
  getMailConnection,
  getMailConnectionBySenderEmail,
  listMailboxMessages,
  getMailThread,
  listMailConnections,
  listMailMessages,
  listMailThreads,
  upsertMailConnection,
  upsertMailMessage,
  upsertMailThread
} from "./store.js";
import { cleanString, nowIso } from "./utils.js";

const router = express.Router();

function normalizeEmail(value) {
  return cleanString(value).toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanString(value));
}

function readInternalMailDomain() {
  return cleanString(process.env.MAIL_INTERNAL_DOMAIN || "meadowb.com").toLowerCase();
}

function isAllowedInternalRecipientEmail(value) {
  const email = normalizeEmail(value);
  const domain = readInternalMailDomain();
  return Boolean(email && domain && email.endsWith(`@${domain}`));
}

function toInteger(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : null;
}

function normalizeRecipient(raw) {
  const email = normalizeEmail(raw?.email);
  if (!email || !isValidEmail(email)) {
    throw new MailAuthError("Each recipient must include a valid email address.", 422);
  }

  const contactId = toInteger(raw?.contactId);
  return {
    email,
    name: cleanString(raw?.name) || null,
    contactId: contactId && contactId > 0 ? contactId : null,
    businessAccountRecordId: cleanString(raw?.businessAccountRecordId) || null,
    businessAccountId: cleanString(raw?.businessAccountId) || null
  };
}

function normalizeLinkedContact(raw) {
  const contactId = toInteger(raw?.contactId);
  return {
    contactId: contactId && contactId > 0 ? contactId : null,
    businessAccountRecordId: cleanString(raw?.businessAccountRecordId) || null,
    businessAccountId: cleanString(raw?.businessAccountId) || null,
    contactName: cleanString(raw?.contactName) || null,
    companyName: cleanString(raw?.companyName) || null
  };
}

function normalizeMatchedContact(raw) {
  const normalized = normalizeLinkedContact(raw);
  if (!normalized.contactId) {
    return null;
  }

  return {
    ...normalized,
    email: normalizeEmail(raw?.email) || null
  };
}

function normalizeLastEmailedAccounts(raw) {
  const accounts = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  return accounts
    .map((item) => ({
      businessAccountRecordId: cleanString(item?.businessAccountRecordId) || null,
      businessAccountId: cleanString(item?.businessAccountId) || null
    }))
    .filter((item) => item.businessAccountRecordId || item.businessAccountId)
    .filter((item) => {
      const key = `${item.businessAccountRecordId || ""}::${item.businessAccountId || ""}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function resolveComparableTimestamp(raw) {
  const value = cleanString(raw);
  if (!value) {
    return "";
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function normalizeAttachments(rawAttachments) {
  return (Array.isArray(rawAttachments) ? rawAttachments : []).map((attachment) => {
    const fileName = cleanString(attachment?.fileName);
    const mimeType = cleanString(attachment?.mimeType) || "application/octet-stream";
    const sizeBytes = toInteger(attachment?.sizeBytes);
    const base64Data = cleanString(attachment?.base64Data);
    if (!fileName || !sizeBytes || sizeBytes <= 0 || !base64Data) {
      throw new MailAuthError("Each attachment must include a file name, size, and data.", 422);
    }

    return {
      fileName,
      mimeType,
      sizeBytes,
      base64Data
    };
  });
}

function normalizeComposePayload(raw, options = {}) {
  const to = (Array.isArray(raw?.to) ? raw.to : []).map((recipient) =>
    normalizeRecipient(recipient)
  );
  const cc = (Array.isArray(raw?.cc) ? raw.cc : []).map((recipient) =>
    normalizeRecipient(recipient)
  );
  const bcc = (Array.isArray(raw?.bcc) ? raw.bcc : []).map((recipient) =>
    normalizeRecipient(recipient)
  );
  if (to.length + cc.length + bcc.length === 0) {
    throw new MailAuthError("At least one recipient is required.", 422);
  }

  return {
    threadId: cleanString(options.threadId ?? raw?.threadId) || null,
    draftId: cleanString(options.draftId ?? raw?.draftId) || null,
    subject: cleanString(raw?.subject),
    htmlBody: typeof raw?.htmlBody === "string" ? raw.htmlBody : "",
    textBody: typeof raw?.textBody === "string" ? raw.textBody : "",
    to,
    cc,
    bcc,
    linkedContact: normalizeLinkedContact(raw?.linkedContact),
    matchedContacts: (Array.isArray(raw?.matchedContacts) ? raw.matchedContacts : [])
      .map((contact) => normalizeMatchedContact(contact))
      .filter(Boolean),
    attachments: normalizeAttachments(raw?.attachments),
    sourceSurface: cleanString(raw?.sourceSurface) === "accounts" ? "accounts" : "mail"
  };
}

function buildResolvedRecipientEmailSet(payload) {
  const resolvedEmails = new Set(
    (Array.isArray(payload?.matchedContacts) ? payload.matchedContacts : [])
      .map((contact) => normalizeEmail(contact?.email))
      .filter(Boolean)
  );

  [...(payload?.to || []), ...(payload?.cc || []), ...(payload?.bcc || [])].forEach((recipient) => {
    if (toInteger(recipient?.contactId) && toInteger(recipient?.contactId) > 0) {
      const email = normalizeEmail(recipient?.email);
      if (email) {
        resolvedEmails.add(email);
      }
    }
  });

  return resolvedEmails;
}

function collectUnresolvedRecipients(payload) {
  const resolvedEmails = buildResolvedRecipientEmailSet(payload);
  const unresolved = new Set();

  [...(payload?.to || []), ...(payload?.cc || []), ...(payload?.bcc || [])].forEach((recipient) => {
    const email = normalizeEmail(recipient?.email);
    if (!email) {
      return;
    }

    if (resolvedEmails.has(email)) {
      return;
    }

    if (isAllowedInternalRecipientEmail(email)) {
      return;
    }

    unresolved.add(email);
  });

  return [...unresolved];
}

function assertResolvedRecipients(payload) {
  const unresolved = collectUnresolvedRecipients(payload);
  if (unresolved.length === 0) {
    return;
  }

  throw new MailAuthError(
    unresolved.length === 1
      ? `Recipient ${unresolved[0]} is not an Acumatica contact.`
      : `These recipients are not Acumatica contacts: ${unresolved.join(", ")}.`,
    422
  );
}

function prepareSendPayload(payload) {
  return {
    ...payload,
    linkedContact: resolveLinkedContactForStoredMessage(payload)
  };
}

function resolveLinkedContactForStoredMessage(payload) {
  if (payload?.linkedContact?.contactId) {
    return payload.linkedContact;
  }

  const firstMatchedContact = Array.isArray(payload?.matchedContacts)
    ? payload.matchedContacts.find((contact) => contact?.contactId)
    : null;
  if (firstMatchedContact?.contactId) {
    return normalizeLinkedContact(firstMatchedContact);
  }

  const firstRecipient = [...(payload?.to || []), ...(payload?.cc || []), ...(payload?.bcc || [])].find(
    (recipient) => recipient?.contactId
  );
  if (!firstRecipient) {
    return normalizeLinkedContact(null);
  }

  return normalizeLinkedContact({
    contactId: firstRecipient.contactId,
    businessAccountRecordId: firstRecipient.businessAccountRecordId,
    businessAccountId: firstRecipient.businessAccountId,
    contactName: firstRecipient.name
  });
}

async function resolveStoredMessagePayload(raw, client = getMailActivityAcumaticaClient()) {
  const fallbackRecipientEmail = normalizeEmail(raw?.contactEmail);
  const hasExplicitRecipients =
    (Array.isArray(raw?.to) && raw.to.length > 0) ||
    (Array.isArray(raw?.cc) && raw.cc.length > 0) ||
    (Array.isArray(raw?.bcc) && raw.bcc.length > 0);
  const payload = normalizeComposePayload(
    !hasExplicitRecipients && fallbackRecipientEmail
      ? {
          ...raw,
          to: [
            {
              email: fallbackRecipientEmail,
              name: cleanString(raw?.contactName) || null,
              businessAccountRecordId:
                cleanString(raw?.businessAccountRecordId) ||
                cleanString(raw?.businessAccountId) ||
                null,
              businessAccountId: cleanString(raw?.businessAccountId) || null
            }
          ]
        }
      : raw,
    {
      threadId: null,
      draftId: null
    }
  );
  if (payload.linkedContact?.contactId || !cleanString(raw?.businessAccountId)) {
    return payload;
  }

  const businessAccountId = cleanString(raw?.businessAccountId);
  const businessAccountRecordId = cleanString(raw?.businessAccountRecordId) || businessAccountId;
  const contactName = cleanString(raw?.contactName);
  const contactEmail = normalizeEmail(raw?.contactEmail);
  if (!contactName && !contactEmail) {
    return payload;
  }

  const businessAccount = await client.resolveBusinessAccount({ businessAccountId });
  const contacts = await client.listBusinessAccountContacts(
    businessAccount.id || businessAccount.code,
    { maxRecords: 500 }
  );
  const contact =
    contacts.find((item) => normalizeEmail(item.email) === contactEmail) ||
    contacts.find((item) => normalizeEmail(item.displayName) === normalizeEmail(contactName)) ||
    null;

  if (!contact?.id) {
    throw new MailAuthError(
      `No contact matched '${contactEmail || contactName}' for business account ${businessAccountId}.`,
      422
    );
  }

  const linkedContact = {
    contactId: Number(contact.id),
    businessAccountRecordId,
    businessAccountId: businessAccount.id || businessAccount.code || businessAccountId,
    contactName: contact.displayName || contactName || null,
    companyName: businessAccount.name || null
  };
  const recipientEmail = normalizeEmail(contact.email) || contactEmail;
  if (!recipientEmail && payload.to.length === 0) {
    throw new MailAuthError("The resolved contact does not have an email address.", 422);
  }

  return {
    ...payload,
    to:
      payload.to.length > 0
        ? payload.to
        : [
            {
              email: recipientEmail,
              name: contact.displayName || contactName || null,
              contactId: Number(contact.id),
              businessAccountRecordId,
              businessAccountId: businessAccount.id || businessAccount.code || businessAccountId
            }
          ],
    linkedContact
  };
}

function buildSessionResponse(auth, connection, options = {}) {
  const senderEmail = normalizeEmail(auth?.senderEmail);
  const connectedGoogleEmail = normalizeEmail(
    connection?.googleEmail || connection?.connectedGoogleEmail || connection?.senderEmail
  );
  const senderMismatch =
    Boolean(connection) && Boolean(connectedGoogleEmail) && connectedGoogleEmail !== senderEmail;

  return {
    status:
      options.status ||
      (senderMismatch
        ? "needs_setup"
        : connection
          ? "connected"
          : "disconnected"),
    senderEmail: senderEmail || null,
    senderDisplayName: cleanString(auth?.displayName) || auth?.loginName || null,
    expectedGoogleEmail: senderEmail || null,
    connectedGoogleEmail: connectedGoogleEmail || null,
    connectionError:
      cleanString(options.connectionError || connection?.connectionError) ||
      (senderMismatch
        ? `Connected Gmail account '${connectedGoogleEmail}' does not match expected sender '${senderEmail}'.`
        : null),
    folders: ["inbox", "sent", "drafts", "starred"]
  };
}

function renderOauthPopupHtml(payload, status = 200) {
  const json = JSON.stringify({
    type: "mbmail.oauth",
    ...payload
  });
  const safeTitle = payload?.success ? "Gmail connected" : "Mail connection failed";
  const safeMessage = cleanString(payload?.message) || safeTitle;

  return {
    status,
    html: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${safeTitle}</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 24px; color: #1f2937; }
      .card { max-width: 480px; margin: 40px auto; border: 1px solid #d7dde8; border-radius: 16px; padding: 24px; }
      h1 { margin: 0 0 8px; font-size: 24px; }
      p { margin: 0; line-height: 1.5; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${safeTitle}</h1>
      <p>${safeMessage}</p>
    </div>
    <script>
      (function () {
        var payload = ${json};
        try {
          if (window.opener) {
            window.opener.postMessage(payload, "*");
          }
        } catch (_error) {}
        setTimeout(function () {
          try {
            window.close();
          } catch (_error) {}
          if (!window.opener && payload.returnTo) {
            window.location.href = payload.returnTo;
          }
        }, 150);
      })();
    </script>
  </body>
</html>`
  };
}

function sendPopupResponse(res, payload, status = 200) {
  const response = renderOauthPopupHtml(payload, status);
  res.status(response.status).type("html").send(response.html);
}

async function ensureConnectedMailbox(auth) {
  const connection = await getMailConnection(auth.loginName);
  if (!connection) {
    throw new MailAuthError("Gmail is not connected for this mailbox.", 409);
  }
  return connection;
}

const mailboxRefreshJobs = new Map();

async function refreshMailbox(connection, options = {}) {
  const now = Date.now();
  let nextConnection = connection;
  const watchExpiresAt = Number(connection?.watchExpiration || 0);
  if (
    cleanString(connection?.refreshToken) &&
    (!watchExpiresAt ||
      watchExpiresAt - now <= Math.max(15, Number(options.renewWithinMinutes || 30)) * 60 * 1000)
  ) {
    nextConnection = await ensureMailboxWatch(connection);
  }

  if (options.sync !== false) {
    if (cleanString(nextConnection?.historyId)) {
      await syncMailboxHistory(nextConnection);
    } else {
      await syncMailboxSnapshot(nextConnection, {
        maxThreads: Math.max(1, Math.min(40, Number(options.maxThreads || 40) || 40))
      });
    }
  }

  if (options.syncActivities === true) {
    await syncPendingMailboxActivities(nextConnection.loginName);
  }

  if (cleanString(nextConnection?.connectionError)) {
    nextConnection = await upsertMailConnection({
      ...nextConnection,
      connectionError: null
    });
  }

  return nextConnection;
}

function scheduleMailboxRefresh(connection, options = {}, context = "background") {
  const loginName = cleanString(connection?.loginName);
  if (!loginName) {
    return null;
  }

  if (mailboxRefreshJobs.has(loginName)) {
    return mailboxRefreshJobs.get(loginName);
  }

  const job = (async () => {
    const latestConnection = (await getMailConnection(loginName)) || connection;
    return refreshMailbox(latestConnection, options);
  })()
    .catch(async (error) => {
      const message = error instanceof Error ? error.message : String(error || "Mailbox refresh failed.");
      console.error(`[mail.refresh] ${context} failed for ${loginName}: ${message}`);

      const latestConnection = await getMailConnection(loginName);
      if (latestConnection) {
        await upsertMailConnection({
          ...latestConnection,
          connectionError: message
        });
      }

      return null;
    })
    .finally(() => {
      mailboxRefreshJobs.delete(loginName);
    });

  mailboxRefreshJobs.set(loginName, job);
  return job;
}

function normalizeThreadResponse(thread, messages) {
  return {
    thread,
    messages: messages.map((message) => ({
      messageId: cleanString(message.messageId),
      threadId: cleanString(message.threadId),
      draftId: cleanString(message.draftId) || null,
      direction: cleanString(message.direction) === "incoming" ? "incoming" : "outgoing",
      subject: cleanString(message.subject),
      htmlBody: message.htmlBody || "",
      textBody: message.textBody || "",
      from: message.from || null,
      to: Array.isArray(message.to) ? message.to : [],
      cc: Array.isArray(message.cc) ? message.cc : [],
      bcc: Array.isArray(message.bcc) ? message.bcc : [],
      sentAt: cleanString(message.sentAt) || null,
      receivedAt: cleanString(message.receivedAt) || null,
      unread: Boolean(message.unread),
      hasAttachments: Boolean(message.hasAttachments),
      activitySyncStatus: cleanString(message.activitySyncStatus) || "not_linked"
    }))
  };
}

function attachFinalActivitySyncStatus(sendResponse, syncedThreadResult) {
  if (!sendResponse?.sent || !syncedThreadResult?.messages) {
    return sendResponse;
  }

  const matchingMessage =
    syncedThreadResult.messages.find(
      (message) => cleanString(message.messageId) === cleanString(sendResponse.messageId)
    ) ||
    [...syncedThreadResult.messages]
      .reverse()
      .find((message) => cleanString(message.direction) === "outgoing") ||
    null;

  if (!matchingMessage) {
    return sendResponse;
  }

  return {
    ...sendResponse,
    activitySyncStatus: cleanString(matchingMessage.activitySyncStatus) || sendResponse.activitySyncStatus,
    activityId: cleanString(matchingMessage.activityId) || null,
    activityIds: Array.isArray(matchingMessage.activityIds)
      ? matchingMessage.activityIds.map((value) => cleanString(value)).filter(Boolean)
      : cleanString(matchingMessage.activityId)
        ? [cleanString(matchingMessage.activityId)]
        : [],
    activityError: cleanString(matchingMessage.activityError) || null
  };
}

router.get("/oauth/start", async (req, res, next) => {
  try {
    const token = cleanString(req.query.token);
    if (!token) {
      throw new MailAuthError("Mail authentication token is required.", 401);
    }

    const auth = parseMailAssertionToken(token);
    const returnTo = cleanString(req.query.returnTo);
    const state = buildOauthState({
      loginName: auth.loginName,
      senderEmail: auth.senderEmail,
      displayName: auth.displayName,
      returnTo
    });

    if (!hasOauthConfig()) {
      sendPopupResponse(
        res,
        {
          success: false,
          returnTo,
          message:
            "MeadowBrook Gmail OAuth is not configured. Add a MeadowBrook-owned Google OAuth client before connecting Gmail."
        },
        503
      );
      return;
    }

    res.redirect(buildGoogleOauthUrl(state));
  } catch (error) {
    next(error);
  }
});

router.get("/oauth/callback", async (req, res) => {
  const returnToFallback = cleanString(req.query.returnTo);

  try {
    const code = cleanString(req.query.code);
    const state = cleanString(req.query.state);
    if (!code || !state) {
      throw new MailAuthError("Google OAuth callback is missing required parameters.", 400);
    }

    const oauthState = parseOauthState(state);
    const loginName = cleanString(oauthState.loginName);
    const senderEmail = normalizeEmail(oauthState.senderEmail);
    const displayName = cleanString(oauthState.displayName) || loginName;
    const returnTo = cleanString(oauthState.returnTo) || returnToFallback || "";
    const exchange = await exchangeGoogleCode(code);

    if (normalizeEmail(exchange.googleEmail) !== senderEmail) {
      sendPopupResponse(
        res,
        {
          success: false,
          returnTo,
          message: `Connected Google account '${exchange.googleEmail}' does not match expected sender '${senderEmail}'.`,
          expectedGoogleEmail: senderEmail,
          connectedGoogleEmail: exchange.googleEmail
        },
        422
      );
      return;
    }

    const existing = await getMailConnection(loginName);
    let connection = await upsertMailConnection({
      loginName,
      senderEmail,
      displayName,
      googleEmail: exchange.googleEmail,
      connectedGoogleEmail: exchange.googleEmail,
      googleDisplayName: exchange.googleDisplayName || displayName,
      refreshToken: cleanString(exchange.tokens?.refresh_token) || cleanString(existing?.refreshToken),
      accessToken: cleanString(exchange.tokens?.access_token),
      expiryDate: Number(exchange.tokens?.expiry_date || 0) || null,
      connectedAt: cleanString(existing?.connectedAt) || nowIso(),
      connectionError: null
    });

    scheduleMailboxRefresh(
      connection,
      {
        sync: true,
        syncActivities: false,
        maxThreads: 12
      },
      "oauth_callback"
    );

    sendPopupResponse(res, {
      success: true,
      returnTo,
      message: `Connected Gmail for ${senderEmail}.`,
      expectedGoogleEmail: senderEmail,
      connectedGoogleEmail: exchange.googleEmail
    });
  } catch (error) {
    sendPopupResponse(
      res,
      {
        success: false,
        returnTo: returnToFallback || "",
        message: error instanceof Error ? error.message : "Unable to connect Gmail."
      },
      error instanceof MailAuthError ? error.status : 500
    );
  }
});

router.post("/oauth/disconnect", async (req, res, next) => {
  try {
    const auth = requireMailAssertion(req);
    await deleteMailConnection(auth.loginName);
    res.json({
      disconnected: true
    });
  } catch (error) {
    next(error);
  }
});

router.get("/session", async (req, res, next) => {
  try {
    const auth = requireMailAssertion(req);
    const forceRefresh = cleanString(req.query.refresh) === "1";
    if (!hasOauthConfig()) {
      res.json(
        buildSessionResponse(auth, null, {
          status: "needs_setup",
          connectionError:
            "MeadowBrook Gmail OAuth is not configured. Add a MeadowBrook-owned Google OAuth client before connecting Gmail."
        })
      );
      return;
    }

    const connection = await getMailConnection(auth.loginName);
    if (!connection) {
      res.json(buildSessionResponse(auth, null));
      return;
    }

    try {
      if (forceRefresh) {
        const refreshed = await refreshMailbox(connection, {
          sync: true,
          syncActivities: false,
          maxThreads: 12
        });
        res.json(buildSessionResponse(auth, refreshed));
        return;
      }

      scheduleMailboxRefresh(
        connection,
        {
          sync: true,
          syncActivities: false,
          maxThreads: 12
        },
        "session"
      );
      res.json(buildSessionResponse(auth, connection));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Mailbox refresh failed.";
      await upsertMailConnection({
        ...connection,
        connectionError: message
      });
      res.json(buildSessionResponse(auth, connection, { connectionError: message }));
    }
  } catch (error) {
    next(error);
  }
});

router.post("/last-emailed", async (req, res, next) => {
  try {
    const auth = requireMailAssertion(req);
    const accounts = normalizeLastEmailedAccounts(req.body?.accounts);
    if (accounts.length === 0) {
      res.json({ items: [] });
      return;
    }

    const messages = await listMailboxMessages(auth.loginName);
    const latestByRecordId = new Map();
    const latestByBusinessAccountId = new Map();

    messages.forEach((message) => {
      if (cleanString(message?.direction) !== "outgoing") {
        return;
      }
      const timestamp = resolveComparableTimestamp(
        message?.sentAt || message?.receivedAt || message?.activityLoggedAt
      );
      if (!timestamp) {
        return;
      }

      const activityTargets = Array.isArray(message?.activityTargets)
        ? message.activityTargets
        : [];
      const targets =
        activityTargets.length > 0
          ? activityTargets
          : [message?.linkedContact && typeof message.linkedContact === "object" ? message.linkedContact : {}];

      targets.forEach((target) => {
        const hasActivity =
          cleanString(target?.activityId) ||
          (activityTargets.length === 0 && cleanString(message?.activityId));
        if (!hasActivity) {
          return;
        }

        const businessAccountRecordId = cleanString(target?.businessAccountRecordId);
        const businessAccountId = cleanString(target?.businessAccountId);

        if (businessAccountRecordId) {
          const current = latestByRecordId.get(businessAccountRecordId);
          if (!current || timestamp > current) {
            latestByRecordId.set(businessAccountRecordId, timestamp);
          }
        }

        if (businessAccountId) {
          const current = latestByBusinessAccountId.get(businessAccountId);
          if (!current || timestamp > current) {
            latestByBusinessAccountId.set(businessAccountId, timestamp);
          }
        }
      });
    });

    res.json({
      items: accounts.map((account) => ({
        businessAccountRecordId: account.businessAccountRecordId,
        businessAccountId: account.businessAccountId,
        lastEmailedAt:
          (account.businessAccountRecordId
            ? latestByRecordId.get(account.businessAccountRecordId)
            : null) ||
          (account.businessAccountId
            ? latestByBusinessAccountId.get(account.businessAccountId)
            : null) ||
          null
      }))
    });
  } catch (error) {
    next(error);
  }
});

router.post("/activities/log", async (req, res, next) => {
  try {
    const auth = requireMailAssertion(req);
    const acumaticaCookieHeader = cleanString(req.get("x-mb-acumatica-cookie"));
    const activityClient = getMailActivityAcumaticaClient({
      cookieHeader: acumaticaCookieHeader
    });
    const payload = await resolveStoredMessagePayload(req.body, activityClient);
    const timestamp = nowIso();
    const threadId = `activity-log-${crypto.randomUUID()}`;
    const messageId = `activity-log-${crypto.randomUUID()}`;
    const linkedContact = resolveLinkedContactForStoredMessage(payload);

    await upsertMailThread(auth.loginName, {
      threadId,
      subject: cleanString(payload.subject) || "(no subject)",
      snippet: cleanString(payload.textBody) || cleanString(payload.subject) || "(no body)",
      folder: "sent",
      unread: false,
      starred: false,
      lastMessageAt: timestamp,
      participants: [
        auth.senderEmail,
        ...payload.to.map((recipient) => recipient.email),
        ...payload.cc.map((recipient) => recipient.email),
        ...payload.bcc.map((recipient) => recipient.email)
      ].filter(Boolean),
      linkedContact,
      matchedContacts: payload.matchedContacts,
      activitySyncStatus: linkedContact.contactId ? "pending" : "not_linked"
    });

    await upsertMailMessage(auth.loginName, {
      messageId,
      threadId,
      draftId: null,
      direction: "outgoing",
      subject: cleanString(payload.subject) || "(no subject)",
      htmlBody: payload.htmlBody || "",
      textBody: payload.textBody || "",
      from: {
        email: auth.senderEmail,
        name: auth.displayName || auth.loginName,
        contactId: null,
        businessAccountRecordId: null,
        businessAccountId: null
      },
      to: payload.to,
      cc: payload.cc,
      bcc: payload.bcc,
      sentAt: timestamp,
      receivedAt: timestamp,
      unread: false,
      hasAttachments: payload.attachments.length > 0,
      sortTimestamp: timestamp,
      activitySyncStatus: linkedContact.contactId ? "pending" : "not_linked",
      linkedContact,
      matchedContacts: payload.matchedContacts
    });

    const synced = await syncThreadActivities(auth.loginName, threadId, activityClient);
    const storedMessage =
      synced?.messages?.find((message) => cleanString(message.messageId) === messageId) || null;

    if (!storedMessage) {
      throw new MailAuthError("Acumatica activity logging did not return the stored message.", 500);
    }

    res.json({
      logged: true,
      threadId,
      messageId,
      activityId: cleanString(storedMessage.activityId) || null,
      activityIds: Array.isArray(storedMessage.activityIds)
        ? storedMessage.activityIds.map((value) => cleanString(value)).filter(Boolean)
        : cleanString(storedMessage.activityId)
          ? [cleanString(storedMessage.activityId)]
          : [],
      activityEntityName: cleanString(storedMessage.activityEntityName) || null,
      activitySyncStatus: cleanString(storedMessage.activitySyncStatus) || "not_linked",
      activityError: cleanString(storedMessage.activityError) || null,
      sentAt: timestamp
    });
  } catch (error) {
    next(error);
  }
});

router.get("/threads", async (req, res, next) => {
  try {
    const auth = requireMailAssertion(req);
    const connection = await ensureConnectedMailbox(auth);

    const folder = cleanString(req.query.folder) || "inbox";
    const q = cleanString(req.query.q);
    const limit = Math.max(1, Math.min(100, Number(req.query.limit || 25) || 25));
    let response = await listMailThreads(auth.loginName, {
      folder,
      q,
      limit
    });

    if (response.items.length === 0) {
      await refreshMailbox(connection, {
        sync: true,
        syncActivities: false,
        maxThreads: Math.max(12, Math.min(limit, 18))
      });
      response = await listMailThreads(auth.loginName, {
        folder,
        q,
        limit
      });
    } else {
      scheduleMailboxRefresh(
        connection,
        {
          sync: true,
          syncActivities: false,
          maxThreads: 12
        },
        "threads"
      );
    }

    res.json(response);
  } catch (error) {
    next(error);
  }
});

router.get("/threads/:threadId", async (req, res, next) => {
  try {
    const auth = requireMailAssertion(req);
    const connection = await ensureConnectedMailbox(auth);

    const threadId = cleanString(req.params.threadId);
    let thread = await getMailThread(auth.loginName, threadId);
    if (!thread) {
      await refreshMailbox(connection, {
        sync: true,
        syncActivities: false,
        maxThreads: 12
      });
      thread = await getMailThread(auth.loginName, threadId);
    } else {
      scheduleMailboxRefresh(
        connection,
        {
          sync: true,
          syncActivities: false,
          maxThreads: 12
        },
        "thread_detail"
      );
    }

    if (!thread) {
      throw new MailAuthError("Mail thread was not found.", 404);
    }
    const messages = await listMailMessages(auth.loginName, threadId);
    res.json(normalizeThreadResponse(thread, messages));
  } catch (error) {
    next(error);
  }
});

router.post("/messages/send", async (req, res, next) => {
  try {
    const auth = requireMailAssertion(req);
    const connection = await ensureConnectedMailbox(auth);
    const acumaticaCookieHeader = cleanString(req.get("x-mb-acumatica-cookie"));
    const skipActivitySync = cleanString(req.get("x-mb-skip-activity-sync")) === "1";
    const activityClient = getMailActivityAcumaticaClient({
      cookieHeader: acumaticaCookieHeader
    });
    const payload = prepareSendPayload(normalizeComposePayload(req.body));
    assertResolvedRecipients(payload);
    const response = await sendMessage(connection, payload);
    if (skipActivitySync) {
      res.json({
        ...response,
        activitySyncStatus: "not_linked",
        activityId: null,
        activityIds: [],
        activityError: null
      });
      return;
    }
    const synced = await syncThreadActivities(auth.loginName, response.threadId, activityClient);
    res.json(attachFinalActivitySyncStatus(response, synced));
  } catch (error) {
    next(error);
  }
});

router.post("/threads/:threadId/reply", async (req, res, next) => {
  try {
    const auth = requireMailAssertion(req);
    const connection = await ensureConnectedMailbox(auth);
    const acumaticaCookieHeader = cleanString(req.get("x-mb-acumatica-cookie"));
    const activityClient = getMailActivityAcumaticaClient({
      cookieHeader: acumaticaCookieHeader
    });
    const payload = prepareSendPayload(normalizeComposePayload(req.body, {
      threadId: req.params.threadId
    }));
    assertResolvedRecipients(payload);
    const response = await sendMessage(connection, payload, {
      threadId: req.params.threadId
    });
    const synced = await syncThreadActivities(auth.loginName, response.threadId, activityClient);
    res.json(attachFinalActivitySyncStatus(response, synced));
  } catch (error) {
    next(error);
  }
});

router.post("/threads/:threadId/forward", async (req, res, next) => {
  try {
    const auth = requireMailAssertion(req);
    const connection = await ensureConnectedMailbox(auth);
    const acumaticaCookieHeader = cleanString(req.get("x-mb-acumatica-cookie"));
    const activityClient = getMailActivityAcumaticaClient({
      cookieHeader: acumaticaCookieHeader
    });
    const payload = prepareSendPayload(normalizeComposePayload(req.body, {
      threadId: null,
      draftId: null
    }));
    assertResolvedRecipients(payload);
    const response = await sendMessage(connection, payload);
    const synced = await syncThreadActivities(auth.loginName, response.threadId, activityClient);
    res.json(attachFinalActivitySyncStatus(response, synced));
  } catch (error) {
    next(error);
  }
});

router.post("/drafts", async (req, res, next) => {
  try {
    const auth = requireMailAssertion(req);
    const connection = await ensureConnectedMailbox(auth);
    const payload = normalizeComposePayload(req.body);
    const response = await saveDraft(connection, payload);
    res.json(response);
  } catch (error) {
    next(error);
  }
});

router.patch("/drafts/:draftId", async (req, res, next) => {
  try {
    const auth = requireMailAssertion(req);
    const connection = await ensureConnectedMailbox(auth);
    const payload = normalizeComposePayload(req.body, {
      draftId: req.params.draftId
    });
    const response = await saveDraft(connection, payload);
    res.json(response);
  } catch (error) {
    next(error);
  }
});

router.post("/drafts/:draftId/send", async (req, res, next) => {
  try {
    const auth = requireMailAssertion(req);
    const acumaticaCookieHeader = cleanString(req.get("x-mb-acumatica-cookie"));
    const activityClient = getMailActivityAcumaticaClient({
      cookieHeader: acumaticaCookieHeader
    });
    await ensureConnectedMailbox(auth);
    const response = await sendDraft(await ensureConnectedMailbox(auth), req.params.draftId);
    const synced = await syncThreadActivities(auth.loginName, response.threadId, activityClient);
    res.json(attachFinalActivitySyncStatus(response, synced));
  } catch (error) {
    next(error);
  }
});

router.post("/threads/:threadId/link", async (req, res, next) => {
  try {
    const auth = requireMailAssertion(req);
    const acumaticaCookieHeader = cleanString(req.get("x-mb-acumatica-cookie"));
    const activityClient = getMailActivityAcumaticaClient({
      cookieHeader: acumaticaCookieHeader
    });
    await ensureConnectedMailbox(auth);
    const existingThread = await getMailThread(auth.loginName, req.params.threadId);
    if (!existingThread) {
      throw new MailAuthError("Mail thread was not found.", 404);
    }

    const incomingLink = req.body && typeof req.body === "object" ? req.body : {};
    const linkedContact = normalizeLinkedContact(
      incomingLink?.contactId ? incomingLink : existingThread.linkedContact
    );
    if (!linkedContact.contactId) {
      throw new MailAuthError("A primary linked contact is required.", 422);
    }

    const result = await linkThreadToContact(auth.loginName, req.params.threadId, {
      ...linkedContact,
      contactName:
        cleanString(incomingLink?.contactName) || cleanString(existingThread?.linkedContact?.contactName) || null,
      companyName:
        cleanString(incomingLink?.companyName) || cleanString(existingThread?.linkedContact?.companyName) || null
    }, activityClient);
    if (!result) {
      throw new MailAuthError("Mail thread was not found.", 404);
    }
    res.json(normalizeThreadResponse(result.thread, result.messages));
  } catch (error) {
    next(error);
  }
});

router.post("/sync/pubsub", async (req, res, next) => {
  try {
    const encoded = cleanString(req.body?.message?.data);
    if (!encoded) {
      res.status(204).end();
      return;
    }

    const payload = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    const senderEmail = normalizeEmail(payload?.emailAddress);
    const historyId = cleanString(payload?.historyId);
    if (!senderEmail) {
      res.status(202).json({ processed: false, reason: "missing_email" });
      return;
    }

    const connection = await getMailConnectionBySenderEmail(senderEmail);
    if (!connection) {
      res.status(202).json({ processed: false, reason: "unknown_mailbox" });
      return;
    }

    await syncMailboxHistory(connection, historyId);
    await syncPendingMailboxActivities(connection.loginName);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.post("/sync/reconcile", async (req, res, next) => {
  try {
    let connections = [];
    try {
      const auth = requireMailAssertion(req);
      const connection = await getMailConnection(auth.loginName);
      if (connection) {
        connections = [connection];
      }
    } catch (_error) {
      connections = await listMailConnections();
    }

    const results = [];
    for (const connection of connections) {
      try {
        const refreshed = await refreshMailbox(connection, { sync: true });
        results.push({
          loginName: connection.loginName,
          senderEmail: connection.senderEmail,
          ok: true,
          historyId: cleanString(refreshed?.historyId) || null
        });
      } catch (error) {
        results.push({
          loginName: connection.loginName,
          senderEmail: connection.senderEmail,
          ok: false,
          error: error instanceof Error ? error.message : "Mailbox reconcile failed."
        });
      }
    }

    res.json({
      processed: results.length,
      items: results
    });
  } catch (error) {
    next(error);
  }
});

router.post("/sync/watch/renew", async (req, res, next) => {
  try {
    let connections = [];
    try {
      const auth = requireMailAssertion(req);
      const connection = await getMailConnection(auth.loginName);
      if (connection) {
        connections = [connection];
      }
    } catch (_error) {
      connections = await listMailConnections();
    }

    const results = [];
    for (const connection of connections) {
      try {
        const renewed = await ensureMailboxWatch(connection);
        results.push({
          loginName: renewed.loginName,
          senderEmail: renewed.senderEmail,
          ok: true,
          watchExpiration: renewed.watchExpiration || null
        });
      } catch (error) {
        results.push({
          loginName: connection.loginName,
          senderEmail: connection.senderEmail,
          ok: false,
          error: error instanceof Error ? error.message : "Watch renewal failed."
        });
      }
    }

    res.json({
      processed: results.length,
      items: results
    });
  } catch (error) {
    next(error);
  }
});

router.use((error, _req, res, _next) => {
  const status = error instanceof MailAuthError ? error.status : 500;
  res.status(status).json({
    error: error instanceof Error ? error.message : "Mail request failed."
  });
});

export { router as mailRouter };
