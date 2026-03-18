import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAuthCookieValue = vi.fn(() => "user-cookie");
const setAuthCookie = vi.fn();
const withServiceAcumaticaSession = vi.fn();
const fetchEmployees = vi.fn();
const fetchEmployeeProfileById = vi.fn();
const findContactsByDisplayName = vi.fn();
const readEmployeeDirectorySnapshot = vi.fn();
const replaceEmployeeDirectory = vi.fn();
const upsertCallEmployeeDirectoryItem = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireAuthCookieValue,
  setAuthCookie,
}));

vi.mock("@/lib/acumatica-service-auth", () => ({
  withServiceAcumaticaSession,
}));

vi.mock("@/lib/acumatica", async () => {
  const actual = await vi.importActual<typeof import("@/lib/acumatica")>("@/lib/acumatica");
  return {
    ...actual,
    fetchEmployees,
    fetchEmployeeProfileById,
    findContactsByDisplayName,
  };
});

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

vi.mock("@/lib/call-analytics/employee-directory", () => ({
  upsertCallEmployeeDirectoryItem,
}));

describe("GET /api/employees/search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-17T17:00:00.000Z"));
    requireAuthCookieValue.mockReturnValue("user-cookie");
    readEmployeeDirectorySnapshot.mockReturnValue({
      items: [],
      source: null,
      updatedAt: null,
    });
    withServiceAcumaticaSession.mockImplementation(async (_preferredLoginName, operation) =>
      operation("service-cookie", { value: null }),
    );
  });

  it("returns matching internal employees from a refreshed directory and falls back to an internal contact email", async () => {
    fetchEmployees.mockResolvedValue([
      { id: "E0000153", name: "Simon Doal" },
      { id: "E0000045", name: "Jorge Serrano" },
    ]);
    fetchEmployeeProfileById.mockResolvedValueOnce({
      employeeId: "E0000153",
      contactId: null,
      displayName: "Simon Doal",
      email: null,
      phone: null,
      isActive: true,
    });
    findContactsByDisplayName.mockResolvedValueOnce([
      {
        ContactID: { value: 153 },
        DisplayName: { value: "Simon Doal" },
        Email: { value: "sdoal@meadowb.com" },
      },
    ]);

    const { GET } = await import("@/app/api/employees/search/route");
    const response = await GET(
      new NextRequest("http://localhost/api/employees/search?q=simon%20d"),
    );
    const payload = (await response.json()) as {
      items: Array<{
        key: string;
        loginName: string;
        employeeName: string;
        email: string;
        contactId: number | null;
        isInternal: true;
      }>;
    };

    expect(response.status).toBe(200);
    expect(withServiceAcumaticaSession).toHaveBeenCalledTimes(1);
    expect(fetchEmployees).toHaveBeenCalledWith("service-cookie", expect.any(Object));
    expect(replaceEmployeeDirectory).toHaveBeenCalledWith(
      [
        { id: "E0000153", name: "Simon Doal" },
        { id: "E0000045", name: "Jorge Serrano" },
      ],
      "acumatica_employees",
    );
    expect(payload.items).toEqual([
      {
        key: "employee:sdoal",
        loginName: "sdoal",
        employeeName: "Simon Doal",
        email: "sdoal@meadowb.com",
        contactId: 153,
        isInternal: true,
      },
    ]);
    expect(upsertCallEmployeeDirectoryItem).toHaveBeenCalledWith(
      expect.objectContaining({
        loginName: "sdoal",
        email: "sdoal@meadowb.com",
        contactId: 153,
      }),
    );
  });

  it("returns an empty list for short queries", async () => {
    const { GET } = await import("@/app/api/employees/search/route");
    const response = await GET(new NextRequest("http://localhost/api/employees/search?q=s"));
    const payload = (await response.json()) as { items: unknown[] };

    expect(response.status).toBe(200);
    expect(withServiceAcumaticaSession).not.toHaveBeenCalled();
    expect(fetchEmployees).not.toHaveBeenCalled();
    expect(payload.items).toEqual([]);
  });
});
