export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { requireAuthCookieValue, setAuthCookie } from "@/lib/auth";
import {
  type AuthCookieRefreshState,
  fetchEmployees,
} from "@/lib/acumatica";
import { getEnv } from "@/lib/env";
import { HttpError, getErrorMessage } from "@/lib/errors";
import {
  FULL_EMPLOYEE_DIRECTORY_SOURCE,
  readEmployeeDirectorySnapshot,
  replaceEmployeeDirectory,
} from "@/lib/read-model/employees";

const EMPLOYEE_DIRECTORY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

let employeeDirectoryRefreshPromise: Promise<Awaited<ReturnType<typeof fetchEmployees>>> | null =
  null;

function isFreshEmployeeDirectory(updatedAt: string | null): boolean {
  if (!updatedAt) {
    return false;
  }

  const parsed = Date.parse(updatedAt);
  if (Number.isNaN(parsed)) {
    return false;
  }

  return Date.now() - parsed <= EMPLOYEE_DIRECTORY_CACHE_TTL_MS;
}

async function refreshEmployeeDirectory(
  cookieValue: string,
  authCookieRefresh: AuthCookieRefreshState,
) {
  if (!employeeDirectoryRefreshPromise) {
    employeeDirectoryRefreshPromise = (async () => {
      const items = await fetchEmployees(cookieValue, authCookieRefresh);
      replaceEmployeeDirectory(items, FULL_EMPLOYEE_DIRECTORY_SOURCE);
      return items;
    })().finally(() => {
      employeeDirectoryRefreshPromise = null;
    });
  }

  return employeeDirectoryRefreshPromise;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authCookieRefresh: AuthCookieRefreshState = {
    value: null,
  };

  try {
    const cookieValue = requireAuthCookieValue(request);
    const { READ_MODEL_ENABLED } = getEnv();
    let items;
    if (READ_MODEL_ENABLED) {
      const snapshot = readEmployeeDirectorySnapshot();
      const hasFullDirectory =
        snapshot.source === FULL_EMPLOYEE_DIRECTORY_SOURCE && snapshot.items.length > 0;
      const hasAnyCachedDirectory = snapshot.items.length > 0;

      if (hasFullDirectory && isFreshEmployeeDirectory(snapshot.updatedAt)) {
        items = snapshot.items;
      } else if (hasAnyCachedDirectory) {
        items = snapshot.items;
        void refreshEmployeeDirectory(cookieValue, { value: null }).catch(() => undefined);
      } else {
        items = await refreshEmployeeDirectory(cookieValue, authCookieRefresh);
      }
    } else {
      items = await fetchEmployees(cookieValue, authCookieRefresh);
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
