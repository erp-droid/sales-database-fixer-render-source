import { describe, expect, it } from "vitest";

import { buildSalesRepDirectory, buildSalesRepOptions } from "@/lib/read-model/sales-reps";

describe("sales rep directory", () => {
  it("maps raw account owner ids to canonical employee codes when a unique employee name exists", () => {
    const items = buildSalesRepDirectory(
      [
        {
          salesRepId: "109350",
          salesRepName: "Justin Settle",
        } as never,
        {
          salesRepId: "109350",
          salesRepName: "Justin Settle",
        } as never,
      ],
      [
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
    );

    expect(items).toEqual([
      expect.objectContaining({
        id: "E0000052",
        name: "Justin Settle",
        ownerReferenceId: "109350",
        usageCount: 2,
      }),
    ]);
  });

  it("keeps an unmatched raw owner id when no canonical employee code exists yet", () => {
    const items = buildSalesRepDirectory(
      [
        {
          salesRepId: "109999",
          salesRepName: "Mystery Rep",
        } as never,
      ],
      [],
    );

    expect(items).toEqual([
      expect.objectContaining({
        id: "109999",
        name: "Mystery Rep",
        ownerReferenceId: null,
        usageCount: 1,
      }),
    ]);
  });

  it("builds unique picker options keyed by canonical employee code", () => {
    const items = buildSalesRepDirectory(
      [
        {
          salesRepId: "109343",
          salesRepName: "Jorge Serrano",
        } as never,
        {
          salesRepId: "109350",
          salesRepName: "Justin Settle",
        } as never,
      ],
      [
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
    );

    expect(buildSalesRepOptions(items)).toEqual([
      { id: "E0000045", name: "Jorge Serrano" },
      { id: "E0000052", name: "Justin Settle" },
    ]);
  });
});
