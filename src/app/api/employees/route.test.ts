import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireAuthCookieValue = vi.fn(() => "cookie");
const setAuthCookie = vi.fn();
const fetchEmployees = vi.fn();
const getEnv = vi.fn();
const replaceSalesRepDirectory = vi.fn();
const readAllAccountRowsFromReadModel = vi.fn();
const readEmployeeDirectorySnapshot = vi.fn();
const replaceEmployeeDirectory = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireAuthCookieValue,
  setAuthCookie,
}));

vi.mock("@/lib/acumatica", () => ({
  fetchEmployees,
}));

vi.mock("@/lib/env", () => ({
  getEnv,
}));

vi.mock("@/lib/read-model/accounts", () => ({
  readAllAccountRowsFromReadModel,
}));

vi.mock("@/lib/read-model/employees", () => ({
  FULL_EMPLOYEE_DIRECTORY_SOURCE: "acumatica_employees",
  readEmployeeDirectorySnapshot,
  replaceEmployeeDirectory,
}));

vi.mock("@/lib/read-model/sales-reps", async () => {
  const actual = await vi.importActual<typeof import("@/lib/read-model/sales-reps")>(
    "@/lib/read-model/sales-reps",
  );

  return {
    ...actual,
    replaceSalesRepDirectory,
  };
});

describe("GET /api/employees", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-12T14:00:00.000Z"));
    requireAuthCookieValue.mockReturnValue("cookie");
    getEnv.mockReturnValue({
      READ_MODEL_ENABLED: true,
    });
    readAllAccountRowsFromReadModel.mockReturnValue([]);
    readEmployeeDirectorySnapshot.mockReturnValue({
      items: [],
      source: null,
      updatedAt: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns canonical employee-code sales reps from the synced SQLite datasets", async () => {
    readAllAccountRowsFromReadModel.mockReturnValue([
      {
        salesRepId: "109343",
        salesRepName: "Jorge Serrano",
      },
      {
        salesRepId: "109350",
        salesRepName: "Justin Settle",
      },
      {
        salesRepId: "100099",
        salesRepName: "Justin Settle",
      },
    ]);
    readEmployeeDirectorySnapshot.mockReturnValue({
      items: [
        {
          id: "E0000045",
          name: "Jorge Serrano",
          loginName: "jserrano",
          email: "jserrano@meadowb.com",
          contactId: 157497,
          phone: null,
          isActive: true,
        },
        {
          id: "E0000052",
          name: "Justin Settle",
          loginName: "jsettle",
          email: "jsettle@meadowb.com",
          contactId: null,
          phone: null,
          isActive: true,
        },
      ],
      source: "acumatica_employees",
      updatedAt: "2026-03-12T13:55:00.000Z",
    });

    const { GET } = await import("@/app/api/employees/route");
    const response = await GET(new NextRequest("http://localhost/api/employees"));
    const payload = (await response.json()) as {
      items: Array<{ id: string; name: string }>;
    };

    expect(response.status).toBe(200);
    expect(fetchEmployees).not.toHaveBeenCalled();
    expect(replaceSalesRepDirectory).toHaveBeenCalledTimes(1);
    expect(payload.items).toEqual([
      { id: "E0000045", name: "Jorge Serrano" },
      { id: "E0000052", name: "Justin Settle" },
    ]);
  });

  it("rebuilds the sales rep directory from cached account rows when employee cache is unavailable", async () => {
    readAllAccountRowsFromReadModel.mockReturnValue([
      {
        salesRepId: "109343",
        salesRepName: "Jorge Serrano",
      },
      {
        salesRepId: "100001",
        salesRepName: "Justin Settle",
      },
      {
        salesRepId: "100099",
        salesRepName: "Justin Settle",
      },
    ]);

    const { GET } = await import("@/app/api/employees/route");
    const response = await GET(new NextRequest("http://localhost/api/employees"));
    const payload = (await response.json()) as {
      items: Array<{ id: string; name: string }>;
    };

    expect(response.status).toBe(200);
    expect(fetchEmployees).not.toHaveBeenCalled();
    expect(replaceSalesRepDirectory).toHaveBeenCalledTimes(1);
    expect(payload.items).toEqual([
      {
        id: "109343",
        name: "Jorge Serrano",
      },
      {
        id: "100001",
        name: "Justin Settle",
      },
    ]);
  });

  it("falls back to a live employee fetch only when there is no synced sales rep data yet", async () => {
    readAllAccountRowsFromReadModel.mockReturnValue([]);
    fetchEmployees.mockResolvedValue([
      {
        id: "E0000045",
        name: "Jorge Serrano",
      },
      {
        id: "E0000117",
        name: "Brock Koczka",
      },
      {
        id: "E0000052",
        name: "Justin Settle",
      },
      {
        id: "109350",
        name: "Justin Settle",
      },
    ]);

    const { GET } = await import("@/app/api/employees/route");
    const response = await GET(new NextRequest("http://localhost/api/employees"));
    const payload = (await response.json()) as {
      items: Array<{ id: string; name: string }>;
    };

    expect(response.status).toBe(200);
    expect(fetchEmployees).toHaveBeenCalledWith("cookie", expect.any(Object));
    expect(replaceEmployeeDirectory).toHaveBeenCalledTimes(1);
    expect(replaceSalesRepDirectory).toHaveBeenCalledTimes(1);
    expect(payload.items).toEqual([
      { id: "E0000117", name: "Brock Koczka" },
      { id: "E0000045", name: "Jorge Serrano" },
      { id: "E0000052", name: "Justin Settle" },
    ]);
  });
});
