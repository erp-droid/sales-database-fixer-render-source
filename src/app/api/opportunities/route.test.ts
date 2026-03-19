import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HttpError } from "@/lib/errors";

const requireAuthCookieValue = vi.fn(() => "cookie");
const setAuthCookie = vi.fn();
const createOpportunity = vi.fn();
const readOpportunityId = vi.fn((record: Record<string, unknown>) => {
  const opportunity = record.OpportunityID as { value?: string } | undefined;
  return opportunity?.value ?? null;
});
const fetchContactMergeServerContext = vi.fn();
const normalizeRawBusinessAccountForMerge = vi.fn();
const isOpportunityOwnerNotFoundErrorMessage = vi.fn((message: string | null | undefined) =>
  Boolean(message?.toLowerCase().includes("owner")),
);
const buildOpportunityCreateOptions = vi.fn(() => ({
  defaultStage: "Awaiting Estimate",
  defaultLocation: "MAIN",
}));
const resolveOpportunityLocation = vi.fn(() => "MAIN");
const buildOpportunityCreatePayload = vi.fn(
  ({
    request,
    ownerValue,
  }: {
    request: { businessAccountId: string; contactId: number; subject: string };
    ownerValue?: string | null;
  }) => ({
    BusinessAccount: { value: request.businessAccountId },
    ContactID: { value: String(request.contactId) },
    Subject: { value: request.subject },
    ...(ownerValue
      ? {
          Owner: { value: ownerValue },
        }
      : {}),
  }),
);

vi.mock("@/lib/auth", () => ({
  requireAuthCookieValue,
  setAuthCookie,
}));

vi.mock("@/lib/acumatica", () => ({
  createOpportunity,
  readOpportunityId,
  readWrappedNumber: (record: Record<string, { value?: unknown }>, key: string) => {
    const numeric = Number(record[key]?.value);
    return Number.isFinite(numeric) ? numeric : null;
  },
  readWrappedString: (record: Record<string, { value?: unknown }>, key: string) => {
    const value = record[key]?.value;
    return typeof value === "string" && value.trim() ? value.trim() : null;
  },
}));

vi.mock("@/lib/contact-merge-server", () => ({
  fetchContactMergeServerContext,
}));

vi.mock("@/lib/contact-merge", () => ({
  normalizeRawBusinessAccountForMerge,
}));

vi.mock("@/lib/opportunity-create", () => ({
  buildOpportunityCreateOptions,
  buildOpportunityCreatePayload,
  isOpportunityOwnerNotFoundErrorMessage,
  resolveOpportunityLocation,
}));

function buildRequest(
  overrides: Record<string, unknown> = {},
): NextRequest {
  return new NextRequest("http://localhost/api/opportunities", {
    method: "POST",
    body: JSON.stringify({
      businessAccountRecordId: "record-1",
      businessAccountId: "02670D2595",
      contactId: 157497,
      subject: "Warehouse electrical upgrade",
      classId: "PRODUCTION",
      location: "MAIN",
      stage: "Awaiting Estimate",
      estimationDate: "2026-03-11T00:00:00.000Z",
      note: null,
      willWinJob: "Yes",
      linkToDrive: "https://drive.google.com/test",
      projectType: "Electrical",
      ownerId: null,
      ownerName: "Jane Doe",
      ...overrides,
    }),
    headers: {
      "content-type": "application/json",
    },
  });
}

describe("POST /api/opportunities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthCookieValue.mockReturnValue("cookie");
    buildOpportunityCreateOptions.mockReturnValue({
      defaultStage: "Awaiting Estimate",
      defaultLocation: "MAIN",
    });
    resolveOpportunityLocation.mockReturnValue("MAIN");
    fetchContactMergeServerContext.mockResolvedValue({
      rawAccountWithContacts: {
        Name: { value: "Alpha Foods" },
        Contacts: [
          {
            ContactID: { value: 157497 },
            DisplayName: { value: "Jorge Serrano" },
          },
        ],
      },
      resolvedRecordId: "record-1",
    });
    normalizeRawBusinessAccountForMerge.mockReturnValue({
      businessAccountId: "02670D2595",
      contactIds: new Set([157497]),
    });
    readOpportunityId.mockImplementation((record: Record<string, unknown>) => {
      const opportunity = record.OpportunityID as { value?: string } | undefined;
      return opportunity?.value ?? null;
    });
  });

  it("rejects contacts that do not belong to the selected business account", async () => {
    const { POST } = await import("@/app/api/opportunities/route");

    const response = await POST(
      buildRequest({
        contactId: 200001,
      }),
    );
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(422);
    expect(payload.error).toContain("selected contact");
    expect(createOpportunity).not.toHaveBeenCalled();
  });

  it("rejects account mismatches", async () => {
    const { POST } = await import("@/app/api/opportunities/route");

    const response = await POST(
      buildRequest({
        businessAccountId: "WRONG-ACCOUNT",
      }),
    );
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(422);
    expect(payload.error).toContain("selected account");
    expect(createOpportunity).not.toHaveBeenCalled();
  });

  it("rejects accounts that do not have a business account id", async () => {
    normalizeRawBusinessAccountForMerge.mockReturnValue({
      businessAccountId: null,
      contactIds: new Set([157497]),
    });

    const { POST } = await import("@/app/api/opportunities/route");

    const response = await POST(buildRequest());
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(422);
    expect(payload.error).toContain("Business account ID is missing");
    expect(createOpportunity).not.toHaveBeenCalled();
  });

  it("returns a normalized success payload", async () => {
    createOpportunity.mockResolvedValue({
      OpportunityID: { value: "000777" },
    });

    const { POST } = await import("@/app/api/opportunities/route");

    const response = await POST(buildRequest());
    const payload = (await response.json()) as OpportunityCreateRoutePayload;

    expect(response.status).toBe(201);
    expect(payload).toEqual({
      created: true,
      opportunityId: "000777",
      businessAccountRecordId: "record-1",
      businessAccountId: "02670D2595",
      companyName: "Alpha Foods",
      contactId: 157497,
      contactName: "Jorge Serrano",
      subject: "Warehouse electrical upgrade",
      ownerId: null,
      ownerName: "Jane Doe",
      warnings: [],
    });
    expect(buildOpportunityCreatePayload).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          stage: "Awaiting Estimate",
          location: "MAIN",
        }),
      }),
    );
  });

  it("retries owner submission with ownerId after an owner-name lookup failure", async () => {
    createOpportunity
      .mockRejectedValueOnce(
        new HttpError(422, "Owner cannot be found in the system."),
      )
      .mockResolvedValueOnce({
        OpportunityID: { value: "000778" },
      });

    const { POST } = await import("@/app/api/opportunities/route");

    const response = await POST(
      buildRequest({
        ownerId: "E0001",
        ownerName: "Jane Doe",
      }),
    );
    const payload = (await response.json()) as { opportunityId: string };

    expect(response.status).toBe(201);
    expect(payload.opportunityId).toBe("000778");
    expect(buildOpportunityCreatePayload).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        ownerValue: "Jane Doe",
        request: expect.objectContaining({
          stage: "Awaiting Estimate",
          location: "MAIN",
        }),
      }),
    );
    expect(buildOpportunityCreatePayload).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        ownerValue: "E0001",
        request: expect.objectContaining({
          stage: "Awaiting Estimate",
          location: "MAIN",
        }),
      }),
    );
    expect(createOpportunity).toHaveBeenCalledTimes(2);
  });
});

type OpportunityCreateRoutePayload = {
  created: boolean;
  opportunityId: string;
  businessAccountRecordId: string;
  businessAccountId: string;
  companyName: string | null;
  contactId: number;
  contactName: string | null;
  subject: string;
  ownerId: string | null;
  ownerName: string | null;
  warnings: string[];
};
