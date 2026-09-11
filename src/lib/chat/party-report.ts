import { getAccessToken } from "@/lib/auth/session";
import {
  getPartyDetail,
  listCustomers,
  listReportingCustomers,
  partyDisplayName,
  partyKindFromEntity,
  searchParties,
  toPartyCard,
  toPartyProfile,
  type PartyCard,
  type PartyKind,
  type PartyProfile,
} from "@/lib/api/party";
import {
  fallbackPartyFilterTabs,
  getFilterScreen,
  listSavedFilters,
  loadMasterByCode,
} from "@/lib/api/filters";
import { listLocations, listOwners, ownerFromUser, type LookupOption } from "@/lib/api/quote-lookups";
import type { TebUserDetail } from "@/lib/api/types";
import { aliasFamily, matchTab, tabPhrases } from "@/lib/chat/filter-fields";
import { REPORT_ENTITIES } from "@/lib/chat/entities";
import { dateWindow, modeLabel, toLiveDateFilter } from "@/lib/chat/date-filter";
import { buildDatasetSummary, localAnalysis, rowDate, rowOwner } from "@/lib/chat/charts";
import type { ChatHistoryTurn } from "@/lib/chat/journey";
import type {
  ChartSeries,
  FilterTab,
  FilterValueRow,
  ReportIntent,
  ReportResult,
} from "@/lib/chat/types";
import { userFacingAskError } from "@/lib/chat/user-copy";

type EmptyResult = (
  partial: Omit<ReportResult, "analysis" | "charts" | "amount" | "metric" | "currencySymbol" | "currencyCode"> &
    Partial<Pick<ReportResult, "amount" | "metric" | "currencySymbol" | "currencyCode" | "partyCards" | "partyProfile">>,
) => ReportResult;

function normalize(value: string): string {
  return value.toLowerCase().replace(/[-_/]+/g, " ").replace(/\s+/g, " ").trim();
}

function matchLookups(options: LookupOption[], needle: string): LookupOption[] {
  const want = normalize(needle);
  if (!want) return [];
  const exact = options.filter((option) => normalize(option.label) === want || option.id === needle);
  if (exact.length > 0) return exact;
  const starts = options.filter((option) => normalize(option.label).startsWith(want));
  if (starts.length === 1) return starts;
  return options.filter((option) => normalize(option.label).includes(want));
}

function isGuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}

function multiValueRow(tab: FilterTab, ids: string[]): FilterValueRow {
  return {
    TabCode: tab.Code,
    PropertyName: tab.DbFieldName || tab.Code.toLowerCase(),
    ControlType: "MULTIVALUE",
    LabelName: tab.Title,
    MultiValue: ids,
    SelectedValue: ids,
    DateFilter: null,
  };
}

function otherKind(kind: PartyKind): PartyKind {
  return kind === "CONTACT" ? "COMPANY" : "CONTACT";
}

function wantsCompanyProfile(intent: ReportIntent, kind: PartyKind): boolean {
  return kind === "CONTACT" && /\bcompany profile\b/i.test(intent.raw);
}

function partyHelp(kind: PartyKind): string {
  const noun = kind === "CONTACT" ? "contacts" : "companies";
  return `Ask about ${noun} in plain language.\n\nYou can mention owner, location, industry, sector, source, relationship, contact type, dates, or a name.\n\nExamples:\n• ${kind === "CONTACT" ? "Contacts" : "Companies"} created last 7 days\n• Search ${noun} Acme\n• ${kind === "CONTACT" ? "Contact" : "Company"} profile for Acme\n• Phone and email for Acme\n• What filters can I use on ${noun}?`;
}

function partySuggestions(kind: PartyKind): string[] {
  const noun = kind === "CONTACT" ? "contacts" : "companies";
  const title = kind === "CONTACT" ? "Contact" : "Company";
  return [
    `${kind === "CONTACT" ? "Contacts" : "Companies"} created last 7 days`,
    `Search ${noun}`,
    `What filters can I use on ${noun}?`,
    `${title} profile for …`,
  ];
}

function appliedOf(intent: ReportIntent, filterId: string | null, filterValues: FilterValueRow[] | null): ReportResult["applied"] {
  return { filterId, filterValues, fullTextSearch: intent.search || "" };
}

function cardsFromRows(rows: Record<string, unknown>[], kind: PartyKind, limit = 8): PartyCard[] {
  const cards: PartyCard[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const card = toPartyCard(row, kind);
    if (!card || seen.has(card.id)) continue;
    seen.add(card.id);
    cards.push(card);
    if (cards.length >= limit) break;
  }
  return cards;
}

function partyCharts(rows: Record<string, unknown>[]): ChartSeries[] {
  const count = (labelOf: (row: Record<string, unknown>) => string, title: string, kind: ChartSeries["kind"]): ChartSeries | null => {
    const map = new Map<string, number>();
    for (const row of rows) {
      const label = labelOf(row) || "Unknown";
      map.set(label, (map.get(label) || 0) + 1);
    }
    const points = [...map.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
    return points.length ? { kind, title, points } : null;
  };
  const charts: ChartSeries[] = [];
  const industry = count(
    (row) => String(row.IndustryName || row.SectorName || row.ContactTypeName || "").trim(),
    "By industry",
    "pie",
  );
  const owner = count((row) => rowOwner(row), "By owner", "bar");
  const monthMap = new Map<string, number>();
  for (const row of rows) {
    const date = rowDate(row) || rowDate(row, "updated");
    if (!date) continue;
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    monthMap.set(key, (monthMap.get(key) || 0) + 1);
  }
  const months = [...monthMap.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => a.label.localeCompare(b.label));
  if (industry) charts.push(industry);
  if (owner) charts.push(owner);
  if (months.length > 1) charts.push({ kind: "line", title: "Created by month", points: months });
  return charts;
}

function refinePartyRows(
  rows: Record<string, unknown>[],
  intent: ReportIntent,
  ownerIds: string[],
  meLabel: string,
  extraNames: Record<string, string[]>,
): Record<string, unknown>[] {
  let next = rows;
  const window = intent.date ? dateWindow(intent.date) : null;
  if (window) {
    next = next.filter((row) => {
      const date = rowDate(row) || rowDate(row, "updated");
      if (!date) return false;
      return date >= window.from && date <= window.to;
    });
  }
  if (ownerIds.length > 0 || (intent.ownerMe && meLabel)) {
    next = next.filter((row) => {
      const ownerId = String(row.OwnerId ?? row.ownerid ?? "");
      if (ownerId && ownerIds.includes(ownerId)) return true;
      if (meLabel && normalize(rowOwner(row)).includes(normalize(meLabel))) return true;
      return false;
    });
  }
  const haystack = (row: Record<string, unknown>, keys: string[]) =>
    keys.map((key) => String(row[key] ?? "")).join(" ");
  const matchNames = (row: Record<string, unknown>, keys: string[], names: string[]) => {
    if (!names.length) return true;
    const blob = normalize(haystack(row, keys));
    return names.some((name) => blob.includes(normalize(name)));
  };
  next = next.filter((row) => matchNames(row, ["IndustryName", "IndustryId"], extraNames.industry || []));
  next = next.filter((row) => matchNames(row, ["LocationName", "CompanyLocationName", "LocationId", "City"], extraNames.location || []));
  next = next.filter((row) => matchNames(row, ["SectorName"], extraNames.sector || []));
  next = next.filter((row) => matchNames(row, ["SourceName", "SourceCategory"], extraNames.source || []));
  next = next.filter((row) =>
    matchNames(row, ["RelationShipTypeNames", "RelationshipType"], extraNames.relationship || []),
  );
  next = next.filter((row) => matchNames(row, ["ContactTypeName", "ContactTypeId"], extraNames.contacttype || []));
  next = next.filter((row) => matchNames(row, ["CompanyName", "CompanyId"], extraNames.company || []));
  if (intent.search) {
    const needle = normalize(intent.search);
    next = next.filter((row) =>
      normalize(`${partyDisplayName(row)} ${row.CompanyName ?? ""} ${row.CompanyCode ?? ""} ${row.Email ?? ""}`).includes(
        needle,
      ),
    );
  }
  return next;
}

async function loadPartyScreen(kind: PartyKind) {
  const moduleCode = kind === "CONTACT" ? "TEBPeople" : "TEBBusiness";
  const screenCode = kind === "CONTACT" ? "CONTACTFILTER" : "COMPANYFILTER";
  try {
    const screen = await getFilterScreen(moduleCode, screenCode);
    if (screen.Tabs.length > 0) return screen;
  } catch {
    // Subscriber may not have a company/contact filter form.
  }
  return { Tabs: fallbackPartyFilterTabs(kind), Controls: [], ExtraApi: [] };
}

async function resolveNeedle(options: LookupOption[], needle: string): Promise<LookupOption[]> {
  return matchLookups(options, needle);
}

async function analyze(
  question: string,
  summary: ReturnType<typeof buildDatasetSummary>,
  history: ChatHistoryTurn[],
): Promise<string> {
  try {
    const token = getAccessToken();
    const res = await fetch("/api/ask/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ question, summary, history: history.slice(-8) }),
    });
    const json = (await res.json()) as { analysis?: string };
    if (json.analysis) return json.analysis;
  } catch {
    // Local commentary is enough when GenAI is unavailable.
  }
  return localAnalysis(question, summary);
}

async function profileFor(
  kind: PartyKind,
  id: string,
  intent: ReportIntent,
): Promise<{ row: Record<string, unknown>; profile: PartyProfile; kind: PartyKind } | null> {
  const row = await getPartyDetail(kind, id);
  if (!row) return null;
  if (wantsCompanyProfile(intent, kind)) {
    const companyId = String(row.CompanyId ?? "");
    if (companyId) {
      const company = await getPartyDetail("COMPANY", companyId);
      const profile = company ? toPartyProfile(company, "COMPANY") : null;
      if (company && profile) return { row: company, profile, kind: "COMPANY" };
    }
  }
  const profile = toPartyProfile(row, kind);
  return profile ? { row, profile, kind } : null;
}

export async function runPartyReport(
  intent: ReportIntent,
  user: TebUserDetail | null,
  emptyResult: EmptyResult,
  history: ChatHistoryTurn[] = [],
): Promise<ReportResult> {
  const entity = REPORT_ENTITIES[intent.entity === "contact" ? "contact" : "company"];
  const kind = partyKindFromEntity(entity.key === "contact" ? "contact" : "company");
  const suggestions = partySuggestions(kind);

  if (intent.listFilters) {
    const screen = await loadPartyScreen(kind);
    const tabs = screen.Tabs.length > 0 ? screen.Tabs : fallbackPartyFilterTabs(kind);
    const lines = tabs.map((tab) => String(tab.Title || "").trim()).filter(Boolean).map((title) => `• ${title}`);
    return emptyResult({
      text: `${partyHelp(kind)}\n\nYou can filter ${entity.plural} by:\n${lines.join("\n")}`,
      chips: [entity.plural, "filter fields"],
      total: 0,
      rows: [],
      columns: entity.columns,
      entity: entity.key,
      stack: "list",
      suggestions: [...tabs.flatMap((tab) => tabPhrases(tab)).slice(0, 4), ...suggestions.slice(0, 2)],
      applied: appliedOf(intent, null, null),
    });
  }

  const topic = intent.partyTopic || (intent.search ? "search" : "list");
  const extraChips: string[] = [];
  if (topic !== "list") extraChips.push(topic);
  if (topic === "search" && !(intent.search || "").trim()) {
    return emptyResult({
      text: `Tell me the ${entity.title.toLowerCase()} name to search for.`,
      chips: [entity.plural, "search"],
      total: 0,
      rows: [],
      columns: entity.columns,
      entity: entity.key,
      stack: "list",
      suggestions,
      applied: appliedOf(intent, null, null),
    });
  }
  const me = ownerFromUser(user);
  const owners = await listOwners().catch(() => [] as LookupOption[]);
  let ownerIds: string[] = [];
  if (intent.ownerMe && me) ownerIds = [me.id];
  if (intent.ownerName) {
    const matches = matchLookups(owners, intent.ownerName);
    if (matches.length === 0) {
      return emptyResult({
        text: `I could not match owner “${intent.ownerName}”.${owners.length ? ` Known values include: ${owners.slice(0, 8).map((row) => row.label).join(", ")}.` : ""}`,
        chips: [entity.plural],
        total: 0,
        rows: [],
        columns: entity.columns,
        entity: entity.key,
        stack: "list",
        suggestions,
        applied: appliedOf(intent, null, null),
      });
    }
    ownerIds = [...new Set([...ownerIds, ...matches.map((row) => row.id)])];
  }

  const screen = await loadPartyScreen(kind);
  const tabs = screen.Tabs.length > 0 ? screen.Tabs : fallbackPartyFilterTabs(kind);
  const extraNames: Record<string, string[]> = {};
  const filterValues: FilterValueRow[] = [];
  const used = new Set<string>();

  for (const row of intent.criteria) {
    const family = aliasFamily(row.key);
    extraNames[family] = [...(extraNames[family] || []), ...row.values];
    const tab = matchTab(tabs, row.key);
    if (!tab || row.values.length === 0) continue;
    let options: LookupOption[] = [];
    if (family === "owner") options = owners;
    else if (family === "location") options = await listLocations().catch(() => []);
    else if (family === "industry") options = await loadMasterByCode("INDUSTRY");
    else if (family === "sector") options = await loadMasterByCode("SECTOR");
    else if (family === "source") {
      options = await loadMasterByCode("SOURCE");
      if (options.length === 0) options = await loadMasterByCode("LEADSOURCE");
    } else if (family === "sourcecategory") options = await loadMasterByCode("SOURCECATEGORY");
    else if (family === "relationship") options = await loadMasterByCode("RELATIONSHIPTYPE");
    else if (family === "contacttype") options = await loadMasterByCode("CONTACTTYPE");
    const ids: string[] = [];
    for (const value of row.values) {
      const matches = await resolveNeedle(options, value);
      if (matches.length > 0) ids.push(...matches.map((item) => item.id));
      else ids.push(value);
    }
    const code = String(tab.Code || "").toUpperCase();
    if (ids.length === 0 || used.has(code)) continue;
    filterValues.push(multiValueRow(tab, ids));
    used.add(code);
  }

  const ownerTab = tabs.find((tab) => String(tab.Code || "").toUpperCase().includes("OWNER"));
  if (ownerIds.length > 0 && ownerTab && !used.has(String(ownerTab.Code || "").toUpperCase())) {
    filterValues.push(multiValueRow(ownerTab, ownerIds));
  }

  let filterId: string | null = null;
  if (intent.savedFilterName || intent.useDefaultFilter) {
    const saved = await listSavedFilters(entity.listModule, kind === "CONTACT" ? "MANAGECONTACT" : "MANAGECOMPANY");
    const named = intent.savedFilterName
      ? saved.find((row) => normalize(row.label) === normalize(intent.savedFilterName || ""))
      : saved.find((row) => Boolean(row.extra?.IsDefault)) || saved[0];
    if (named) filterId = named.id;
  }

  const needle = (intent.search || "").trim();
  const dateFilter = intent.date ? toLiveDateFilter(intent.date) : null;

  try {
    if ((topic === "profile" || topic === "search") && needle) {
      if (isGuid(needle)) {
        const loaded = (await profileFor(kind, needle, intent)) || (await profileFor(otherKind(kind), needle, intent));
        if (loaded) {
          extraChips.push("profile");
          return emptyResult({
            text: `${loaded.profile.name} — tap a number to call or an email to write.`,
            chips: [entity.plural, ...extraChips],
            total: 1,
            rows: [loaded.row],
            columns: entity.columns,
            entity: loaded.kind === "CONTACT" ? "contact" : "company",
            stack: "list",
            partyCards: [loaded.profile],
            partyProfile: loaded.profile,
            suggestions: [
              kind === "CONTACT" ? "Contacts created last 7 days" : "Companies created last 7 days",
              `What filters can I use on ${entity.plural}?`,
            ],
            applied: appliedOf(intent, filterId, filterValues.length ? filterValues : null),
          });
        }
      }

      let activeKind = kind;
      let lookedUp = await searchParties(activeKind, needle);
      const listed = await listCustomers({
        kind: activeKind,
        search: needle,
        pageSize: intent.pageSize,
        filterId,
        filterValues: filterValues.length ? filterValues : null,
        dateFilter,
        ownerIds,
      });
      let rows = listed.rows;
      let total = listed.total;
      if (rows.length === 0 && lookedUp.length === 0) {
        const alt = otherKind(activeKind);
        const altLookup = await searchParties(alt, needle);
        const altList = await listCustomers({
          kind: alt,
          search: needle,
          pageSize: intent.pageSize,
        });
        if (altList.rows.length > 0 || altLookup.length > 0) {
          activeKind = alt;
          lookedUp = altLookup;
          rows = altList.rows;
          total = altList.total;
          extraChips.push(alt === "CONTACT" ? "contacts" : "companies");
        }
      }
      if (rows.length === 0 && lookedUp.length > 0) {
        extraChips.push("search");
        const details = await Promise.all(lookedUp.slice(0, 8).map((option) => getPartyDetail(activeKind, option.id)));
        rows = details.filter((row): row is Record<string, unknown> => Boolean(row));
        total = lookedUp.length;
      }

      const exact = rows.filter((row) => normalize(partyDisplayName(row)) === normalize(needle));
      const profileSource = exact.length === 1 ? exact[0] : rows.length === 1 ? rows[0] : null;
      if ((topic === "profile" || /\b(profile|phone|e-?mail|number|call)\b/i.test(intent.raw)) && profileSource) {
        const id = String(profileSource.Id ?? profileSource.id ?? "");
        const loaded = id ? await profileFor(activeKind, id, intent) : null;
        const profile = loaded?.profile || toPartyProfile(profileSource, activeKind);
        if (profile) {
          return emptyResult({
            text: `${profile.name} — tap a number to call or an email to write.`,
            chips: [activeKind === "CONTACT" ? "contacts" : "companies", "profile", ...extraChips],
            total: 1,
            rows: [loaded?.row || profileSource],
            columns: REPORT_ENTITIES[activeKind === "CONTACT" ? "contact" : "company"].columns,
            entity: (loaded?.kind || activeKind) === "CONTACT" ? "contact" : "company",
            stack: "list",
            partyCards: [profile],
            partyProfile: profile,
            suggestions: [
              `${activeKind === "CONTACT" ? "Contacts" : "Companies"} created last 7 days`,
              `What filters can I use on ${activeKind === "CONTACT" ? "contacts" : "companies"}?`,
            ],
            applied: appliedOf(intent, filterId, filterValues.length ? filterValues : null),
          });
        }
      }

      if (rows.length === 0 && lookedUp.length > 0) {
        rows = lookedUp.map((option) => ({
          Id: option.id,
          FullName: option.label,
          CompanyName: option.label,
          ...(option.extra ?? {}),
        }));
        total = lookedUp.length;
      }

      const meLabel = me?.label || "";
      const refined = refinePartyRows(rows, { ...intent, search: undefined }, ownerIds, meLabel, extraNames);
      if (refined.length && refined.length !== rows.length) {
        rows = refined;
        total = refined.length;
        extraChips.push("narrowed to matching rows");
      }
      const cards = cardsFromRows(rows, activeKind);
      const summary = buildDatasetSummary(rows, total, "count", null, false);
      const noun = REPORT_ENTITIES[activeKind === "CONTACT" ? "contact" : "company"];
      return {
        text:
          cards.length === 1
            ? `${cards[0].name} — tap a number to call or an email to write.`
            : `${total.toLocaleString()} ${total === 1 ? noun.title.toLowerCase() : noun.plural}${needle ? ` matching “${needle}”` : ""}.`,
        analysis: rows.length ? await analyze(intent.raw, summary, history) : `No ${noun.plural} matched “${needle}”.`,
        chips: [noun.plural, "search", ...extraChips, ...(intent.date ? [modeLabel(intent.date)] : [])],
        total,
        amount: 0,
        metric: "count",
        currencySymbol: "",
        currencyCode: "",
        rows,
        columns: noun.columns,
        charts: partyCharts(rows),
        summary,
        entity: noun.key,
        stack: intent.stack,
        partyCards: cards,
        suggestions: partySuggestions(activeKind),
        applied: appliedOf(intent, filterId, filterValues.length ? filterValues : null),
      };
    }

    const listed = await listCustomers({
      kind,
      search: needle,
      pageSize: intent.pageSize,
      filterId,
      filterValues: filterValues.length ? filterValues : null,
      dateFilter,
      ownerIds,
    });
    let rows = listed.rows;
    let total = listed.total;
    if (rows.length === 0) {
      const fallback = await listReportingCustomers(kind, intent.pageSize, dateFilter);
      if (fallback && fallback.rows.length > 0) {
        rows = fallback.rows;
        total = fallback.total;
      }
    }
    const meLabel = me?.label || "";
    const refined = refinePartyRows(rows, { ...intent, search: needle ? undefined : intent.search }, ownerIds, meLabel, extraNames);
    if (refined.length !== rows.length) {
      rows = refined;
      total = refined.length;
      extraChips.push("narrowed to matching rows");
    }
    const cards = cardsFromRows(rows, kind);
    const summary = buildDatasetSummary(rows, total, "count", null, false);
    const qualifier = [
      ...(intent.date ? [modeLabel(intent.date)] : []),
      ...(intent.ownerMe ? ["owned by me"] : []),
      ...(intent.ownerName ? [`owner ${intent.ownerName}`] : []),
    ];
    return {
      text: `${total.toLocaleString()} ${total === 1 ? entity.title.toLowerCase() : entity.plural}${qualifier.length ? ` (${qualifier.join(" · ")})` : ""}.`,
      analysis:
        rows.length > 0
          ? await analyze(intent.raw, summary, history)
          : `No matching ${entity.plural} were found for those filters.`,
      chips: [entity.plural, ...extraChips, ...qualifier],
      total,
      amount: 0,
      metric: "count",
      currencySymbol: "",
      currencyCode: "",
      rows,
      columns: entity.columns,
      charts: partyCharts(rows),
      summary,
      entity: entity.key,
      stack: intent.stack,
      partyCards: cards,
      suggestions,
      applied: appliedOf(intent, filterId, filterValues.length ? filterValues : null),
    };
  } catch (err) {
    return emptyResult({
      text: userFacingAskError(err),
      chips: [entity.plural],
      total: 0,
      rows: [],
      columns: entity.columns,
      entity: entity.key,
      stack: "list",
      suggestions,
      applied: appliedOf(intent, filterId, filterValues.length ? filterValues : null),
    });
  }
}
