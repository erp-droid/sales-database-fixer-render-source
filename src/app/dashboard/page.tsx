import { Suspense } from "react";

import { DashboardOverviewClient } from "@/components/dashboard-overview-client";

export default function DashboardPage() {
  return (
    <Suspense fallback={null}>
      <DashboardOverviewClient />
    </Suspense>
  );
}
