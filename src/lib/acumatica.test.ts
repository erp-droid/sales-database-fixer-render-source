import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockResponseInput = {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
};

function jsonResponse(input: MockResponseInput): Response {
  const headers = new Headers(input.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  return new Response(
    input.body === undefined ? null : JSON.stringify(input.body),
    {
      status: input.status,
      headers,
    },
  );
}

function setAcumaticaEnv(overrides?: Record<string, string | undefined>): void {
  process.env.AUTH_PROVIDER = "acumatica";
  process.env.ACUMATICA_BASE_URL = "https://example.acumatica.com";
  process.env.ACUMATICA_ENTITY_PATH = "/entity/lightspeed/24.200.001";
  process.env.ACUMATICA_COMPANY = "MeadowBrook Live";
  process.env.ACUMATICA_LOCALE = "en-US";
  process.env.AUTH_COOKIE_NAME = ".ASPXAUTH";
  process.env.AUTH_COOKIE_SECURE = "false";
  process.env.USER_CREDENTIALS_SECRET = "test-user-credentials-secret";
  process.env.READ_MODEL_SQLITE_PATH = "/tmp/acumatica-test-read-model.sqlite";
  process.env.AUTH_LOGIN_URL = "";
  process.env.AUTH_ME_URL = "";
  process.env.AUTH_LOGOUT_URL = "";
  process.env.AUTH_FORGOT_PASSWORD_URL = "";
  process.env.ACUMATICA_BRANCH = "";
  process.env.ACUMATICA_OPPORTUNITY_ENTITY = "Opportunity";
  process.env.ACUMATICA_OPPORTUNITY_CLASS_DEFAULT = "PRODUCTION";
  process.env.ACUMATICA_OPPORTUNITY_STAGE_DEFAULT = "Awaiting Estimate";
  process.env.ACUMATICA_OPPORTUNITY_LOCATION_DEFAULT = "MAIN";
  process.env.ACUMATICA_OPPORTUNITY_ESTIMATION_OFFSET_DAYS = "0";
  process.env.ACUMATICA_OPPORTUNITY_ATTR_WIN_JOB_ID =
    "Do you think we are going to win this job?";
  process.env.ACUMATICA_OPPORTUNITY_ATTR_LINK_TO_DRIVE_ID = "Link to Drive";
  process.env.ACUMATICA_OPPORTUNITY_ATTR_PROJECT_TYPE_ID = "Project Type";
  process.env.ACUMATICA_OPPORTUNITY_LINK_TO_DRIVE_DEFAULT = "";

  if (!overrides) {
    return;
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe("Acumatica endpoint resolution", () => {
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    setAcumaticaEnv();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  it("derives the eCommerce fallback with the same version", async () => {
    const acumaticaModule = await import("@/lib/acumatica");
    expect(
      acumaticaModule.deriveFallbackAcumaticaEntityPath("/entity/lightspeed/24.200.001"),
    ).toBe("/entity/eCommerce/24.200.001");
  });

  it("derives the Default fallback with the same version", async () => {
    const acumaticaModule = await import("@/lib/acumatica");
    expect(
      acumaticaModule.deriveDefaultAcumaticaEntityPath("/entity/lightspeed/24.200.001"),
    ).toBe("/entity/Default/24.200.001");
  });

  it("uses the configured endpoint when it is available and reuses the cache", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ status: 200, body: [] }))
      .mockResolvedValueOnce(jsonResponse({ status: 200, body: [] }));

    const { validateSessionWithAcumatica } = await import("@/lib/acumatica");

    await validateSessionWithAcumatica("cookie");
    await validateSessionWithAcumatica("cookie");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/entity/lightspeed/24.200.001/Contact?$top=1",
    );
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      "/entity/lightspeed/24.200.001/Contact?$top=1",
    );
  });

  it("falls back to eCommerce when the configured endpoint is not found", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          status: 404,
          body: { message: "Endpoint [lightspeed/24.200.001] not found" },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ status: 200, body: [] }))
      .mockResolvedValueOnce(jsonResponse({ status: 200, body: [] }));

    const { validateSessionWithAcumatica } = await import("@/lib/acumatica");

    await validateSessionWithAcumatica("cookie");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      "/entity/eCommerce/24.200.001/Contact?$top=1",
    );
  });

  it("falls back to Default when eCommerce is unusable for customer management", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          status: 404,
          body: { message: "Endpoint [lightspeed/24.200.001] not found" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: 500,
          body: {
            message:
              "The required configuration data is not entered on the Customer Management Preferences form.",
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ status: 200, body: [] }))
      .mockResolvedValueOnce(jsonResponse({ status: 200, body: [] }));

    const { validateSessionWithAcumatica } = await import("@/lib/acumatica");

    await validateSessionWithAcumatica("cookie");

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain(
      "/entity/Default/24.200.001/Contact?$top=1",
    );
  });

  it("does not fall back when the configured endpoint returns 401", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: 401,
        body: { message: "Session is invalid or expired" },
      }),
    );

    const { validateSessionWithAcumatica } = await import("@/lib/acumatica");

    await expect(validateSessionWithAcumatica("cookie")).rejects.toMatchObject({
      status: 401,
      message: "Session is invalid or expired",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns a precise diagnostic when both endpoints are missing", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          status: 404,
          body: { message: "Endpoint [lightspeed/24.200.001] not found" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: 404,
          body: { message: "Endpoint [eCommerce/24.200.001] not found" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: 404,
          body: { message: "Endpoint [Default/24.200.001] not found" },
        }),
      );

    const { validateSessionWithAcumatica } = await import("@/lib/acumatica");

    await expect(validateSessionWithAcumatica("cookie")).rejects.toMatchObject({
      status: 502,
      message:
        'Acumatica REST endpoint was not found for company "MeadowBrook Live". Tested:\n/entity/lightspeed/24.200.001\n/entity/eCommerce/24.200.001\n/entity/Default/24.200.001',
    });
  });

  it("retries other endpoints when a cached endpoint later disappears", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ status: 200, body: [] }))
      .mockResolvedValueOnce(
        jsonResponse({
          status: 404,
          body: { message: "Endpoint [lightspeed/24.200.001] not found" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: 500,
          body: {
            message:
              "The required configuration data is not entered on the Customer Management Preferences form.",
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ status: 200, body: [] }));

    const { validateSessionWithAcumatica } = await import("@/lib/acumatica");

    await validateSessionWithAcumatica("cookie");
    await validateSessionWithAcumatica("cookie");

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      "/entity/lightspeed/24.200.001/Contact?$top=1",
    );
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain(
      "/entity/eCommerce/24.200.001/Contact?$top=1",
    );
    expect(String(fetchMock.mock.calls[3]?.[0])).toContain(
      "/entity/Default/24.200.001/Contact?$top=1",
    );
  });

  it("falls back across endpoints when Event is missing on the configured endpoint", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          status: 404,
          body: {
            message: 'Entity "Event" not found in the endpoint [lightspeed/24.200.001]',
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: 404,
          body: {
            message: 'Entity "Event" not found in the endpoint [eCommerce/24.200.001]',
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: 200,
          body: { id: "event-note-1" },
        }),
      );

    const { createEvent } = await import("@/lib/acumatica");

    await createEvent("cookie", [
      {
        Summary: { value: "Operations sync" },
      },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/entity/lightspeed/24.200.001/Event",
    );
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      "/entity/eCommerce/24.200.001/Event",
    );
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain(
      "/entity/Default/24.200.001/Event",
    );
  });

  it("retries alternate event payloads after recoverable event create errors", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          status: 400,
          body: {
            message: "Body: field cannot be found in the system.",
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: 200,
          body: { id: "event-note-2" },
        }),
      );

    const { createEvent } = await import("@/lib/acumatica");

    await createEvent("cookie", [
      {
        Summary: { value: "Operations sync" },
        Body: { value: "Initial payload" },
      },
      {
        Summary: { value: "Operations sync" },
        Description: { value: "Fallback payload" },
      },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(firstBody.Body).toEqual({ value: "Initial payload" });
    expect(secondBody.Description).toEqual({ value: "Fallback payload" });
  });

  it("resolves a stale contact NoteID to the linked business account", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 200, body: [] }));

    const { fetchBusinessAccountById, validateSessionWithAcumatica } = await import(
      "@/lib/acumatica"
    );

    await validateSessionWithAcumatica("cookie");
    fetchMock.mockReset();

    fetchMock
      .mockResolvedValueOnce(jsonResponse({ status: 200, body: [] }))
      .mockResolvedValueOnce(
        jsonResponse({
          status: 500,
          body: { message: "Invalid business account identifier" },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ status: 200, body: [] }))
      .mockResolvedValueOnce(
        jsonResponse({
          status: 200,
          body: [],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: 200,
          body: [
            {
              id: "contact-note-id",
              NoteID: { value: "contact-note-id" },
              BusinessAccount: { value: "02670D2595" },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: 200,
          body: [
            {
              id: "account-record-id",
              NoteID: { value: "account-note-id" },
              BusinessAccountID: { value: "02670D2595" },
              Name: { value: "MeadowBrook Construction - Internal" },
            },
          ],
        }),
      );

    const result = await fetchBusinessAccountById("cookie", "contact-note-id");

    expect(result).toMatchObject({
      id: "account-record-id",
      BusinessAccountID: { value: "02670D2595" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(String(fetchMock.mock.calls[4]?.[0])).toContain(
      "/Contact?%24top=1&%24skip=0&%24filter=NoteID+eq+%27contact-note-id%27",
    );
    expect(String(fetchMock.mock.calls[5]?.[0])).toContain(
      "/BusinessAccount?%24top=1&%24skip=0",
    );
    expect(String(fetchMock.mock.calls[5]?.[0])).toContain(
      "BusinessAccountID+eq+%2702670D2595%27",
    );
  });

  it("supplements missing detail attributes when the endpoint only accepts a lighter detail expand", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 200, body: [] }));

    const { fetchBusinessAccountById, validateSessionWithAcumatica } = await import(
      "@/lib/acumatica"
    );

    await validateSessionWithAcumatica("cookie");
    fetchMock.mockReset();

    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          status: 500,
          body: { message: "Attributes expand is not available on this endpoint." },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ status: 200, body: [] }))
      .mockResolvedValueOnce(
        jsonResponse({
          status: 200,
          body: {
            id: "account-record-id",
            BusinessAccountID: { value: "B200000001" },
            Name: { value: "Alpha Inc" },
            MainAddress: {
              AddressLine1: { value: "5579 McAdam Road" },
              City: { value: "Mississauga" },
              State: { value: "ON" },
              PostalCode: { value: "L4Z 1N4" },
              Country: { value: "CA" },
            },
            PrimaryContact: {
              DisplayName: { value: "Jorge Serrano" },
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: 200,
          body: {
            id: "account-record-id",
            BusinessAccountID: { value: "B200000001" },
            Attributes: [
              {
                AttributeID: { value: "CLIENTTYPE" },
                Value: { value: "A" },
              },
              {
                AttributeID: { value: "REGION" },
                Value: { value: "Region 6" },
              },
            ],
          },
        }),
      );

    const result = await fetchBusinessAccountById("cookie", "B200000001");

    expect(result).toMatchObject({
      id: "account-record-id",
      BusinessAccountID: { value: "B200000001" },
      Attributes: [
        {
          AttributeID: { value: "CLIENTTYPE" },
          Value: { value: "A" },
        },
        {
          AttributeID: { value: "REGION" },
          Value: { value: "Region 6" },
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain(
      "/BusinessAccount/B200000001?%24expand=Contacts%2CMainAddress%2CPrimaryContact",
    );
    expect(String(fetchMock.mock.calls[3]?.[0])).toContain(
      "/BusinessAccount/B200000001?%24expand=Attributes",
    );
  });
});

describe("fetchEmployeeProfiles", () => {
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    setAcumaticaEnv();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  it("hydrates missing employee email and phone from the employee detail endpoint", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);

      if (url.includes("/Employee?") && url.includes("top=200") && url.includes("skip=0")) {
        return jsonResponse({
          status: 200,
          body: [
            {
              EmployeeID: { value: "E0000153" },
              EmployeeName: { value: "Simon Doal" },
              Status: { value: "Active" },
            },
          ],
        });
      }

      if (url.includes("/Employee?") && url.includes("top=200") && url.includes("skip=200")) {
        return jsonResponse({ status: 200, body: [] });
      }

      if (url.includes("/Employee/E0000153?$expand=ContactInfo")) {
        return jsonResponse({
          status: 200,
          body: {
            EmployeeID: { value: "E0000153" },
            EmployeeName: { value: "Simon Doal" },
            Status: { value: "Active" },
            ContactInfo: {
              Email: { value: "sdoal@meadowb.com" },
              Phone1: { value: "4374233641" },
            },
          },
        });
      }

      if (url.includes("/EPEmployee?") || url.includes("/EPEmployee/")) {
        return jsonResponse({
          status: 404,
          body: { message: "Entity EPEmployee not found" },
        });
      }

      return jsonResponse({ status: 200, body: [] });
    });

    const { fetchEmployeeProfiles } = await import("@/lib/acumatica");

    await expect(fetchEmployeeProfiles("cookie")).resolves.toEqual([
      {
        employeeId: "E0000153",
        contactId: null,
        displayName: "Simon Doal",
        email: "sdoal@meadowb.com",
        phone: "4374233641",
        isActive: true,
      },
    ]);
  });

  it("skips phone-only hydration when disabled for background directory sync", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);

      if (url.includes("/Employee?") && url.includes("top=200") && url.includes("skip=0")) {
        return jsonResponse({
          status: 200,
          body: [
            {
              EmployeeID: { value: "E0000153" },
              EmployeeName: { value: "Simon Doal" },
              Status: { value: "Active" },
              Email: { value: "sdoal@meadowb.com" },
            },
          ],
        });
      }

      if (url.includes("/Employee?") && url.includes("top=200") && url.includes("skip=200")) {
        return jsonResponse({ status: 200, body: [] });
      }

      if (url.includes("/Employee/E0000153?$expand=ContactInfo")) {
        throw new Error("Unexpected employee detail hydration request");
      }

      if (url.includes("/EPEmployee?") || url.includes("/EPEmployee/")) {
        return jsonResponse({
          status: 404,
          body: { message: "Entity EPEmployee not found" },
        });
      }

      return jsonResponse({ status: 200, body: [] });
    });

    const { fetchEmployeeProfiles } = await import("@/lib/acumatica");

    await expect(
      fetchEmployeeProfiles("cookie", undefined, {
        hydrateMissingPhone: false,
      }),
    ).resolves.toEqual([
      {
        employeeId: "E0000153",
        contactId: null,
        displayName: "Simon Doal",
        email: "sdoal@meadowb.com",
        phone: null,
        isActive: true,
      },
    ]);
  });
});

describe("fetchEmployees", () => {
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    setAcumaticaEnv();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  it("keeps richer employee records when derived sales-rep rows are merged in later", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);

      if (url.includes("/Employee?") && url.includes("top=200") && url.includes("skip=0")) {
        return jsonResponse({
          status: 200,
          body: [
            {
              EmployeeID: { value: "E0000142" },
              EmployeeName: { value: "Jacky Lee" },
              Status: { value: "Active" },
              ContactID: { value: 142 },
              ContactInfo: {
                Email: { value: "jlee@meadowb.com" },
                Phone1: { value: "3653411781" },
              },
            },
          ],
        });
      }

      if (url.includes("/Employee?") && url.includes("top=200") && url.includes("skip=200")) {
        return jsonResponse({ status: 200, body: [] });
      }

      if (url.includes("/EPEmployee?")) {
        return jsonResponse({
          status: 404,
          body: { message: 'Entity "EPEmployee" not found in the endpoint' },
        });
      }

      if (url.includes("/BusinessAccount?") && url.includes("top=200") && url.includes("skip=0")) {
        return jsonResponse({
          status: 200,
          body: [
            {
              BusinessAccountID: { value: "BA0001" },
              Owner: { value: "E0000142" },
              OwnerEmployeeName: { value: "Jacky Lee" },
            },
          ],
        });
      }

      if (url.includes("/BusinessAccount?") && url.includes("top=200") && url.includes("skip=200")) {
        return jsonResponse({ status: 200, body: [] });
      }

      return jsonResponse({ status: 200, body: [] });
    });

    const { fetchEmployees } = await import("@/lib/acumatica");

    await expect(fetchEmployees("cookie")).resolves.toEqual([
      {
        id: "E0000142",
        name: "Jacky Lee",
        loginName: "jlee",
        email: "jlee@meadowb.com",
        contactId: 142,
        phone: "3653411781",
        isActive: true,
      },
    ]);
  });
});

describe("searchEmployeesByDisplayName", () => {
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    setAcumaticaEnv();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  it("queries employees by exact display name without loading the full directory", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);

      if (url.includes("/Employee?") && url.includes("%24filter=")) {
        return jsonResponse({
          status: 200,
          body: [
            {
              EmployeeID: { value: "E0000153" },
              EmployeeName: { value: "Simon Doal" },
            },
          ],
        });
      }

      if (url.includes("/EPEmployee?")) {
        return jsonResponse({
          status: 404,
          body: { message: "Entity EPEmployee not found" },
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    const { searchEmployeesByDisplayName } = await import("@/lib/acumatica");

    await expect(searchEmployeesByDisplayName("cookie", "Simon Doal")).resolves.toEqual([
      {
        id: "E0000153",
        name: "Simon Doal",
        loginName: null,
        email: null,
        contactId: null,
        phone: null,
        isActive: false,
      },
    ]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/Employee?");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("DisplayName+eq+%27Simon+Doal%27");
  });
});

describe("searchEmployeeProfiles", () => {
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    setAcumaticaEnv();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  it("queries employee profiles by exact email and hydrates missing phone from the detail endpoint", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);

      if (url.includes("/Employee?") && url.includes("Email+eq+%27jserrano%40meadowb.com%27")) {
        return jsonResponse({
          status: 200,
          body: [
            {
              EmployeeID: { value: "E0000045" },
              EmployeeName: { value: "Jorge Serrano" },
              Email: { value: "jserrano@meadowb.com" },
              Status: { value: "Active" },
            },
          ],
        });
      }

      if (url.includes("/Employee/E0000045?$expand=ContactInfo")) {
        return jsonResponse({
          status: 200,
          body: {
            EmployeeID: { value: "E0000045" },
            EmployeeName: { value: "Jorge Serrano" },
            Status: { value: "Active" },
            ContactInfo: {
              Email: { value: "jserrano@meadowb.com" },
              Phone1: { value: "4162304681" },
            },
          },
        });
      }

      if (url.includes("/EPEmployee?") || url.includes("/EPEmployee/")) {
        return jsonResponse({
          status: 404,
          body: { message: "Entity EPEmployee not found" },
        });
      }

      return jsonResponse({ status: 200, body: [] });
    });

    const { searchEmployeeProfiles } = await import("@/lib/acumatica");

    await expect(
      searchEmployeeProfiles("cookie", {
        filter: "Email eq 'jserrano@meadowb.com'",
      }),
    ).resolves.toEqual([
      {
        employeeId: "E0000045",
        contactId: null,
        displayName: "Jorge Serrano",
        email: "jserrano@meadowb.com",
        phone: "4162304681",
        isActive: true,
      },
    ]);
  });
});

describe("Acumatica environment and login payload", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  it("requires ACUMATICA_COMPANY for direct Acumatica auth", async () => {
    vi.resetModules();
    setAcumaticaEnv({
      ACUMATICA_COMPANY: undefined,
    });

    const { getEnv } = await import("@/lib/env");

    expect(() => getEnv()).toThrow(
      "Invalid environment configuration for Acumatica auth provider: ACUMATICA_COMPANY",
    );
  });

  it("sends MeadowBrook Live in the Acumatica login payload", async () => {
    vi.resetModules();
    setAcumaticaEnv();

    vi.doMock("@/lib/caller-identity", () => ({
      resolveSignedInCallerIdentity: vi.fn().mockResolvedValue({
        loginName: "jorge",
        contactId: 1,
        displayName: "Jorge Serrano",
        email: "jorge@meadowb.com",
        userPhone: "+14165550100",
      }),
    }));

    const fetchMock = vi.fn().mockImplementation(async () =>
      new Response(
        JSON.stringify({ ok: true }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "set-cookie": ".ASPXAUTH=abc123; Path=/; HttpOnly",
          },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("@/app/api/auth/login/route");

    const request = new NextRequest("http://localhost/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        username: "jorge",
        password: "secret",
      }),
    });

    const response = await POST(request);
    const requestInit = fetchMock.mock.calls[0]?.[1];
    const payload =
      typeof requestInit?.body === "string"
        ? (JSON.parse(requestInit.body) as Record<string, string>)
        : {};

    expect(response.status).toBe(200);
    expect(payload.company).toBe("MeadowBrook Live");
  });
});

describe("Acumatica request logging", () => {
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    setAcumaticaEnv();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  it("suppresses fast successful request logs", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 200, body: [] }));

    const { validateSessionWithAcumatica } = await import("@/lib/acumatica");
    await validateSessionWithAcumatica("cookie");

    const requestLogs = infoSpy.mock.calls.filter((call) => call[0] === "[acumatica]");
    expect(requestLogs).toHaveLength(0);
  });

  it("logs slow successful requests", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 200, body: [] }));

    let nowCalls = 0;
    vi.spyOn(Date, "now").mockImplementation(() => {
      nowCalls += 1;
      return nowCalls === 1 ? 0 : 1500;
    });

    const { validateSessionWithAcumatica } = await import("@/lib/acumatica");
    await validateSessionWithAcumatica("cookie");

    const requestLogs = infoSpy.mock.calls.filter((call) => call[0] === "[acumatica]");
    expect(requestLogs).toHaveLength(1);
    expect(requestLogs[0]?.[1]).toMatchObject({
      status: 200,
      attempts: 1,
      durationMs: 1500,
    });
  });

  it("logs warning entries for failed requests", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: 500,
        body: { message: "Server error" },
      }),
    );

    const { validateSessionWithAcumatica } = await import("@/lib/acumatica");
    await expect(validateSessionWithAcumatica("cookie")).rejects.toMatchObject({
      status: 500,
    });

    const requestLogs = warnSpy.mock.calls.filter((call) => call[0] === "[acumatica]");
    expect(requestLogs).toHaveLength(1);
    expect(requestLogs[0]?.[1]).toMatchObject({
      status: 500,
      attempts: 1,
    });
  });
});

describe("Acumatica entity creation", () => {
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    setAcumaticaEnv();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  it("creates business accounts with PUT on the entity collection", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 200, body: { id: "abc" } }));

    const { createBusinessAccount } = await import("@/lib/acumatica");
    await createBusinessAccount("cookie", {
      Name: { value: "Alpha Inc" },
    });

    const requestUrl = String(fetchMock.mock.calls[0]?.[0]);
    const requestInit = fetchMock.mock.calls[0]?.[1];

    expect(requestUrl).toContain("/entity/lightspeed/24.200.001/BusinessAccount");
    expect(requestInit?.method).toBe("PUT");
  });

  it("creates contacts with PUT on the entity collection", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 200, body: { id: "contact" } }));

    const { createContact } = await import("@/lib/acumatica");
    await createContact("cookie", {
      DisplayName: { value: "Jane Doe" },
    });

    const requestUrl = String(fetchMock.mock.calls[0]?.[0]);
    const requestInit = fetchMock.mock.calls[0]?.[1];

    expect(requestUrl).toContain("/entity/lightspeed/24.200.001/Contact");
    expect(requestInit?.method).toBe("PUT");
  });

  it("falls back to a contact collection lookup when direct contact-id fetches fail", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          status: 500,
          body: { message: "Sequence contains more than one matching element" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: 200,
          body: [
            {
              id: "0fa8bd1d-a7ef-f011-8370-025dbe72350a",
              ContactID: { value: 157252 },
              DisplayName: { value: "Rayo Golwala" },
            },
          ],
        }),
      );

    const { fetchContactById } = await import("@/lib/acumatica");
    const result = await fetchContactById("cookie", 157252);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/Contact/157252");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/Contact?");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("157252");
    expect(result).toMatchObject({
      id: "0fa8bd1d-a7ef-f011-8370-025dbe72350a",
      ContactID: { value: 157252 },
    });
  });

  it("retries contact creation on the Default endpoint after the duplicate-match error", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          status: 500,
          body: { message: "Sequence contains more than one matching element" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ status: 200, body: { ContactID: { value: 157497 } } }),
      );

    const { createContact } = await import("@/lib/acumatica");
    await createContact("cookie", {
      BusinessAccount: { value: "B200002424" },
      CompanyName: { value: "Itipack Systems" },
      DisplayName: { value: "Johann D'Souza" },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/entity/lightspeed/24.200.001/Contact",
    );
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      "/entity/Default/24.200.001/Contact",
    );
  });

  it("retries contact creation without CompanyName when Acumatica still reports a duplicate match", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          status: 500,
          body: { message: "Sequence contains more than one matching element" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: 500,
          body: { message: "Sequence contains more than one matching element" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ status: 200, body: { ContactID: { value: 157497 } } }),
      );

    const { createContact } = await import("@/lib/acumatica");
    await createContact("cookie", {
      BusinessAccount: { value: "B200002424" },
      CompanyName: { value: "Itipack Systems" },
      Type: { value: "Contact" },
      DisplayName: { value: "Johann D'Souza" },
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const finalBody = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body));
    expect(finalBody.BusinessAccount).toEqual({ value: "B200002424" });
    expect(finalBody.DisplayName).toEqual({ value: "Johann D'Souza" });
    expect(finalBody).not.toHaveProperty("CompanyName");
    expect(finalBody.Type).toEqual({ value: "Contact" });
  });

  it("retries contact updates on the Default endpoint after the duplicate-match error", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          status: 500,
          body: { message: "Sequence contains more than one matching element" },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ status: 200, body: { ContactID: { value: 157497 } } }));

    const { updateContact } = await import("@/lib/acumatica");
    await updateContact("cookie", 157497, {
      BusinessAccount: { value: "B200002424" },
      CompanyName: { value: "Itipack Systems" },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/entity/lightspeed/24.200.001/Contact",
    );
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      "/entity/Default/24.200.001/Contact",
    );
  });

  it("retries contact updates without CompanyName when Acumatica still reports a duplicate match", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          status: 500,
          body: { message: "Sequence contains more than one matching element" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: 500,
          body: { message: "Sequence contains more than one matching element" },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ status: 200, body: { ContactID: { value: 157497 } } }));

    const { updateContact } = await import("@/lib/acumatica");
    await updateContact("cookie", 157497, {
      BusinessAccount: { value: "B200002424" },
      CompanyName: { value: "Itipack Systems" },
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const finalBody = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body));
    expect(finalBody.ContactID).toEqual({ value: 157497 });
    expect(finalBody.BusinessAccount).toEqual({ value: "B200002424" });
    expect(finalBody).not.toHaveProperty("CompanyName");
  });

  it("retries contact updates using the resolved Acumatica record id after duplicate-match failures", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          status: 500,
          body: { message: "Sequence contains more than one matching element" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: 500,
          body: { message: "Sequence contains more than one matching element" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: 200,
          body: [
            {
              id: "0fa8bd1d-a7ef-f011-8370-025dbe72350a",
              ContactID: { value: 157252 },
              DisplayName: { value: "Rayo Golwala" },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ status: 200, body: { ContactID: { value: 157252 } } }));

    const { updateContact } = await import("@/lib/acumatica");
    await updateContact("cookie", 157252, {
      note: { value: "Confirmed decision maker" },
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain("/Contact?");
    const finalBody = JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body));
    expect(finalBody.ContactID).toEqual({ value: 157252 });
    expect(finalBody.id).toBe("0fa8bd1d-a7ef-f011-8370-025dbe72350a");
    expect(finalBody.note).toEqual({ value: "Confirmed decision maker" });
  });

  it("prefers collection updates for business-account saves when requested", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 200, body: { id: "account" } }));

    const { updateBusinessAccount } = await import("@/lib/acumatica");
    await updateBusinessAccount(
      "cookie",
      ["B200001337", "94f9367f-472c-f111-8373-025dbe72350a"],
      {
        BusinessAccountID: { value: "B200001337" },
        ContactID: { value: 154474 },
      },
      undefined,
      {
        strategy: "body-first",
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/entity/lightspeed/24.200.001/BusinessAccount",
    );
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain(
      "/BusinessAccount/B200001337",
    );
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("PUT");
  });

  it("falls back to keyed business-account updates after collection update failures", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);

      if (url.includes("/BusinessAccount/B200001337")) {
        return jsonResponse({ status: 200, body: { id: "account" } });
      }

      if (url.endsWith("/BusinessAccount")) {
        return jsonResponse({ status: 500, body: { message: "Server error" } });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const { updateBusinessAccount } = await import("@/lib/acumatica");
    await updateBusinessAccount(
      "cookie",
      "B200001337",
      {},
      undefined,
      {
        strategy: "body-first",
      },
    );

    expect(fetchMock.mock.calls.some((call) =>
      String(call[0]).includes("/BusinessAccount/B200001337"),
    )).toBe(true);
  });

  it("creates opportunities with PUT on the configured opportunity entity before falling back", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: 200, body: { OpportunityID: { value: "000777" } } }),
    );

    const { createOpportunity } = await import("@/lib/acumatica");
    await createOpportunity("cookie", {
      Subject: { value: "Warehouse electrical upgrade" },
    });

    const requestUrl = String(fetchMock.mock.calls[0]?.[0]);
    const requestInit = fetchMock.mock.calls[0]?.[1];

    expect(requestUrl).toContain("/entity/lightspeed/24.200.001/Opportunity");
    expect(requestInit?.method).toBe("PUT");
  });

  it("falls back to POST when PUT is rejected on the configured opportunity entity", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ status: 405, body: { message: "Method not allowed" } }))
      .mockResolvedValueOnce(
        jsonResponse({ status: 200, body: { OpportunityID: { value: "000778" } } }),
      );

    const { createOpportunity } = await import("@/lib/acumatica");
    await createOpportunity("cookie", {
      Subject: { value: "Warehouse electrical upgrade" },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/Opportunity");
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("PUT");
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("POST");
  });
});

describe("readOpportunityId", () => {
  it("extracts wrapped OpportunityID", async () => {
    const { readOpportunityId } = await import("@/lib/acumatica");
    expect(readOpportunityId({ OpportunityID: { value: "000777" } })).toBe("000777");
  });

  it("extracts wrapped OpportunityId", async () => {
    const { readOpportunityId } = await import("@/lib/acumatica");
    expect(readOpportunityId({ OpportunityId: { value: "000778" } })).toBe("000778");
  });

  it("extracts wrapped OpportunityNbr", async () => {
    const { readOpportunityId } = await import("@/lib/acumatica");
    expect(readOpportunityId({ OpportunityNbr: { value: "000779" } })).toBe("000779");
  });

  it("extracts wrapped ID", async () => {
    const { readOpportunityId } = await import("@/lib/acumatica");
    expect(readOpportunityId({ ID: { value: "000780" } })).toBe("000780");
  });
});
