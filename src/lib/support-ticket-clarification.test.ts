import { describe, expect, it } from "vitest";

import {
  clarificationEmailParagraphs,
  fallbackClarificationQuestions,
  isSimpleClarificationQuestion,
  MAX_CLARIFICATION_QUESTIONS,
  MAX_CLARIFICATION_ROUNDS,
  normalizeClarificationQuestions,
} from "@/lib/support-ticket-clarification";

describe("support ticket clarification limits", () => {
  it("keeps the fixed email and question limits", () => {
    expect(MAX_CLARIFICATION_ROUNDS).toBe(2);
    expect(MAX_CLARIFICATION_QUESTIONS).toBe(3);
  });

  it("accepts one short question in basic language", () => {
    expect(isSimpleClarificationQuestion("What did you see after you clicked Save?")).toBe(true);
    expect(isSimpleClarificationQuestion("Does this happen with one email or every email?")).toBe(true);
  });

  it("rejects technical, compound, and long questions", () => {
    expect(isSimpleClarificationQuestion("Can you send the API log?")).toBe(false);
    expect(isSimpleClarificationQuestion("What did you click and also what did the next page show?")).toBe(false);
    expect(isSimpleClarificationQuestion(
      "What did you see after you opened the customer and pressed the button near the bottom of the page yesterday morning?",
    )).toBe(false);
  });

  it("removes repeated or invalid questions and returns no more than three", () => {
    expect(normalizeClarificationQuestions(
      [
        "What were you trying to do?",
        "Can you send the server log?",
        "What did you see instead?",
        "Does the same problem happen every time?",
        "When did this happen?",
      ],
      ["What were you trying to do?"],
    )).toEqual([
      "What did you see instead?",
      "Does the same problem happen every time?",
      "When did this happen?",
    ]);
  });

  it("uses different simple questions for each fallback round", () => {
    const first = fallbackClarificationQuestions({ category: "mail" }, 0);
    const second = fallbackClarificationQuestions({ category: "mail" }, 1, first);

    expect(first).toHaveLength(3);
    expect(second).toHaveLength(3);
    expect(first.every(isSimpleClarificationQuestion)).toBe(true);
    expect(second.every(isSimpleClarificationQuestion)).toBe(true);
    expect(second.some((question) => first.includes(question))).toBe(false);
  });

  it("tells the employee that not knowing an answer is acceptable", () => {
    const paragraphs = clarificationEmailParagraphs(["What did you see instead?"]);
    expect(paragraphs.join(" ")).toContain("not sure");
  });
});
