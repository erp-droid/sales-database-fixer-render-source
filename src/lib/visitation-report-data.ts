import type { AuthCookieRefreshState } from "@/lib/acumatica";
import { fetchAllSyncRows } from "@/lib/data-quality-live";
import { getEnv } from "@/lib/env";
import { HttpError } from "@/lib/errors";
import { readAllAccountRowsFromReadModel } from "@/lib/read-model/accounts";
import { maybeTriggerReadModelSync, readSyncStatus } from "@/lib/read-model/sync";
import type { BusinessAccountRow } from "@/types/business-account";

function hasUsableReadModelSnapshot(): boolean {
  const status = readSyncStatus();
  return Boolean(status.lastSuccessfulSyncAt) || status.rowsCount > 0;
}
export async function loadVisitationReportRows(
  authCookieValue: string,
  authCookieRefresh: AuthCookieRefreshState,
): Promise<{ rows: BusinessAccountRow[]; readModelEnabled: boolean }> {
  const { READ_MODEL_ENABLED } = getEnv();
  let rows: BusinessAccountRow[] = [];

  if (READ_MODEL_ENABLED) {
    maybeTriggerReadModelSync(authCookieValue, authCookieRefresh);
    rows = readAllAccountRowsFromReadModel();
    if (rows.length === 0 && !hasUsableReadModelSnapshot()) {
      throw new HttpError(
        409,
        "No account snapshot is available yet. Sync the account records, then run the report again.",
      );
    }
  } else {
    rows = await fetchAllSyncRows(authCookieValue, authCookieRefresh, {
      includeInternal: false,
    });
  }

  return { rows, readModelEnabled: READ_MODEL_ENABLED };
}
