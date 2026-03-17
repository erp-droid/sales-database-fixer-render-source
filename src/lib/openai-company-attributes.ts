import { getEnv } from "@/lib/env";
import { HttpError } from "@/lib/errors";
import {
  CATEGORY_OPTIONS,
  INDUSTRY_TYPE_OPTIONS,
  SUB_CATEGORY_OPTIONS,
  normalizeOptionValue,
  type AttributeOption,
} from "@/lib/business-account-create";
import { resolveExactBusinessAccountRegion } from "@/lib/business-account-region-resolution";
import { normalizeBusinessAccountRegionValue } from "@/lib/business-account-region-values";
import type {
  CompanyAttributeSuggestion,
  CompanyAttributeSuggestionRequest,
  CompanyAttributeSuggestionResponse,
  CompanyAttributeSuggestionSource,
} from "@/types/company-attribute-suggestion";

const OPENAI_COMPANY_ATTRIBUTE_MODEL_DEFAULT = "gpt-4o-mini";
const NO_SELECTION = "NONE";

const CATEGORY_VALUES = [...CATEGORY_OPTIONS.map((option) => option.value), NO_SELECTION];
const INDUSTRY_TYPE_VALUES = [...INDUSTRY_TYPE_OPTIONS.map((option) => option.value), NO_SELECTION];
const SUB_CATEGORY_VALUES = [...SUB_CATEGORY_OPTIONS.map((option) => option.value), NO_SELECTION];
const CONFIDENCE_VALUES = ["low", "medium", "high"] as const;

type OpenAiTextAnnotation = {
  title?: unknown;
  url?: unknown;
};

type OpenAiTextContent = {
  text?: unknown;
  annotations?: unknown;
};

type OpenAiOutputItem = {
  type?: unknown;
  content?: unknown;
  action?: unknown;
};

type OpenAiResponsePayload = {
  error?: unknown;
  output?: unknown;
};

type RawCompanyAttributeSuggestion = {
  category?: unknown;
  industryType?: unknown;
  subCategory?: unknown;
  confidence?: unknown;
  reasoning?: unknown;
};

function readText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readOpenAiApiKey(): string {
  const apiKey = getEnv().OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new HttpError(503, "OpenAI is not configured for company attribute suggestions.");
  }

  return apiKey;
}

function readOpenAiCompanyAttributeModel(): string {
  return getEnv().OPENAI_SUMMARY_MODEL?.trim() || OPENAI_COMPANY_ATTRIBUTE_MODEL_DEFAULT;
}

function parseOpenAiError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") {
    return fallback;
  }

  const record = payload as Record<string, unknown>;
  const directError = readText(record.error);
  if (directError) {
    return directError;
  }

  const nestedError =
    record.error && typeof record.error === "object"
      ? readText((record.error as Record<string, unknown>).message)
      : null;
  return nestedError ?? fallback;
}

function mapOpenAiError(status: number, payload: unknown): HttpError {
  const fallback = parseOpenAiError(payload, "OpenAI rejected the company attribute request.");

  if (status === 400) {
    return new HttpError(502, fallback);
  }

  if (status === 401 || status === 403) {
    return new HttpError(
      502,
      "OpenAI rejected the API key or this project cannot use company attribute suggestions.",
    );
  }

  if (status === 429) {
    return new HttpError(429, "OpenAI rate limited this request. Wait a moment and try again.");
  }

  if (status >= 500) {
    return new HttpError(502, "OpenAI is unavailable right now. Try again later.");
  }

  return new HttpError(502, fallback);
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function readEmailDomain(value: string | null | undefined): string | null {
  const email = readText(value);
  if (!email) {
    return null;
  }

  const atIndex = email.lastIndexOf("@");
  if (atIndex < 0) {
    return null;
  }

  const domain = email.slice(atIndex + 1).trim().toLowerCase();
  return domain || null;
}

function readUrlDomain(value: string | null | undefined): string | null {
  const url = readText(value);
  if (!url) {
    return null;
  }

  try {
    const hostname = new URL(url).hostname.trim().toLowerCase();
    return hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

function normalizeCountryCode(value: string | null | undefined): string | null {
  const country = readText(value)?.toUpperCase() ?? null;
  if (!country) {
    return null;
  }

  if (country === "CAN") {
    return "CA";
  }

  if (country === "USA") {
    return "US";
  }

  return country.length > 2 ? country.slice(0, 2) : country;
}

function buildOptionGuide(options: AttributeOption[]): string {
  return options
    .map((option) => {
      const aliases = option.aliases?.length ? ` (aliases: ${option.aliases.join(", ")})` : "";
      return `- ${option.value} = ${option.label}${aliases}`;
    })
    .join("\n");
}

export function buildCompanyAttributeSuggestionInput(
  request: CompanyAttributeSuggestionRequest,
): string {
  const emailDomain = readEmailDomain(request.contactEmail);
  const location = [request.city, request.state, request.country]
    .map((value) => readText(value))
    .filter(Boolean)
    .join(", ");
  const address = [request.addressLine1, request.postalCode]
    .map((value) => readText(value))
    .filter(Boolean)
    .join(", ");

  const contextLines = [
    "Classify this company into MeadowBrook Acumatica attribute values using current public web information.",
    "Be conservative. If the evidence is weak, conflicting, or too generic, return NONE for that field.",
    "Category is an internal A/B/C/D client tier. Only suggest it when public evidence clearly supports a tier; otherwise return NONE.",
    "Use General only when a company does not clearly fit any narrower sub-category.",
    "",
    `Company name: ${readText(request.companyName) ?? "Unknown"}`,
    `Business account ID: ${readText(request.businessAccountId) ?? "Unknown"}`,
    `Address hint: ${address || "Unknown"}`,
    `Location hint: ${location || "Unknown"}`,
    `Email domain hint: ${emailDomain ?? "Unknown"}`,
    `Current Company Region: ${readText(request.companyRegion) ?? "Missing"}`,
    `Current Industry Type: ${readText(request.industryType) ?? "Missing"}`,
    `Current Sub-Category: ${readText(request.subCategory) ?? "Missing"}`,
    `Current Category: ${readText(request.category) ?? "Missing"}`,
    "",
    "Allowed Category values:",
    buildOptionGuide(CATEGORY_OPTIONS),
    `- ${NO_SELECTION} = no confident category suggestion`,
    "",
    "Allowed Industry Type values:",
    buildOptionGuide(INDUSTRY_TYPE_OPTIONS),
    `- ${NO_SELECTION} = no confident industry type suggestion`,
    "",
    "Allowed Sub-Category values:",
    buildOptionGuide(SUB_CATEGORY_OPTIONS),
    `- ${NO_SELECTION} = no confident sub-category suggestion`,
    "",
    "Return only the closest allowed values. Never invent a company website, product line, or market segment.",
  ];

  return contextLines.join("\n");
}

function buildWebSearchTool(request: CompanyAttributeSuggestionRequest): Record<string, unknown> {
  const city = readText(request.city);
  const region = readText(request.state);
  const country = normalizeCountryCode(request.country);
  const userLocation =
    city || region || country
      ? {
          type: "approximate",
          ...(city ? { city } : {}),
          ...(region ? { region } : {}),
          ...(country ? { country } : {}),
        }
      : null;

  return {
    type: "web_search",
    ...(userLocation ? { user_location: userLocation } : {}),
  };
}

function readOutputItems(payload: unknown): OpenAiOutputItem[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const output = (payload as OpenAiResponsePayload).output;
  return Array.isArray(output) ? (output as OpenAiOutputItem[]) : [];
}

function readOutputText(payload: unknown): string | null {
  for (const item of readOutputItems(payload)) {
    const content = Array.isArray(item.content) ? (item.content as OpenAiTextContent[]) : [];
    for (const contentItem of content) {
      const text = readText(contentItem.text);
      if (text) {
        return text;
      }
    }
  }

  return null;
}

function toSource(
  titleValue: unknown,
  urlValue: unknown,
): CompanyAttributeSuggestionSource | null {
  const title = readText(titleValue);
  const url = readText(urlValue);
  if (!title || !url) {
    return null;
  }

  return {
    title,
    url,
    domain: readUrlDomain(url),
  };
}

function readResponseSources(payload: unknown): CompanyAttributeSuggestionSource[] {
  const sources: CompanyAttributeSuggestionSource[] = [];

  for (const item of readOutputItems(payload)) {
    const action = item.action && typeof item.action === "object"
      ? (item.action as Record<string, unknown>)
      : null;
    const rawSources = action && Array.isArray(action.sources) ? action.sources : [];
    for (const rawSource of rawSources) {
      if (!rawSource || typeof rawSource !== "object") {
        continue;
      }

      const source = toSource(
        (rawSource as Record<string, unknown>).title,
        (rawSource as Record<string, unknown>).url,
      );
      if (source) {
        sources.push(source);
      }
    }

    const content = Array.isArray(item.content) ? (item.content as OpenAiTextContent[]) : [];
    for (const contentItem of content) {
      const annotations = Array.isArray(contentItem.annotations)
        ? (contentItem.annotations as OpenAiTextAnnotation[])
        : [];
      for (const annotation of annotations) {
        const source = toSource(annotation.title, annotation.url);
        if (source) {
          sources.push(source);
        }
      }
    }
  }

  const deduped = new Map<string, CompanyAttributeSuggestionSource>();
  for (const source of sources) {
    if (!deduped.has(source.url)) {
      deduped.set(source.url, source);
    }
  }

  return [...deduped.values()].slice(0, 5);
}

function normalizeSuggestedValue(
  options: AttributeOption[],
  value: unknown,
): string | null {
  const text = readText(value);
  if (!text || text.toUpperCase() === NO_SELECTION) {
    return null;
  }

  const normalized = normalizeOptionValue(options, text);
  return options.some((option) => option.value === normalized) ? normalized : null;
}

function readOptionLabel(options: AttributeOption[], value: string | null): string | null {
  if (!value) {
    return null;
  }

  return options.find((option) => option.value === value)?.label ?? null;
}

export function mapOpenAiCompanyAttributeSuggestion(
  rawSuggestion: RawCompanyAttributeSuggestion,
  sources: CompanyAttributeSuggestionSource[],
  request: CompanyAttributeSuggestionRequest,
): CompanyAttributeSuggestionResponse {
  const mappedRegion = resolveExactBusinessAccountRegion(request.postalCode)?.region ?? null;
  const companyRegion = normalizeBusinessAccountRegionValue(mappedRegion);
  const category = normalizeSuggestedValue(CATEGORY_OPTIONS, rawSuggestion.category);
  const industryType = normalizeSuggestedValue(
    INDUSTRY_TYPE_OPTIONS,
    rawSuggestion.industryType,
  );
  const subCategory = normalizeSuggestedValue(
    SUB_CATEGORY_OPTIONS,
    rawSuggestion.subCategory,
  );
  const reasoning =
    readText(rawSuggestion.reasoning) ??
    "OpenAI could not provide a confident company classification from public web results.";
  const confidence = CONFIDENCE_VALUES.includes(rawSuggestion.confidence as never)
    ? (rawSuggestion.confidence as CompanyAttributeSuggestion["confidence"])
    : "low";

  if (!companyRegion && !category && !industryType && !subCategory) {
    return {
      status: "no_match",
      message: reasoning,
    };
  }

  const filledFieldKeys: Array<"industryType" | "subCategory" | "category" | "companyRegion"> = [];
  if (!readText(request.companyRegion) && companyRegion) {
    filledFieldKeys.push("companyRegion");
  }
  if (!readText(request.category) && category) {
    filledFieldKeys.push("category");
  }
  if (!readText(request.industryType) && industryType) {
    filledFieldKeys.push("industryType");
  }
  if (!readText(request.subCategory) && subCategory) {
    filledFieldKeys.push("subCategory");
  }

  return {
    status: "ready",
    suggestion: {
      companyRegion,
      companyRegionLabel: companyRegion,
      category,
      categoryLabel: readOptionLabel(CATEGORY_OPTIONS, category),
      industryType,
      industryTypeLabel: readOptionLabel(INDUSTRY_TYPE_OPTIONS, industryType),
      subCategory,
      subCategoryLabel: readOptionLabel(SUB_CATEGORY_OPTIONS, subCategory),
      confidence,
      reasoning,
      sources,
    },
    filledFieldKeys,
  };
}

export async function suggestCompanyAttributesWithOpenAi(
  request: CompanyAttributeSuggestionRequest,
): Promise<CompanyAttributeSuggestionResponse> {
  const companyName = readText(request.companyName);
  const emailDomain = readEmailDomain(request.contactEmail);
  if (!companyName && !emailDomain) {
    return {
      status: "need_more_context",
      message: "Add a company name or contact email before asking OpenAI to classify attributes.",
    };
  }

  const apiKey = readOpenAiApiKey();
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: readOpenAiCompanyAttributeModel(),
      tools: [buildWebSearchTool(request)],
      include: ["web_search_call.action.sources"],
      input: [
        {
          role: "system",
          content:
            "You classify companies into a fixed CRM taxonomy. Use web search results, stay factual, and return strict JSON only.",
        },
        {
          role: "user",
          content: buildCompanyAttributeSuggestionInput(request),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "company_attribute_suggestion",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["category", "industryType", "subCategory", "confidence", "reasoning"],
            properties: {
              category: {
                type: "string",
                enum: CATEGORY_VALUES,
              },
              industryType: {
                type: "string",
                enum: INDUSTRY_TYPE_VALUES,
              },
              subCategory: {
                type: "string",
                enum: SUB_CATEGORY_VALUES,
              },
              confidence: {
                type: "string",
                enum: [...CONFIDENCE_VALUES],
              },
              reasoning: {
                type: "string",
              },
            },
          },
        },
      },
      max_output_tokens: 500,
    }),
    cache: "no-store",
  });

  const bodyText = await response.text();
  const payload = parseJsonObject(bodyText);

  if (!response.ok) {
    throw mapOpenAiError(response.status, payload);
  }

  if (!payload) {
    throw new HttpError(502, "OpenAI returned an unexpected response.");
  }

  const suggestionText = readOutputText(payload);
  const suggestionPayload = suggestionText ? parseJsonObject(suggestionText) : null;
  if (!suggestionPayload) {
    throw new HttpError(502, "OpenAI returned an unexpected response.");
  }

  return mapOpenAiCompanyAttributeSuggestion(
    suggestionPayload as RawCompanyAttributeSuggestion,
    readResponseSources(payload),
    request,
  );
}
