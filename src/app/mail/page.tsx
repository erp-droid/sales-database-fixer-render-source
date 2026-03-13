import { Suspense } from "react";

import { MailClient } from "@/components/mail-client";

export default function MailPage() {
  return (
    <Suspense fallback={null}>
      <MailClient />
    </Suspense>
  );
}
