import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class LocalStorageMock {
  private readonly store = new Map<string, string>();

  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  setItem(key: string, value: string) {
    this.store.set(key, value);
  }

  removeItem(key: string) {
    this.store.delete(key);
  }

  clear() {
    this.store.clear();
  }
}

const SAMPLE_ROW = {
  id: "acct-1",
  accountRecordId: "acct-1",
  businessAccountId: "BA-100",
  companyName: "Alpha Fabrication",
  address: "1 Main St, Toronto ON, CA",
  addressLine1: "1 Main St",
  addressLine2: "",
  city: "Toronto",
  state: "ON",
  postalCode: "M1M 1M1",
  country: "CA",
  primaryContactName: "Jane Doe",
  primaryContactPhone: "416-555-0100",
  primaryContactEmail: "jane@example.com",
  salesRepId: "109343",
  salesRepName: "Jorge Serrano",
  industryType: null,
  subCategory: null,
  companyRegion: "Region 5",
  week: null,
  primaryContactId: 123,
  notes: null,
  lastModifiedIso: "2026-03-13T21:00:00.000Z",
};

describe("client dataset cache", () => {
  beforeEach(() => {
    const localStorage = new LocalStorageMock();

    vi.stubGlobal("window", {
      localStorage,
      dispatchEvent: vi.fn(),
    });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;

        constructor(type: string) {
          this.type = type;
        }
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("persists datasets across module reloads", async () => {
    const cache = await import("@/lib/client-dataset-cache");

    cache.writeCachedDatasetToStorage({
      rows: [SAMPLE_ROW],
      lastSyncedAt: "2026-03-13T21:36:00.592Z",
    });

    vi.resetModules();

    const reloadedCache = await import("@/lib/client-dataset-cache");
    expect(reloadedCache.readCachedDatasetFromStorage()).toEqual({
      rows: [SAMPLE_ROW],
      lastSyncedAt: "2026-03-13T21:36:00.592Z",
    });
  });

  it("ignores and clears legacy dataset keys after a cache version bump", async () => {
    const legacyPayload = JSON.stringify({
      rows: [SAMPLE_ROW],
      lastSyncedAt: "2026-03-13T21:36:00.592Z",
    });
    const localStorage = (
      globalThis.window as unknown as { localStorage: LocalStorageMock }
    ).localStorage;
    localStorage.setItem("businessAccounts.dataset.v3", legacyPayload);

    const cache = await import("@/lib/client-dataset-cache");
    expect(cache.readCachedDatasetFromStorage()).toBeNull();
    expect(localStorage.getItem("businessAccounts.dataset.v5")).toBeNull();
    expect(localStorage.getItem("businessAccounts.dataset.v4")).toBeNull();
    expect(localStorage.getItem("businessAccounts.dataset.v3")).toBeNull();
  });
});
