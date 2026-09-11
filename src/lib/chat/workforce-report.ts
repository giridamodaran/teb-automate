import { getCurrentUser } from "@/lib/auth/session";
import { ownerFromUser, type LookupOption } from "@/lib/api/quote-lookups";
import {
  getSubscriberUserDetail,
  getUserLastLocation,
  getUserRouteHistories,
  lastLocationsForUsers,
  listTeamMembers,
  listWorkforceUsers,
  locationCoords,
  locationLabel,
  personId,
  personName,
  startedDate,
} from "@/lib/api/workforce";
import { dateWindow, startOfDay } from "@/lib/chat/date-filter";
import { REPORT_ENTITIES } from "@/lib/chat/entities";
import { buildDatasetSummary, pickCharts } from "@/lib/chat/charts";
import type { MapPath, MapPin, ReportIntent, ReportResult } from "@/lib/chat/types";

const WORKFORCE_HELP =
  "Ask about your team in plain language:\n• Find my team\n• Where is the user now\n• Where is Akash\n• Show route for me\n• Route of Priya";

const WORKFORCE_SUGGESTIONS = ["Find my team", "Where is the user now", "Show route for me"];

function asPeopleRow(row: Record<string, unknown>, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const merged = { ...row, ...extra };
  const name = personName(merged);
  const started = startedDate(merged);
  const place = locationLabel(merged);
  const coords = locationCoords(merged);
  return {
    ...merged,
    Id: personId(merged) || extra.Id || row.Id,
    FullName: name,
    Title: name,
    Email: extra.Email ?? row.Email ?? row.SubText,
    Status: extra.Status ?? row.Status ?? (place || "Active"),
    Address: place,
    Latitude: coords?.lat ?? merged.Latitude ?? merged.latitude,
    Longitude: coords?.lng ?? merged.Longitude ?? merged.longitude,
    CreatedDate: extra.CreatedDate ?? row.CreatedDate ?? started,
    DateOfJoining: started,
  };
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
    const label = personName(row);
    const key = `${label}:${coords.lat}:${coords.lng}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pins.push({
      lat: coords.lat,
      lng: coords.lng,
      label,
      subtitle: locationLabel(row) || `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`,
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

export async function runWorkforceReport(intent: ReportIntent, emptyResult: EmptyResult): Promise<ReportResult> {
  const entity = REPORT_ENTITIES.workforce;
  if (intent.listFilters || /\buser filter\b/i.test(intent.raw)) {
    return emptyResult({
      text: WORKFORCE_HELP,
      chips: ["workforce", "team", "where", "user", "route"],
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
  const [users, team] = await Promise.all([listWorkforceUsers(), listTeamMembers()]);
  const directory = users.length >= team.length ? users : mergeUnique(users, team);
  const chips = [
    "workforce",
    topic === "location" ? "last location" : topic === "started" ? "start date" : topic,
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
    const map = pinsFromRows([
      ...startEnd.map((row, index) => ({
        ...row,
        Kind: index === 0 ? "start" : "end",
        FullName: index === 0 ? "Start" : "End",
      })),
      ...history.pins,
    ]);
    const paths: MapPath[] = [...history.paths];
    if (paths.length === 0 && map.length >= 2) {
      paths.push({ points: map.map((pin) => ({ lat: pin.lat, lng: pin.lng })) });
    }
    const when = intent.date?.label || "today";
    const km = history.distanceKm != null ? ` (${history.distanceKm.toFixed(1)} km)` : "";
    const hasMap = map.length > 0 || paths.length > 0;
    return {
      ...emptyResult({
        text: hasMap
          ? `${who.label}’s route for ${when} is on the map${km}.`
          : `${who.label} has no route history for ${when}.`,
        chips,
        total: map.length || paths.reduce((sum, path) => sum + path.points.length, 0),
        rows: history.pins.slice(0, 40).map((row) => asPeopleRow(row, { FullName: who.label })),
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
        ? `${who.label} route ${when}${km}. Start and end pins plus the tracked path.`
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
    const row = asPeopleRow(who.extra ?? { Id: who.id, FullName: who.label }, {
      ...detail,
      ...(last ?? {}),
      Status: last ? locationLabel(last) || "Located" : "No last location",
    });
    const place = locationLabel(last ?? row);
    const map = pinsFromRows([row]);
    return {
      ...emptyResult({
        text: place ? `${who.label} was last seen at ${place}.` : `${who.label} has no last location on file.`,
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
        : `${who.label} is not sharing a last location right now.`,
      charts: [],
      map,
      mapTitle: "Last location",
    };
  }

  if (topic === "started") {
    const extras = directory.map((option) =>
      asPeopleRow({ Id: option.id, FullName: option.label, ...(option.extra ?? {}) }),
    );
    const missing = extras.filter((row) => !startedDate(row)).slice(0, 40);
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
          const raw = startedDate(row);
          return raw ? inWindow(raw, window.from, window.to) : false;
        })
      : details;
    const summary = buildDatasetSummary(rows, rows.length, "count");
    const lines = rows
      .slice(0, 12)
      .map((row) => `${personName(row)} — started ${startedDate(row) || "unknown"}`);
    return {
      ...emptyResult({
        text: window
          ? `${rows.length} people started ${intent.date?.label ?? "in that period"}.`
          : `${rows.length} people with a start date.`,
        chips,
        total: rows.length,
        rows,
        columns: entity.columns,
        entity: "workforce",
        stack: "list",
        suggestions: WORKFORCE_SUGGESTIONS,
        applied: appliedSearch(intent),
      }),
      analysis: lines.length ? lines.join("\n") : "No people matched that start date.",
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
    return asPeopleRow(option.extra ?? { Id: option.id, FullName: option.label }, {
      ...(last ?? {}),
      Status: last ? locationLabel(last) || "Signed in" : "No last location",
    });
  });
  const map = pinsFromRows(rows);
  const located = rows.filter((row) => locationLabel(row) || locationCoords(row));
  const lines = located.slice(0, 12).map((row) => `${personName(row)} — ${locationLabel(row)}`);
  const names = rows.slice(0, 12).map((row) => personName(row));
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
  const seen = new Set(left.map((row) => row.id));
  return [...left, ...right.filter((row) => row.id && !seen.has(row.id))];
}
