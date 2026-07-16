import { describe, expect, it } from "vitest";

import { newestEmployeeMessage } from "@/lib/support-ticket-worker";
import type { MailMessage } from "@/types/mail-thread";

function message(input: {
  id: string;
  direction: "incoming" | "outgoing";
  sentAt: string;
}): MailMessage {
  return {
    messageId: input.id,
    threadId: "thread-1",
    draftId: null,
    direction: input.direction,
    subject: "Support ticket",
    htmlBody: "",
    textBody: input.id,
    from: null,
    to: [],
    cc: [],
    bcc: [],
    sentAt: input.sentAt,
    receivedAt: null,
    unread: false,
    hasAttachments: false,
    activitySyncStatus: "not_linked",
  };
}

describe("newestEmployeeMessage", () => {
  const olderRobotMessage = message({
    id: "robot-ack",
    direction: "outgoing",
    sentAt: "2026-07-16T12:00:00.000Z",
  });
  const latestRobotMessage = message({
    id: "robot-update",
    direction: "outgoing",
    sentAt: "2026-07-16T12:01:00.000Z",
  });

  it("accepts a normal incoming employee reply", () => {
    const reply = message({
      id: "employee-reply",
      direction: "incoming",
      sentAt: "2026-07-16T12:02:00.000Z",
    });
    expect(newestEmployeeMessage(
      { employeeEmail: "employee@meadowb.com", lastIncomingMessageAt: null },
      [olderRobotMessage, reply],
      new Set(["robot-ack"]),
    )?.messageId).toBe("employee-reply");
  });

  it("accepts an unrecorded outgoing reply when the employee is the robot mailbox", () => {
    const selfReply = message({
      id: "jorge-manual-reply",
      direction: "outgoing",
      sentAt: "2026-07-16T12:02:00.000Z",
    });
    expect(newestEmployeeMessage(
      { employeeEmail: "jserrano@meadowb.com", lastIncomingMessageAt: null },
      [olderRobotMessage, latestRobotMessage, selfReply],
      new Set(["robot-ack", "robot-update"]),
      "jserrano@meadowb.com",
    )?.messageId).toBe("jorge-manual-reply");
  });

  it("does not treat an outgoing message as a reply for other employees", () => {
    expect(newestEmployeeMessage(
      { employeeEmail: "employee@meadowb.com", lastIncomingMessageAt: null },
      [olderRobotMessage, latestRobotMessage],
      new Set(["robot-ack"]),
      "jserrano@meadowb.com",
    )).toBeNull();
  });
});
