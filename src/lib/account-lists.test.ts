import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("account-lists", () => {
  let tempDir = "";
  let closeDb: (() => void) | null = null;

  beforeEach(() => {
    vi.resetModules();
    tempDir = mkdtempSync(path.join(tmpdir(), "account-lists-test-"));
    process.env.AUTH_COOKIE_SECURE = "false";
    process.env.ACUMATICA_BASE_URL = "https://example.invalid";
    process.env.ACUMATICA_COMPANY = "Test Company";
    process.env.READ_MODEL_SQLITE_PATH = path.join(tempDir, "read-model.sqlite");
  });

  afterEach(() => {
    closeDb?.();
    closeDb = null;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("shows user lists only to the owner and company lists to everyone", async () => {
    const { getReadModelDb } = await import("@/lib/read-model/db");
    const {
      createAccountList,
      listVisibleAccountLists,
      normalizeAccountListFilters,
    } = await import("@/lib/account-lists");
    closeDb = () => getReadModelDb().close();

    createAccountList("jserrano", {
      name: "Brock A/B",
      scope: "user",
      filters: normalizeAccountListFilters({
        selectedCategoryFilters: ["A", "B"],
        selectedSalesRepFilters: ["Brock Koczka"],
      }),
    });
    createAccountList("jserrano", {
      name: "Dormant Customers",
      scope: "company",
      filters: normalizeAccountListFilters({
        activeFilterView: "marketingOnly",
        selectedWeekFilters: ["Week 4"],
      }),
    });

    expect(listVisibleAccountLists("jserrano").map((list) => list.name)).toEqual([
      "Brock A/B",
      "Brock Koczka A/B",
      "Dormant Customers",
      "Justin Settle A/B",
    ]);
    expect(listVisibleAccountLists("sarah").map((list) => list.name)).toEqual([
      "Brock Koczka A/B",
      "Dormant Customers",
      "Justin Settle A/B",
    ]);
  });

  it("seeds the shared A/B sales-rep lists for the Directory and Map", async () => {
    const { getReadModelDb } = await import("@/lib/read-model/db");
    const { listVisibleAccountLists } = await import("@/lib/account-lists");
    closeDb = () => getReadModelDb().close();

    const lists = listVisibleAccountLists("sarah");

    expect(lists).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "system:justin-settle-ab",
          name: "Justin Settle A/B",
          scope: "company",
          ownerLoginName: "system",
          filters: expect.objectContaining({
            selectedCategoryFilters: ["A", "B"],
            selectedSalesRepFilters: ["Justin Settle"],
          }),
        }),
        expect.objectContaining({
          id: "system:brock-koczka-ab",
          name: "Brock Koczka A/B",
          scope: "company",
          ownerLoginName: "system",
          filters: expect.objectContaining({
            selectedCategoryFilters: ["A", "B"],
            selectedSalesRepFilters: ["Brock Koczka"],
          }),
        }),
      ]),
    );
  });

  it("normalizes invalid filter values before saving", async () => {
    const { getReadModelDb } = await import("@/lib/read-model/db");
    const { createAccountList } = await import("@/lib/account-lists");
    closeDb = () => getReadModelDb().close();

    const list = createAccountList("JSERRANO", {
      name: "  Clean List  ",
      scope: "user",
      filters: {
        activeFilterView: "allCompanies",
        selectedCategoryFilters: ["A", "Invalid"],
        selectedWeekFilters: ["week 2", "not a week"],
        selectedSalesRepFilters: ["", "__unassigned__", "Brock Koczka"],
        q: "  steel  ",
        headerFilters: {
          companyName: "meadow",
          accountType: "",
          opportunityCount: "",
          salesRepName: "",
          industryType: "",
          subCategory: "",
          companyRegion: "",
          week: "",
          address: "",
          companyPhone: "",
          primaryContactName: "",
          primaryContactJobTitle: "",
          primaryContactPhone: "",
          primaryContactExtension: "",
          primaryContactEmail: "",
          notes: "",
          category: "Invalid",
          lastCalled: "",
          lastCalendarInvited: "",
          lastEmailed: "",
          lastModified: "",
        },
      },
    });

    expect(list.name).toBe("Clean List");
    expect(list.ownerLoginName).toBe("jserrano");
    expect(list.filters.selectedCategoryFilters).toEqual(["A"]);
    expect(list.filters.selectedWeekFilters).toEqual(["Week 2"]);
    expect(list.filters.selectedSalesRepFilters).toEqual(["__unassigned__", "Brock Koczka"]);
    expect(list.filters.q).toBe("steel");
    expect(list.filters.headerFilters.category).toBe("");
  });

  it("deletes lists only for the owner", async () => {
    const { getReadModelDb } = await import("@/lib/read-model/db");
    const {
      createAccountList,
      deleteAccountList,
      listVisibleAccountLists,
      normalizeAccountListFilters,
    } = await import("@/lib/account-lists");
    closeDb = () => getReadModelDb().close();

    const list = createAccountList("jserrano", {
      name: "Mine",
      scope: "user",
      filters: normalizeAccountListFilters({ selectedCategoryFilters: ["A"] }),
    });

    expect(() => deleteAccountList(list.id, "sarah")).toThrow(
      "List was not found or cannot be deleted by this user.",
    );
    deleteAccountList(list.id, "jserrano");
    expect(listVisibleAccountLists("jserrano").map((entry) => entry.name)).toEqual([
      "Brock Koczka A/B",
      "Justin Settle A/B",
    ]);
  });
});
