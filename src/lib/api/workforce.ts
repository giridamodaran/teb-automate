import { tebRequest } from "@/lib/api/client";
import { asLookupOptions, listOwners, ownerFromUser, type LookupOption } from "@/lib/api/quote-lookups";
import { getCurrentUser, getSubscriberUsers } from "@/lib/auth/session";

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

function parseMaybeJson(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function asRows(raw: unknown): Record<string, unknown>[] {
  const parsed = parseMaybeJson(raw);
  if (Array.isArray(parsed)) {
    return parsed.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object");
  }
  const obj = asRecord(parsed);
  if (!obj) return [];
  for (const key of ["Data", "value", "Value", "Users", "Members", "Markers", "Records"]) {
    const inner = asRows(obj[key]);
    if (inner.length > 0) return inner;
  }
  return [obj];
}

function firstString(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value == null || typeof value === "object") continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

export function personName(row: Record<string, unknown>): string {
  const combined = [row.FirstName, row.LastName].filter(Boolean).join(" ").trim();
  return (
    firstString(row, ["FullName", "Text", "Name", "UserName", "DisplayName", "Title"]) ||
    combined ||
    firstString(row, ["Email", "Id"]) ||
    "Unknown"
  );
}

export function personId(row: Record<string, unknown>): string {
  return firstString(row, ["UserId", "userId", "MemberId", "SubscriberUserId", "Id", "id"]);
}

export function locationCoords(row: Record<string, unknown> | null | undefined): { lat: number; lng: number } | null {
  if (!row) return null;
  const lat = Number(row.Latitude ?? row.latitude ?? row.Lat ?? row.lat);
  const lng = Number(row.Longitude ?? row.longitude ?? row.Lng ?? row.lng ?? row.Long ?? row.long);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

function hasLocation(row: Record<string, unknown> | null | undefined): boolean {
  if (!row) return false;
  return Boolean(locationLabel(row) || locationCoords(row));
}

/** Live tracking matches people on UserId; dropdown rows often also have a different Id. */
function peopleOptions(raw: unknown): LookupOption[] {
  return asLookupOptions(raw).map((option) => {
    const extra = option.extra ?? {};
    const id =
      firstString(extra, ["UserId", "MemberId", "SubscriberUserId", "Id", "id"]) || option.id;
    return relabel({ ...option, id, extra });
  });
}

function flattenTeam(raw: unknown, rows: Record<string, unknown>[] = []): Record<string, unknown>[] {
  const parsed = parseMaybeJson(raw);
  if (Array.isArray(parsed)) {
    for (const item of parsed) flattenTeam(item, rows);
    return rows;
  }
  const node = asRecord(parsed);
  if (!node) return rows;
  const looksLikePerson = Boolean(personId(node) || personName(node) !== "Unknown");
  if (looksLikePerson && (node.Email || node.UserId || node.MemberId || node.FullName || node.Text || node.Name || node.FirstName || node.UserName)) {
    rows.push(node);
  }
  for (const key of ["Children", "Child", "Members", "Users", "Nodes", "TeamMembers", "Team", "Items", "value", "Value", "Data"]) {
    if (key in node) flattenTeam(node[key], rows);
  }
  return rows;
}

function relabel(option: LookupOption): LookupOption {
  const extra = option.extra ?? {};
  const combined = [extra.FirstName, extra.LastName].filter(Boolean).join(" ").trim();
  const label =
    (combined && combined.length >= option.label.length ? combined : "") ||
    personName({ ...extra, Id: option.id, Label: option.label }) ||
    option.label;
  return { ...option, label };
}

function mergePeople(groups: LookupOption[][]): LookupOption[] {
  const seen = new Map<string, LookupOption>();
  for (const group of groups) {
    for (const raw of group) {
      const option = relabel(raw);
      if (!option.id || seen.has(option.id)) continue;
      seen.set(option.id, option);
    }
  }
  return [...seen.values()];
}

export async function listWorkforceUsers(): Promise<LookupOption[]> {
  const me = ownerFromUser(getCurrentUser());
  const groups: LookupOption[][] = [];
  if (me) groups.push([relabel(me)]);
  groups.push(peopleOptions(getSubscriberUsers()));
  let merged = mergePeople(groups);
  if (merged.length > 1) return merged;

  const attempts: Array<{ host: "MICRO" | "USER" | "COMPANY"; path: string; method?: "GET" | "POST"; body?: unknown }> = [
    { host: "USER", path: "FnGetSubscriberUsers()" },
    { host: "USER", path: "FnGetSubscriberUsersDropdown()" },
    { host: "MICRO", path: "gateway/admin/GetUserDropdown?Module=TEBWorkforce&IsWithIcon=true" },
    { host: "MICRO", path: "gateway/admin/GetUserDropdown" },
    { host: "COMPANY", path: "FnGetCurrentUserTeamMembers()?moduleName=TEBWorkforce" },
    { host: "COMPANY", path: "FnGetCurrentUserTeamMembers()" },
    { host: "COMPANY", path: "FnGetCurrentUserTeamMembers()?moduleName=WorkForceManagement" },
  ];
  for (const attempt of attempts) {
    try {
      const envelope = await tebRequest(attempt.host, attempt.path, {
        method: attempt.method,
        body: attempt.body,
      });
      const rows = peopleOptions(envelope.Data ?? envelope.value ?? envelope.Value ?? envelope);
      if (rows.length > 0) {
        groups.push(rows);
        merged = mergePeople(groups);
        if (merged.length > 1) return merged;
      }
    } catch {
      // Next live path — field users often lack the Workforce package dropdown.
    }
  }
  try {
    const envelope = await tebRequest("MICRO", "gateway/admin/GetUserDropdown", {
      method: "POST",
      body: { Module: "TEBWorkforce", IsWithIcon: true },
    });
    groups.push(peopleOptions(envelope.Data ?? envelope.value ?? envelope.Value ?? envelope));
  } catch {
    // POST form is optional.
  }
  try {
    const owners = await listOwners();
    groups.push(
      owners.map((option) => {
        const extra = option.extra ?? {};
        const id = firstString(extra, ["UserId", "MemberId", "SubscriberUserId"]) || option.id;
        return relabel({ ...option, id, extra });
      }),
    );
  } catch {
    // Session owners already merged.
  }
  return mergePeople(groups);
}

export async function listMyTeam(): Promise<Record<string, unknown>[]> {
  let fromTree: Record<string, unknown>[] = [];
  try {
    const envelope = await tebRequest("COMPANY", "FnGetTeamTreeStructure()");
    fromTree = flattenTeam(envelope.value ?? envelope.Data ?? envelope.Value ?? envelope);
  } catch {
    // Team members list is enough for non-managers.
  }
  const users = await listWorkforceUsers();
  const fromUsers = users.map((option) => ({
    Id: option.id,
    UserId: option.id,
    FullName: option.label,
    Title: option.label,
    Email: option.extra?.Email ?? option.extra?.SubText,
    ...(option.extra ?? {}),
  }));
  const seen = new Set<string>();
  const rows: Record<string, unknown>[] = [];
  for (const row of [...fromTree, ...fromUsers]) {
    const id = personId(row) || String(row.Id ?? "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    rows.push(row);
  }
  return rows;
}

export async function listTeamMembers(): Promise<LookupOption[]> {
  const me = ownerFromUser(getCurrentUser());
  const groups: LookupOption[][] = [];
  const attempts: Array<{ host: "MICRO" | "COMPANY"; path: string; method?: "GET" | "POST"; body?: unknown }> = [
    { host: "MICRO", path: "gateway/admin/GetUserDropdown?Module=TEBWorkforce&IsWithIcon=true" },
    { host: "COMPANY", path: "FnGetCurrentUserTeamMembers()?moduleName=TEBWorkforce" },
    { host: "COMPANY", path: "FnGetCurrentUserTeamMembers()?moduleName=WorkForceManagement" },
    { host: "COMPANY", path: "FnGetCurrentUserTeamMembers()" },
  ];
  for (const attempt of attempts) {
    try {
      const envelope = await tebRequest(attempt.host, attempt.path, {
        method: attempt.method,
        body: attempt.body,
      });
      const rows = peopleOptions(envelope.Data ?? envelope.value ?? envelope.Value ?? envelope);
      if (rows.length > 0) {
        groups.push(rows);
        break;
      }
    } catch {
      // Live team map uses the Workforce dropdown first; other logins need team-member APIs.
    }
  }
  if (groups.length === 0) {
    try {
      const envelope = await tebRequest("MICRO", "gateway/admin/GetUserDropdown", {
        method: "POST",
        body: { Module: "TEBWorkforce", IsWithIcon: true },
      });
      groups.push(peopleOptions(envelope.Data ?? envelope.value ?? envelope.Value ?? envelope));
    } catch {
      // POST form is optional.
    }
  }
  try {
    const envelope = await tebRequest("COMPANY", "FnGetTeamTreeStructure()");
    groups.push(peopleOptions(flattenTeam(envelope.value ?? envelope.Data ?? envelope.Value ?? envelope)));
  } catch {
    // Team tree is optional for non-managers.
  }
  if (me) groups.push([relabel(me)]);
  const merged = mergePeople(groups);
  return merged.length > 0 ? merged : listWorkforceUsers();
}

export async function getSignedInLastLocations(userIds: string[]): Promise<Record<string, unknown>[]> {
  if (userIds.length === 0) return [];
  // Live /workforce/team posts ParamName UserIds as the raw id array.
  try {
    const envelope = await tebRequest("MICRO", "gateway/workforce/GetSignedInUsersLastLocation", {
      method: "POST",
      body: userIds,
    });
    const rows = asRows(envelope.Data ?? envelope.value ?? envelope.Value);
    if (rows.length > 0) return rows;
  } catch {
    // Wrapped { UserIds } is the fallback some gateways expect.
  }
  try {
    const envelope = await tebRequest("MICRO", "gateway/workforce/GetSignedInUsersLastLocation", {
      method: "POST",
      body: { UserIds: userIds },
    });
    return asRows(envelope.Data ?? envelope.value ?? envelope.Value);
  } catch {
    return [];
  }
}

function eventLocation(raw: unknown): Record<string, unknown> | null {
  const data = asRecord(parseMaybeJson(raw));
  if (!data) return null;
  const events = asRows(data.eventDeviceInfoDTOs ?? data.EventDeviceInfoDTOs ?? data);
  const latest =
    events.find((row) => /LATESTLOCATION|LASTLOCATION|LOCATION/i.test(String(row.EventType ?? row.Type ?? ""))) ??
    events.find((row) => hasLocation(row)) ??
    (hasLocation(data) ? data : null);
  return latest && hasLocation(latest) ? latest : hasLocation(data) ? data : null;
}

export async function getUserLastLocation(userId: string): Promise<Record<string, unknown> | null> {
  if (!userId) return null;
  const read = (envelope: { Data?: unknown; value?: unknown; Value?: unknown; Succeeded?: boolean; Failed?: boolean }) => {
    const data = parseMaybeJson(envelope.Data ?? envelope.value ?? envelope.Value);
    const row = asRecord(data) ?? asRows(data)[0] ?? null;
    return row && hasLocation(row) ? row : eventLocation(data);
  };
  try {
    const envelope = await tebRequest<Record<string, unknown>>(
      "MICRO",
      `gateway/workforce/GetUserLastLocation?UserId=${encodeURIComponent(userId)}`,
    );
    const row = read(envelope);
    if (row) return row;
  } catch {
    // POST body is the live tracking fallback.
  }
  try {
    const envelope = await tebRequest<Record<string, unknown>>("MICRO", "gateway/workforce/GetUserLastLocation", {
      method: "POST",
      body: { UserId: userId },
    });
    const row = read(envelope);
    if (row) return row;
  } catch {
    // Today's tracking pin is the next live fallback.
  }
  try {
    const today = new Date().toISOString();
    const envelope = await tebRequest<Record<string, unknown>>(
      "MICRO",
      `gateway/workforce/CurrentDateUserTrackingInfo?UserId=${encodeURIComponent(userId)}`,
      { method: "POST", body: { UserId: userId, CurrentDate: today } },
    );
    return read(envelope);
  } catch {
    return null;
  }
}

function locationByUserId(rows: Record<string, unknown>[]): Map<string, Record<string, unknown>> {
  const byId = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    if (!hasLocation(row)) continue;
    const id = personId(row);
    if (id) byId.set(id, row);
  }
  return byId;
}

export async function lastLocationsForUsers(userIds: string[]): Promise<Record<string, unknown>[]> {
  const ids = [...new Set(userIds.filter(Boolean))];
  const me = ownerFromUser(getCurrentUser())?.id;
  const byId = new Map<string, Record<string, unknown>>();
  if (me) {
    const self = await getUserLastLocation(me);
    if (self) byId.set(me, { ...self, UserId: me, Id: me });
  }
  const batch = await getSignedInLastLocations(ids.length > 0 ? ids : me ? [me] : []);
  for (const [id, row] of locationByUserId(batch)) byId.set(id, row);
  const missing = (ids.length > 0 ? ids : me ? [me] : []).filter((id) => !hasLocation(byId.get(id))).slice(0, 15);
  if (missing.length > 0) {
    const found = await Promise.all(missing.map((id) => getUserLastLocation(id)));
    found.forEach((row, index) => {
      if (!row) return;
      byId.set(missing[index], { ...row, UserId: missing[index], Id: missing[index] });
    });
  }
  return [...byId.values()];
}

export async function getSubscriberUserDetail(userId: string): Promise<Record<string, unknown> | null> {
  try {
    const envelope = await tebRequest<Record<string, unknown>>(
      "MICRO",
      `gateway/admin/GetSubscriberUserDetail?Id=${encodeURIComponent(userId)}`,
    );
    const data = parseMaybeJson(envelope.Data ?? envelope.value ?? envelope.Value);
    return asRecord(data) ?? asRows(data)[0] ?? null;
  } catch {
    return null;
  }
}

export function locationLabel(row: Record<string, unknown>): string {
  const address = firstString(row, ["Address", "Location", "LocationName", "LastLocation", "Place", "City"]);
  if (address) return address;
  const lat = row.Latitude ?? row.latitude;
  const lng = row.Longitude ?? row.longitude;
  if (lat != null && lng != null && String(lat) !== "" && String(lng) !== "") {
    return `${lat}, ${lng}`;
  }
  return "";
}

export function startedDate(row: Record<string, unknown>): string {
  return firstString(row, [
    "DateOfJoining",
    "JoiningDate",
    "JoinDate",
    "StartDate",
    "CreatedDate",
    "createddate",
    "OnboardDate",
  ]);
}

/** HR joining date only — tracking `StartDate` is punch-in, not DateOfJoining. */
export function joiningDate(row: Record<string, unknown>): string {
  return firstString(row, ["DateOfJoining", "JoiningDate", "JoinDate", "OnboardDate", "CreatedDate", "createddate"]);
}

export function punchStartTime(row: Record<string, unknown>): string {
  return firstString(row, ["StartDate", "StartEventTime", "EventTime"]);
}

export function punchEndTime(row: Record<string, unknown>): string {
  return firstString(row, ["EndDate", "EndEventTime"]);
}

function calendarDay(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function uniqueIds(values: string[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const value of values) {
    const id = value.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/** Live Day Manage posts dropdown `Id` as UserIds (not a different UserId field). */
export async function listTrackingUserIds(): Promise<string[]> {
  const fromDropdown = async (path: string, method: "GET" | "POST" = "GET", body?: unknown) => {
    const envelope = await tebRequest("MICRO", path, method === "POST" ? { method, body } : undefined);
    return asRows(envelope.Data ?? envelope.value ?? envelope.Value ?? envelope)
      .map((row) => firstString(row, ["Id"]))
      .filter(Boolean);
  };
  try {
    const ids = await fromDropdown("gateway/admin/GetUserDropdown?Module=TEBWorkforce&IsWithIcon=true");
    if (ids.length > 0) return uniqueIds(ids);
  } catch {
    // POST dropdown is the live fallback.
  }
  try {
    const ids = await fromDropdown("gateway/admin/GetUserDropdown", "POST", { Module: "TEBWorkforce", IsWithIcon: true });
    if (ids.length > 0) return uniqueIds(ids);
  } catch {
    // Team / subscriber lists still identify people for tracking.
  }
  const people = await listWorkforceUsers();
  return uniqueIds(people.map((row) => row.id));
}

export interface WorkforceSnapshotStage {
  id: string;
  name: string;
  count: number;
}

export async function getWorkforceDaySnapshot(
  from: Date,
  to: Date,
): Promise<{ total: number; stages: WorkforceSnapshotStage[] }> {
  const fromDay = calendarDay(from);
  const toDay = calendarDay(to);
  const envelope = await tebRequest<Record<string, unknown>>("MICRO", "gateway/reporting/GetOverviewWorkforceSnapshot", {
    method: "POST",
    body: {
      FilterId: "",
      IsActive: true,
      FullTextSearch: "",
      WorkflowFilters: [],
      DateFilter: {
        FieldType: "CREATEDFILTER",
        Mode: "BETWEEN",
        DateRange: { FromDate: fromDay, ToDate: toDay },
        DatePeriod: { Period: 0, PeriodType: "" },
        AnyUpdate: { UpdateOn: [], PeriodType: "LAST", IsNotUpdate: false },
        FinancePeriod: "",
      },
      LocationFilter: { Sites: [], Cities: [], Countries: [], Counties: [] },
      OwnerAssigneeFilter: { Owners: [], Assignees: [] },
      Itemfilter: {},
      MasterFilter: {},
      CustomFieldFilters: [],
      Apps: [],
      ChartCode: "WORKFORCESNAPSHOT",
      ModuleCode: "TEBWorkforce",
      PageNumber: 0,
      PageSize: 25,
    },
    timeoutMs: 30000,
  });
  const data = asRecord(parseMaybeJson(envelope.Data ?? envelope.value ?? envelope.Value)) ?? {};
  const stages = asRows(data.Stages).map((row) => ({
    id: firstString(row, ["StageId", "Id", "Code"]),
    name: firstString(row, ["StageName", "Title", "Name"]) || "Stage",
    count: Number(row.TotalCount ?? row.Count ?? 0) || 0,
  }));
  return {
    total: Number(data.TotalCount ?? stages.reduce((sum, stage) => sum + stage.count, 0)) || 0,
    stages,
  };
}

function trackingBody(from: Date, to: Date, userIds: string[], pageNumber: number, pageSize: number) {
  const start = new Date(from);
  start.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(23, 59, 59, 999);
  return {
    Data: {
      StartEventTime: start.toISOString(),
      EndEventTime: end.toISOString(),
      UserIds: userIds,
      EventTypes: [],
    },
    PageNumber: pageNumber,
    PageSize: pageSize,
    SortColumn: "",
    SortOrder: true,
  };
}

function envelopeTotal(envelope: { TotalCount?: unknown; TotalRecord?: unknown; Data?: unknown }, fallback: number): number {
  const total = Number(envelope.TotalCount ?? envelope.TotalRecord);
  if (Number.isFinite(total) && total >= 0) return total;
  const data = asRecord(envelope.Data);
  const nested = Number(data?.TotalCount ?? data?.TotalRecord);
  if (Number.isFinite(nested) && nested >= 0) return nested;
  return fallback;
}

/** Day Manage list: last 90 days → GetTrackingSummary, older → GetArchiveTrackingSummary. */
export async function listDayTracking(from: Date, to: Date, userIds: string[]): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  if (userIds.length === 0) return { rows: [], total: 0 };
  const ninety = new Date();
  ninety.setHours(0, 0, 0, 0);
  ninety.setDate(ninety.getDate() - 90);
  const start = new Date(from);
  start.setHours(0, 0, 0, 0);
  const archive = start < ninety;
  const paths = archive
    ? ["gateway/workforce/GetArchiveTrackingSummary", "gateway/workforce/GetTrackingSummary"]
    : ["gateway/workforce/GetTrackingSummary", "gateway/workforce/GetArchiveTrackingSummary"];
  const pageSize = 100;
  for (const path of paths) {
    const rows: Record<string, unknown>[] = [];
    let total = 0;
    try {
      for (let page = 0; page < 20; page += 1) {
        const envelope = await tebRequest<Record<string, unknown>[]>("MICRO", path, {
          method: "POST",
          body: trackingBody(from, to, userIds, page, pageSize),
          timeoutMs: 30000,
        });
        const batch = asRows(envelope.Data ?? envelope.value ?? envelope.Value);
        if (page === 0) total = envelopeTotal(envelope, batch.length);
        rows.push(...batch);
        if (batch.length === 0 || rows.length >= total) break;
      }
      return { rows, total: total || rows.length };
    } catch {
      // Archive vs summary depends on how old the day is.
    }
  }
  return { rows: [], total: 0 };
}

export async function listMonthAttendance(
  from: Date,
  to: Date,
  memberIds: string[],
  teamIds: string[] = [],
): Promise<Record<string, unknown>[]> {
  if (memberIds.length === 0) return [];
  const start = new Date(from);
  start.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(23, 59, 59, 999);
  try {
    const envelope = await tebRequest("MICRO", "gateway/Workforce/GetSubscriberUserAttendance", {
      method: "POST",
      body: {
        Data: {
          StartDate: start.toISOString(),
          EndDate: end.toISOString(),
          UserIds: [],
          TeamIds: teamIds,
          MemberIds: memberIds,
          FullTextSearch: "",
        },
        PageNumber: 0,
        PageSize: 200,
        SortColumn: "",
        SortOrder: true,
      },
      timeoutMs: 30000,
    });
    const data = asRows(envelope.Data ?? envelope.value ?? envelope.Value);
    const users = data.flatMap((row) => asRows(row.Users));
    return users.length > 0 ? users : data;
  } catch {
    return [];
  }
}

export interface RouteHistory {
  pins: Record<string, unknown>[];
  paths: Array<{ points: Array<{ lat: number; lng: number }>; dotted?: boolean }>;
  distanceKm?: number;
  start?: Record<string, unknown> | null;
  end?: Record<string, unknown> | null;
}

function trackLogRequest(userId: string, date: Date) {
  return {
    UserId: userId,
    CurrentDate: date.toISOString(),
    DisplayType: "STARTDAY",
    Accuracy: "Default",
    Distance: "Default",
  };
}

function pathPoints(raw: unknown): Array<{ lat: number; lng: number }> {
  const rows = asRows(raw);
  const points: Array<{ lat: number; lng: number }> = [];
  for (const row of rows) {
    const coords =
      locationCoords(row) ??
      locationCoords({
        Latitude: row.lat ?? row.Lat,
        Longitude: row.lng ?? row.Lng,
      });
    if (coords) points.push(coords);
  }
  return points;
}

function parseRoutePayload(raw: unknown): RouteHistory {
  const parsed = parseMaybeJson(raw);
  if (Array.isArray(parsed)) {
    const pins = asRows(parsed);
    const points = pins.map((row) => locationCoords(row)).filter((row): row is { lat: number; lng: number } => Boolean(row));
    return {
      pins,
      paths: points.length >= 2 ? [{ points }] : [],
    };
  }
  const data = asRecord(parsed) ?? {};
  const nested = data.trackingList ?? data.TrackingList ?? data.myDayData;
  if (nested && nested !== parsed) {
    const inner = parseRoutePayload(nested);
    if (inner.pins.length || inner.paths.length) return inner;
  }
  const start = asRecord(data.StartCoordinate) ?? asRecord(data.start);
  const end = asRecord(data.EndCoordinate) ?? asRecord(data.end);
  const markers = asRows(data.MarkerList ?? data.Markers ?? data.markers);
  const polylines = asRows(data.PolylineList ?? data.Polylines ?? data.polylines);
  const paths: RouteHistory["paths"] = [];
  for (const line of polylines) {
    const points = pathPoints(line.Path ?? line.path ?? line.Points ?? line.Coordinates ?? line);
    if (points.length >= 2) {
      paths.push({
        points,
        dotted: Boolean(line.LocationDisabled || line.FlightModeOn || line.DottedLines),
      });
    }
  }
  const pins = [...markers];
  if (start && (locationCoords(start) || locationCoords({ Latitude: start.lat, Longitude: start.lng }))) {
    pins.unshift({ ...start, Kind: "start", FullName: firstString(start, ["FullName", "Address"]) || "Start" });
  }
  if (end && (locationCoords(end) || locationCoords({ Latitude: end.lat, Longitude: end.lng }))) {
    pins.push({ ...end, Kind: "end", FullName: firstString(end, ["FullName", "Address"]) || "End" });
  }
  const distance = Number(data.DistanceInKilometers ?? data.Distance ?? data.distanceKm);
  return {
    pins,
    paths,
    distanceKm: Number.isFinite(distance) && distance > 0 ? distance : undefined,
    start,
    end,
  };
}

async function postTrackLog(path: string, userId: string, date: Date, wrap = false): Promise<unknown> {
  const body = trackLogRequest(userId, date);
  const envelope = await tebRequest("MICRO", path, {
    method: "POST",
    body: wrap ? { TrackLogRequest: body } : body,
  });
  return parseMaybeJson(envelope.Data ?? envelope.value ?? envelope.Value);
}

export async function getUserRouteHistory(userId: string, date = new Date()): Promise<RouteHistory> {
  if (!userId) return { pins: [], paths: [] };
  const methods = [
    "gateway/workforce/GetUserTrackingMapView",
    "gateway/workforce/GetUserTrackingListView",
    "gateway/workforce/GetUserTrackingTrip",
  ];
  for (const method of methods) {
    for (const wrap of [false, true]) {
      try {
        const payload = await postTrackLog(method, userId, date, wrap);
        const parsed = parseRoutePayload(payload);
        if (parsed.pins.length > 0 || parsed.paths.length > 0 || parsed.start || parsed.end) return parsed;
      } catch {
        // Next live route payload shape.
      }
    }
  }
  return { pins: [], paths: [] };
}

export async function getUserRouteHistories(userId: string, dates: Date[]): Promise<RouteHistory> {
  const days = dates.slice(0, 7);
  const parts = await Promise.all(days.map((day) => getUserRouteHistory(userId, day)));
  const merged: RouteHistory = { pins: [], paths: [], distanceKm: 0 };
  for (const part of parts) {
    merged.pins.push(...part.pins);
    merged.paths.push(...part.paths);
    if (part.distanceKm) merged.distanceKm = (merged.distanceKm ?? 0) + part.distanceKm;
    if (!merged.start) merged.start = part.start;
    merged.end = part.end ?? merged.end;
  }
  if (!merged.distanceKm) merged.distanceKm = undefined;
  return merged;
}
