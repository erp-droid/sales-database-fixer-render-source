import { Suspense } from "react";

import { AuditLogClient } from "@/components/audit-log-client";

export default function AuditPage() {
  return (
    <Suspense fallback={null}>
      <AuditLogClient />
    </Suspense>
  );
}
