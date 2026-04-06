import { Suspense } from "react";

import { DashboardBasicView } from "@/components/dashboard-basic-view";
import { DashboardOverviewClient } from "@/components/dashboard-overview-client";

type DashboardPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function toSearchParams(
  params: Record<string, string | string[] | undefined>,
): URLSearchParams {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") {
      search.set(key, value);
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        search.append(key, item);
      }
    }
  }

  return search;
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const resolvedParams = (await searchParams) ?? {};
  const parsedSearchParams = toSearchParams(resolvedParams);
  const isBasicView = parsedSearchParams.get("basic") === "1";
  const defaultNowIso = new Date().toISOString();

  if (isBasicView) {
    return <DashboardBasicView searchParams={parsedSearchParams} />;
  }

  return (
    <Suspense fallback={null}>
      <DashboardOverviewClient defaultNowIso={defaultNowIso} />
    </Suspense>
  );
}
