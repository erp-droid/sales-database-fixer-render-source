import { cookies } from "next/headers";

import { ReportsClient } from "@/components/reports-client";
import { LOGIN_NAME_COOKIE } from "@/lib/account-directory-access";
import { getLocalDevLoginName, isLocalDevAuthBypassEnabled } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const cookieStore = await cookies();
  const initialLoginName = isLocalDevAuthBypassEnabled()
    ? getLocalDevLoginName()
    : cookieStore.get(LOGIN_NAME_COOKIE)?.value ?? null;

  return <ReportsClient initialLoginName={initialLoginName} />;
}
