import { Suspense } from "react";

import { DashboardOverviewClient } from "@/components/dashboard-overview-client";

export default function DashboardPage() {
  const defaultNowIso = new Date().toISOString();

  return (
    <Suspense fallback={null}>
      <DashboardOverviewClient defaultNowIso={defaultNowIso} />
    </Suspense>
  );
}
