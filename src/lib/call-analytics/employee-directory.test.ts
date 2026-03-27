import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildCallEmployeeDirectoryFromEmployeeProfiles,
  buildEmployeeDirectoryFromEmployeeProfiles,
} from "@/lib/call-analytics/employee-directory";

function buildEmployee(input: {
  employeeId?: string;
  contactId?: number | null;
  displayName: string;
  email?: string | null;
  phone?: string | null;
  isActive?: boolean;
}) {
  return {
    employeeId: input.employeeId ?? "E0001",
    contactId: input.contactId ?? null,
    displayName: input.displayName,
    email: input.email === undefined ? "simon@meadowb.com" : input.email,
    phone: input.phone === undefined ? "416-555-0100" : input.phone,
    isActive: input.isActive ?? true,
  };
}

function buildContact(input: {
  contactId: number;
  email: string;
  displayName?: string;
  phone?: string | null;
}): Record<string, unknown> {
  return {
    ContactID: { value: input.contactId },
    DisplayName: { value: input.displayName ?? "Simon MeadowBrook" },
    Email: { value: input.email },
    ...(input.phone === null ? {} : { Phone1: { value: input.phone ?? "905-555-0100" } }),
  };
}

describe("buildCallEmployeeDirectoryFromEmployeeProfiles", () => {
  it("keeps internal employees even when no phone is present and supplements contact ids from contacts", () => {
    const directory = buildCallEmployeeDirectoryFromEmployeeProfiles(
      [
        buildEmployee({
          employeeId: "E000153",
          displayName: "Simon MeadowBrook",
          email: "simon@meadowb.com",
          phone: null,
        }),
        buildEmployee({
          employeeId: "E000154",
          displayName: "External Contact",
          email: "person@example.com",
        }),
      ],
      [
        buildContact({
          contactId: 101,
          email: "simon@meadowb.com",
          phone: "905-555-0100",
        }),
      ],
    );

    expect(directory).toEqual([
      expect.objectContaining({
        contactId: 101,
        displayName: "Simon MeadowBrook",
        email: "simon@meadowb.com",
        normalizedPhone: null,
        callerIdPhone: null,
      }),
    ]);
  });

  it("uses the employee profile phone instead of the contact phone", () => {
    const directory = buildCallEmployeeDirectoryFromEmployeeProfiles(
      [
        buildEmployee({
          employeeId: "E000153",
          contactId: 101,
          displayName: "Simon MeadowBrook",
          email: "simon@meadowb.com",
          phone: "4374233641",
        }),
      ],
      [
        buildContact({
          contactId: 101,
          email: "simon@meadowb.com",
          phone: "905-555-0100",
        }),
      ],
    );

    expect(directory).toEqual([
      expect.objectContaining({
        contactId: 101,
        email: "simon@meadowb.com",
        normalizedPhone: "+14374233641",
        callerIdPhone: "+14374233641",
      }),
    ]);
  });

  it("supplements missing employee emails from a same-name internal contact without copying the contact phone", () => {
    const directory = buildCallEmployeeDirectoryFromEmployeeProfiles(
      [
        buildEmployee({
          employeeId: "E000153",
          contactId: null,
          displayName: "Simon Doal",
          email: null,
          phone: null,
        }),
      ],
      [
        buildContact({
          contactId: 153,
          displayName: "Simon Doal",
          email: "sdoal@meadowb.com",
          phone: "905-555-0100",
        }),
      ],
    );

    expect(directory).toEqual([
      expect.objectContaining({
        contactId: 153,
        displayName: "Simon Doal",
        email: "sdoal@meadowb.com",
        normalizedPhone: null,
        callerIdPhone: null,
      }),
    ]);
  });
});

describe("buildEmployeeDirectoryFromEmployeeProfiles", () => {
  it("keeps the richer employee id, login, email, contact, and phone fields for cached lookup", () => {
    const directory = buildEmployeeDirectoryFromEmployeeProfiles(
      [
        buildEmployee({
          employeeId: "E000153",
          contactId: 101,
          displayName: "Simon MeadowBrook",
          email: "simon@meadowb.com",
          phone: "4374233641",
        }),
      ],
      [
        buildContact({
          contactId: 101,
          email: "simon@meadowb.com",
          phone: "905-555-0100",
        }),
      ],
    );

    expect(directory).toEqual([
      {
        id: "E000153",
        name: "Simon MeadowBrook",
        loginName: "simon",
        email: "simon@meadowb.com",
        contactId: 101,
        phone: "+14374233641",
        isActive: true,
      },
    ]);
  });
});

describe("syncCallEmployeeDirectory", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("deduplicates concurrent full-directory syncs", async () => {
    const fetchEmployeeProfiles = vi.fn(
      async () =>
        [
          buildEmployee({
            employeeId: "E000153",
            contactId: 101,
            displayName: "Simon MeadowBrook",
            email: "simon@meadowb.com",
            phone: "4374233641",
          }),
        ],
    );
    const fetchContacts = vi.fn(async () => [
      buildContact({
        contactId: 101,
        email: "simon@meadowb.com",
      }),
    ]);

    vi.doMock("@/lib/acumatica", () => ({
      fetchEmployeeProfiles,
      fetchContacts,
      readWrappedNumber: (record: Record<string, { value?: unknown }>, field: string) => {
        const value = record[field]?.value;
        return typeof value === "number" ? value : null;
      },
      readWrappedString: (record: Record<string, { value?: unknown }>, field: string) => {
        const value = record[field]?.value;
        return typeof value === "string" ? value : "";
      },
    }));

    vi.doMock("@/lib/read-model/db", () => ({
      getReadModelDb: () => ({
        transaction: <T extends (...args: unknown[]) => unknown>(callback: T) => callback,
        prepare: () => ({
          run: () => undefined,
          all: () => [],
        }),
      }),
    }));

    const module = await import("@/lib/call-analytics/employee-directory");

    const [left, right] = await Promise.all([
      module.syncCallEmployeeDirectory("cookie"),
      module.syncCallEmployeeDirectory("cookie"),
    ]);

    expect(fetchEmployeeProfiles).toHaveBeenCalledTimes(1);
    expect(fetchContacts).toHaveBeenCalledTimes(1);
    expect(left).toEqual(right);
  });

  it("rebuilds historical call sessions after refreshing the employee directory", async () => {
    const fetchEmployeeProfiles = vi.fn(async () => [
      buildEmployee({
        employeeId: "E000153",
        contactId: 101,
        displayName: "Simon MeadowBrook",
        email: "simon@meadowb.com",
        phone: "4374233641",
      }),
    ]);
    const fetchContacts = vi.fn(async () => [
      buildContact({
        contactId: 101,
        email: "simon@meadowb.com",
      }),
    ]);
    const rebuildCallSessions = vi.fn();

    vi.doMock("@/lib/acumatica", () => ({
      fetchEmployeeProfiles,
      fetchContacts,
      readWrappedNumber: (record: Record<string, { value?: unknown }>, field: string) => {
        const value = record[field]?.value;
        return typeof value === "number" ? value : null;
      },
      readWrappedString: (record: Record<string, { value?: unknown }>, field: string) => {
        const value = record[field]?.value;
        return typeof value === "string" ? value : "";
      },
    }));

    vi.doMock("@/lib/call-analytics/sessionize", () => ({
      rebuildCallSessions,
    }));

    vi.doMock("@/lib/read-model/db", () => ({
      getReadModelDb: () => ({
        transaction: <T extends (...args: unknown[]) => unknown>(callback: T) => callback,
        prepare: () => ({
          run: () => undefined,
          all: () => [],
        }),
      }),
    }));

    const module = await import("@/lib/call-analytics/employee-directory");

    await module.syncCallEmployeeDirectory("cookie");

    expect(rebuildCallSessions).toHaveBeenCalledTimes(1);
  });

  it("skips phone-only hydration during full directory sync", async () => {
    const fetchEmployeeProfiles = vi.fn(async () => [
      buildEmployee({
        employeeId: "E000153",
        contactId: 101,
        displayName: "Simon MeadowBrook",
        email: "simon@meadowb.com",
        phone: null,
      }),
    ]);
    const fetchContacts = vi.fn(async () => [
      buildContact({
        contactId: 101,
        email: "simon@meadowb.com",
      }),
    ]);

    vi.doMock("@/lib/acumatica", () => ({
      fetchEmployeeProfiles,
      fetchContacts,
      readWrappedNumber: (record: Record<string, { value?: unknown }>, field: string) => {
        const value = record[field]?.value;
        return typeof value === "number" ? value : null;
      },
      readWrappedString: (record: Record<string, { value?: unknown }>, field: string) => {
        const value = record[field]?.value;
        return typeof value === "string" ? value : "";
      },
    }));

    vi.doMock("@/lib/read-model/db", () => ({
      getReadModelDb: () => ({
        transaction: <T extends (...args: unknown[]) => unknown>(callback: T) => callback,
        prepare: () => ({
          run: () => undefined,
          all: () => [],
        }),
      }),
    }));

    const module = await import("@/lib/call-analytics/employee-directory");

    await module.syncCallEmployeeDirectory("cookie");

    expect(fetchEmployeeProfiles).toHaveBeenCalledWith(
      "cookie",
      undefined,
      { hydrateMissingPhone: false },
    );
  });
});
