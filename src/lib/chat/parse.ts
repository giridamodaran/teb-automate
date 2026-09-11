import type { DateRangeIntent, FilterCriterion, PartyTopic, QuoteTopic, ReportIntent, ReportStack, WorkforceTopic } from "@/lib/chat/types";
import { findEntityByKeyword, type ReportEntityKey } from "@/lib/chat/entities";
import { mergeCriteria, parseCriteria, parseItemPhrases, splitFilterValues } from "@/lib/chat/filter-fields";
import {
  addDays,
  anyTime,
  betweenRange,
  fieldTypeFromText,
  startOfDay,
  withinDays,
  withinPeriod,
} from "@/lib/chat/date-filter";

function parseDate(text: string): DateRangeIntent | undefined {
  const field = fieldTypeFromText(text);
  if (/\b(any time|all time|no date)\b/i.test(text)) return anyTime(field);

  const lastDays = text.match(/\blast\s+(\d{1,3})\s+days?\b/i);
  if (lastDays) {
    const days = Math.max(1, Number(lastDays[1]));
    return withinDays(field, days, `last ${days} days`);
  }
  const lastMonths = text.match(/\blast\s+(\d{1,2})\s+months?\b/i);
  if (lastMonths) {
    const months = Math.max(1, Number(lastMonths[1]));
    return withinPeriod(field, months, "FILTERMONTHS", `last ${months} months`);
  }
  const lastYears = text.match(/\blast\s+(\d{1,2})\s+years?\b/i);
  if (lastYears) {
    const years = Math.max(1, Number(lastYears[1]));
    return withinPeriod(field, years, "FILTERYEARS", `last ${years} years`);
  }
  if (/\blast\s+7\s*d\b|\bpast week\b/i.test(text)) return withinDays(field, 7, "last 7 days");

  const now = new Date();
  if (/\btoday\b/i.test(text)) return betweenRange(field, now, now, "today");
  if (/\byesterday\b/i.test(text)) {
    const day = addDays(now, -1);
    return betweenRange(field, day, day, "yesterday");
  }
  if (/\bthis week\b/i.test(text)) {
    const start = startOfDay(now);
    const weekday = start.getDay();
    start.setDate(start.getDate() - (weekday === 0 ? 6 : weekday - 1));
    return betweenRange(field, start, now, "this week");
  }
  if (/\blast week\b/i.test(text)) {
    const start = startOfDay(now);
    const weekday = start.getDay();
    start.setDate(start.getDate() - (weekday === 0 ? 6 : weekday - 1) - 7);
    return betweenRange(field, start, addDays(start, 6), "last week");
  }
  if (/\bthis month\b/i.test(text)) {
    return betweenRange(field, new Date(now.getFullYear(), now.getMonth(), 1), now, "this month");
  }
  if (/\blast month\b/i.test(text)) {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    return betweenRange(field, start, end, "last month");
  }
  if (/\bthis quarter\b/i.test(text)) {
    const quarter = Math.floor(now.getMonth() / 3) * 3;
    return betweenRange(field, new Date(now.getFullYear(), quarter, 1), now, "this quarter");
  }
  if (/\blast quarter\b/i.test(text)) {
    const quarter = Math.floor(now.getMonth() / 3) * 3;
    const start = new Date(now.getFullYear(), quarter - 3, 1);
    const end = new Date(now.getFullYear(), quarter, 0);
    return betweenRange(field, start, end, "last quarter");
  }
  if (/\bthis year\b/i.test(text)) {
    return betweenRange(field, new Date(now.getFullYear(), 0, 1), now, "this year");
  }
  if (/\blast year\b/i.test(text)) {
    return betweenRange(field, new Date(now.getFullYear() - 1, 0, 1), new Date(now.getFullYear() - 1, 11, 31), "last year");
  }

  const isoBetween = text.match(
    /\bbetween\s+(\d{4}-\d{2}-\d{2})\s+and\s+(\d{4}-\d{2}-\d{2})\b/i,
  );
  if (isoBetween) {
    return betweenRange(field, new Date(isoBetween[1]), new Date(isoBetween[2]), `${isoBetween[1]} – ${isoBetween[2]}`);
  }
  const isoDay = text.match(/\b(?:on\s+)?(\d{4}-\d{2}-\d{2})\b/i);
  if (isoDay && /\b(started|joined|joining|start date|present|punch|attendance|start day|end day)\b/i.test(text)) {
    const day = new Date(isoDay[1]);
    if (!Number.isNaN(day.getTime())) return betweenRange(field, day, day, isoDay[1]);
  }
  const startedRest = text.match(/\b(?:started|joined|present)\s+(?:on\s+)?([0-9]{1,2}[\/\-.][0-9]{1,2}[\/\-.][0-9]{2,4})\b/i);
  if (startedRest) {
    const day = new Date(startedRest[1]);
    if (!Number.isNaN(day.getTime())) return betweenRange(field, day, day, startedRest[1]);
  }
  return undefined;
}

function parseMetric(text: string): "count" | "value" | undefined {
  if (/\b(how many|number of|no\.?\s*of|count of|record count)\b/i.test(text) && !/\bvalue\b/i.test(text)) return "count";
  if (
    /\b(by value|quote value|invoice value|order value|ticket value|total value|total amount|net amount|grand total|worth|revenue|pipeline|sum)\b/i.test(text) ||
    /\bvalues?\b/i.test(text)
  ) {
    return "value";
  }
  return undefined;
}

export function isDashboardQuestion(text: string): boolean {
  return /\b(management dashboard|sales dashboard|team snapshot|snapshot|dashboard|overview|kpi|funnel)\b/i.test(
    text,
  );
}

function parseStack(text: string, metric?: "count" | "value"): ReportStack {
  if (isDashboardQuestion(text)) return "dashboard";
  if (metric === "value") return "count";
  if (/\b(how many|count)\b/i.test(text)) return "count";
  if (/\btotal\b/i.test(text)) return "count";
  return "list";
}

function parseChart(text: string): "bar" | "pie" | "line" | undefined {
  if (/\b(pie|share|split|distribution|breakdown|percent|composition)\b/i.test(text)) return "pie";
  if (/\b(line|trend|over time|timeline|by month|by week|by day)\b/i.test(text)) return "line";
  if (/\b(bar|compare|by owner|by status|by company)\b/i.test(text)) return "bar";
  return undefined;
}

function parsePageSize(text: string): number {
  const top = text.match(/\b(?:top|first|show)\s+(\d{1,3})\b/i);
  if (top) return Math.min(200, Math.max(5, Number(top[1])));
  return 100;
}

function captureName(match: string | undefined): string | undefined {
  const value = match?.replace(/[?.!,;]+$/, "").trim();
  if (!value) return undefined;
  if (/^(me|my|mine|the|this|that|a|an)$/i.test(value)) return undefined;
  return value;
}

function parseOwner(text: string): Pick<ReportIntent, "ownerMe" | "ownerName"> & { ownerNames: string[] } {
  if (/\b(owned by me|i own|my own|mine)\b/i.test(text) || /\bmy\s+(quotes?|leads?|orders?|opportunit(?:y|ies)|invoices?|tickets?|work\s*orders?|receipts?|actions?|workforce|companies|contacts?|accounts?)\b/i.test(text)) {
    return { ownerMe: true, ownerNames: [] };
  }
  const owned = text.match(/\b(?:owned by|owner(?: is| are)?)\s+([a-z][a-z ,.'-]{1,80})/i);
  const possessive = text.match(/\b([a-z][a-z .'-]{1,30})'s\s+(?:quotes?|leads?|orders?|opportunit(?:y|ies)|invoices?|tickets?|work\s*orders?|receipts?|actions?|companies|contacts?)\b/i);
  const names = splitFilterValues(owned?.[1] || "") || [];
  const one = captureName(possessive?.[1]);
  if (one && !names.includes(one)) names.push(one);
  return { ownerMe: false, ownerName: names[0], ownerNames: names };
}

function parseAssignee(text: string): Pick<ReportIntent, "assigneeMe" | "assigneeName"> & { assigneeNames: string[] } {
  if (/\bassigned to me\b/i.test(text)) return { assigneeMe: true, assigneeNames: [] };
  const assigned = text.match(/\bassigned to\s+([a-z][a-z ,.'-]{1,80})/i);
  const names = splitFilterValues(assigned?.[1] || "");
  return { assigneeMe: false, assigneeName: names[0], assigneeNames: names };
}

function parseSearch(text: string): string | undefined {
  const quoted = text.match(/["']([^"']{2,80})["']/);
  if (quoted?.[1]) return quoted[1].trim();
  const containing = text.match(/\b(?:containing|named|about|titled)\s+([a-z0-9][\w .&-]{1,60})/i);
  if (containing?.[1] && !/^(me|item|items|sku|skus|product|products|asset|assets)\b/i.test(containing[1])) {
    return containing[1].replace(/\s+(this|last|today|yesterday|in|owned|assigned)\b.*$/i, "").trim();
  }
  const forMatch = text.match(/\bfor\s+([a-z0-9][\w .&-]{1,60})/i);
  let forValue = captureName(forMatch?.[1]);
  if (forValue) {
    forValue = forValue.replace(/\s+(this|last|today|yesterday|in|owned|assigned)\b.*$/i, "").trim();
  }
  if (forValue && /^(me|this month|last month|today|item|items|sku|skus|product|products|asset|assets)$/i.test(forValue)) {
    return undefined;
  }
  if (forValue) return forValue;
  return undefined;
}

const STAGE_TAIL =
  /\s+(?:created|updated|modified|closed|scheduled|owned|assigned|where|and|with|this|last|today|yesterday|between)\b.*$/i;
const STAGE_DATE_PREFIX = /^(?:the\s+)?(?:last|this|next|today|yesterday|past)\b/i;
const STAGE_NOISE = /^(?:me|my|mine|the|a|an|or|and|stage|status|workflow|quotes?|leads?|orders?|tickets?|invoices?|opportunit(?:y|ies)|work\s*orders?|actions?)$/i;

function cleanStageName(raw: string | undefined): string | undefined {
  let value = String(raw || "")
    .replace(/[?.!,;]+$/g, "")
    .replace(STAGE_TAIL, "")
    .replace(/\s+/g, " ")
    .trim();
  value = value.replace(/^(?:the|a|an)\s+/i, "");
  value = value.replace(/\s+(?:stage|status|workflow)s?$/i, "").trim();
  if (!value || STAGE_NOISE.test(value) || STAGE_DATE_PREFIX.test(value)) return undefined;
  if (value.length < 2 || value.length > 60) return undefined;
  return value;
}

function parseStages(text: string): string[] {
  const names: string[] = [];
  const push = (raw: string | undefined) => {
    const name = cleanStageName(raw);
    if (name && !names.some((row) => row.toLowerCase() === name.toLowerCase())) names.push(name);
  };

  const orPhrase = text.match(/\b(?:stage or status|status or stage)\s+(?:in|is|=|:)\s+["']?([^"'?]+)["']?/i);
  if (orPhrase) {
    push(orPhrase[1]);
    return names;
  }

  const patterns = [
    /\bin\s+(?:the\s+)?(?:stage|status)\s+(?:of\s+|called\s+|named\s+)?["']?([^"'?]+?)["']?(?=\s+(?:created|updated|owned|assigned|where|and|with|this|last|today)|[?.!]*$)/gi,
    /\b(?:where\s+)?(?:stage|status)\s*(?:=|is|are|:|in)\s+["']?([^"'?]+?)["']?(?=\s+(?:created|updated|owned|assigned|where|and|with|this|last|today)|[?.!]*$)/gi,
    /\bin\s+(?:the\s+)?["']([^"']{2,60})["']\s+(?:stage|status)\b/gi,
    /\bin\s+(?:the\s+)?(.{2,50}?)\s+(?:stage|status)\b/gi,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const raw = match[1] || "";
      if (/\b(?:stage|status|or)\b/i.test(raw) && !/follow|progress|engineer|assign/i.test(raw)) continue;
      push(raw);
    }
  }

  if (names.length === 0) {
    const trailing = text.match(
      /\bin\s+(?:the\s+)?(?!(?:last|this|next|today|yesterday|the last|the next)\b)([A-Za-z][A-Za-z0-9 /&-]{1,50}?)(?=\s+(?:created|updated|owned|assigned|this|last|today|where)|[?.!]*$)/i,
    );
    const candidate = cleanStageName(trailing?.[1]);
    if (candidate && !/^(stage|status)\b/i.test(candidate)) push(candidate);
  }
  return names;
}

function parseWorkforce(text: string): { topic?: WorkforceTopic; personName?: string; entity?: ReportEntityKey } {
  const userEq = text.match(
    /\b(?:user|member|person|employee|username)\s*(?:=|is|:)\s+([a-z][a-z0-9 .'-]{1,60})/i,
  );
  const findUser = text.match(
    /\b(?:find|show|locate)\s+(?:the\s+)?(?:user|member|person)\s+([a-z][a-z0-9 .'-]{1,60})/i,
  );
  const routeOf = text.match(
    /\b(?:route(?:\s+history)?|path|track(?:ing)?)\s+(?:of|for|by)\s+(?:user\s+|username\s+)?([a-z][a-z0-9 .'-]{1,60})/i,
  );
  const where = text.match(
    /\bwhere\s+(?:is|are)\s+(?:the\s+)?(?:user\s+)?(.+?)(?:\s+now|\s+on the map|\s+located)?\s*[?.!]*$/i,
  );
  const rawPerson = userEq?.[1] || findUser?.[1] || routeOf?.[1];
  let personName = /^(me|my|mine)$/i.test(rawPerson?.trim() || "") ? "me" : captureName(rawPerson);
  if (!personName) {
    personName = captureName(where?.[1]);
    if (personName) personName = personName.replace(/^(the\s+)?(user|member|person|username)\s+/i, "").trim();
    if (personName && /^(the user|user|he|she|they|everyone|the team|now|my team)$/i.test(personName)) {
      personName = undefined;
    }
  }
  if (personName && /^(me|my|mine)$/i.test(personName)) personName = "me";

  const isRoute =
    /\b(route history|show (the )?route|plot (the )?route|tracking route|day'?s route|\broute\b|where did .+ go)\b/i.test(
      text,
    );
  const isWhere =
    /\b(where is|where are|last location|current location|on the map|on a map|signed in|last known)\b/i.test(text);
  const isTeam = /\b(find my team|my team|team members|who reports to me|direct reports)\b/i.test(text);
  const isJoined = /\b(joined on|joining date|date of joining|who joined)\b/i.test(text);
  const isPresent =
    !isJoined &&
    (/\b(?:people|members|users|employees?)\s+(?:have\s+)?started\b/i.test(text) ||
      /\b(?:who|users?|people)\s+started\b/i.test(text) ||
      /\bhave\s+started\b/i.test(text) ||
      /\b(?:members?|people)\s+present\b/i.test(text) ||
      /\bpunch(?:ed)?\s+(?:in|out)\b/i.test(text) ||
      /\bstart(?:ed)?\s+day\b/i.test(text) ||
      /\bend(?:ed)?\s+day\b/i.test(text) ||
      /\b(?:who|people|members)\s+ended\b/i.test(text) ||
      /\bforce\s+end\b/i.test(text) ||
      /\bstarted on\b|\bstart date\b/i.test(text) ||
      (/\bno\.?\s*of\s+(?:people|members|users)\b/i.test(text) && /\bstart/i.test(text)) ||
      (/\bhow many\s+(?:people|members|users)\b/i.test(text) && /\b(start|present|end|punch|attend)/i.test(text)) ||
      /\bworkforce attendance\b|\battendance (?:today|yesterday|this month|last month|for)\b/i.test(text));
  if (isRoute && !isTeam) return { entity: "workforce", topic: "route", personName: personName || "me" };
  if (isPresent) return { entity: "workforce", topic: "started", personName };
  if (isJoined) return { entity: "workforce", topic: "joined", personName };
  if (isWhere) return { entity: "workforce", topic: "location", personName: personName || "me" };
  if (personName && !isTeam) return { entity: "workforce", topic: "location", personName };
  if (isTeam) return { entity: "workforce", topic: "team", personName };
  if (/\b(workforce|work force|wforce|field team|user filter)\b/i.test(text)) {
    return { entity: "workforce", topic: "team", personName };
  }
  return {};
}

const PARTY_NAME_STOP =
  /^(created|updated|modified|closed|owned|assigned|in|where|last|this|today|yesterday|with|by|i|my|me|the|a|an|and|or|filters?|fields?|what|which|how|many|count|list|show|find|search|view|profile|details?|phone|email|number|call|companies|company|contacts|contact|accounts|account|people)$/i;

function parsePartyName(raw: string | undefined): string | undefined {
  let value = captureName(raw);
  if (!value) return undefined;
  value = value
    .replace(/\s+(?:created|updated|owned|assigned|last|this|today|where|in the|phone|email|profile|details?).*$/i, "")
    .replace(/[?.!,;]+$/g, "")
    .trim();
  if (!value || PARTY_NAME_STOP.test(value.split(/\s+/)[0] || "")) return undefined;
  if (value.length < 2 || value.length > 80) return undefined;
  return value;
}

function parseParty(text: string): { entity?: ReportEntityKey; topic?: PartyTopic; search?: string } {
  const other = findEntityByKeyword(text);
  if (other && other !== "company" && other !== "contact") return {};

  const hasCompany = /\b(compan(?:y|ies)|accounts?)\b/i.test(text);
  const hasContact =
    /\b(contacts?)\b/i.test(text) ||
    (/\bpeople\b/i.test(text) &&
      !/\b(people started|users started|who started|have started|members present|workforce|punched|attendance)\b/i.test(
        text,
      ));
  if (!hasCompany && !hasContact) {
    const phoneOf = text.match(/\b(?:phone|e-?mail|number|call)\s+(?:of|for)\s+(.+)$/i);
    const search = parsePartyName(phoneOf?.[1]);
    return search ? { entity: "company", topic: "profile", search } : {};
  }

  let entity: ReportEntityKey = hasContact && !hasCompany ? "contact" : "company";
  if (hasCompany && hasContact) {
    entity = /\bcompany profile\b/i.test(text) ? "company" : "contact";
  }

  const isProfile = /\b(profile|details|view (the )?(company|contact|account)|phone|e-?mail|number|click to call|\bcall\b)\b/i.test(
    text,
  );
  const isSearch = /\b(search|find|named|containing|lookup)\b/i.test(text);
  const topic: PartyTopic = isProfile ? "profile" : isSearch ? "search" : "list";

  const patterns = [
    /\b(?:profile|details)\s+(?:of|for)\s+(.+)$/i,
    /\b(?:phone|e-?mail|number|call)\s+(?:of|for)\s+(.+)$/i,
    /\bview\s+(?:the\s+)?(?:company|contact|account)(?:\s+profile)?\s+(?:of|for)?\s*(.+)$/i,
    /\b(?:search|find|show|list)\s+(?:the\s+)?(?:compan(?:y|ies)|contacts?|accounts?|people)\s+(?:named|called|for)?\s*(.+)$/i,
    /\b(?:compan(?:y|ies)|contacts?|accounts?)\s+(?:named|called)\s+(.+)$/i,
  ];
  let search: string | undefined;
  for (const pattern of patterns) {
    search = parsePartyName(text.match(pattern)?.[1]);
    if (search) break;
  }
  return { entity, topic, search };
}

function parseQuoteView(text: string, previous?: ReportIntent | null): { topic?: QuoteTopic; search?: string } {
  const followUp =
    previous?.entity === "quote" &&
    previous.quoteTopic === "view" &&
    /\b(link|open in (?:teb|the browser|browser)|notes|items|templates?|actions?|status|price breakdown|breakdown|same quote)\b/i.test(
      text,
    ) &&
    !/\b(quotes created|how many|last \d|this month|pie|chart|snapshot|filter)\b/i.test(text);
  if (followUp) {
    return { topic: "view", search: previous?.search };
  }

  if (!/\b(quotes?|quotations?)\b/i.test(text) || isDashboardQuestion(text)) return {};

  const isView =
    /\b(view (the )?(quote|quotation)|quote profile|quotation profile|quote details|quotation details|open (the )?(quote|quotation)|show (the )?(quote|quotation)|quote notes|quote items|quote actions|quote templates?|price breakdown)\b/i.test(
      text,
    ) || /\b(view|open|show)\s+(?:the\s+)?quote\b/i.test(text);
  if (!isView) return {};

  const codeEq = text.match(
    /\b(?:quote|quotation)\s*(?:no|number|code|#)\s*(?:=|is|:)?\s*["']?([A-Za-z0-9][A-Za-z0-9._/-]{1,40})["']?/i,
  );
  const codeToken = text.match(/\b([A-Za-z]{1,8}-\d{1,10})\b/);
  const profileFor = text.match(/\b(?:quote|quotation)\s+(?:profile|details)\s+(?:of|for)\s+(.+)$/i);
  const viewRest = text.match(
    /\b(?:view|open|show)\s+(?:the\s+)?(?:quote|quotation)(?:\s+profile|\s+details|\s+items|\s+notes|\s+actions|\s+templates?)?\s+(?:of|for)?\s*(.+)$/i,
  );

  let search =
    captureName(codeEq?.[1]) ||
    captureName(codeToken?.[1]) ||
    parsePartyName(profileFor?.[1]) ||
    parsePartyName(viewRest?.[1]);
  if (search) {
    search = search
      .replace(/^(?:no|number|code|#)\s+/i, "")
      .replace(/\s+(?:created|updated|owned|assigned|last|this|today|where|items?|notes?|actions?|templates?).*$/i, "")
      .trim();
    if (/^(items?|notes?|actions?|templates?|status|profile|details|quote|quotation)$/i.test(search)) {
      search = undefined;
    }
  }
  return { topic: "view", search };
}

function parseSavedFilter(text: string): Pick<ReportIntent, "savedFilterName" | "useDefaultFilter"> {
  if (/\b(default filter|my default)\b/i.test(text)) return { useDefaultFilter: true };
  const named = text.match(/\b(?:filter named|saved filter|using filter)\s+["']?([^"']{2,60})["']?/i);
  return { savedFilterName: captureName(named?.[1]) };
}

export function isGreeting(text: string): boolean {
  return /^(hi|hello|hey|help|what can you do|what do you do)\s*[?!.]*$/i.test(text.trim());
}

export const HELP_TEXT =
  "Ask in plain language about Companies, Contacts, Quotes, Leads, Opportunities, Orders, Invoices, Receipts, Service Tickets, Work Orders, Actions, Workforce, or the Management Dashboard.\n\nYou can mention owner, assignee, workflow status or stage, dates, and items. Examples:\n• Companies created last 7 days\n• Company profile for Acme\n• View quote Q-1024\n• Quotes in Follow Up\n• Work orders in Assign to Engineer\n• Team snapshot this month\n• How many people started today\n• Find my team";

export function parseQuestion(
  text: string,
  previous?: ReportIntent | null,
  pathEntity?: ReportEntityKey,
): ReportIntent {
  const raw = text.trim();
  const workforce = parseWorkforce(raw);
  const party = parseParty(raw);
  const quote = parseQuoteView(raw, previous);
  const namedEntity =
    workforce.entity || findEntityByKeyword(raw) || party.entity || (quote.topic === "view" ? "quote" : undefined);
  const entity = namedEntity || pathEntity || previous?.entity;
  const standalone =
    Boolean(workforce.entity) ||
    Boolean(party.entity) ||
    Boolean(party.topic) ||
    Boolean(quote.topic === "view") ||
    Boolean(findEntityByKeyword(raw)) ||
    isDashboardQuestion(raw) ||
    /^(show|list|find|report|how many|count|chart|analyse|analyze|total|where|dashboard|snapshot|overview|search|view)\b/i.test(
      raw,
    );
  const base = !standalone && previous ? previous : undefined;
  const owner = parseOwner(raw);
  const assignee = parseAssignee(raw);
  const date =
    parseDate(raw) ||
    (workforce.topic === "started" ? betweenRange("CREATEDFILTER", new Date(), new Date(), "today") : undefined);
  const saved = parseSavedFilter(raw);
  const search = quote.search || party.search || parseSearch(raw);
  const stages = parseStages(raw);
  const workflow = raw.match(/\bworkflow\s+["']?([a-z][a-z0-9 /&-]{1,40})["']?/i);
  const chart = parseChart(raw);
  const metric = parseMetric(raw) || (!standalone ? base?.metric : undefined) || "count";
  const extras: FilterCriterion[] = [];
  if (owner.ownerMe) extras.push({ key: "owner", values: [], me: true });
  if (owner.ownerNames.length > 0) extras.push({ key: "owner", values: owner.ownerNames });
  if (assignee.assigneeMe) extras.push({ key: "assignee", values: [], me: true });
  if (assignee.assigneeNames.length > 0) extras.push({ key: "assignee", values: assignee.assigneeNames });
  if (stages.length > 0) extras.push({ key: "status", values: stages });
  const workflowName = captureName(workflow?.[1]);
  if (workflowName) extras.push({ key: "workflow", values: [workflowName] });
  const criteria = mergeCriteria(parseCriteria(raw), [...extras, ...parseItemPhrases(raw)]);
  const location = criteria.find((row) => row.key === "location")?.values[0];

  return {
    raw,
    entity: entity || base?.entity,
    stack:
      isDashboardQuestion(raw) ||
      (!namedEntity && previous?.stack === "dashboard" && !pathEntity)
        ? "dashboard"
        : parseStack(raw, metric),
    metric,
    chart: chart || (!standalone ? base?.chart : undefined),
    ownerMe: owner.ownerMe || (!owner.ownerName && Boolean(base?.ownerMe)),
    ownerName: owner.ownerName || (!owner.ownerMe ? base?.ownerName : undefined),
    assigneeMe: assignee.assigneeMe || (!assignee.assigneeName && Boolean(base?.assigneeMe)),
    assigneeName: assignee.assigneeName || (!assignee.assigneeMe ? base?.assigneeName : undefined),
    locationName: location || base?.locationName,
    stageNames: stages.length > 0 ? stages : base?.stageNames || [],
    workflowName: workflowName || base?.workflowName,
    search: search || (!standalone ? base?.search : undefined),
    date: date || (!standalone ? base?.date : undefined),
    savedFilterName: saved.savedFilterName,
    useDefaultFilter: saved.useDefaultFilter,
    listFilters: /\b(what (filters|fields)|which filters|filter fields|available filters)\b/i.test(raw),
    criteria: criteria.length > 0 ? criteria : !standalone ? base?.criteria || [] : [],
    pageSize: parsePageSize(raw),
    workforceTopic: workforce.topic || (!standalone ? base?.workforceTopic : undefined),
    partyTopic: party.topic || (!standalone ? base?.partyTopic : undefined),
    quoteTopic: quote.topic,
    personName: workforce.personName || (!standalone ? base?.personName : undefined),
  };
}
