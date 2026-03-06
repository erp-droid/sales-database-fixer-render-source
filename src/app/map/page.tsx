import { getEnv } from "@/lib/env";
import { AccountsMapClient } from "@/components/accounts-map-client";

export default function MapPage() {
  const env = getEnv();

  return (
    <AccountsMapClient
      acumaticaBaseUrl={env.ACUMATICA_BASE_URL}
      acumaticaCompanyId={env.ACUMATICA_COMPANY ?? "MeadowBrook Live"}
    />
  );
}
