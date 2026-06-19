export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import {
  getStoredLoginName,
  requireAuthCookieValue,
  setAuthCookie,
} from "@/lib/auth";
import { queryBusinessAccounts } from "@/lib/business-accounts";
import {
  buildBusinessAccountsCsv,
  buildBusinessAccountsCsvFilename,
  canExportBusinessAccountsCsv,
} from "@/lib/business-account-export";
import { fetchAllSyncRows } from "@/lib/data-quality-live";
import { getEnv } from "@/lib/env";
import { HttpError, getErrorMessage } from "@/lib/errors";
import { readAllAccountRowsFromReadModel } from "@/lib/read-model/accounts";
import { maybeTriggerReadModelSync, readSyncStatus } from "@/lib/read-model/sync";
import { parseListQuery } from "@/lib/validation";
import {
  CATEGORY_VALUES,
  type BusinessAccountRow,
  type Category,
} from "@/types/business-account";

const BLANK_CATEGORY_FILTER = "__blank_category__";
const UNASSIGNED_SALES_REP_FILTER = "__unassigned__";

type ExportFilterView = "allCompanies" | "marketingOnly";
type CategoryFilterValue = Category | typeof BLANK_CATEGORY_FILTER;

type ExportViewFilters = {
  filterView: ExportFilterView;
  selectedCategories: CategoryFilterValue[];
  selectedWeeks: string[];
  selectedSalesReps: string[];
};

function hasUsableReadModelSnapshot(): boolean {
  const status = readSyncStatus();
  return Boolean(status.lastSuccessfulSyncAt) || status.rowsCount > 0;
}

function normalizeMultiValueParam(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function readMultiValueParams(searchParams: URLSearchParams, key: string): string[] {
  return searchParams.getAll(key).flatMap(normalizeMultiValueParam);
}

function isCategory(value: string): value is Category {
  return CATEGORY_VALUES.includes(value as Category);
}

function isCategoryFilterValue(value: string): value is CategoryFilterValue {
  return isCategory(value) || value === BLANK_CATEGORY_FILTER;
}

function normalizeWeekValue(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(/^week\s*(\d+)$/i);
  if (match) {
    const weekNumber = Number.parseInt(match[1] ?? "", 10);
    if (Number.isFinite(weekNumber)) {
      return `Week ${weekNumber}`;
    }
  }

  return trimmed;
}

function normalizeComparable(value: string): string {
  return value.trim().toLowerCase();
}

function parseExportViewFilters(searchParams: URLSearchParams): ExportViewFilters {
  const filterView =
    searchParams.get("filterView") === "marketingOnly"
      ? "marketingOnly"
      : "allCompanies";

  return {
    filterView,
    selectedCategories: [
      ...new Set(
        readMultiValueParams(searchParams, "selectedCategory").filter(isCategoryFilterValue),
      ),
    ],
    selectedWeeks: [
      ...new Set(
        readMultiValueParams(searchParams, "selectedWeek")
          .map((value) => normalizeWeekValue(value))
          .filter((value): value is string => Boolean(value)),
      ),
    ],
    selectedSalesReps: [
      ...new Set(readMultiValueParams(searchParams, "selectedSalesRep")),
    ],
  };
}

function applyExportViewFilters(
  rows: BusinessAccountRow[],
  filters: ExportViewFilters,
): BusinessAccountRow[] {
  const categorySet = new Set(filters.selectedCategories);
  const weekSet = new Set(filters.selectedWeeks.map(normalizeComparable));
  const salesRepSet = new Set(filters.selectedSalesReps);

  return rows.filter((row) => {
    if (filters.filterView === "marketingOnly" && row.marketingEligible === false) {
      return false;
    }

    if (categorySet.size > 0) {
      const matchesBlankCategory =
        categorySet.has(BLANK_CATEGORY_FILTER) && row.category === null;
      const matchesNamedCategory =
        row.category !== null && categorySet.has(row.category);
      if (!matchesBlankCategory && !matchesNamedCategory) {
        return false;
      }
    }

    if (weekSet.size > 0) {
      const normalizedWeek = normalizeWeekValue(row.week);
      if (!normalizedWeek || !weekSet.has(normalizeComparable(normalizedWeek))) {
        return false;
      }
    }

    if (salesRepSet.size > 0) {
      const salesRepName = row.salesRepName?.trim();
      const matchesUnassignedSalesRep =
        salesRepSet.has(UNASSIGNED_SALES_REP_FILTER) &&
        !row.salesRepId?.trim() &&
        !salesRepName;
      const matchesNamedSalesRep = Boolean(salesRepName && salesRepSet.has(salesRepName));
      if (!matchesUnassignedSalesRep && !matchesNamedSalesRep) {
        return false;
      }
    }

    return true;
  });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authCookieRefresh = {
    value: null as string | null,
  };

  try {
    const cookieValue = requireAuthCookieValue(request);
    const loginName = getStoredLoginName(request);
    if (!canExportBusinessAccountsCsv(loginName)) {
      throw new HttpError(403, "Only jserrano can export account CSV files.");
    }

    const params = parseListQuery(request.nextUrl.searchParams);
    const viewFilters = parseExportViewFilters(request.nextUrl.searchParams);
    const { READ_MODEL_ENABLED } = getEnv();

    let sourceRows = [] as Awaited<ReturnType<typeof fetchAllSyncRows>>;
    if (READ_MODEL_ENABLED) {
      maybeTriggerReadModelSync(cookieValue, authCookieRefresh);
      sourceRows = readAllAccountRowsFromReadModel();
      if (sourceRows.length === 0 && !hasUsableReadModelSnapshot()) {
        throw new HttpError(
          409,
          "No local snapshot yet. Click Sync records to build the SQLite snapshot before exporting.",
        );
      }
    }

    if (sourceRows.length === 0 && !READ_MODEL_ENABLED) {
      sourceRows = await fetchAllSyncRows(cookieValue, authCookieRefresh, {
        includeInternal: false,
      });
    }

    const viewRows = applyExportViewFilters(sourceRows, viewFilters);
    const exportRows = queryBusinessAccounts(viewRows, {
      ...params,
      includeInternalRows: true,
      page: 1,
      pageSize: Math.max(1, viewRows.length || 1),
    }).items;

    const response = new NextResponse(buildBusinessAccountsCsv(exportRows), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${buildBusinessAccountsCsvFilename()}"`,
        "Cache-Control": "no-store",
      },
    });

    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }

    return response;
  } catch (error) {
    let response: NextResponse;

    if (error instanceof ZodError) {
      response = NextResponse.json(
        {
          error: "Invalid export parameters",
          details: error.flatten(),
        },
        { status: 400 },
      );
    } else if (error instanceof HttpError) {
      response = NextResponse.json(
        {
          error: error.message,
          details: error.details,
        },
        { status: error.status },
      );
    } else {
      response = NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }

    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }

    return response;
  }
}
