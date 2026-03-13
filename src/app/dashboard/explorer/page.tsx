import { Suspense } from "react";

import { DashboardExplorerClient } from "@/components/dashboard-explorer-client";

export default function DashboardExplorerPage() {
  return (
    <Suspense fallback={null}>
      <DashboardExplorerClient />
    </Suspense>
  );
}
