import { Suspense } from "react";

import { CalendarClient } from "@/components/calendar-client";

export default function CalendarPage() {
  return (
    <Suspense fallback={null}>
      <CalendarClient />
    </Suspense>
  );
}
