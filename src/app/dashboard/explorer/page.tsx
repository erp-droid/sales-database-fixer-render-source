import { Suspense } from "react";

import { DashboardExplorerClient } from "@/components/dashboard-explorer-client";

export default function DashboardExplorerPage() {
  const defaultNowIso = new Date().toISOString();

  return (
    <Suspense fallback={null}>
      <DashboardExplorerClient defaultNowIso={defaultNowIso} />
    </Suspense>
  );
}
