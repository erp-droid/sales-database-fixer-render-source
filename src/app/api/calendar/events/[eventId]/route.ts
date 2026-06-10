export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";

import { requireStoredLoginName } from "@/lib/auth";
import { HttpError, getErrorMessage } from "@/lib/errors";
import {
  deleteCalendarEventInGoogleCalendar,
  updateCalendarEventInGoogleCalendar,
} from "@/lib/google-calendar";
import type { CalendarEventUpdateResponse } from "@/types/google-calendar";

const isoInstantSchema = z
  .string()
  .trim()
  .refine((value) => Number.isFinite(Date.parse(value)), {
    message: "Must be a valid ISO date-time.",
  })
  .transform((value) => new Date(Date.parse(value)).toISOString());

const allDayDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "All-day dates must use YYYY-MM-DD format.");

const nullableTrimmedStringSchema = (maxLength: number) =>
  z
    .union([z.string().trim().max(maxLength), z.null()])
    .optional()
    .transform((value) => {
      if (typeof value === "string") {
        return value.trim() || null;
      }

      return value;
    });

const calendarEventUpdateSchema = z
  .object({
    startDateTime: isoInstantSchema.optional(),
    endDateTime: isoInstantSchema.optional(),
    startDate: allDayDateSchema.optional(),
    endDate: allDayDateSchema.optional(),
    summary: z.string().trim().min(1, "Title is required.").max(1024).optional(),
    location: nullableTrimmedStringSchema(1024),
    description: nullableTrimmedStringSchema(8192),
    attendees: z
      .array(
        z.object({
          email: z.string().trim().email("Guest email addresses must be valid."),
          displayName: nullableTrimmedStringSchema(256),
        }),
      )
      .optional(),
    recurrence: z
      .union([
        z
          .array(
            z
              .string()
              .trim()
              .regex(/^RRULE:FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(;INTERVAL=\d{1,2})?(;BYDAY=(SU|MO|TU|WE|TH|FR|SA)(,(SU|MO|TU|WE|TH|FR|SA))*)?$/, "Unsupported recurrence rule."),
          )
          .max(1),
        z.null(),
      ])
      .optional(),
    reminders: z
      .object({
        useDefault: z.boolean(),
        minutes: z.coerce.number().int().min(0).max(40320).nullable().optional(),
      })
      .optional(),
    colorId: z
      .union([z.enum(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"]), z.null()])
      .optional(),
    guestsCanModify: z.boolean().optional(),
    guestsCanInviteOthers: z.boolean().optional(),
    guestsCanSeeOtherGuests: z.boolean().optional(),
    transparency: z.enum(["opaque", "transparent"]).optional(),
    visibility: z.enum(["default", "public", "private", "confidential"]).optional(),
    includeGoogleMeet: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    const hasTimedStart = value.startDateTime !== undefined;
    const hasTimedEnd = value.endDateTime !== undefined;
    const hasAllDayStart = value.startDate !== undefined;
    const hasAllDayEnd = value.endDate !== undefined;
    const hasTimedUpdate = hasTimedStart || hasTimedEnd;
    const hasAllDayUpdate = hasAllDayStart || hasAllDayEnd;
    const hasDetailsUpdate =
      value.summary !== undefined ||
      value.location !== undefined ||
      value.description !== undefined ||
      value.attendees !== undefined ||
      value.recurrence !== undefined ||
      value.reminders !== undefined ||
      value.colorId !== undefined ||
      value.guestsCanModify !== undefined ||
      value.guestsCanInviteOthers !== undefined ||
      value.guestsCanSeeOtherGuests !== undefined ||
      value.transparency !== undefined ||
      value.visibility !== undefined ||
      value.includeGoogleMeet !== undefined;

    if (hasTimedUpdate && hasAllDayUpdate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Update either timed fields or all-day fields, not both.",
      });
    }

    if (hasTimedUpdate && (!hasTimedStart || !hasTimedEnd)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Timed updates require both start and end.",
      });
    } else if (
      hasTimedUpdate &&
      value.startDateTime &&
      value.endDateTime &&
      Date.parse(value.endDateTime) <= Date.parse(value.startDateTime)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "The event end must be after the start.",
      });
    }

    if (hasAllDayUpdate && (!hasAllDayStart || !hasAllDayEnd)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "All-day updates require both start and end dates.",
      });
    } else if (hasAllDayUpdate && value.startDate && value.endDate && value.endDate <= value.startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "The all-day end date must be after the start date.",
      });
    }

    if (!hasTimedUpdate && !hasAllDayUpdate && !hasDetailsUpdate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide at least one event field to update.",
      });
    }
  });

type RouteContext = {
  params: Promise<{ eventId: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const storedLoginName = requireStoredLoginName(request);
    const { eventId } = await context.params;
    if (!eventId?.trim()) {
      throw new HttpError(400, "Event id is required.");
    }

    const body = await request.json().catch(() => {
      throw new HttpError(400, "Request body must be valid JSON.");
    });
    const update = calendarEventUpdateSchema.parse(body);

    const event = await updateCalendarEventInGoogleCalendar(storedLoginName, {
      eventId: eventId.trim(),
      ...(update.startDate && update.endDate
        ? { start: { date: update.startDate }, end: { date: update.endDate } }
        : {}),
      ...(update.startDateTime && update.endDateTime
        ? { start: { dateTime: update.startDateTime }, end: { dateTime: update.endDateTime } }
        : {}),
      ...(update.summary !== undefined ? { summary: update.summary } : {}),
      ...(update.location !== undefined ? { location: update.location } : {}),
      ...(update.description !== undefined ? { description: update.description } : {}),
      ...(update.attendees !== undefined ? { attendees: update.attendees } : {}),
      ...(update.recurrence !== undefined ? { recurrence: update.recurrence } : {}),
      ...(update.reminders !== undefined ? { reminders: update.reminders } : {}),
      ...(update.colorId !== undefined ? { colorId: update.colorId } : {}),
      ...(update.guestsCanModify !== undefined
        ? { guestsCanModify: update.guestsCanModify }
        : {}),
      ...(update.guestsCanInviteOthers !== undefined
        ? { guestsCanInviteOthers: update.guestsCanInviteOthers }
        : {}),
      ...(update.guestsCanSeeOtherGuests !== undefined
        ? { guestsCanSeeOtherGuests: update.guestsCanSeeOtherGuests }
        : {}),
      ...(update.transparency !== undefined ? { transparency: update.transparency } : {}),
      ...(update.visibility !== undefined ? { visibility: update.visibility } : {}),
      ...(update.includeGoogleMeet !== undefined
        ? { includeGoogleMeet: update.includeGoogleMeet }
        : {}),
    });

    const responseBody: CalendarEventUpdateResponse = { event };
    return NextResponse.json(responseBody);
  } catch (error) {
    if (error instanceof ZodError) {
      const firstIssue = error.issues[0]?.message ?? "Invalid calendar event update payload.";
      return NextResponse.json(
        { error: firstIssue, details: error.flatten() },
        { status: 400 },
      );
    }
    if (error instanceof HttpError) {
      return NextResponse.json(
        { error: error.message, details: error.details },
        { status: error.status },
      );
    }

    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const storedLoginName = requireStoredLoginName(request);
    const { eventId } = await context.params;
    if (!eventId?.trim()) {
      throw new HttpError(400, "Event id is required.");
    }

    await deleteCalendarEventInGoogleCalendar(storedLoginName, eventId.trim());
    return NextResponse.json({ deleted: true });
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json(
        { error: error.message, details: error.details },
        { status: error.status },
      );
    }

    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
