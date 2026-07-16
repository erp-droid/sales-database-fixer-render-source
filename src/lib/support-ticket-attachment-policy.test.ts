import { describe, expect, it } from "vitest";

import {
  isAllowedSupportAttachment,
  isRobotAnalyzableImage,
  normalizeSupportAttachmentMimeType,
  supportAttachmentStorageExtension,
} from "@/lib/support-ticket-attachment-policy";

describe("support ticket attachment policy", () => {
  it("accepts support evidence by MIME type or known extension", () => {
    expect(isAllowedSupportAttachment("screen.png", "image/png")).toBe(true);
    expect(isAllowedSupportAttachment("browser.log", "")).toBe(true);
    expect(isAllowedSupportAttachment("notes.exe", "application/octet-stream")).toBe(false);
  });

  it("normalizes common browser upload types", () => {
    expect(normalizeSupportAttachmentMimeType("photo.JPG", "application/octet-stream")).toBe("image/jpeg");
    expect(supportAttachmentStorageExtension("photo.JPG", "image/jpeg")).toBe(".jpg");
  });

  it("only sends API-supported image formats to the robot", () => {
    expect(isRobotAnalyzableImage("image/jpeg")).toBe(true);
    expect(isRobotAnalyzableImage("image/heic")).toBe(false);
    expect(isRobotAnalyzableImage("application/pdf")).toBe(false);
  });
});
