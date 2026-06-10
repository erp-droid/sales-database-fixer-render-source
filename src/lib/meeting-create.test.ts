import { describe, expect, it } from "vitest";

import {
  buildMeetingEventPayloadVariants,
  buildMeetingInviteAttendees,
  extractDeliverableMeetingEmail,
  findMeetingContactByEmail,
  findMeetingContactByLoginName,
  isDeliverableMeetingEmail,
  isMeetingOrganizerContactForLogin,
  normalizeMeetingLoginName,
} from "@/lib/meeting-create";
import type { MeetingContactOption, MeetingCreateRequest } from "@/types/meeting-create";

function buildContact(input: Partial<MeetingContactOption> & Pick<MeetingContactOption, "contactId" | "contactName" | "key">): MeetingContactOption {
  return {
    businessAccountId: null,
    businessAccountRecordId: null,
    companyName: null,
    email: null,
    isInternal: false,
    phone: null,
    ...input,
  };
}

describe("normalizeMeetingLoginName", () => {
  it("strips the email domain when present", () => {
    expect(normalizeMeetingLoginName("jserrano@meadowb.com")).toBe("jserrano");
  });

  it("normalizes plain login names", () => {
    expect(normalizeMeetingLoginName(" JSerrano ")).toBe("jserrano");
  });
});

describe("findMeetingContactByLoginName", () => {
  it("finds the internal meeting contact for a plain login name", () => {
    const contact = findMeetingContactByLoginName(
      [
        buildContact({
          key: "external",
          contactId: 1,
          contactName: "External Jorge",
          email: "jserrano@example.com",
          isInternal: false,
        }),
        buildContact({
          key: "internal",
          contactId: 2,
          contactName: "Jorge Serrano",
          email: "jserrano@meadowb.com",
          isInternal: true,
        }),
      ],
      "jserrano",
    );

    expect(contact?.contactId).toBe(2);
  });

  it("matches when the stored login value is already an email address", () => {
    const contact = findMeetingContactByLoginName(
      [
        buildContact({
          key: "internal",
          contactId: 2,
          contactName: "Jorge Serrano",
          email: "jserrano@meadowb.com",
          isInternal: true,
        }),
      ],
      "jserrano@meadowb.com",
    );

    expect(contact?.contactId).toBe(2);
  });

  it("returns null when only non-internal contacts match the login name", () => {
    const contact = findMeetingContactByLoginName(
      [
        buildContact({
          key: "external",
          contactId: 1,
          contactName: "External Jorge",
          email: "jserrano@example.com",
          isInternal: false,
        }),
      ],
      "jserrano",
    );

    expect(contact).toBeNull();
  });
});

describe("findMeetingContactByEmail", () => {
  it("matches contacts by normalized email address", () => {
    const contact = findMeetingContactByEmail(
      [
        buildContact({
          key: "internal",
          contactId: 2,
          contactName: "Jorge Serrano",
          email: "jserrano@meadowb.com",
          isInternal: true,
        }),
      ],
      " JSerrano@meadowb.com ",
    );

    expect(contact?.contactId).toBe(2);
  });
});

describe("isMeetingOrganizerContactForLogin", () => {
  it("matches an internal contact email to the stored login name", () => {
    expect(isMeetingOrganizerContactForLogin("jserrano@meadowb.com", "jserrano")).toBe(true);
  });

  it("rejects non-internal emails even when the local part matches", () => {
    expect(isMeetingOrganizerContactForLogin("jserrano@example.com", "jserrano")).toBe(false);
  });
});

describe("extractDeliverableMeetingEmail", () => {
  it("passes through valid addresses, normalized", () => {
    expect(extractDeliverableMeetingEmail(" Victor.Liu@Stellantis.com ")).toBe(
      "victor.liu@stellantis.com",
    );
  });

  it("extracts the address from display-name formats", () => {
    expect(extractDeliverableMeetingEmail("Alex Buhagiar <abuhagiar@meadowb.com>")).toBe(
      "abuhagiar@meadowb.com",
    );
  });

  it("takes the first deliverable address from separated lists", () => {
    expect(extractDeliverableMeetingEmail("first@example.com; second@example.com")).toBe(
      "first@example.com",
    );
    expect(extractDeliverableMeetingEmail("first@example.com, second@example.com")).toBe(
      "first@example.com",
    );
  });

  it("strips stray punctuation around addresses", () => {
    expect(extractDeliverableMeetingEmail("trailing.dot@example.com.")).toBe(
      "trailing.dot@example.com",
    );
    expect(extractDeliverableMeetingEmail("(wrapped@example.com)")).toBe("wrapped@example.com");
  });

  it("returns null when no deliverable address exists", () => {
    expect(extractDeliverableMeetingEmail("Alex Buhagiar")).toBeNull();
    expect(extractDeliverableMeetingEmail("double..dot@example.com")).toBeNull();
    expect(extractDeliverableMeetingEmail("")).toBeNull();
    expect(extractDeliverableMeetingEmail(null)).toBeNull();
  });
});

describe("isDeliverableMeetingEmail", () => {
  it("matches the server-side email validation", () => {
    expect(isDeliverableMeetingEmail("guest@example.com")).toBe(true);
    expect(isDeliverableMeetingEmail("trailing.dot@example.com.")).toBe(false);
    expect(isDeliverableMeetingEmail("Alex Buhagiar <abuhagiar@meadowb.com>")).toBe(false);
  });
});

describe("buildMeetingInviteAttendees", () => {
  it("extracts deliverable addresses from messy contact emails", () => {
    const attendees = buildMeetingInviteAttendees({
      contacts: [
        {
          contactId: 12,
          contactName: "Messy Email Contact",
          contactRecordId: "contact-12",
          email: "Messy Email Contact <messy@example.com>",
        },
        {
          contactId: 13,
          contactName: "No Email Contact",
          contactRecordId: "contact-13",
          email: "not-an-email",
        },
      ],
      attendeeEmails: [],
    });

    expect(attendees).toEqual([
      {
        contactId: 12,
        contactName: "Messy Email Contact",
        contactRecordId: "contact-12",
        email: "messy@example.com",
      },
    ]);
  });

  it("dedupes invite emails across contact-backed and direct-email attendees", () => {
    const attendees = buildMeetingInviteAttendees({
      contacts: [
        {
          contactId: 10,
          contactName: "Amy Vega",
          contactRecordId: "contact-10",
          email: "amy@example.com",
        },
        {
          contactId: 11,
          contactName: "Amy Vega Duplicate",
          contactRecordId: "contact-11",
          email: "AMY@example.com",
        },
      ],
      attendeeEmails: ["guest@example.com", " amy@example.com ", "guest@example.com"],
    });

    expect(attendees).toEqual([
      {
        contactId: 10,
        contactName: "Amy Vega",
        contactRecordId: "contact-10",
        email: "amy@example.com",
      },
      {
        contactId: null,
        contactName: null,
        contactRecordId: null,
        email: "guest@example.com",
      },
    ]);
  });
});

describe("buildMeetingEventPayloadVariants", () => {
  it("sends the selected Acumatica category literally", () => {
    const request: MeetingCreateRequest = {
      businessAccountRecordId: "record-1",
      businessAccountId: "BA0001",
      sourceContactId: 10,
      organizerContactId: null,
      includeOrganizerInAcumatica: false,
      relatedContactId: 10,
      category: "Drop Off",
      summary: "Material delivery",
      location: "Warehouse",
      timeZone: "America/Toronto",
      startDate: "2026-03-19",
      startTime: "09:00",
      endDate: "2026-03-19",
      endTime: "10:00",
      priority: "Normal",
      details: "Leave samples at reception.",
      attendeeContactIds: [10],
      attendeeEmails: ["guest@example.com"],
    };

    const payload = buildMeetingEventPayloadVariants({
      attendees: [
        {
          contactId: 10,
          contactName: "Jacky Lee",
          contactRecordId: "contact-note-10",
          email: "jacky.lee@example.com",
        },
      ],
      relatedContactRecordId: "contact-note-10",
      request,
    })[0] as Record<string, { value?: unknown }>;

    expect(payload.Category).toEqual({ value: "Drop Off" });
  });
});
