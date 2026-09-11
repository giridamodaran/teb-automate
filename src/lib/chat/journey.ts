import type { TebMenuApp, TebMenuItem, TebUserDetail } from "@/lib/api/types";
import { SESSION_KEYS, askJourneyStorageKey } from "@/lib/auth/session";
import { entityFromPath, REPORT_ENTITIES, type ReportEntityKey } from "@/lib/chat/entities";
import type { ReportIntent, ReportResult } from "@/lib/chat/types";
import { appIconName, collectItemLinks, permittedApps, visibleNavItems } from "@/lib/nav/menu";

export type JourneyTopicId = ReportEntityKey | "dashboard";

export interface JourneyTopic {
  id: JourneyTopicId;
  title: string;
  entity?: ReportEntityKey;
  questions: string[];
}

export interface AskAppJourney {
  appCode: string;
  title: string;
  icon: string;
  topics: JourneyTopic[];
}

export const HOME_PROMPT = "What do you want to know today?";

export const APP_PROMPT_PREFIX = "Ask about";

const TOPIC_QUESTIONS: Record<JourneyTopicId, string[]> = {
  dashboard: [
    "Team snapshot this month",
    "Quote snapshot owned by me last 7 days",
    "What filters can I use on the dashboard?",
  ],
  quote: [
    "Quotes created last 7 days",
    "Quotes I own this month",
    "Quotes with item iPhone",
    "What filters can I use on quotes?",
  ],
  lead: [
    "Leads I own this month",
    "Leads where owner = me and status = Open",
    "What filters can I use on leads?",
  ],
  opportunity: [
    "Opportunities created last 7 days",
    "Opportunities with item iPhone",
    "What filters can I use on opportunities?",
  ],
  order: [
    "Orders created last 7 days",
    "Orders I own this month",
    "What filters can I use on orders?",
  ],
  invoice: [
    "Invoices created last 7 days",
    "Invoices I own this month",
    "What filters can I use on invoices?",
  ],
  receipt: ["Receipts this month", "Amount received this month"],
  ticket: [
    "Service tickets created last 7 days",
    "Service tickets where priority = High",
    "What filters can I use on tickets?",
  ],
  workorder: [
    "Work orders assigned to me created last 7 days",
    "Work orders I own this month",
    "What filters can I use on work orders?",
  ],
  action: [
    "Actions assigned to me scheduled this week",
    "Actions where owner = me",
    "What filters can I use on actions?",
  ],
  workforce: ["Find my team", "Where is the user now", "Show route for me"],
};

const DEFAULT_TOPICS_BY_APP: Record<string, JourneyTopicId[]> = {
  SALES: ["dashboard", "lead", "opportunity", "quote", "order", "action"],
  SERVICE: ["ticket", "workorder"],
  FINANCE: ["invoice", "receipt"],
  WFORCE: ["workforce"],
  RPT: ["dashboard"],
};

function topicFromHint(hint: string): JourneyTopicId | undefined {
  const text = hint.toLowerCase();
  if (/\bdashboard\b|\bsnapshot\b|\bteam view\b/.test(text) || /\/dashboard/i.test(hint)) return "dashboard";
  return entityFromPath(hint.startsWith("/") ? hint : `/${hint}`) ?? entityFromPath(`/${text.replace(/\s+/g, "/")}`);
}

function topicFromNavItem(item: TebMenuItem): JourneyTopicId | undefined {
  const blob = [item.title, item.menucode, item.module, item.link, item.groupapp].filter(Boolean).join(" ");
  const fromPath = collectItemLinks(item).map(topicFromHint).find(Boolean);
  if (fromPath) return fromPath;
  if (/\bdashboard\b|\bsnapshot\b/i.test(blob)) return "dashboard";
  if (/\bquote/i.test(blob)) return "quote";
  if (/\blead/i.test(blob)) return "lead";
  if (/\bopportunit|\bteb ?sale\b/i.test(blob)) return "opportunity";
  if (/\binvoice|\breceipt/i.test(blob)) return /\breceipt/i.test(blob) ? "receipt" : "invoice";
  if (/\bticket/i.test(blob)) return "ticket";
  if (/\bwork\s*order/i.test(blob)) return "workorder";
  if (/\bworkforce|\bwforce|\btracking|\broute\b/i.test(blob)) return "workforce";
  if (/\baction|\bmy day/i.test(blob)) return "action";
  if (/\border/i.test(blob) && !/\bwork\s*order/i.test(blob)) return "order";
  return undefined;
}

function walkTopics(items: TebMenuItem[] | unknown, found: Set<JourneyTopicId>) {
  for (const item of visibleNavItems(items)) {
    const topic = topicFromNavItem(item);
    if (topic) found.add(topic);
    walkTopics(item.children, found);
  }
}

function topicDef(id: JourneyTopicId): JourneyTopic {
  if (id === "dashboard") {
    return { id, title: "Dashboard", questions: TOPIC_QUESTIONS.dashboard };
  }
  const entity = REPORT_ENTITIES[id];
  return { id, title: entity.title, entity: id, questions: TOPIC_QUESTIONS[id] };
}

const APP_TITLES: Record<string, string> = {
  SALES: "Sales",
  SERVICE: "Service",
  FINANCE: "Finance",
  WFORCE: "Workforce",
  RPT: "Reports",
};

const APP_ICONS: Record<string, string> = {
  SALES: "storefront",
  SERVICE: "build",
  FINANCE: "account_balance",
  WFORCE: "groups",
  RPT: "bar_chart",
};

function fallbackAskApps(): AskAppJourney[] {
  return (Object.entries(DEFAULT_TOPICS_BY_APP) as [string, JourneyTopicId[]][]).map(([code, ids]) => ({
    appCode: code,
    title: APP_TITLES[code] || code,
    icon: APP_ICONS[code] || "apps",
    topics: ids.map(topicDef),
  }));
}

export function journeysForUser(menu: TebMenuApp[] | unknown, user: TebUserDetail | null): AskAppJourney[] {
  const listed = permittedApps(menu, user).map((app) => {
    const found = new Set<JourneyTopicId>();
    walkTopics(app.NavigationMenus, found);
    const code = String(app.AppCode || "").toUpperCase();
    if (found.size === 0) {
      for (const id of DEFAULT_TOPICS_BY_APP[code] ?? []) found.add(id);
    }
    const order = DEFAULT_TOPICS_BY_APP[code] ?? [...found];
    const topics = [...found]
      .sort((a, b) => {
        const left = order.indexOf(a);
        const right = order.indexOf(b);
        return (left < 0 ? 99 : left) - (right < 0 ? 99 : right);
      })
      .map(topicDef);
    return {
      appCode: code || String(app.AppTitle || "APP"),
      title: String(app.AppTitle || code || "App"),
      icon: appIconName(app),
      topics,
    };
  });
  return listed.length ? listed : fallbackAskApps();
}

export function questionsFor(app: AskAppJourney, topic?: JourneyTopic | null): string[] {
  if (topic) return topic.questions;
  const seen = new Set<string>();
  const rows: string[] = [];
  for (const item of app.topics) {
    for (const question of item.questions.slice(0, 2)) {
      if (seen.has(question)) continue;
      seen.add(question);
      rows.push(question);
    }
  }
  return rows.slice(0, 8);
}

export function appPrompt(app: AskAppJourney, topic?: JourneyTopic | null): string {
  if (!app.topics.length) {
    return `${app.title} is on your login, but Ask does not query that app’s screens yet. Pick another app, go back to all apps, or type a question.`;
  }
  if (topic) {
    return `${APP_PROMPT_PREFIX} ${topic.title} in ${app.title}. Pick a starter question or type your own. Ask stays on this journey until you switch.`;
  }
  const names = app.topics.map((item) => item.title).join(", ");
  return `${APP_PROMPT_PREFIX} ${app.title}. You can ask about ${names}. Pick a starter, a topic, or type a search.`;
}

export function isHomeCommand(text: string): boolean {
  return /^(all apps|main( section| menu)?|home|start over|switch app|show apps|apps)\s*[?.!]*$/i.test(text.trim());
}

export function matchApp(apps: AskAppJourney[], text: string): AskAppJourney | undefined {
  const want = text.trim().toLowerCase();
  return apps.find(
    (app) =>
      app.title.toLowerCase() === want ||
      app.appCode.toLowerCase() === want ||
      new RegExp(`\\b${app.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text),
  );
}

export function matchTopic(app: AskAppJourney, text: string): JourneyTopic | undefined {
  const want = text.trim().toLowerCase();
  return app.topics.find((topic) => {
    if (topic.title.toLowerCase() === want || topic.id === want || topic.entity === want) return true;
    if (topic.entity) {
      const entity = REPORT_ENTITIES[topic.entity];
      if (entity.plural.toLowerCase() === want) return true;
      if (entity.keywords.some((keyword) => keyword.toLowerCase() === want)) return true;
    }
    return topic.title.toLowerCase() === want.replace(/s$/, "");
  });
}

export function looksLikeSearch(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.split(/\s+/).length > 4) return true;
  return /\b(last|this|where|how many|count|created|owned|assigned|filter|snapshot|find|show|list|with item|trend|chart|pie|team|route)\b/i.test(
    trimmed,
  );
}

export function seedJourneyIntent(topic?: JourneyTopic | null): ReportIntent | null {
  if (!topic) return null;
  return {
    raw: "",
    entity: topic.entity,
    stack: topic.id === "dashboard" ? "dashboard" : "list",
    metric: "count",
    ownerMe: false,
    assigneeMe: false,
    stageNames: [],
    criteria: [],
    pageSize: 100,
  };
}

export interface ChatHistoryTurn {
  role: "user" | "assistant";
  text: string;
}

export function historyTurns(
  messages: Array<{ role: string; text: string }>,
  limit = 8,
): ChatHistoryTurn[] {
  return messages
    .filter((row) => row.role === "user" || row.role === "assistant")
    .slice(-limit)
    .map((row) => ({ role: row.role as "user" | "assistant", text: row.text.slice(0, 500) }));
}

export const JOURNEY_STORAGE_KEY = SESSION_KEYS.askJourney;
const MAX_STORED_MESSAGES = 40;

export interface StoredJourney {
  messages: Array<{
    id: string;
    role: "user" | "assistant";
    text: string;
    result?: ReportResult;
    apps?: AskAppJourney[];
    topics?: JourneyTopic[];
    questions?: string[];
    journeyAppCode?: string;
    showApps?: boolean;
  }>;
  appCode: string | null;
  topicId: JourneyTopicId | null;
  intent: ReportIntent | null;
  userId?: string;
}

function compactResult(result: ReportResult): ReportResult {
  return {
    ...result,
    rows: [],
    viewHref: undefined,
    paths: (result.paths ?? []).map((path) => ({
      ...path,
      points: path.points.slice(0, 200),
    })),
    map: (result.map ?? []).slice(0, 80),
    applied: {
      filterId: result.applied?.filterId ?? null,
      filterValues: null,
      fullTextSearch: result.applied?.fullTextSearch ?? "",
    },
    summary: result.summary
      ? { ...result.summary, sample: (result.summary.sample ?? []).slice(0, 3) }
      : undefined,
  };
}

function parseJourney(raw: string | null): StoredJourney | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredJourney;
    if (!Array.isArray(parsed.messages)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function readStoredJourney(userId?: string | number | null): StoredJourney | null {
  if (typeof window === "undefined") return null;
  const key = askJourneyStorageKey(userId);
  const scoped = parseJourney(localStorage.getItem(key));
  if (scoped) return scoped;
  if (!userId) {
    return parseJourney(sessionStorage.getItem(JOURNEY_STORAGE_KEY));
  }
  const unscoped =
    parseJourney(localStorage.getItem(JOURNEY_STORAGE_KEY)) ??
    parseJourney(sessionStorage.getItem(JOURNEY_STORAGE_KEY));
  if (unscoped && (!unscoped.userId || String(unscoped.userId) === String(userId))) {
    writeStoredJourney(unscoped, userId);
    localStorage.removeItem(JOURNEY_STORAGE_KEY);
    sessionStorage.removeItem(JOURNEY_STORAGE_KEY);
    return unscoped;
  }
  return null;
}

export function writeStoredJourney(state: StoredJourney, userId?: string | number | null): void {
  if (typeof window === "undefined") return;
  try {
    const compact: StoredJourney = {
      ...state,
      userId: userId == null ? state.userId : String(userId),
      messages: state.messages.slice(-MAX_STORED_MESSAGES).map((message) =>
        message.result ? { ...message, result: compactResult(message.result) } : message,
      ),
    };
    localStorage.setItem(askJourneyStorageKey(userId), JSON.stringify(compact));
  } catch {
    // Ignore quota / private-mode failures.
  }
}

export function clearStoredJourney(userId?: string | number | null): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(askJourneyStorageKey(userId));
  localStorage.removeItem(JOURNEY_STORAGE_KEY);
  sessionStorage.removeItem(JOURNEY_STORAGE_KEY);
}
