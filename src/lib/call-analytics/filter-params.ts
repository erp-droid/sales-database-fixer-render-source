import type {
  CallDirectionFilter,
  CallOutcomeFilter,
  CallSourceFilter,
  DashboardFilters,
} from "@/lib/call-analytics/types";

type ParseDashboardFiltersOptions = {
  now?: number | string | Date;
};

function toIso(value: number): string {
  return new Date(value).toISOString();
}

function resolveNow(value: ParseDashboardFiltersOptions["now"]): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  if (value instanceof Date) {
    const numeric = value.getTime();
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }

  return Date.now();
}

function parseDateParam(value: string | null, fallback: number): string {
  if (!value) {
    return toIso(fallback);
  }

  const numeric = Date.parse(value);
  return Number.isFinite(numeric) ? new Date(numeric).toISOString() : toIso(fallback);
}

function parseEmployees(searchParams: URLSearchParams): string[] {
  const direct = searchParams.getAll("employee");
  const combined = direct.length > 0 ? direct : (searchParams.get("employees")?.split(",") ?? []);
  return [...new Set(combined.map((value) => value.trim().toLowerCase()).filter(Boolean))];
}

export function parseDashboardFilters(
  searchParams: URLSearchParams,
  options?: ParseDashboardFiltersOptions,
): DashboardFilters {
  const now = resolveNow(options?.now);
  const defaultStart = now - 30 * 24 * 60 * 60 * 1000;

  const directionValue = searchParams.get("direction");
  const outcomeValue = searchParams.get("outcome");
  const sourceValue = searchParams.get("source");

  return {
    start: parseDateParam(searchParams.get("start"), defaultStart),
    end: parseDateParam(searchParams.get("end"), now),
    employees: parseEmployees(searchParams),
    direction:
      directionValue === "outbound" || directionValue === "inbound"
        ? (directionValue as CallDirectionFilter)
        : "all",
    outcome:
      outcomeValue === "answered" ||
      outcomeValue === "unanswered" ||
      outcomeValue === "busy" ||
      outcomeValue === "failed" ||
      outcomeValue === "canceled"
        ? (outcomeValue as CallOutcomeFilter)
        : "all",
    source:
      sourceValue === "app" || sourceValue === "non_app"
        ? (sourceValue as CallSourceFilter)
        : "all",
    search: searchParams.get("search")?.trim() ?? "",
  };
}

export function buildDashboardQueryString(
  filters: DashboardFilters,
  options?: {
    page?: number | null;
    pageSize?: number | null;
    bucket?: "day" | "week" | null;
  },
): string {
  const params = new URLSearchParams();

  params.set("start", filters.start);
  params.set("end", filters.end);

  if (filters.direction !== "all") {
    params.set("direction", filters.direction);
  }
  if (filters.outcome !== "all") {
    params.set("outcome", filters.outcome);
  }
  if (filters.source !== "all") {
    params.set("source", filters.source);
  }
  if (filters.search.trim()) {
    params.set("search", filters.search.trim());
  }
  for (const employee of filters.employees) {
    if (employee.trim()) {
      params.append("employee", employee.trim().toLowerCase());
    }
  }

  if (typeof options?.page === "number" && Number.isFinite(options.page) && options.page > 1) {
    params.set("page", String(Math.trunc(options.page)));
  }
  if (
    typeof options?.pageSize === "number" &&
    Number.isFinite(options.pageSize) &&
    options.pageSize > 0
  ) {
    params.set("pageSize", String(Math.trunc(options.pageSize)));
  }
  if (options?.bucket) {
    params.set("bucket", options.bucket);
  }

  return params.toString();
}

export function formatDashboardDateInputValue(value: string): string {
  const numeric = Date.parse(value);
  if (!Number.isFinite(numeric)) {
    return "";
  }

  return new Date(numeric).toISOString().slice(0, 10);
}
