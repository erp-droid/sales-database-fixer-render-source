import { getEnv } from "@/lib/env";
import { AccountsClient } from "@/components/accounts-client";

export default function AccountsPage() {
  const env = getEnv();

  return (
    <AccountsClient
      acumaticaBaseUrl={env.ACUMATICA_BASE_URL}
      acumaticaCompanyId={env.ACUMATICA_COMPANY ?? "MeadowBrook Live"}
    />
  );
}
