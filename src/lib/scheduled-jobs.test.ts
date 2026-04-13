import { describe, expect, it } from "vitest";

import {
  resolveScheduledCallActivityTargetDate,
  resolveScheduledDailyCallCoachingReportDate,
} from "@/lib/scheduled-jobs";

describe("scheduled-jobs", () => {
  it("targets the previous local day before the call-sync schedule window", () => {
    const result = resolveScheduledCallActivityTargetDate(
      new Date("2026-04-09T19:30:00.000Z"),
      "America/Toronto",
      17,
      0,
    );

    expect(result).toBe("2026-04-08");
  });

  it("targets the current local day once the call-sync schedule window opens", () => {
    const result = resolveScheduledCallActivityTargetDate(
      new Date("2026-04-09T21:30:00.000Z"),
      "America/Toronto",
      17,
      0,
    );

    expect(result).toBe("2026-04-09");
  });

  it("does not mark daily coaching due before the local schedule window", () => {
    const result = resolveScheduledDailyCallCoachingReportDate(
      new Date("2026-04-09T10:30:00.000Z"),
      "America/Toronto",
      7,
      0,
      1,
    );

    expect(result).toEqual({
      due: false,
      reportDate: "2026-04-08",
    });
  });

  it("marks daily coaching due after the local schedule window", () => {
    const result = resolveScheduledDailyCallCoachingReportDate(
      new Date("2026-04-09T12:30:00.000Z"),
      "America/Toronto",
      7,
      0,
      1,
    );

    expect(result).toEqual({
      due: true,
      reportDate: "2026-04-08",
    });
  });
});
