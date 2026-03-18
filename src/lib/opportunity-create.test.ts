import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function setOpportunityEnv(overrides?: Record<string, string | undefined>): void {
  process.env.AUTH_PROVIDER = "acumatica";
  process.env.ACUMATICA_BASE_URL = "https://example.acumatica.com";
  process.env.ACUMATICA_ENTITY_PATH = "/entity/lightspeed/24.200.001";
  process.env.ACUMATICA_COMPANY = "MeadowBrook Live";
  process.env.ACUMATICA_LOCALE = "en-US";
  process.env.AUTH_COOKIE_NAME = ".ASPXAUTH";
  process.env.AUTH_COOKIE_SECURE = "false";
  process.env.ACUMATICA_OPPORTUNITY_ENTITY = "Opportunity";
  process.env.ACUMATICA_OPPORTUNITY_CLASS_DEFAULT = "PRODUCTION";
  process.env.ACUMATICA_OPPORTUNITY_CLASS_SERVICE = "SERVICE";
  process.env.ACUMATICA_OPPORTUNITY_CLASS_GLENDALE = "GLENDALE";
  process.env.ACUMATICA_OPPORTUNITY_STAGE_DEFAULT = "Awaiting Estimate";
  process.env.ACUMATICA_OPPORTUNITY_LOCATION_DEFAULT = "MAIN";
  process.env.ACUMATICA_OPPORTUNITY_OWNER_DEFAULT = "Estimator Default";
  process.env.ACUMATICA_OPPORTUNITY_ESTIMATION_OFFSET_DAYS = "0";
  process.env.ACUMATICA_OPPORTUNITY_ATTR_WIN_JOB_ID =
    "Do you think we are going to win this job?";
  process.env.ACUMATICA_OPPORTUNITY_ATTR_LINK_TO_DRIVE_ID = "Link to Drive";
  process.env.ACUMATICA_OPPORTUNITY_ATTR_PROJECT_TYPE_ID = "Project Type";
  process.env.ACUMATICA_OPPORTUNITY_LINK_TO_DRIVE_DEFAULT = "Made using MB Quoting Page";

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

describe("opportunity create helpers", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    setOpportunityEnv();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  it("builds the configured required opportunity attributes", async () => {
    const { buildRequiredOpportunityAttributes } = await import(
      "@/lib/opportunity-create"
    );

    expect(
      buildRequiredOpportunityAttributes({
        willWinJob: "No",
        linkToDrive: "https://drive.google.com/test",
        projectType: "HVAC",
      }),
    ).toEqual([
      {
        AttributeID: { value: "Do you think we are going to win this job?" },
        Value: { value: "No" },
      },
      {
        AttributeID: { value: "Link to Drive" },
        Value: { value: "https://drive.google.com/test" },
      },
      {
        AttributeID: { value: "Project Type" },
        Value: { value: "HVAC" },
      },
    ]);
  });

  it("builds opportunity options from env defaults", async () => {
    vi.setSystemTime(new Date("2026-03-11T12:00:00.000Z"));
    const { buildOpportunityCreateOptions } = await import("@/lib/opportunity-create");

    expect(buildOpportunityCreateOptions()).toMatchObject({
      defaultClassId: "PRODUCTION",
      defaultStage: "Awaiting Estimate",
      defaultLocation: "MAIN",
      defaultOwnerName: "Estimator Default",
      defaultLinkToDrive: "",
      classOptions: [
        { value: "PRODUCTION", label: "PRODUCTION" },
        { value: "SERVICE", label: "SERVICE" },
        { value: "GLENDALE", label: "GLENDALE" },
      ],
    });
  });

  it("omits Owner when no estimator was selected", async () => {
    const { buildOpportunityCreatePayload } = await import("@/lib/opportunity-create");

    const payload = buildOpportunityCreatePayload({
      request: {
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
        ownerName: null,
      },
    });

    expect(payload).not.toHaveProperty("Owner");
  });

  it("includes Owner when an estimator was selected", async () => {
    const { buildOpportunityCreatePayload } = await import("@/lib/opportunity-create");

    const payload = buildOpportunityCreatePayload({
      request: {
        businessAccountRecordId: "record-1",
        businessAccountId: "02670D2595",
        contactId: 157497,
        subject: "Warehouse electrical upgrade",
        classId: "PRODUCTION",
        location: "MAIN",
        stage: "Awaiting Estimate",
        estimationDate: "2026-03-11T00:00:00.000Z",
        note: "Bring drawings",
        willWinJob: "Yes",
        linkToDrive: "https://drive.google.com/test",
        projectType: "Electrical",
        ownerId: "E0001",
        ownerName: "Jane Doe",
      },
      ownerValue: "Jane Doe",
    }) as Record<string, { value: string }>;

    expect(payload.Owner).toEqual({ value: "Jane Doe" });
    expect(payload.note).toEqual({ value: "Bring drawings" });
  });

  it("maps class, stage id, location, and estimation from the request", async () => {
    const { buildOpportunityCreatePayload } = await import("@/lib/opportunity-create");

    const payload = buildOpportunityCreatePayload({
      request: {
        businessAccountRecordId: "record-1",
        businessAccountId: "02670D2595",
        contactId: 157497,
        subject: "Warehouse electrical upgrade",
        classId: "SERVICE",
        location: "SECONDARY",
        stage: "Qualified",
        estimationDate: "2026-03-12T00:00:00.000Z",
        note: null,
        willWinJob: "Yes",
        linkToDrive: "https://drive.google.com/test",
        projectType: "Electrical",
        ownerId: null,
        ownerName: "Estimator Default",
      },
    }) as Record<string, { value: string }>;

    expect(payload.ClassID).toEqual({ value: "SERVICE" });
    expect(payload.StageID).toEqual({ value: "Qualified" });
    expect(payload.Location).toEqual({ value: "SECONDARY" });
    expect(payload.Estimation).toEqual({ value: "2026-03-12T00:00:00.000Z" });
  });

  it("falls back to the configured default stage when the request stage is blank", async () => {
    const { buildOpportunityCreatePayload } = await import("@/lib/opportunity-create");

    const payload = buildOpportunityCreatePayload({
      request: {
        businessAccountRecordId: "record-1",
        businessAccountId: "02670D2595",
        contactId: 157497,
        subject: "Warehouse electrical upgrade",
        classId: "SERVICE",
        location: "SECONDARY",
        stage: "   ",
        estimationDate: "2026-03-12T00:00:00.000Z",
        note: null,
        willWinJob: "Yes",
        linkToDrive: "https://drive.google.com/test",
        projectType: "Electrical",
        ownerId: null,
        ownerName: "Estimator Default",
      },
    }) as Record<string, { value: string }>;

    expect(payload.StageID).toEqual({ value: "Awaiting Estimate" });
  });
});
