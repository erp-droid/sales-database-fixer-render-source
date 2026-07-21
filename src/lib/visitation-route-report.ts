import { buildAddressKeyFromRow } from "@/lib/read-model/geocodes";
import {
  findAuthoritativeVisitationRouteSchedule,
  matchAccountsToAuthoritativeSchedule,
  type AuthoritativeVisitationRouteSchedule,
} from "@/lib/visitation-route-schedule";
import type { BusinessAccountRow } from "@/types/business-account";

export const VISITATION_ROUTE_WEEK_COUNT = 12;
export const VISITATION_ROUTE_DAY_COUNT = 5;
export const VISITATION_ROUTE_MIN_ACCOUNTS_PER_DAY = 10;

export type VisitationRouteGeocode = {
  latitude: number;
  longitude: number;
};

export type VisitationRouteAccount = {
  accountRecordId: string;
  businessAccountId: string;
  companyName: string;
  address: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  companyPhone: string;
  contactName: string;
  contactJobTitle: string;
  contactPhone: string;
  contactExtension: string;
  contactEmail: string;
  category: "A" | "B";
  salesRepId: string;
  salesRepName: string;
  assignedWeek: number | null;
  latitude: number | null;
  longitude: number | null;
};

export type VisitationRouteDay = {
  week: number;
  day: number;
  accounts: VisitationRouteAccount[];
  estimatedDistanceKm: number;
};

export type VisitationRoutePlan = {
  salesRepId: string;
  salesRepName: string;
  generatedAt: string;
  accountTotal: number;
  mappedAccountTotal: number;
  unmappedAccountTotal: number;
  estimatedDistanceKm: number;
  days: VisitationRouteDay[];
  scheduleDiagnostics: VisitationRouteScheduleDiagnostics | null;
};

export type VisitationRouteScheduleDiagnostics = {
  scheduleId: string;
  scheduleVersion: string;
  referenceAccountTotal: number;
  matchedScheduledAccountTotal: number;
  missingReferenceAccountTotal: number;
  newlyPlacedAccountTotal: number;
};

export type VisitationRouteSalesRepOption = {
  id: string;
  name: string;
  accountCount: number;
};

type ProjectedAccount = VisitationRouteAccount & {
  x: number;
  y: number;
};

type ProjectedCenter = { x: number; y: number };

function normalizeText(value: string | null | undefined): string {
  return value?.trim() ?? "";
}
function normalizeComparable(value: string | null | undefined): string {
  return normalizeText(value).toLocaleLowerCase();
}

function accountIdentity(row: BusinessAccountRow): string {
  return (
    normalizeText(row.accountRecordId) ||
    normalizeText(row.id) ||
    normalizeText(row.businessAccountId) ||
    `${normalizeComparable(row.companyName)}|${buildAddressKeyFromRow(row)}`
  );
}

function mostCommonValue(values: Array<string | null | undefined>): string {
  const entries = new Map<string, { count: number; value: string }>();
  for (const rawValue of values) {
    const value = normalizeText(rawValue);
    if (!value) {
      continue;
    }
    const key = normalizeComparable(value);
    const current = entries.get(key);
    entries.set(key, { count: (current?.count ?? 0) + 1, value: current?.value ?? value });
  }
  return (
    [...entries.values()].sort(
      (left, right) => right.count - left.count || left.value.localeCompare(right.value),
    )[0]?.value ?? ""
  );
}

function categoryForRows(rows: BusinessAccountRow[]): "A" | "B" | null {
  const category = mostCommonValue(rows.map((row) => row.category)).toUpperCase();
  return category === "A" || category === "B" ? category : null;
}

function parseAssignedWeek(value: string | null | undefined): number | null {
  const match = normalizeText(value).match(/^week\s*(\d+)$/i);
  if (!match) {
    return null;
  }
  const week = Number.parseInt(match[1] ?? "", 10);
  return Number.isInteger(week) && week >= 1 && week <= VISITATION_ROUTE_WEEK_COUNT
    ? week
    : null;
}

function assignedWeekForRows(rows: BusinessAccountRow[]): number | null {
  const weeks = new Set<number>();
  for (const row of rows) {
    const week = parseAssignedWeek(row.week);
    if (week !== null) {
      weeks.add(week);
    }
  }
  return weeks.size === 1 ? [...weeks][0] ?? null : null;
}

function contactCompleteness(row: BusinessAccountRow): number {
  return [
    row.primaryContactName,
    row.primaryContactJobTitle,
    row.primaryContactPhone,
    row.primaryContactExtension,
    row.primaryContactEmail,
  ].filter((value) => normalizeText(value).length > 0).length;
}

function addressCompleteness(row: BusinessAccountRow): number {
  return [
    row.addressLine1,
    row.addressLine2,
    row.city,
    row.state,
    row.postalCode,
    row.country,
  ].filter((value) => normalizeText(value).length > 0).length;
}

function compareRowPreference(
  left: BusinessAccountRow,
  right: BusinessAccountRow,
  geocodes: ReadonlyMap<string, VisitationRouteGeocode>,
): number {
  const leftMapped = geocodes.has(buildAddressKeyFromRow(left)) ? 1 : 0;
  const rightMapped = geocodes.has(buildAddressKeyFromRow(right)) ? 1 : 0;
  return (
    rightMapped - leftMapped ||
    addressCompleteness(right) - addressCompleteness(left) ||
    Number(Boolean(right.isPrimaryContact)) - Number(Boolean(left.isPrimaryContact)) ||
    contactCompleteness(right) - contactCompleteness(left) ||
    normalizeText(left.rowKey).localeCompare(normalizeText(right.rowKey))
  );
}

function compareContactPreference(left: BusinessAccountRow, right: BusinessAccountRow): number {
  return (
    Number(Boolean(right.isPrimaryContact)) - Number(Boolean(left.isPrimaryContact)) ||
    contactCompleteness(right) - contactCompleteness(left) ||
    normalizeText(left.primaryContactName).localeCompare(
      normalizeText(right.primaryContactName),
    )
  );
}

function formatFullAddress(row: BusinessAccountRow): string {
  const street = [normalizeText(row.addressLine1), normalizeText(row.addressLine2)]
    .filter(Boolean)
    .join(", ");
  const locality = [
    normalizeText(row.city),
    normalizeText(row.state),
    normalizeText(row.postalCode),
  ]
    .filter(Boolean)
    .join(" ");
  return [street, locality, normalizeText(row.country)].filter(Boolean).join(", ");
}

function groupRows(rows: BusinessAccountRow[]): BusinessAccountRow[][] {
  const grouped = new Map<string, BusinessAccountRow[]>();
  for (const row of rows) {
    const key = accountIdentity(row);
    const group = grouped.get(key) ?? [];
    group.push(row);
    grouped.set(key, group);
  }
  return [...grouped.values()];
}

function toRouteAccount(
  rows: BusinessAccountRow[],
  geocodes: ReadonlyMap<string, VisitationRouteGeocode>,
): VisitationRouteAccount | null {
  const category = categoryForRows(rows);
  if (!category) {
    return null;
  }

  const accountRow = [...rows].sort((left, right) =>
    compareRowPreference(left, right, geocodes),
  )[0];
  const contactRow = [...rows].sort(compareContactPreference)[0];
  if (!accountRow || !contactRow) {
    return null;
  }

  const addressKey = buildAddressKeyFromRow(accountRow);
  const geocode = geocodes.get(addressKey);
  const address = formatFullAddress(accountRow) || normalizeText(accountRow.address);

  return {
    accountRecordId: normalizeText(accountRow.accountRecordId) || normalizeText(accountRow.id),
    businessAccountId: normalizeText(accountRow.businessAccountId),
    companyName: normalizeText(accountRow.companyName) || "Unnamed account",
    address,
    addressLine1: normalizeText(accountRow.addressLine1),
    addressLine2: normalizeText(accountRow.addressLine2),
    city: normalizeText(accountRow.city),
    state: normalizeText(accountRow.state),
    postalCode: normalizeText(accountRow.postalCode),
    country: normalizeText(accountRow.country),
    companyPhone: mostCommonValue(rows.map((row) => row.companyPhone ?? row.phoneNumber)),
    contactName: normalizeText(contactRow.primaryContactName),
    contactJobTitle: normalizeText(contactRow.primaryContactJobTitle),
    contactPhone: normalizeText(contactRow.primaryContactPhone),
    contactExtension: normalizeText(contactRow.primaryContactExtension),
    contactEmail: normalizeText(contactRow.primaryContactEmail),
    category,
    salesRepId: mostCommonValue(rows.map((row) => row.salesRepId)),
    salesRepName: mostCommonValue(rows.map((row) => row.salesRepName)),
    assignedWeek: assignedWeekForRows(rows),
    latitude: geocode?.latitude ?? null,
    longitude: geocode?.longitude ?? null,
  };
}

function compareAccountIdentity(
  left: VisitationRouteAccount,
  right: VisitationRouteAccount,
): number {
  return (
    left.companyName.localeCompare(right.companyName, undefined, {
      sensitivity: "base",
      numeric: true,
    }) || left.accountRecordId.localeCompare(right.accountRecordId)
  );
}

export function buildVisitationRouteSalesRepOptions(
  rows: BusinessAccountRow[],
): VisitationRouteSalesRepOption[] {
  const groupedByRep = new Map<string, VisitationRouteSalesRepOption>();
  for (const accountRows of groupRows(rows)) {
    if (!categoryForRows(accountRows)) {
      continue;
    }
    const name = mostCommonValue(accountRows.map((row) => row.salesRepName));
    const id = mostCommonValue(accountRows.map((row) => row.salesRepId));
    if (!name && !id) {
      continue;
    }
    const key = name ? `name:${normalizeComparable(name)}` : `id:${normalizeComparable(id)}`;
    const current = groupedByRep.get(key);
    groupedByRep.set(key, {
      id: current?.id || id || name,
      name: current?.name || name || id,
      accountCount: (current?.accountCount ?? 0) + 1,
    });
  }
  return [...groupedByRep.values()].sort(
    (left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" }) ||
      left.id.localeCompare(right.id),
  );
}

function hasCoordinates(account: VisitationRouteAccount): boolean {
  return Number.isFinite(account.latitude) && Number.isFinite(account.longitude);
}

function projectAccounts(accounts: VisitationRouteAccount[]): ProjectedAccount[] {
  const meanLatitude =
    accounts.reduce((sum, account) => sum + (account.latitude ?? 0), 0) /
    Math.max(accounts.length, 1);
  const longitudeScale = Math.max(0.2, Math.cos((meanLatitude * Math.PI) / 180));
  return accounts.map((account) => ({
    ...account,
    x: (account.longitude ?? 0) * 111.32 * longitudeScale,
    y: (account.latitude ?? 0) * 110.57,
  }));
}

function projectedDistance(left: ProjectedCenter, right: ProjectedCenter): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function averageCenter(points: ProjectedAccount[]): ProjectedCenter {
  if (points.length === 0) {
    return { x: 0, y: 0 };
  }
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

function chooseInitialCenters(
  points: ProjectedAccount[],
  clusterCount: number,
): ProjectedCenter[] {
  if (points.length === 0 || clusterCount === 0) {
    return [];
  }
  const first = [...points].sort((left, right) => left.x - right.x || right.y - left.y)[0];
  const centers: ProjectedAccount[] = first ? [first] : [];
  while (centers.length < clusterCount) {
    const candidate = [...points]
      .filter((point) => !centers.includes(point))
      .map((point) => ({
        point,
        nearestDistance: Math.min(
          ...centers.map((center) => projectedDistance(point, center)),
        ),
      }))
      .sort(
        (left, right) =>
          right.nearestDistance - left.nearestDistance ||
          compareAccountIdentity(left.point, right.point),
      )[0]?.point;
    if (!candidate) {
      break;
    }
    centers.push(candidate);
  }
  return centers;
}

function balancedCapacities(total: number, count: number): number[] {
  if (count === 0) {
    return [];
  }
  const base = Math.floor(total / count);
  const extras = total % count;
  return Array.from({ length: count }, (_, index) => base + (index < extras ? 1 : 0));
}

function allocateCapacities(
  points: ProjectedAccount[],
  centers: ProjectedCenter[],
): number[] {
  const sizes = balancedCapacities(points.length, centers.length).sort((a, b) => b - a);
  const demand = centers.map((_, index) => ({ index, count: 0, distance: 0 }));
  for (const point of points) {
    const nearest = centers
      .map((center, index) => ({ index, distance: projectedDistance(point, center) }))
      .sort((left, right) => left.distance - right.distance || left.index - right.index)[0];
    if (nearest) {
      demand[nearest.index].count += 1;
      demand[nearest.index].distance += nearest.distance;
    }
  }
  const capacities = Array.from({ length: centers.length }, () => 0);
  demand
    .sort(
      (left, right) =>
        right.count - left.count || right.distance - left.distance || left.index - right.index,
    )
    .forEach((entry, index) => {
      capacities[entry.index] = sizes[index] ?? 0;
    });
  return capacities;
}

function assignToCenters(
  points: ProjectedAccount[],
  centers: ProjectedCenter[],
  capacities: number[],
): ProjectedAccount[][] {
  const clusters = centers.map(() => [] as ProjectedAccount[]);
  const remaining = [...capacities];
  const candidates = points
    .map((point) => {
      const rankings = centers
        .map((center, index) => ({ index, distance: projectedDistance(point, center) }))
        .sort((left, right) => left.distance - right.distance || left.index - right.index);
      return {
        point,
        rankings,
        regret: (rankings[1]?.distance ?? rankings[0]?.distance ?? 0) -
          (rankings[0]?.distance ?? 0),
      };
    })
    .sort(
      (left, right) =>
        right.regret - left.regret || compareAccountIdentity(left.point, right.point),
    );

  for (const candidate of candidates) {
    const destination = candidate.rankings.find((ranking) => remaining[ranking.index] > 0);
    const destinationIndex = destination?.index ?? 0;
    clusters[destinationIndex].push(candidate.point);
    remaining[destinationIndex] -= 1;
  }
  return clusters;
}

function chooseMedoid(points: ProjectedAccount[]): ProjectedCenter {
  const center = averageCenter(points);
  return (
    [...points].sort(
      (left, right) =>
        projectedDistance(left, center) - projectedDistance(right, center) ||
        compareAccountIdentity(left, right),
    )[0] ?? center
  );
}

function buildMappedClusters(
  accounts: VisitationRouteAccount[],
  requestedCount: number,
): VisitationRouteAccount[][] {
  if (accounts.length === 0) {
    return [];
  }
  const points = projectAccounts(accounts);
  const clusterCount = Math.min(requestedCount, points.length);
  let centers = chooseInitialCenters(points, clusterCount);
  let bestClusters = centers.map(() => [] as ProjectedAccount[]);
  let bestScore = Number.POSITIVE_INFINITY;

  for (let iteration = 0; iteration < 30; iteration += 1) {
    const clusters = assignToCenters(points, centers, allocateCapacities(points, centers));
    const score = clusters.reduce((total, cluster) => {
      const center = averageCenter(cluster);
      return total + cluster.reduce((sum, point) => sum + projectedDistance(point, center), 0);
    }, 0);
    if (score < bestScore) {
      bestScore = score;
      bestClusters = clusters;
    }
    const nextCenters = clusters.map((cluster) => chooseMedoid(cluster));
    const unchanged = nextCenters.every(
      (center, index) =>
        Math.abs(center.x - centers[index].x) < 0.000001 &&
        Math.abs(center.y - centers[index].y) < 0.000001,
    );
    centers = nextCenters;
    if (unchanged) {
      break;
    }
  }

  return bestClusters
    .map((cluster) => ({
      accounts: cluster as VisitationRouteAccount[],
      center: averageCenter(cluster),
    }))
    .sort((left, right) => left.center.x - right.center.x || right.center.y - left.center.y)
    .map((cluster) => cluster.accounts);
}

function distributeAccounts(
  accounts: VisitationRouteAccount[],
  groupCount: number,
): VisitationRouteAccount[][] {
  const mapped = accounts.filter(hasCoordinates);
  const unmapped = accounts.filter((account) => !hasCoordinates(account));
  const groups = buildMappedClusters(mapped, groupCount);
  while (groups.length < groupCount) {
    groups.push([]);
  }

  for (const account of [...unmapped].sort(compareAccountIdentity)) {
    const minimumSize = Math.min(...groups.map((group) => group.length));
    const candidates = groups
      .map((group, index) => ({
        index,
        cityMatches: group.filter(
          (item) => normalizeComparable(item.city) === normalizeComparable(account.city),
        ).length,
      }))
      .filter((candidate) => groups[candidate.index].length === minimumSize)
      .sort(
        (left, right) => right.cityMatches - left.cityMatches || left.index - right.index,
      );
    groups[candidates[0]?.index ?? 0].push(account);
  }
  return groups;
}

function nearestMappedDistanceKm(
  account: VisitationRouteAccount,
  group: VisitationRouteAccount[],
): number {
  if (!hasCoordinates(account)) {
    return Number.POSITIVE_INFINITY;
  }
  const distances = group
    .filter(hasCoordinates)
    .map((candidate) => haversineDistanceKm(account, candidate));
  return distances.length > 0 ? Math.min(...distances) : Number.POSITIVE_INFINITY;
}

function groupAccountsByAssignedWeek(
  accounts: VisitationRouteAccount[],
): VisitationRouteAccount[][] {
  const weeks = Array.from(
    { length: VISITATION_ROUTE_WEEK_COUNT },
    () => [] as VisitationRouteAccount[],
  );
  const unassigned: VisitationRouteAccount[] = [];

  for (const account of accounts) {
    if (account.assignedWeek === null) {
      unassigned.push(account);
    } else {
      weeks[account.assignedWeek - 1].push(account);
    }
  }

  if (unassigned.length === accounts.length) {
    return distributeAccounts(accounts, VISITATION_ROUTE_WEEK_COUNT);
  }

  for (const account of [...unassigned].sort(compareAccountIdentity)) {
    const minimumSize = Math.min(...weeks.map((weekAccounts) => weekAccounts.length));
    const destination = weeks
      .map((weekAccounts, index) => ({ index, accounts: weekAccounts }))
      .filter((week) => week.accounts.length === minimumSize)
      .map((candidate) => ({
        ...candidate,
        cityMatches: candidate.accounts.filter(
          (item) => normalizeComparable(item.city) === normalizeComparable(account.city),
        ).length,
        distanceKm: nearestMappedDistanceKm(account, candidate.accounts),
      }))
      .sort((left, right) => {
        if (hasCoordinates(account)) {
          return (
            left.distanceKm - right.distanceKm ||
            right.cityMatches - left.cityMatches ||
            left.index - right.index
          );
        }
        return (
          right.cityMatches - left.cityMatches ||
          left.accounts.length - right.accounts.length ||
          left.index - right.index
        );
      })[0];
    weeks[destination?.index ?? 0].push(account);
  }

  return weeks;
}

function haversineDistanceKm(
  left: VisitationRouteAccount,
  right: VisitationRouteAccount,
): number {
  if (!hasCoordinates(left) || !hasCoordinates(right)) {
    return 0;
  }
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const leftLatitude = toRadians(left.latitude ?? 0);
  const rightLatitude = toRadians(right.latitude ?? 0);
  const latitudeDelta = rightLatitude - leftLatitude;
  const longitudeDelta = toRadians((right.longitude ?? 0) - (left.longitude ?? 0));
  const value =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(leftLatitude) *
      Math.cos(rightLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function routeDistance(accounts: VisitationRouteAccount[]): number {
  let total = 0;
  for (let index = 1; index < accounts.length; index += 1) {
    total += haversineDistanceKm(accounts[index - 1], accounts[index]);
  }
  return total;
}

function nearestNeighborRoute(accounts: VisitationRouteAccount[]): VisitationRouteAccount[] {
  if (accounts.length <= 2) {
    return [...accounts];
  }
  const remaining = [...accounts];
  const firstIndex = remaining.reduce((bestIndex, account, index) => {
    const best = remaining[bestIndex];
    if (!best) {
      return index;
    }
    return (account.longitude ?? 0) < (best.longitude ?? 0) ||
      ((account.longitude ?? 0) === (best.longitude ?? 0) &&
        (account.latitude ?? 0) > (best.latitude ?? 0))
      ? index
      : bestIndex;
  }, 0);
  const route = remaining.splice(firstIndex, 1);
  while (remaining.length > 0) {
    const current = route[route.length - 1];
    const nextIndex = remaining.reduce((bestIndex, account, index) => {
      const distance = haversineDistanceKm(current, account);
      const bestDistance = haversineDistanceKm(current, remaining[bestIndex]);
      return distance < bestDistance ? index : bestIndex;
    }, 0);
    route.push(...remaining.splice(nextIndex, 1));
  }
  return route;
}

function twoOptRoute(accounts: VisitationRouteAccount[]): VisitationRouteAccount[] {
  let route = nearestNeighborRoute(accounts);
  let improved = true;
  while (improved) {
    improved = false;
    for (let left = 1; left < route.length - 2; left += 1) {
      for (let right = left + 1; right < route.length - 1; right += 1) {
        const currentDistance =
          haversineDistanceKm(route[left - 1], route[left]) +
          haversineDistanceKm(route[right], route[right + 1]);
        const swappedDistance =
          haversineDistanceKm(route[left - 1], route[right]) +
          haversineDistanceKm(route[left], route[right + 1]);
        if (swappedDistance + 0.000001 < currentDistance) {
          route = [
            ...route.slice(0, left),
            ...route.slice(left, right + 1).reverse(),
            ...route.slice(right + 1),
          ];
          improved = true;
        }
      }
    }
  }
  return route;
}

function orderDailyRoute(accounts: VisitationRouteAccount[]): VisitationRouteAccount[] {
  const mappedRoute = twoOptRoute(accounts.filter(hasCoordinates));
  const route = [...mappedRoute];
  for (const account of accounts.filter((item) => !hasCoordinates(item)).sort(compareAccountIdentity)) {
    let insertionIndex = -1;
    for (let index = route.length - 1; index >= 0; index -= 1) {
      if (normalizeComparable(route[index].city) === normalizeComparable(account.city)) {
        insertionIndex = index + 1;
        break;
      }
    }
    route.splice(insertionIndex >= 0 ? insertionIndex : route.length, 0, account);
  }
  return route;
}

function chooseAuthoritativeScheduleDay(
  account: VisitationRouteAccount,
  days: Array<{ week: number; day: number; accounts: VisitationRouteAccount[] }>,
): { week: number; day: number; accounts: VisitationRouteAccount[] } {
  const shortDays = days.filter(
    (day) => day.accounts.length < VISITATION_ROUTE_MIN_ACCOUNTS_PER_DAY,
  );
  let candidates = shortDays.length > 0 ? shortDays : days;
  if (account.assignedWeek !== null) {
    const assignedWeekCandidates = candidates.filter(
      (day) => day.week === account.assignedWeek,
    );
    if (assignedWeekCandidates.length > 0) {
      candidates = assignedWeekCandidates;
    }
  }

  return [...candidates]
    .map((day) => ({
      day,
      cityMatches: day.accounts.filter(
        (candidate) =>
          normalizeComparable(candidate.city) === normalizeComparable(account.city),
      ).length,
      distanceKm: nearestMappedDistanceKm(account, day.accounts),
    }))
    .sort((left, right) => {
      if (hasCoordinates(account)) {
        return (
          left.distanceKm - right.distanceKm ||
          right.cityMatches - left.cityMatches ||
          left.day.accounts.length - right.day.accounts.length ||
          left.day.week - right.day.week ||
          left.day.day - right.day.day
        );
      }
      return (
        right.cityMatches - left.cityMatches ||
        left.day.accounts.length - right.day.accounts.length ||
        left.day.week - right.day.week ||
        left.day.day - right.day.day
      );
    })[0]?.day ?? days[0];
}

function buildDaysFromAuthoritativeSchedule(
  accounts: VisitationRouteAccount[],
  salesRepName: string,
  authoritativeSchedule?: AuthoritativeVisitationRouteSchedule | null,
): {
  days: VisitationRouteDay[];
  diagnostics: VisitationRouteScheduleDiagnostics;
} | null {
  const schedule = authoritativeSchedule === undefined
    ? findAuthoritativeVisitationRouteSchedule(salesRepName)
    : authoritativeSchedule;
  if (!schedule) {
    return null;
  }

  const matched = matchAccountsToAuthoritativeSchedule(accounts, schedule);
  const allocatedDays = matched.days.map((day) => ({
    ...day,
    accounts: [...day.accounts],
  }));
  for (const account of [...matched.unmatchedAccounts].sort(compareAccountIdentity)) {
    const destination = chooseAuthoritativeScheduleDay(account, allocatedDays);
    destination.accounts.push(account);
  }

  const shortfalls = allocatedDays.filter(
    (day) => day.accounts.length < VISITATION_ROUTE_MIN_ACCOUNTS_PER_DAY,
  );
  if (shortfalls.length > 0) {
    const details = shortfalls
      .map((day) => `W${day.week} D${day.day} (${day.accounts.length})`)
      .join(", ");
    throw new Error(
      `The saved visitation schedule cannot provide at least ${VISITATION_ROUTE_MIN_ACCOUNTS_PER_DAY} accounts on every day. Short days: ${details}.`,
    );
  }

  const days = allocatedDays.map((day) => {
    const orderedAccounts = orderDailyRoute(day.accounts);
    return {
      week: day.week,
      day: day.day,
      accounts: orderedAccounts,
      estimatedDistanceKm: routeDistance(orderedAccounts),
    };
  });
  return {
    days,
    diagnostics: {
      scheduleId: schedule.id,
      scheduleVersion: schedule.version,
      referenceAccountTotal: schedule.referenceAccountTotal,
      matchedScheduledAccountTotal: matched.matchedAccountTotal,
      missingReferenceAccountTotal: matched.missingReferenceAccountTotal,
      newlyPlacedAccountTotal: matched.unmatchedAccounts.length,
    },
  };
}

export function buildVisitationRoutePlan({
  rows,
  geocodes,
  salesRepId,
  salesRepName,
  generatedAt = new Date(),
  authoritativeSchedule,
}: {
  rows: BusinessAccountRow[];
  geocodes: ReadonlyMap<string, VisitationRouteGeocode>;
  salesRepId?: string | null;
  salesRepName?: string | null;
  generatedAt?: Date;
  authoritativeSchedule?: AuthoritativeVisitationRouteSchedule | null;
}): VisitationRoutePlan {
  const targetId = normalizeComparable(salesRepId);
  const targetName = normalizeComparable(salesRepName);
  const accounts = groupRows(rows)
    .map((accountRows) => toRouteAccount(accountRows, geocodes))
    .filter((account): account is VisitationRouteAccount => Boolean(account))
    .filter((account) => {
      const idMatches = Boolean(targetId) && normalizeComparable(account.salesRepId) === targetId;
      const nameMatches =
        Boolean(targetName) && normalizeComparable(account.salesRepName) === targetName;
      return idMatches || nameMatches;
    });

  const resolvedSalesRepName =
    mostCommonValue(accounts.map((account) => account.salesRepName)) ||
    normalizeText(salesRepName) ||
    normalizeText(salesRepId);
  const resolvedSalesRepId =
    mostCommonValue(accounts.map((account) => account.salesRepId)) || normalizeText(salesRepId);
  const authoritativeRoute = buildDaysFromAuthoritativeSchedule(
    accounts,
    resolvedSalesRepName,
    authoritativeSchedule,
  );
  const days = authoritativeRoute?.days ??
    groupAccountsByAssignedWeek(accounts).flatMap((weekAccounts, weekIndex) =>
      distributeAccounts(weekAccounts, VISITATION_ROUTE_DAY_COUNT).map(
        (dayAccounts, dayIndex) => {
          const orderedAccounts = orderDailyRoute(dayAccounts);
          return {
            week: weekIndex + 1,
            day: dayIndex + 1,
            accounts: orderedAccounts,
            estimatedDistanceKm: routeDistance(orderedAccounts),
          };
        },
      ),
    );

  const mappedAccountTotal = accounts.filter(hasCoordinates).length;
  return {
    salesRepId: resolvedSalesRepId,
    salesRepName: resolvedSalesRepName,
    generatedAt: generatedAt.toISOString(),
    accountTotal: accounts.length,
    mappedAccountTotal,
    unmappedAccountTotal: accounts.length - mappedAccountTotal,
    estimatedDistanceKm: days.reduce((sum, day) => sum + day.estimatedDistanceKm, 0),
    days,
    scheduleDiagnostics: authoritativeRoute?.diagnostics ?? null,
  };
}
