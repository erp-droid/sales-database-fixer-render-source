import { cookies } from "next/headers";

import { LOGIN_NAME_COOKIE } from "@/lib/account-directory-access";
import {
  getEnv,
  getLocalDevLoginName,
  isLocalDevAuthBypassEnabled,
} from "@/lib/env";
import { AccountsClient } from "@/components/accounts-client";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const env = getEnv();
  const cookieStore = await cookies();
  const initialLoginName = isLocalDevAuthBypassEnabled()
    ? getLocalDevLoginName()
    : cookieStore.get(LOGIN_NAME_COOKIE)?.value ?? null;

  return (
    <AccountsClient
      initialLoginName={initialLoginName}
      openAiAttributeSuggestEnabled={Boolean(env.OPENAI_API_KEY?.trim())}
      rocketReachEnabled={Boolean(env.ROCKETREACH_API_KEY?.trim())}
    />
  );
}
