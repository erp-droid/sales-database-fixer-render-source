export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { requireAuthCookieValue, setAuthCookie } from "@/lib/auth";
import {
  type AuthCookieRefreshState,
  fetchEmployees,
} from "@/lib/acumatica";
import { getEnv } from "@/lib/env";
import { HttpError, getErrorMessage } from "@/lib/errors";
import { readAllAccountRowsFromReadModel } from "@/lib/read-model/accounts";
import {
  FULL_EMPLOYEE_DIRECTORY_SOURCE,
  readEmployeeDirectorySnapshot,
  replaceEmployeeDirectory,
} from "@/lib/read-model/employees";
import {
  buildSalesRepDirectory,
  buildSalesRepOptions,
  replaceSalesRepDirectory,
} from "@/lib/read-model/sales-reps";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authCookieRefresh: AuthCookieRefreshState = {
    value: null,
  };

  try {
    const cookieValue = requireAuthCookieValue(request);
    const { READ_MODEL_ENABLED } = getEnv();
    let items;
    if (READ_MODEL_ENABLED) {
      const rows = readAllAccountRowsFromReadModel();
      const employeeSnapshot = readEmployeeDirectorySnapshot();

      if (rows.length > 0 || employeeSnapshot.items.length > 0) {
        const directoryItems = buildSalesRepDirectory(rows, employeeSnapshot.items);
        if (directoryItems.length > 0) {
          replaceSalesRepDirectory(directoryItems);
        }
        items = buildSalesRepOptions(directoryItems);
      } else {
        const employeeItems = await fetchEmployees(cookieValue, authCookieRefresh);
        replaceEmployeeDirectory(employeeItems, FULL_EMPLOYEE_DIRECTORY_SOURCE);
        const directoryItems = buildSalesRepDirectory([], employeeItems);
        replaceSalesRepDirectory(directoryItems);
        items = buildSalesRepOptions(directoryItems);
      }
    } else {
      const employeeItems = await fetchEmployees(cookieValue, authCookieRefresh);
      items = buildSalesRepOptions(buildSalesRepDirectory([], employeeItems));
    }

    const response = NextResponse.json({ items });
    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }

    return response;
  } catch (error) {
    let response: NextResponse;
    if (error instanceof HttpError) {
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
