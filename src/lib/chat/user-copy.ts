import { TebApiError } from "@/lib/api/types";
import { REPORT_ENTITIES } from "@/lib/chat/entities";

const DEFAULT_REPORT_ERROR = "I couldn't load that. Try another question, or a simpler filter.";

const TECHNICAL =
  /\b(DYNAMIC|MANAGE|AcGetData|AcAddDetail|FilterValues|FilterDetail|FilterId|GetFilterControls|GetTeamBased\w*|GetModuleWise\w*|GetUserTracking\w*|DATEFILTER|OWNERFILTER|ScreenCode|ModuleCode|CorrelationId|TEB[A-Z][a-zA-Z]+|[A-Za-z]+Management|SNAPSHOT|gateway|OPENAI|ANTHROPIC)\b|\.env|https?:\/\/|Request failed\s*\(\d+\)|\{[\s\S]*\}/i;

export function userFacingAskError(err: unknown): string {
  if (err instanceof TebApiError) return friendlyFromText(err.message, err.status);
  if (err instanceof Error) return friendlyFromText(err.message);
  return DEFAULT_REPORT_ERROR;
}

function friendlyFromText(message: string, status?: number): string {
  if (status === 401 || /session expired/i.test(message)) {
    return "Your session has expired. Please sign in again.";
  }
  if (status === 403 || /^forbidden$/i.test(message.trim())) {
    return "You don't have permission to see that.";
  }
  if (status === 408 || /timed out/i.test(message)) {
    return "That took too long. Try again in a moment.";
  }
  if (/could not reach|failed to fetch|network error/i.test(message)) {
    return "I couldn't reach TEB right now. Check your connection and try again.";
  }
  if (/filter form not created/i.test(message)) {
    return "Filters aren't set up for this list yet. Try asking without extra filters, or pick a date and owner.";
  }
  if (/module is required/i.test(message)) {
    return "I need something like Quotes, Leads, or Service Tickets. Try “Quote snapshot this month”.";
  }
  const trimmed = message.trim();
  if (!trimmed || TECHNICAL.test(trimmed) || /please contact (the )?admin/i.test(trimmed)) {
    return DEFAULT_REPORT_ERROR;
  }
  if (trimmed.length > 160) return DEFAULT_REPORT_ERROR;
  return trimmed;
}

/** Map live module codes (TEBQuote, TicketManagement) to labels a subscriber would recognise. */
export function friendlyModuleLabel(raw: unknown): string {
  const value = String(raw ?? "").trim();
  if (!value) return "Module";
  const lower = value.toLowerCase();
  for (const entity of Object.values(REPORT_ENTITIES)) {
    const codes = [entity.key, entity.title, entity.plural, entity.listModule, entity.dynamicModule, ...entity.workflowModules];
    if (codes.some((code) => code.toLowerCase() === lower)) {
      return entity.plural.charAt(0).toUpperCase() + entity.plural.slice(1);
    }
  }
  if (/^TEB[A-Z]/i.test(value)) {
    return value.replace(/^TEB/i, "").replace(/([a-z])([A-Z])/g, "$1 $2");
  }
  if (/Management$/i.test(value)) {
    return value.replace(/Management$/i, "").replace(/([a-z])([A-Z])/g, "$1 $2").trim() || "Module";
  }
  return value;
}
