import type { BusinessAccountRow } from "@/types/business-account";

export type AppVariant = "meadowbrook" | "glendale";

export type AppBranding = {
  variant: AppVariant;
  companyName: string;
  appTitle: string;
  mapSubtitle: string;
  mailLabel: string;
  employeeLabel: string;
  teamMemberLabel: string;
  logoSrc: string;
  logoAlt: string;
  logoWidth: number;
  logoHeight: number;
  defaultUserInitials: string;
  storageNamespace: string;
};

function normalizeVariant(value: string | null | undefined): AppVariant {
  const normalized = value?.trim().toLowerCase();
  return normalized === "glendale" ? "glendale" : "meadowbrook";
}

export function getAppVariant(): AppVariant {
  return normalizeVariant(
    process.env.NEXT_PUBLIC_APP_VARIANT ?? process.env.APP_VARIANT,
  );
}

export function getAppBranding(): AppBranding {
  const variant = getAppVariant();

  if (variant === "glendale") {
    return {
      variant,
      companyName: "Glendale",
      appTitle: "Sales Glendale",
      mapSubtitle: "Sales Glendale Map",
      mailLabel: "Glendale Mail",
      employeeLabel: "Glendale employee",
      teamMemberLabel: "Glendale team member",
      logoSrc: "/glendale-logo.png",
      logoAlt: "Glendale",
      logoWidth: 210,
      logoHeight: 50,
      defaultUserInitials: "GL",
      storageNamespace: "glendale",
    };
  }

  return {
    variant,
    companyName: "MeadowBrook",
    appTitle: "Sales MeadowBrook",
    mapSubtitle: "Sales MeadowBrook Map",
    mailLabel: "MeadowBrook Mail",
    employeeLabel: "MeadowBrook employee",
    teamMemberLabel: "MeadowBrook team member",
    logoSrc: "/mb-logo.png",
    logoAlt: "MeadowBrook",
    logoWidth: 478,
    logoHeight: 136,
    defaultUserInitials: "MB",
    storageNamespace: "meadowbrook",
  };
}

function matchesGlendaleSalesRepName(value: string | null | undefined): boolean {
  return value?.toLowerCase().includes("travis") ?? false;
}

export function isBusinessAccountRowVisibleForCurrentVariant(
  row: Pick<BusinessAccountRow, "salesRepName">,
): boolean {
  const isGlendaleAccount = matchesGlendaleSalesRepName(row.salesRepName);
  return getAppVariant() === "glendale" ? isGlendaleAccount : !isGlendaleAccount;
}

export function filterRowsForCurrentVariant<T extends Pick<BusinessAccountRow, "salesRepName">>(
  rows: readonly T[],
): T[] {
  return rows.filter((row) => isBusinessAccountRowVisibleForCurrentVariant(row));
}
