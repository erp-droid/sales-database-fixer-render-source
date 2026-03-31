import test from "node:test";
import assert from "node:assert/strict";

import { resolveGoogleAuthOptions } from "../src/googleServiceAuth.js";

const ORIGINAL_ENV = {
  GOOGLE_SERVICE_ACCOUNT_JSON: process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
  GCP_SERVICE_ACCOUNT_JSON: process.env.GCP_SERVICE_ACCOUNT_JSON,
  GOOGLE_SERVICE_ACCOUNT_KEY_FILE: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE,
  GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  QUOTE_DOC_GOOGLE_SERVICE_ACCOUNT_JSON: process.env.QUOTE_DOC_GOOGLE_SERVICE_ACCOUNT_JSON,
  QUOTE_DOC_GOOGLE_SERVICE_ACCOUNT_KEY_FILE: process.env.QUOTE_DOC_GOOGLE_SERVICE_ACCOUNT_KEY_FILE
};

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

test.afterEach(() => {
  restoreEnv();
});

test("resolveGoogleAuthOptions prefers service-account JSON and normalizes the private key", () => {
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({
    client_email: "quotes@example.com",
    private_key: "-----BEGIN PRIVATE KEY-----\\nabc\\ndef\\n-----END PRIVATE KEY-----\\n"
  });

  const options = resolveGoogleAuthOptions({
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"]
  });

  assert.deepEqual(options, {
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    credentials: {
      client_email: "quotes@example.com",
      private_key: "-----BEGIN PRIVATE KEY-----\nabc\ndef\n-----END PRIVATE KEY-----"
    }
  });
});

test("resolveGoogleAuthOptions falls back to a configured key file", () => {
  process.env.GOOGLE_APPLICATION_CREDENTIALS = "/tmp/service-account.json";

  const options = resolveGoogleAuthOptions({
    scopes: ["scope-a"],
    jsonEnvNames: ["QUOTE_DOC_GOOGLE_SERVICE_ACCOUNT_JSON"],
    keyFileEnvNames: ["QUOTE_DOC_GOOGLE_SERVICE_ACCOUNT_KEY_FILE"]
  });

  assert.deepEqual(options, {
    scopes: ["scope-a"],
    keyFile: "/tmp/service-account.json"
  });
});

test("resolveGoogleAuthOptions throws a clear error for invalid JSON credentials", () => {
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = "{invalid";

  assert.throws(
    () =>
      resolveGoogleAuthOptions({
        scopes: ["scope-a"]
      }),
    /GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON/
  );
});
