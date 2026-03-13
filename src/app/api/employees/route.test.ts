import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireAuthCookieValue = vi.fn(() => "cookie");
const setAuthCookie = vi.fn();
const fetchEmployees = vi.fn();
const getEnv = vi.fn();
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

vi.mock("@/lib/read-model/employees", async () => {
  const actual = await vi.importActual<typeof import("@/lib/read-model/employees")>(
    "@/lib/read-model/employees",
  );

  return {
    ...actual,
    readEmployeeDirectorySnapshot,
    replaceEmployeeDirectory,
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
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the cached directory immediately and refreshes in the background when the cache is stale", async () => {
    readEmployeeDirectorySnapshot.mockReturnValue({
      items: [{ id: "109343", name: "Jorge Serrano" }],
      source: "sync",
      updatedAt: "2026-03-12T13:55:00.000Z",
    });
    fetchEmployees.mockResolvedValue([
      { id: "109343", name: "Jorge Serrano" },
      { id: "124894", name: "Brock Koczka" },
      { id: "109301", name: "Adrian Fernandez" },
    ]);

    const { GET } = await import("@/app/api/employees/route");
    const response = await GET(new NextRequest("http://localhost/api/employees"));
    const payload = (await response.json()) as {
      items: Array<{ id: string; name: string }>;
    };

    expect(response.status).toBe(200);
    expect(fetchEmployees).toHaveBeenCalledWith("cookie", expect.any(Object));
    expect(payload.items).toEqual([{ id: "109343", name: "Jorge Serrano" }]);
  });

  it("reuses the cached full directory when it is already fresh", async () => {
    readEmployeeDirectorySnapshot.mockReturnValue({
      items: [
        { id: "109343", name: "Jorge Serrano" },
        { id: "124894", name: "Brock Koczka" },
      ],
      source: "acumatica_employees",
      updatedAt: "2026-03-12T13:30:00.000Z",
    });

    const { GET } = await import("@/app/api/employees/route");
    const response = await GET(new NextRequest("http://localhost/api/employees"));
    const payload = (await response.json()) as {
      items: Array<{ id: string; name: string }>;
    };

    expect(response.status).toBe(200);
    expect(fetchEmployees).not.toHaveBeenCalled();
    expect(replaceEmployeeDirectory).not.toHaveBeenCalled();
    expect(payload.items).toEqual([
      { id: "109343", name: "Jorge Serrano" },
      { id: "124894", name: "Brock Koczka" },
    ]);
  });

  it("waits for a live refresh when there is no cached directory yet", async () => {
    readEmployeeDirectorySnapshot.mockReturnValue({
      items: [],
      source: "sync",
      updatedAt: null,
    });
    fetchEmployees.mockResolvedValue([
      { id: "109343", name: "Jorge Serrano" },
      { id: "124894", name: "Brock Koczka" },
    ]);

    const { GET } = await import("@/app/api/employees/route");
    const response = await GET(new NextRequest("http://localhost/api/employees"));
    const payload = (await response.json()) as {
      items: Array<{ id: string; name: string }>;
    };

    expect(response.status).toBe(200);
    expect(fetchEmployees).toHaveBeenCalledWith("cookie", expect.any(Object));
    expect(replaceEmployeeDirectory).toHaveBeenCalledWith(payload.items, "acumatica_employees");
    expect(payload.items).toEqual([
      { id: "109343", name: "Jorge Serrano" },
      { id: "124894", name: "Brock Koczka" },
    ]);
  });
});
