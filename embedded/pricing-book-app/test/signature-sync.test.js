import assert from "node:assert/strict";
import test from "node:test";

import { shouldRefreshMailboxSignature } from "../src/mail/signature-sync.js";

const NOW = Date.parse("2026-07-17T12:00:00.000Z");
const ONE_HOUR = 60 * 60 * 1000;

test("refreshes a mailbox signature that has never been synced", () => {
  assert.equal(shouldRefreshMailboxSignature({}, { now: NOW }), true);
});

test("keeps a recently synced mailbox signature", () => {
  assert.equal(
    shouldRefreshMailboxSignature(
      { signatureSyncedAt: new Date(NOW - ONE_HOUR + 1).toISOString() },
      { now: NOW, refreshIntervalMs: ONE_HOUR }
    ),
    false
  );
});

test("refreshes a stale mailbox signature even when its stored value is empty", () => {
  assert.equal(
    shouldRefreshMailboxSignature(
      {
        senderSignatureHtml: null,
        signatureSyncedAt: new Date(NOW - ONE_HOUR).toISOString()
      },
      { now: NOW, refreshIntervalMs: ONE_HOUR }
    ),
    true
  );
});

test("force refresh bypasses a recent signature sync", () => {
  assert.equal(
    shouldRefreshMailboxSignature(
      { signatureSyncedAt: new Date(NOW).toISOString() },
      { force: true, now: NOW }
    ),
    true
  );
});
