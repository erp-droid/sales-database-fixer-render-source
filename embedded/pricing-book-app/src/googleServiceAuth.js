import { google } from "googleapis";

function cleanString(value) {
  return String(value ?? "").trim();
}

function dedupe(items = []) {
  return [...new Set(items.map((item) => cleanString(item)).filter(Boolean))];
}

function parseServiceAccountCredentials(rawJson, label = "GOOGLE_SERVICE_ACCOUNT_JSON") {
  const raw = cleanString(rawJson);
  if (!raw) return null;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_error) {
    throw new Error(`${label} is not valid JSON.`);
  }

  const clientEmail = cleanString(parsed?.client_email);
  const privateKey = String(parsed?.private_key || "").replace(/\\n/g, "\n").trim();
  if (!clientEmail || !privateKey) {
    throw new Error(`${label} must include client_email and private_key.`);
  }

  return {
    client_email: clientEmail,
    private_key: privateKey
  };
}

export function resolveGoogleAuthOptions({ scopes = [], jsonEnvNames = [], keyFileEnvNames = [] } = {}) {
  const scopedAuth = { scopes };
  const jsonCandidates = dedupe([...jsonEnvNames, "GOOGLE_SERVICE_ACCOUNT_JSON", "GCP_SERVICE_ACCOUNT_JSON"]);

  for (const envName of jsonCandidates) {
    const credentials = parseServiceAccountCredentials(process.env[envName], envName);
    if (credentials) {
      return {
        ...scopedAuth,
        credentials
      };
    }
  }

  const keyFileCandidates = dedupe([...keyFileEnvNames, "GOOGLE_SERVICE_ACCOUNT_KEY_FILE", "GOOGLE_APPLICATION_CREDENTIALS"]);
  for (const envName of keyFileCandidates) {
    const keyFile = cleanString(process.env[envName]);
    if (!keyFile) continue;
    return {
      ...scopedAuth,
      keyFile
    };
  }

  return scopedAuth;
}

export function buildGoogleAuth({ scopes = [], jsonEnvNames = [], keyFileEnvNames = [] } = {}) {
  return new google.auth.GoogleAuth(
    resolveGoogleAuthOptions({
      scopes,
      jsonEnvNames,
      keyFileEnvNames
    })
  );
}
