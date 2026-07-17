import type { SupportTicketRecord } from "@/lib/support-ticket-store";

export const MAX_CLARIFICATION_ROUNDS = 2;
export const MAX_CLARIFICATION_QUESTIONS = 3;

const QUESTION_WORDS = /^(?:about|what|which|where|when|who|how|did|do|does|is|are|can|could|was|were|has|have)\b/i;
const TECHNICAL_WORDS = /\b(?:api|backend|browser version|cache|commit|configuration|console|cookie|database|deployment|developer tools|diagnostic|endpoint|environment|error code|file path|frontend|github|health check|identifier|id|log|network|payload|render|repository|runtime|server|source code|sql|stack|sync|token|trace|url)\b/i;
const COMPOUND_QUESTION = /\b(?:and then|and also|as well as|or else)\b/i;

function cleanQuestion(value: string): string {
  return value
    .replace(/^\s*(?:\d+[.)]|[-*])\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function questionKey(value: string): string {
  return cleanQuestion(value).replace(/\?+$/, "").trim().toLowerCase();
}

export function isSimpleClarificationQuestion(value: string): boolean {
  const question = cleanQuestion(value);
  const words = question.replace(/[?!.]/g, "").split(/\s+/).filter(Boolean);
  return question.length >= 8 &&
    question.length <= 150 &&
    words.length <= 20 &&
    QUESTION_WORDS.test(question) &&
    !TECHNICAL_WORDS.test(question) &&
    !COMPOUND_QUESTION.test(question) &&
    !/[;:{}\[\]<>]/.test(question) &&
    (question.match(/\?/g)?.length ?? 0) <= 1;
}

export function normalizeClarificationQuestions(
  values: readonly string[],
  previousQuestions: readonly string[] = [],
): string[] {
  const previous = new Set(previousQuestions.map(questionKey));
  const selected: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const cleaned = cleanQuestion(value);
    const normalized = questionKey(cleaned);
    if (
      !isSimpleClarificationQuestion(cleaned) ||
      previous.has(normalized) ||
      seen.has(normalized)
    ) {
      continue;
    }
    seen.add(normalized);
    selected.push(cleaned.endsWith("?") ? cleaned : `${cleaned}?`);
    if (selected.length >= MAX_CLARIFICATION_QUESTIONS) {
      break;
    }
  }
  return selected;
}

function categoryQuestion(ticket: Pick<SupportTicketRecord, "category">): string {
  switch (ticket.category) {
    case "accounts":
      return "Which customer were you looking at?";
    case "contacts":
      return "Which person were you looking at?";
    case "mail":
      return "Which customer should the email appear under?";
    case "calendar":
      return "Which meeting or date has the problem?";
    case "calls":
      return "Which phone call has the problem?";
    case "quotes":
      return "Which quote or customer has the problem?";
    case "sign_in":
      return "What do you see after you try to sign in?";
    case "performance":
      return "Which page feels slow or does not open?";
    default:
      return "Which page were you on when the problem happened?";
  }
}

function scopeQuestion(ticket: Pick<SupportTicketRecord, "category">): string {
  switch (ticket.category) {
    case "accounts":
      return "Does this happen with one customer or every customer?";
    case "contacts":
      return "Does this happen with one person or every person?";
    case "mail":
      return "Does this happen with one email or every email?";
    case "calendar":
      return "Does this happen with one meeting or every meeting?";
    case "calls":
      return "Does this happen with one call or every call?";
    case "quotes":
      return "Does this happen with one quote or every quote?";
    case "performance":
      return "Does every page feel slow, or only one page?";
    default:
      return "Does the same problem happen every time?";
  }
}

export function fallbackClarificationQuestions(
  ticket: Pick<SupportTicketRecord, "category">,
  round: number,
  previousQuestions: readonly string[] = [],
): string[] {
  const candidates = round <= 0
    ? [
      categoryQuestion(ticket),
      "What were you trying to do?",
      "What did you see instead?",
    ]
    : [
      "Does the same problem happen when you try again?",
      scopeQuestion(ticket),
      "About what time did this last happen?",
    ];
  return normalizeClarificationQuestions(candidates, previousQuestions);
}

export function clarificationEmailParagraphs(questions: readonly string[]): string[] {
  return [
    "I need a little more information before I choose the safest next step.",
    "Please answer these short questions. If you are not sure, write “not sure.”",
    ...questions.map((question, index) => `${index + 1}. ${question}`),
  ];
}
