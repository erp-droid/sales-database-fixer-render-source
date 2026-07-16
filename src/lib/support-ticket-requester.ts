import { readCallEmployeeDirectory } from "@/lib/call-analytics/employee-directory";
import { readCallerIdentityProfile } from "@/lib/caller-identity-cache";
import { getEnv } from "@/lib/env";
import { HttpError } from "@/lib/errors";
import { readEmployeeDirectory } from "@/lib/read-model/employees";

export type SupportTicketRequester = {
  employeeName: string;
  employeeEmail: string;
};

function normalize(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function emailLogin(value: string | null | undefined) {
  const normalized = normalize(value);
  const separator = normalized.indexOf("@");
  return separator >= 0 ? normalized.slice(0, separator) : normalized;
}

function isWorkEmailForLogin(email: string | null | undefined, loginName: string, domain: string) {
  const normalized = normalize(email);
  return emailLogin(normalized) === loginName && normalized.endsWith(`@${domain}`);
}

export function resolveSupportTicketRequester(loginName: string): SupportTicketRequester {
  const normalizedLogin = normalize(loginName);
  if (!normalizedLogin || !/^[a-z0-9._%+-]+$/.test(normalizedLogin)) {
    throw new HttpError(401, "Signed-in username is unavailable. Sign out and sign in again.");
  }

  const domain = getEnv().MAIL_INTERNAL_DOMAIN.trim().toLowerCase();
  const callerProfile = readCallerIdentityProfile(normalizedLogin);
  const callDirectoryItem = readCallEmployeeDirectory().find(
    (item) => normalize(item.loginName) === normalizedLogin,
  ) ?? null;
  const employeeDirectoryItem = readEmployeeDirectory().find(
    (item) =>
      normalize(item.loginName) === normalizedLogin ||
      emailLogin(item.email) === normalizedLogin,
  ) ?? null;

  const employeeEmail = [
    callerProfile?.email,
    callDirectoryItem?.email,
    employeeDirectoryItem?.email,
  ].find((email) => isWorkEmailForLogin(email, normalizedLogin, domain)) ??
    `${normalizedLogin}@${domain}`;

  const employeeName = [
    callerProfile?.displayName,
    callDirectoryItem?.displayName,
    employeeDirectoryItem?.name,
  ].map((value) => value?.trim() ?? "").find(Boolean) ?? normalizedLogin;

  return { employeeName, employeeEmail };
}
