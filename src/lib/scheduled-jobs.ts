import { getReadModelDb } from "@/lib/read-model/db";

export type ScheduledJobName = "call_activity_sync" | "daily_call_coaching";
export type ScheduledJobRunStatus = "running" | "completed" | "failed";

export type ScheduledJobRunRecord = {
  jobName: ScheduledJobName;
  windowKey: string;
  status: ScheduledJobRunStatus;
  detail: string | null;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
};

type StoredScheduledJobRunRecord = {
  job_name: ScheduledJobName;
  window_key: string;
  status: ScheduledJobRunStatus;
  detail: string | null;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
};

function readLocalDateParts(
  date: Date,
  timeZone: string,
): {
  year: string;
  month: string;
  day: string;
  hour?: string;
  minute?: string;
} | null {
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const readPart = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  const year = readPart("year");
  const month = readPart("month");
  const day = readPart("day");
  if (!year || !month || !day) {
    return null;
  }

  return {
    year,
    month,
    day,
    hour: readPart("hour"),
    minute: readPart("minute"),
  };
}

export function formatLocalDateKey(date: Date, timeZone: string): string | null {
  const parts = readLocalDateParts(date, timeZone);
  if (!parts) {
    return null;
  }

  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function shiftDateKey(dateKey: string, offsetDays: number, timeZone: string): string | null {
  const [year, month, day] = String(dateKey)
    .split("-")
    .map((value) => Number.parseInt(value, 10));
  if (!year || !month || !day) {
    return null;
  }

  const shifted = new Date(Date.UTC(year, month - 1, day + offsetDays, 12, 0, 0));
  return formatLocalDateKey(shifted, timeZone);
}

export function resolveScheduledCallActivityTargetDate(
  now: Date,
  timeZone: string,
  scheduleHour: number,
  scheduleMinute: number,
): string | null {
  const localParts = readLocalDateParts(now, timeZone);
  const currentDateKey = formatLocalDateKey(now, timeZone);
  if (!localParts || !currentDateKey) {
    return null;
  }

  const localHour = Number.parseInt(localParts.hour ?? "", 10);
  const localMinute = Number.parseInt(localParts.minute ?? "", 10);
  if (!Number.isFinite(localHour) || !Number.isFinite(localMinute)) {
    return null;
  }

  const beforeSchedule =
    localHour < scheduleHour ||
    (localHour === scheduleHour && localMinute < scheduleMinute);
  return beforeSchedule
    ? shiftDateKey(currentDateKey, -1, timeZone)
    : currentDateKey;
}

export function resolveScheduledDailyCallCoachingReportDate(
  now: Date,
  timeZone: string,
  scheduleHour: number,
  scheduleMinute: number,
  lookbackDays: number,
): {
  due: boolean;
  reportDate: string | null;
} {
  const localParts = readLocalDateParts(now, timeZone);
  const currentDateKey = formatLocalDateKey(now, timeZone);
  if (!localParts || !currentDateKey) {
    return {
      due: false,
      reportDate: null,
    };
  }

  const localHour = Number.parseInt(localParts.hour ?? "", 10);
  const localMinute = Number.parseInt(localParts.minute ?? "", 10);
  if (!Number.isFinite(localHour) || !Number.isFinite(localMinute)) {
    return {
      due: false,
      reportDate: null,
    };
  }

  const due =
    localHour > scheduleHour ||
    (localHour === scheduleHour && localMinute >= scheduleMinute);

  return {
    due,
    reportDate: shiftDateKey(currentDateKey, -lookbackDays, timeZone),
  };
}

export function readScheduledJobRun(
  jobName: ScheduledJobName,
  windowKey: string,
): ScheduledJobRunRecord | null {
  const db = getReadModelDb();
  const row = db
    .prepare(
      `
      SELECT
        job_name,
        window_key,
        status,
        detail,
        started_at,
        completed_at,
        updated_at
      FROM scheduled_job_runs
      WHERE job_name = ?
        AND window_key = ?
      `,
    )
    .get(jobName, windowKey) as StoredScheduledJobRunRecord | undefined;

  if (!row) {
    return null;
  }

  return {
    jobName: row.job_name,
    windowKey: row.window_key,
    status: row.status,
    detail: row.detail,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
  };
}

export function writeScheduledJobRun(input: {
  jobName: ScheduledJobName;
  windowKey: string;
  status: ScheduledJobRunStatus;
  detail?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
}): ScheduledJobRunRecord {
  const db = getReadModelDb();
  const now = new Date().toISOString();
  const startedAt = input.startedAt ?? (input.status === "running" ? now : null);
  const completedAt = input.completedAt ?? (input.status === "completed" ? now : null);

  db.prepare(
    `
    INSERT INTO scheduled_job_runs (
      job_name,
      window_key,
      status,
      detail,
      started_at,
      completed_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(job_name, window_key) DO UPDATE SET
      status = excluded.status,
      detail = excluded.detail,
      started_at = excluded.started_at,
      completed_at = excluded.completed_at,
      updated_at = excluded.updated_at
    `,
  ).run(
    input.jobName,
    input.windowKey,
    input.status,
    input.detail ?? null,
    startedAt,
    completedAt,
    now,
  );

  return {
    jobName: input.jobName,
    windowKey: input.windowKey,
    status: input.status,
    detail: input.detail ?? null,
    startedAt,
    completedAt,
    updatedAt: now,
  };
}
