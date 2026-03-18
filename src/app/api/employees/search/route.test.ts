import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAuthCookieValue = vi.fn(() => "user-cookie");
const setAuthCookie = vi.fn();
const withServiceAcumaticaSession = vi.fn();
const fetchEmployees = vi.fn();
const fetchEmployeeProfileById = vi.fn();
const findContactsByDisplayName = vi.fn();
const searchContacts = vi.fn();
const readEmployeeDirectorySnapshot = vi.fn();
const replaceEmployeeDirectory = vi.fn();
const readCallEmployeeDirectory = vi.fn();
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
    searchContacts,
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
  readCallEmployeeDirectory,
  upsertCallEmployeeDirectoryItem,
}));

describe("GET /api/employees/search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-17T17:00:00.000Z"));
    requireAuthCookieValue.mockReturnValue("user-cookie");
    readCallEmployeeDirectory.mockReturnValue([]);
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

  it("returns cached rich employee matches immediately without a live refresh", async () => {
    readEmployeeDirectorySnapshot.mockReturnValue({
      items: [
        {
          id: "E0000153",
          name: "Simon Doal",
          loginName: "sdoal",
          email: "sdoal@meadowb.com",
          contactId: 153,
          phone: "+14374233641",
          isActive: true,
        },
      ],
      source: "acumatica_employees",
      updatedAt: "2026-03-17T16:00:00.000Z",
    });

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
    expect(withServiceAcumaticaSession).not.toHaveBeenCalled();
    expect(fetchEmployees).not.toHaveBeenCalled();
    expect(fetchEmployeeProfileById).not.toHaveBeenCalled();
  });

  it("falls back to a broader internal contact search when Acumatica contact display names differ", async () => {
    fetchEmployees.mockResolvedValue([{ id: "E0000153", name: "Simon Doal" }]);
    fetchEmployeeProfileById.mockResolvedValueOnce({
      employeeId: "E0000153",
      contactId: null,
      displayName: "Simon Doal",
      email: null,
      phone: null,
      isActive: true,
    });
    findContactsByDisplayName.mockResolvedValueOnce([]);
    searchContacts.mockResolvedValueOnce([
      {
        ContactID: { value: 153 },
        DisplayName: { value: "Simon S. Doal" },
        Email: { value: "sdoal@meadowb.com" },
      },
    ]);

    const { GET } = await import("@/app/api/employees/search/route");
    const response = await GET(
      new NextRequest("http://localhost/api/employees/search?q=simon%20d"),
    );
    const payload = (await response.json()) as {
      items: Array<{
        loginName: string;
        employeeName: string;
        email: string;
        contactId: number | null;
      }>;
    };

    expect(response.status).toBe(200);
    expect(searchContacts).toHaveBeenCalledWith(
      "service-cookie",
      expect.objectContaining({
        filter: expect.stringContaining("substringof('simon'"),
        top: 10,
        skip: 0,
      }),
      expect.any(Object),
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

  it("returns cached call-directory employees immediately without hydrating Acumatica again", async () => {
    readCallEmployeeDirectory.mockReturnValue([
      {
        loginName: "jlee",
        contactId: 142,
        displayName: "Jacky Lee",
        email: "jlee@meadowb.com",
        normalizedPhone: "+13653411781",
        callerIdPhone: "+13653411781",
        isActive: true,
        updatedAt: "2026-03-17T17:00:00.000Z",
      },
    ]);

    const { GET } = await import("@/app/api/employees/search/route");
    const response = await GET(
      new NextRequest("http://localhost/api/employees/search?q=jacky"),
    );
    const payload = (await response.json()) as {
      items: Array<{
        key: string;
        loginName: string;
        employeeName: string;
        email: string;
        contactId: number | null;
      }>;
    };

    expect(response.status).toBe(200);
    expect(payload.items).toEqual([
      {
        key: "employee:jlee",
        loginName: "jlee",
        employeeName: "Jacky Lee",
        email: "jlee@meadowb.com",
        contactId: 142,
        isInternal: true,
      },
    ]);
    expect(withServiceAcumaticaSession).toHaveBeenCalledTimes(1);
    expect(fetchEmployees).not.toHaveBeenCalled();
    expect(fetchEmployeeProfileById).not.toHaveBeenCalled();
  });
});
