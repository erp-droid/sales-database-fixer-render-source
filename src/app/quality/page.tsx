import { getEnv } from "@/lib/env";
import { DataQualityClient } from "@/components/data-quality-client";

export const dynamic = "force-dynamic";

export default function QualityPage() {
  const env = getEnv();

  return (
    <DataQualityClient
      acumaticaBaseUrl={env.ACUMATICA_BASE_URL}
      acumaticaCompanyId={env.ACUMATICA_COMPANY ?? "MeadowBrook Live"}
    />
  );
}
