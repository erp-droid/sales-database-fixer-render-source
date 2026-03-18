import { formatPhoneForTwilioDial } from "@/lib/phone";
import { getReadModelDb } from "@/lib/read-model/db";

export type CallerIdVerificationStatus = "pending" | "verified" | "failed";

export type CallerIdVerificationRecord = {
  loginName: string;
  phoneNumber: string;
  validationCode: string | null;
  callSid: string | null;
  status: CallerIdVerificationStatus;
  failureMessage: string | null;
  verifiedAt: string | null;
  updatedAt: string;
};

function normalizeLoginName(value: string): string {
  return value.trim().toLowerCase();
}

function mapRow(
  row:
    | {
        login_name: string;
        phone_number: string;
        validation_code: string | null;
        call_sid: string | null;
        status: CallerIdVerificationStatus;
        failure_message: string | null;
        verified_at: string | null;
        updated_at: string;
      }
    | undefined,
): CallerIdVerificationRecord | null {
  if (!row) {
    return null;
  }

  return {
    loginName: row.login_name,
    phoneNumber: row.phone_number,
    validationCode: row.validation_code,
    callSid: row.call_sid,
    status: row.status,
    failureMessage: row.failure_message,
    verifiedAt: row.verified_at,
    updatedAt: row.updated_at,
  };
}

export function readCallerIdVerification(loginName: string): CallerIdVerificationRecord | null {
  const normalizedLoginName = normalizeLoginName(loginName);
  if (!normalizedLoginName) {
    return null;
  }

  const db = getReadModelDb();
  const row = db
    .prepare(
      `
      SELECT
        login_name,
        phone_number,
        validation_code,
        call_sid,
        status,
        failure_message,
        verified_at,
        updated_at
      FROM caller_id_verifications
      WHERE login_name = ?
      `,
    )
    .get(normalizedLoginName) as
    | {
        login_name: string;
        phone_number: string;
        validation_code: string | null;
        call_sid: string | null;
        status: CallerIdVerificationStatus;
        failure_message: string | null;
        verified_at: string | null;
        updated_at: string;
      }
    | undefined;

  return mapRow(row);
}

export function savePendingCallerIdVerification(input: {
  loginName: string;
  phoneNumber: string;
  validationCode: string;
  callSid: string;
}): CallerIdVerificationRecord {
  const normalizedLoginName = normalizeLoginName(input.loginName);
  const normalizedPhoneNumber = formatPhoneForTwilioDial(input.phoneNumber);
  const validationCode = input.validationCode.trim();
  const callSid = input.callSid.trim();
  if (!normalizedLoginName || !normalizedPhoneNumber || !validationCode || !callSid) {
    throw new Error("A login name, phone number, validation code, and call SID are required.");
  }

  const db = getReadModelDb();
  const now = new Date().toISOString();
  db.prepare(
    `
    INSERT INTO caller_id_verifications (
      login_name,
      phone_number,
      validation_code,
      call_sid,
      status,
      failure_message,
      verified_at,
      updated_at
    ) VALUES (?, ?, ?, ?, 'pending', NULL, NULL, ?)
    ON CONFLICT(login_name) DO UPDATE SET
      phone_number = excluded.phone_number,
      validation_code = excluded.validation_code,
      call_sid = excluded.call_sid,
      status = excluded.status,
      failure_message = excluded.failure_message,
      verified_at = excluded.verified_at,
      updated_at = excluded.updated_at
    `,
  ).run(normalizedLoginName, normalizedPhoneNumber, validationCode, callSid, now);

  return readCallerIdVerification(normalizedLoginName)!;
}

export function saveVerifiedCallerIdVerification(input: {
  loginName: string;
  phoneNumber: string;
}): CallerIdVerificationRecord {
  const normalizedLoginName = normalizeLoginName(input.loginName);
  const normalizedPhoneNumber = formatPhoneForTwilioDial(input.phoneNumber);
  if (!normalizedLoginName || !normalizedPhoneNumber) {
    throw new Error("A login name and phone number are required.");
  }

  const db = getReadModelDb();
  const now = new Date().toISOString();
  db.prepare(
    `
    INSERT INTO caller_id_verifications (
      login_name,
      phone_number,
      validation_code,
      call_sid,
      status,
      failure_message,
      verified_at,
      updated_at
    ) VALUES (?, ?, NULL, NULL, 'verified', NULL, ?, ?)
    ON CONFLICT(login_name) DO UPDATE SET
      phone_number = excluded.phone_number,
      validation_code = excluded.validation_code,
      call_sid = excluded.call_sid,
      status = excluded.status,
      failure_message = excluded.failure_message,
      verified_at = excluded.verified_at,
      updated_at = excluded.updated_at
    `,
  ).run(normalizedLoginName, normalizedPhoneNumber, now, now);

  return readCallerIdVerification(normalizedLoginName)!;
}

export function saveFailedCallerIdVerification(input: {
  loginName: string;
  phoneNumber: string;
  failureMessage: string;
}): CallerIdVerificationRecord {
  const normalizedLoginName = normalizeLoginName(input.loginName);
  const normalizedPhoneNumber = formatPhoneForTwilioDial(input.phoneNumber);
  const failureMessage = input.failureMessage.trim();
  if (!normalizedLoginName || !normalizedPhoneNumber || !failureMessage) {
    throw new Error("A login name, phone number, and failure message are required.");
  }

  const db = getReadModelDb();
  const now = new Date().toISOString();
  db.prepare(
    `
    INSERT INTO caller_id_verifications (
      login_name,
      phone_number,
      validation_code,
      call_sid,
      status,
      failure_message,
      verified_at,
      updated_at
    ) VALUES (?, ?, NULL, NULL, 'failed', ?, NULL, ?)
    ON CONFLICT(login_name) DO UPDATE SET
      phone_number = excluded.phone_number,
      validation_code = excluded.validation_code,
      call_sid = excluded.call_sid,
      status = excluded.status,
      failure_message = excluded.failure_message,
      verified_at = excluded.verified_at,
      updated_at = excluded.updated_at
    `,
  ).run(normalizedLoginName, normalizedPhoneNumber, failureMessage, now);

  return readCallerIdVerification(normalizedLoginName)!;
}
