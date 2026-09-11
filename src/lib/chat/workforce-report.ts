import { getCurrentUser } from "@/lib/auth/session";
import { ownerFromUser, type LookupOption } from "@/lib/api/quote-lookups";
import {
  getSubscriberUserDetail,
  getUserLastLocation,
  getUserRouteHistories,
  getWorkforceDaySnapshot,
  isUsablePersonName,
  joiningDate,
  lastLocationsForUsers,
  listDayTracking,
  listTeamMembers,
  listTrackingUserIds,
  listWorkforceUsers,
  locationCoords,
  locationLabel,
  personId,
  personName,
  punchEndTime,
  punchStartTime,
  startedDate,
  type WorkforceSnapshotStage,
} from "@/lib/api/workforce";
import { dateWindow, startOfDay } from "@/lib/chat/date-filter";
import { formatFriendlyDate } from "@/lib/format-date";
import { REPORT_ENTITIES } from "@/lib/chat/entities";
import { buildDatasetSummary, pickCharts } from "@/lib/chat/charts";
import type { ChartSeries, MapPath, MapPin, ReportIntent, ReportResult } from "@/lib/chat/types";

const WORKFORCE_HELP =
  "Ask about your team in plain language:\n• How many people started today\n• Members present yesterday\n• Find my team\n• Where is the user now\n• Show route for me";

const WORKFORCE_SUGGESTIONS = [
  "How many people started today",
  "Members present yesterday",
  "Find my team",
  "Where is the user now",
  "Show route for me",
];

const ATTENDANCE_COLUMNS = [
  { key: "FullName", title: "Name" },
  { key: "JobTitle", title: "Job title" },
  { key: "Site", title: "Site" },
  { key: "StartDate", title: "Start time", kind: "date" as const },
  { key: "EndDate", title: "End time", kind: "date" as const },
  { key: "Status", title: "Status" },
];

function asPeopleRow(row: Record<string, unknown>, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const merged = { ...row, ...extra };
  const nameCandidates = [extra.FullName, extra.Text, row.Text, row.FullName, personName(merged)].map((value) =>
    String(value ?? "").trim(),
  );
  const name = nameCandidates.find((value) => isUsablePersonName(value)) || "Unknown";
  const started = startedDate(merged);
  const place = locationLabel(merged);
  const coords = locationCoords(merged);
  return {
    ...merged,
    Id: personId(merged) || extra.Id || row.Id,
    FullName: name,
    Title: extra.Title ?? row.JobTitle ?? (isUsablePersonName(String(row.Title ?? "")) ? row.Title : name),
    Email: extra.Email ?? row.Email ?? row.SubText,
    Status: extra.Status ?? row.Status ?? (place || "Active"),
    Address: place || firstStringish(merged, ["StartAddress", "EndAddress", "CurrentAddress"]),
    Latitude: coords?.lat ?? merged.Latitude ?? merged.latitude,
    Longitude: coords?.lng ?? merged.Longitude ?? merged.longitude,
    CreatedDate: extra.CreatedDate ?? row.CreatedDate ?? (punchStartTime(merged) || started),
    DateOfJoining: joiningDate(merged) || started,
  };
}

function firstStringish(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value == null || typeof value === "object") continue;
    const text = String(value).trim();
    if (text && text !== "0" && text !== "0.0" && !/^-?\d+(\.\d+)?$/.test(text)) return text;
  }
  return "";
}

function formatPunchClock(raw: string): string {
  return formatFriendlyDate(raw) || raw;
}

function punchFocus(raw: string): "start" | "end" | "force" {
  if (/\bforce\s+end/i.test(raw)) return "force";
  if (/\b(end day|ended|punched out|punch out)\b/i.test(raw) && !/\b(start|present|punch(?:ed)? in)\b/i.test(raw)) {
    return "end";
  }
  return "start";
}

function stageCount(stages: WorkforceSnapshotStage[], id: string): number | undefined {
  const stage = stages.find((row) => row.id.toUpperCase() === id);
  return stage ? stage.count : undefined;
}

function snapshotCharts(intent: ReportIntent, stages: WorkforceSnapshotStage[]): ChartSeries[] {
  const points = stages
    .map((stage) => ({ label: stage.name, value: stage.count }))
    .filter((point) => Number.isFinite(point.value));
  if (points.length === 0) return [];
  const kind = intent.chart === "pie" ? "pie" : intent.chart === "line" ? "bar" : intent.stack === "count" ? "pie" : "bar";
  return [{ kind, title: "Workforce day", points }];
}

function matchPerson(options: LookupOption[], needle: string): LookupOption | null {
  const want = needle.toLowerCase().replace(/\s+/g, " ").trim();
  if (!want) return null;
  if (/^(me|my|mine)$/i.test(want)) {
    const me = ownerFromUser(getCurrentUser());
    if (me) return options.find((option) => option.id === me.id) ?? options[0] ?? null;
  }
  const fields = (option: LookupOption) =>
    [
      option.label,
      option.id,
      String(option.extra?.UserName ?? ""),
      String(option.extra?.userName ?? ""),
      String(option.extra?.Text ?? ""),
      String(option.extra?.Email ?? ""),
      String(option.extra?.SubText ?? ""),
    ]
      .map((value) => value.toLowerCase().trim())
      .filter(Boolean);
  const exact = options.filter((option) => fields(option).includes(want) || option.id === needle);
  if (exact.length === 1) return exact[0];
  const contains = options.filter((option) => fields(option).some((value) => value.includes(want)));
  if (contains.length === 1) return contains[0];
  return contains.sort((a, b) => a.label.length - b.label.length)[0] ?? exact[0] ?? null;
}

function inWindow(raw: string, from: Date, to: Date): boolean {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return false;
  return date >= from && date <= to;
}

function pinsFromRows(rows: Record<string, unknown>[]): MapPin[] {
  const pins: MapPin[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const coords = locationCoords(row);
    if (!coords) continue;
    const rawName = personName(row);
    const label = isUsablePersonName(rawName) ? rawName : String(row.Kind === "start" ? "Start" : row.Kind === "end" ? "End" : "");
    if (!label) continue;
    const key = `${label}:${coords.lat}:${coords.lng}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pins.push({
      lat: coords.lat,
      lng: coords.lng,
      label,
      subtitle: locationLabel(row),
      kind: row.Kind === "start" || row.Kind === "end" ? (row.Kind as "start" | "end") : "pin",
    });
  }
  return pins;
}

function appliedSearch(intent: ReportIntent, person?: string): ReportResult["applied"] {
  return { filterId: null, filterValues: null, fullTextSearch: person || intent.personName || "" };
}

function routeDates(intent: ReportIntent): Date[] {
  const window = intent.date ? dateWindow(intent.date) : null;
  if (!window) return [new Date()];
  const days: Date[] = [];
  const cursor = startOfDay(window.from);
  const end = startOfDay(window.to);
  while (cursor <= end && days.length < 7) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days.length > 0 ? days : [new Date()];
}

type EmptyResult = (
  partial: Omit<ReportResult, "analysis" | "charts" | "amount" | "metric" | "currencySymbol" | "currencyCode"> &
    Partial<Pick<ReportResult, "amount" | "metric" | "currencySymbol" | "currencyCode" | "map" | "paths" | "mapTitle">>,
) => ReportResult;

async function runPresentReport(intent: ReportIntent, emptyResult: EmptyResult): Promise<ReportResult> {
  const when = intent.date?.label || "today";
  const window = intent.date ? dateWindow(intent.date) : null;
  const from = window?.from ?? startOfDay(new Date());
  const to = window?.to ?? new Date();
  const focus = punchFocus(intent.raw);
  const chips = ["workforce", "present", when];
  if (focus !== "start") chips.push(focus === "end" ? "ended" : "force end");
  if (intent.personName) chips.push(intent.personName);

  const userIds = await listTrackingUserIds();
  const [snapshot, tracking, directory] = await Promise.all([
    getWorkforceDaySnapshot(from, to).catch(() => ({ total: 0, stages: [] as WorkforceSnapshotStage[] })),
    userIds.length > 0
      ? listDayTracking(from, to, userIds)
      : Promise.resolve({ rows: [] as Record<string, unknown>[], total: 0 }),
    listTeamMembers().catch(() => [] as LookupOption[]),
  ]);
  const namesById = new Map(
    directory.filter((option) => isUsablePersonName(option.label)).map((option) => [option.id, option.label]),
  );

  const unique = new Map<string, Record<string, unknown>>();
  for (const row of tracking.rows) {
    const id = personId(row) || String(row.Id ?? personName(row));
    const current = unique.get(id);
    if (!current || punchStartTime(row) > punchStartTime(current)) unique.set(id, row);
  }
  let people = [...unique.values()].map((row) => {
    const start = punchStartTime(row);
    const end = punchEndTime(row);
    const id = personId(row);
    const directoryName = (id && namesById.get(id)) || "";
    return asPeopleRow(row, {
      FullName: directoryName || personName(row),
      JobTitle: row.JobTitle,
      Title: row.JobTitle || directoryName || personName(row),
      Site: row.Site,
      StartDate: start,
      EndDate: end,
      Status: end ? "Ended" : start ? "Started" : "Not started",
      CreatedDate: start,
      Address: firstStringish(row, ["StartAddress", "EndAddress", "CurrentAddress", "Site"]),
    });
  });
  if (intent.personName) {
    const want = intent.personName.toLowerCase();
    people = people.filter(
      (row) => personName(row).toLowerCase().includes(want) || personId(row).toLowerCase() === want,
    );
  }

  const startedPeople = people.filter((row) => punchStartTime(row));
  const endedPeople = people.filter((row) => punchEndTime(row));
  const listed = focus === "end" ? endedPeople : focus === "force" ? [] : startedPeople;
  const startCount = intent.personName ? startedPeople.length : (stageCount(snapshot.stages, "STARTDAY") ?? startedPeople.length);
  const endCount = intent.personName ? endedPeople.length : (stageCount(snapshot.stages, "ENDDAY") ?? endedPeople.length);
  const forceCount = intent.personName ? 0 : (stageCount(snapshot.stages, "FORCEDENDDAY") ?? 0);
  const notStarted = stageCount(snapshot.stages, "NOTSTARTDAY");
  const headline = focus === "end" ? endCount : focus === "force" ? forceCount : startCount;
  const noun = headline === 1 ? "person" : "people";
  const focusText =
    focus === "end"
      ? `${headline} ${noun} ended ${when}.`
      : focus === "force"
        ? `${headline} ${noun} were force-ended ${when}.`
        : `${headline} ${noun} started ${when}.`;
  const extra = [
    focus === "start" ? `${endCount} ended` : `${startCount} started`,
    `${forceCount} force ended`,
    !intent.personName && notStarted != null ? `${notStarted} not started` : "",
  ]
    .filter(Boolean)
    .join(", ");
  const text =
    userIds.length === 0
      ? "I couldn't find workforce users for this login, so I can't count who punched in."
      : intent.personName
        ? listed.length
          ? `${intent.personName} ${focus === "end" ? "ended" : "started"} ${when}.`
          : `${intent.personName} did not ${focus === "end" ? "punch out" : "punch in"} ${when}.`
        : `${focusText} ${extra}.`;

  const lines =
    focus === "force"
      ? [
          forceCount > 0
            ? `${forceCount} force-ended ${when}. Names for force end are on the workforce card, not the day list.`
            : `Nobody was force-ended ${when}.`,
        ]
      : listed.slice(0, 12).map((row) => {
          const start = punchStartTime(row);
          const end = punchEndTime(row);
          const clock = start ? formatPunchClock(start) : "no punch-in";
          return end
            ? `${personName(row)} — started ${clock}, ended ${formatPunchClock(end)}`
            : `${personName(row)} — started ${clock}`;
        });
  if (listed.length > 12) lines.push(`and ${listed.length - 12} more`);

  const summary = buildDatasetSummary(listed, headline, "count");
  const charts =
    snapshot.stages.length > 0
      ? snapshotCharts(intent, snapshot.stages)
      : pickCharts({ ...intent, chart: intent.chart || "bar" }, summary);

  return {
    ...emptyResult({
      text,
      chips,
      total: headline,
      rows: listed,
      columns: ATTENDANCE_COLUMNS,
      entity: "workforce",
      stack: intent.stack === "count" ? "count" : "list",
      suggestions: WORKFORCE_SUGGESTIONS,
      applied: appliedSearch(intent),
    }),
    analysis: lines.length ? lines.join("\n") : `No matching people for ${when}.`,
    charts,
    summary,
  };
}

export async function runWorkforceReport(intent: ReportIntent, emptyResult: EmptyResult): Promise<ReportResult> {
  const entity = REPORT_ENTITIES.workforce;
  if (intent.listFilters || /\buser filter\b/i.test(intent.raw)) {
    return emptyResult({
      text: WORKFORCE_HELP,
      chips: ["workforce", "team", "where", "user", "route", "present"],
      total: 0,
      rows: [],
      columns: entity.columns,
      entity: "workforce",
      stack: "list",
      suggestions: WORKFORCE_SUGGESTIONS,
      applied: appliedSearch(intent),
    });
  }

  const topic = intent.workforceTopic || "team";
  if (topic === "started") {
    return runPresentReport(intent, emptyResult);
  }

  const [users, team] = await Promise.all([listWorkforceUsers(), listTeamMembers()]);
  const directory = users.length >= team.length ? users : mergeUnique(users, team);
  const chips = [
    "workforce",
    topic === "location" ? "last location" : topic === "joined" ? "joining date" : topic,
  ];
  if (intent.personName) chips.push(intent.personName);
  if (intent.date) chips.push(intent.date.label);

  if (directory.length === 0 && team.length === 0) {
    return emptyResult({
      text: "I couldn't find any team members for this login. This account may not have team tracking turned on.",
      chips,
      total: 0,
      rows: [],
      columns: entity.columns,
      entity: "workforce",
      stack: "list",
      suggestions: WORKFORCE_SUGGESTIONS,
      applied: appliedSearch(intent),
    });
  }

  const picked = intent.personName ? matchPerson(directory, intent.personName) : null;
  if (intent.personName && !picked) {
    return emptyResult({
      text: `I could not match user “${intent.personName}”.${directory.length ? ` Known people include: ${directory.slice(0, 8).map((row) => row.label).join(", ")}.` : ""}`,
      chips,
      total: 0,
      rows: [],
      columns: entity.columns,
      entity: "workforce",
      stack: "list",
      suggestions: [
        "Find my team",
        "Where is the user now",
        "Show route for me",
        ...directory.slice(0, 3).map((row) => `Where is ${row.label}`),
      ],
      applied: appliedSearch(intent),
    });
  }

  if (topic === "route") {
    const who = picked ?? matchPerson(directory, "me");
    if (!who) {
      return emptyResult({
        text: "I need a username to plot a route. Try “Show route for me” or “Route of Priya”.",
        chips,
        total: 0,
        rows: [],
        columns: entity.columns,
        entity: "workforce",
        stack: "list",
        suggestions: WORKFORCE_SUGGESTIONS,
        applied: appliedSearch(intent),
      });
    }
    const history = await getUserRouteHistories(who.id, routeDates(intent));
    const startEnd = [history.start, history.end].filter(Boolean) as Record<string, unknown>[];
    const map = pinsFromRows(
      startEnd.map((row, index) => ({
        ...row,
        Kind: index === 0 ? "start" : "end",
        FullName: index === 0 ? "Start" : "End",
      })),
    );
    const paths: MapPath[] = [...history.paths];
    if (paths.length === 0 && map.length >= 2) {
      paths.push({ points: map.map((pin) => ({ lat: pin.lat, lng: pin.lng })) });
    }
    const when = intent.date?.label || "today";
    const km = history.distanceKm != null ? ` (${history.distanceKm.toFixed(1)} km)` : "";
    const hasMap = map.length > 0 || paths.length > 0;
    const startPlace = locationLabel(history.start ?? {});
    const endPlace = locationLabel(history.end ?? {});
    const routePlaces = [startPlace ? `Start: ${startPlace}` : "", endPlace ? `End: ${endPlace}` : ""].filter(Boolean);
    return {
      ...emptyResult({
        text: hasMap
          ? `${who.label}’s route for ${when} is on the map${km}.`
          : `${who.label} has no route history for ${when}.`,
        chips,
        total: map.length || paths.reduce((sum, path) => sum + path.points.length, 0),
        rows: (history.pins.filter((row) => row.Kind === "start" || row.Kind === "end" || locationLabel(row)).length
          ? history.pins.filter((row) => row.Kind === "start" || row.Kind === "end" || locationLabel(row))
          : history.pins
        )
          .slice(0, 40)
          .map((row) => asPeopleRow(row, { FullName: who.label })),
        columns: entity.columns,
        entity: "workforce",
        stack: "list",
        map,
        paths,
        mapTitle: "Route",
        suggestions: WORKFORCE_SUGGESTIONS,
        applied: appliedSearch(intent, who.label),
      }),
      analysis: hasMap
        ? `${who.label} route ${when}${km}.${routePlaces.length ? ` ${routePlaces.join(" · ")}` : ""}`
        : `${who.label} has no tracked path for ${when}.`,
      charts: [],
      map,
      paths,
      mapTitle: "Route",
    };
  }

  if (topic === "location") {
    const who = picked ?? matchPerson(directory, "me");
    if (!who) {
      return emptyResult({
        text: "I need a username to find a last location. Try “Where is the user now” or “Where is Priya”.",
        chips,
        total: 0,
        rows: [],
        columns: entity.columns,
        entity: "workforce",
        stack: "list",
        suggestions: WORKFORCE_SUGGESTIONS,
        applied: appliedSearch(intent),
      });
    }
    const last = await getUserLastLocation(who.id);
    const detail = (await getSubscriberUserDetail(who.id)) ?? {};
    const row = asPeopleRow(who.extra ?? { Id: who.id }, {
      ...detail,
      ...(last ?? {}),
      Id: who.id,
      FullName: who.label,
      Status: last ? locationLabel(last) || "Located" : "No last location",
    });
    const place = locationLabel(last ?? row);
    const map = pinsFromRows([{ ...row, FullName: who.label }]);
    return {
      ...emptyResult({
        text: place
          ? `${who.label} was last seen at ${place}.`
          : map.length
            ? `${who.label} last known location is on the map.`
            : `${who.label} has no last location on file.`,
        chips,
        total: 1,
        rows: [row],
        columns: entity.columns,
        entity: "workforce",
        stack: "list",
        map,
        mapTitle: "Last location",
        suggestions: WORKFORCE_SUGGESTIONS,
        applied: appliedSearch(intent, who.label),
      }),
      analysis: place
        ? `${who.label} last location: ${place}.`
        : map.length
          ? `${who.label} last known location is on the map.`
          : `${who.label} is not sharing a last location right now.`,
      charts: [],
      map,
      mapTitle: "Last location",
    };
  }

  if (topic === "joined") {
    const extras = directory.map((option) =>
      asPeopleRow({ Id: option.id, ...(option.extra ?? {}) }, { FullName: option.label }),
    );
    const missing = extras.filter((row) => !joiningDate(row)).slice(0, 40);
    const fetched = await Promise.all(
      missing.map(async (row) => {
        const id = personId(row);
        const detail = id ? await getSubscriberUserDetail(id).catch(() => null) : null;
        return asPeopleRow(row, detail ?? {});
      }),
    );
    const byId = new Map(fetched.map((row) => [String(row.Id ?? personId(row)), row]));
    let details = extras.map((row) => byId.get(String(row.Id ?? personId(row))) ?? row);
    if (picked) details = details.filter((row) => personId(row) === picked.id || personName(row) === picked.label);
    const window = intent.date ? dateWindow(intent.date) : null;
    const rows = window
      ? details.filter((row) => {
          const raw = joiningDate(row);
          return raw ? inWindow(raw, window.from, window.to) : false;
        })
      : details;
    const summary = buildDatasetSummary(rows, rows.length, "count");
    const lines = rows
      .slice(0, 12)
      .map((row) => `${personName(row)} — joined ${formatFriendlyDate(joiningDate(row)) || "unknown"}`);
    return {
      ...emptyResult({
        text: window
          ? `${rows.length} people joined ${intent.date?.label ?? "in that period"}.`
          : `${rows.length} people with a joining date.`,
        chips,
        total: rows.length,
        rows,
        columns: entity.columns,
        entity: "workforce",
        stack: "list",
        suggestions: WORKFORCE_SUGGESTIONS,
        applied: appliedSearch(intent),
      }),
      analysis: lines.length ? lines.join("\n") : "No people matched that joining date.",
      charts: pickCharts({ ...intent, chart: "line" }, summary),
      summary,
    };
  }

  const members = team.length > 0 ? team : directory;
  let selected = members;
  if (picked) selected = members.filter((row) => row.id === picked.id || row.label === picked.label);
  const ids = selected.map((row) => row.id).filter(Boolean).slice(0, 80);
  const locations = await lastLocationsForUsers(ids);
  const byId = new Map(locations.map((row) => [personId(row), row]));
  const rows = selected.map((option) => {
    const extraId = String(option.extra?.UserId ?? option.extra?.MemberId ?? "");
    const last = byId.get(option.id) ?? (extraId ? byId.get(extraId) : undefined);
    return asPeopleRow(option.extra ?? { Id: option.id }, {
      ...(last ?? {}),
      Id: option.id,
      FullName: option.label,
      Status: last ? locationLabel(last) || "Signed in" : "No last location",
    });
  });
  const map = pinsFromRows(rows);
  const located = rows.filter((row) => locationLabel(row) || locationCoords(row));
  const lines = located.slice(0, 12).map((row) => {
    const place = locationLabel(row);
    const name = isUsablePersonName(personName(row)) ? personName(row) : String(row.FullName ?? "Unknown");
    return place ? `${name} — ${place}` : name;
  });
  const names = rows
    .slice(0, 12)
    .map((row) => personName(row))
    .filter((name) => isUsablePersonName(name));
  return {
    ...emptyResult({
      text: picked
        ? map.length
          ? `${picked.label} last known location is on the map.`
          : `${picked.label} is on your team but has no last known location.`
        : map.length
          ? `Your team has ${rows.length} ${rows.length === 1 ? "person" : "people"}. ${map.length} last-known location ${map.length === 1 ? "pin is" : "pins are"} on the map.`
          : `Your team has ${rows.length} ${rows.length === 1 ? "person" : "people"}, but none have a last known location right now.`,
      chips,
      total: rows.length,
      rows,
      columns: entity.columns,
      entity: "workforce",
      stack: "list",
      map,
      mapTitle: picked ? "Last location" : "Team",
      suggestions: WORKFORCE_SUGGESTIONS,
      applied: appliedSearch(intent, picked?.label),
    }),
    analysis: lines.length
      ? lines.join("\n")
      : names.length
        ? `Team: ${names.join(", ")}${rows.length > 12 ? "…" : ""}`
        : "No team members were returned.",
    charts: [],
    map,
    mapTitle: picked ? "Last location" : "Team",
  };
}

function mergeUnique(left: LookupOption[], right: LookupOption[]): LookupOption[] {
  const seen = new Map(left.map((row) => [row.id, row]));
  for (const option of right) {
    if (!option.id) continue;
    const current = seen.get(option.id);
    if (!current) {
      seen.set(option.id, option);
      continue;
    }
    if (!isUsablePersonName(current.label) && isUsablePersonName(option.label)) {
      seen.set(option.id, { ...current, label: option.label, extra: { ...current.extra, ...option.extra } });
    }
  }
  return [...seen.values()];
}
