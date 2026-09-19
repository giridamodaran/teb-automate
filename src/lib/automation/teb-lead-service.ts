import { getTebHosts } from "@/lib/api/hosts";
import { getAutomationToken } from "@/lib/automation/teb-auth";
import {
  createPendingLeadLog,
  markLeadLogCompleted,
  markLeadLogFailed,
} from "@/lib/automation/supabase-db";

export interface LeadSearchResult {
  id: string;
  leadCode?: string;
  phone?: string;
  email?: string;
  title?: string;
  rawRecord: Record<string, unknown>;
}

export interface LeadOperationResult {
  success: boolean;
  leadId: string;
  isNewLead: boolean;
  message: string;
  fields: Record<string, unknown>;
  rawResponse?: unknown;
}

export function cleanPhoneNumber(phone: string): string {
  if (!phone) return "";
  return phone.replace(/[^0-9+]/g, "").trim();
}

export function extractNationalPhoneDigits(phone: string): string {
  if (!phone) return "";
  let digits = phone.replace(/[^0-9]/g, "").trim();
  if (digits.startsWith("91") && digits.length > 5) {
    digits = digits.slice(2);
  }
  return digits;
}

let cachedCustomFieldDefs: any[] | null = null;
let cachedDefaultLocationId = "";
let cachedDefaultCurrencyId = "";

/**
 * Fetches TEB Custom Field definitions for LeadManagement.
 */
async function getCustomFieldDefinitions(token: string, hosts: Record<string, string>): Promise<any[]> {
  if (cachedCustomFieldDefs && cachedCustomFieldDefs.length > 0) {
    return cachedCustomFieldDefs;
  }
  try {
    const res = await fetch(`${hosts.MICRO}/gateway/customField/getcustomfield`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        Type: "WEB",
      },
      body: JSON.stringify({ ModuleCode: "LeadManagement", Module: "LeadManagement", Code: "LEAD" }),
      cache: "no-store",
    });
    if (res.ok) {
      const json = await res.json();
      cachedCustomFieldDefs = json.Data || [];
      return cachedCustomFieldDefs || [];
    }
  } catch {
    // Ignore fetch error
  }
  return [];
}

/**
 * Fetches default Location ID from TEB Cloud.
 */
async function getDefaultLocationId(token: string, hosts: Record<string, string>): Promise<string> {
  if (cachedDefaultLocationId) return cachedDefaultLocationId;
  try {
    const res = await fetch(`${hosts.COMPANY}/FnGetLocation()`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        Type: "WEB",
      },
      cache: "no-store",
    });
    if (res.ok) {
      const json = await res.json();
      const list = json.value || json.Data || [];
      const defLoc = list.find((item: any) => item.IsDefaultLocation) || list[0];
      if (defLoc?.Id) {
        cachedDefaultLocationId = String(defLoc.Id);
        return cachedDefaultLocationId;
      }
    }
  } catch {
    // Ignore fetch error
  }
  return "68a41460b74ff993b1731077";
}

/**
 * Fetches default Currency ID from Subscriber Settings.
 */
async function getDefaultCurrencyId(token: string, hosts: Record<string, string>): Promise<string> {
  if (cachedDefaultCurrencyId) return cachedDefaultCurrencyId;
  try {
    const res = await fetch(`${hosts.COMPANY}/FnGetSubscriberSetting()?$expand=Currency`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        Type: "WEB",
      },
      cache: "no-store",
    });
    if (res.ok) {
      const json = await res.json();
      const currId = String(json.CurrencyId || json.Currency?.Id || json.CurrencyCode || "");
      if (currId) {
        cachedDefaultCurrencyId = currId;
        return cachedDefaultCurrencyId;
      }
    }
  } catch {
    // Ignore fetch error
  }
  return "049";
}

/**
 * Merges incoming webhook fields with existing custom fields while preserving all non-automation custom fields.
 */
export function buildMergedCustomFields(
  incomingPayload: Record<string, unknown>,
  customFieldDefs: any[],
  existingCustomFields: any[] = []
) {
  const reserved = new Set([
    "name", "Name", "LeadName", "FullName", "title", "Title",
    "phone", "Phone", "mobile", "Mobile", "phoneNumber", "waId",
    "email", "Email", "secretKey", "secret",
    "utm_source", "utm_medium", "utm_campaign", "utm_id", "utm_term", "utm_content"
  ]);

  const mergedMap = new Map<string, any>();

  // 1. Preserve all existing custom fields from the lead record
  if (Array.isArray(existingCustomFields)) {
    for (const cf of existingCustomFields) {
      const key = String(cf.PropertyName || cf.ControlName || cf.Code || cf.Label || "").toLowerCase();
      if (key) {
        mergedMap.set(key, { ...cf });
      }
    }
  }

  // 2. Update/insert ONLY incoming fields that match valid TEB custom field definitions
  for (const [key, value] of Object.entries(incomingPayload)) {
    if (!reserved.has(key) && value !== undefined && value !== null && String(value).trim() !== "") {
      const lowerKey = key.toLowerCase();
      const def = customFieldDefs.find(
        (d) => d.ControlName === key || String(d.ControlName).toLowerCase() === lowerKey
      );

      // Only include if field exists in TEB definitions or existing record
      if (!def && !mergedMap.has(lowerKey)) {
        continue;
      }

      const existing = mergedMap.get(lowerKey) || {};

      mergedMap.set(lowerKey, {
        ...existing,
        Id: def?.Id || existing.Id || existing.CustomFieldId || "",
        CustomFieldId: def?.Id || existing.CustomFieldId || existing.Id || "",
        Code: key,
        ControlName: key,
        PropertyName: key,
        Label: def?.Title || existing.Label || key,
        Value: String(value),
        ControlType: def?.ControlType || existing.ControlType || "TEXT",
      });
    }
  }

  return Array.from(mergedMap.values());
}

/**
 * Searches TEB for a Lead matching the provided phone number (without country code).
 */
export async function searchLeadByPhone(
  phoneNumber: string,
  token: string
): Promise<LeadSearchResult | null> {
  const hosts = getTebHosts();
  const searchDigits = extractNationalPhoneDigits(phoneNumber);
  const rawDigits = phoneNumber.replace(/[^0-9]/g, "").trim();

  if (!searchDigits && !rawDigits) {
    throw new Error("Phone number is required for lead search.");
  }

  const searchUrl = `${hosts.MICRO}/gateway/Lead/GetLeads`;

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    Type: "WEB",
    DeviceInfo: JSON.stringify({ BrowserName: "AutomationEngine", browserVersion: "1.0.0" }),
    DeviceAddress: "127.0.0.1",
    ApiHitDate: new Date().toString(),
  };

  const searchTerms = Array.from(
    new Set([searchDigits, rawDigits, phoneNumber.trim(), `+${rawDigits}`])
  ).filter(Boolean);

  const matchedItems: Record<string, unknown>[] = [];
  const matchedIds = new Set<string>();

  for (const term of searchTerms) {
    try {
      const res = await fetch(searchUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          Data: {
            IsActive: true,
            FullTextSearch: term,
          },
          PageNumber: 0,
          PageSize: 50,
        }),
        cache: "no-store",
      });

      if (res.ok) {
        const payload = await res.json();
        const items = extractLeadItems(payload);

        for (const item of items) {
          const leadId = String(item.Id || item.id || item.LeadId || item.leadId || "");
          if (!leadId || matchedIds.has(leadId)) continue;

          const phoneDetails = Array.isArray(item.PhoneDetail)
            ? item.PhoneDetail
            : Array.isArray(item.Phone)
            ? item.Phone
            : [];

          const itemPhones: string[] = [];
          for (const p of phoneDetails) {
            if (p?.Value || p?.value) {
              itemPhones.push(String(p.Value || p.value).replace(/[^0-9]/g, ""));
            }
          }
          if (item.phone) itemPhones.push(String(item.phone).replace(/[^0-9]/g, ""));
          if (item.Phone && typeof item.Phone === "string") itemPhones.push(item.Phone.replace(/[^0-9]/g, ""));

          const isMatch = itemPhones.some(
            (pDigits) =>
              pDigits === searchDigits ||
              pDigits === rawDigits ||
              (searchDigits.length >= 5 && pDigits.includes(searchDigits)) ||
              (searchDigits.length >= 5 && searchDigits.includes(pDigits))
          );

          if (isMatch) {
            matchedIds.add(leadId);
            matchedItems.push(item);
          }
        }
      }
    } catch {
      // Continue search
    }
  }

  if (matchedItems.length === 0) return null;

  // Sort matched leads descending by ModifiedDate / CreatedDate (latest modified record first)
  matchedItems.sort((a, b) => {
    const timeA = new Date(String(a.ModifiedDate || a.CreatedDate || 0)).getTime();
    const timeB = new Date(String(b.ModifiedDate || b.CreatedDate || 0)).getTime();
    return timeB - timeA;
  });

  const bestMatch = matchedItems[0];
  const bestId = String(bestMatch.Id || bestMatch.id || bestMatch.LeadId || bestMatch.leadId || "");

  return {
    id: bestId,
    leadCode: String(bestMatch.LeadCode || bestMatch.Code || bestMatch.code || ""),
    phone: String(bestMatch.phone || searchDigits),
    email: String(bestMatch.email || bestMatch.Email || ""),
    title: String(bestMatch.Title || bestMatch.Name || bestMatch.LeadName || bestMatch.FullName || ""),
    rawRecord: bestMatch,
  };
}

function extractLeadItems(payload: unknown): Record<string, unknown>[] {
  if (!payload || typeof payload !== "object") return [];
  const p = payload as Record<string, unknown>;
  if (Array.isArray(p.Data)) return p.Data as Record<string, unknown>[];
  if (Array.isArray(p.value)) return p.value as Record<string, unknown>[];
  if (p.Data && typeof p.Data === "object") {
    const sub = p.Data as Record<string, unknown>;
    if (Array.isArray(sub.Items)) return sub.Items as Record<string, unknown>[];
    if (Array.isArray(sub.List)) return sub.List as Record<string, unknown>[];
    if (Array.isArray(sub.GridData)) return sub.GridData as Record<string, unknown>[];
  }
  return [];
}

/**
 * Creates a NEW Lead record in TEB Cloud using live SaveLeadDetail API with default system fields.
 */
export async function createLead(
  phoneNumber: string,
  leadData: Record<string, unknown>,
  token: string
): Promise<LeadOperationResult> {
  const hosts = getTebHosts();
  const createUrl = `${hosts.MICRO}/gateway/Lead/SaveLeadDetail`;

  const customFieldDefs = await getCustomFieldDefinitions(token, hosts);
  const locationId = await getDefaultLocationId(token, hosts);
  const currencyId = await getDefaultCurrencyId(token, hosts);

  const leadTitle = String(
    leadData.name || leadData.Name || leadData.LeadName || leadData.title || leadData.Title || `New Lead (${phoneNumber})`
  );

  const customFieldArray = buildMergedCustomFields(leadData, customFieldDefs, []);
  const emailVal = String(leadData.email || leadData.Email || "");

  const savePayload = {
    FullName: leadTitle,
    LeadName: leadTitle,
    Location: locationId,
    LocationId: locationId,
    Site: locationId,
    CurrencyId: currencyId,
    Owner: "68ac22e2a608471805479fce",
    OwnerId: "68ac22e2a608471805479fce",
    WorkFlow: "695e64cf510a06f8e3709363",
    WorkflowId: "695e64cf510a06f8e3709363",
    Phone: [
      { Title: "Work", Country: "+91", Icon: "mat_outline:call", Type: "PHONE", Value: extractNationalPhoneDigits(phoneNumber) || phoneNumber }
    ],
    Email: emailVal ? [
      { Title: "Work", Icon: "mat_outline:email", Type: "EMAIL", Value: emailVal }
    ] : [],
    CustomField: customFieldArray,
  };

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    Type: "WEB",
    DeviceInfo: JSON.stringify({ BrowserName: "AutomationEngine", browserVersion: "1.0.0" }),
    DeviceAddress: "127.0.0.1",
    ApiHitDate: new Date().toString(),
  };

  const res = await fetch(createUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(savePayload),
    cache: "no-store",
  });

  if (!res.ok) {
    const errText = await res.text();
    return {
      success: false,
      leadId: "",
      isNewLead: true,
      message: `Failed to create lead (${res.status}): ${errText}`,
      fields: savePayload,
    };
  }

  const responseJson = await res.json();
  const newId = String(responseJson?.Data?.Id || responseJson?.Data?.LeadId || "NEW_LEAD");

  return {
    success: responseJson?.Succeeded !== false,
    leadId: newId,
    isNewLead: true,
    message: responseJson?.Messages?.[0] || "New Lead created successfully in TEB Cloud",
    fields: savePayload,
    rawResponse: responseJson,
  };
}

/**
 * Updates an existing Lead record in TEB Cloud while PRESERVING ALL EXISTING NON-AUTOMATION FIELDS.
 */
export async function updateLead(
  leadId: string,
  leadData: Record<string, unknown>,
  token: string,
  existingRecord: Record<string, unknown> = {}
): Promise<LeadOperationResult> {
  const hosts = getTebHosts();
  const updateUrl = `${hosts.DYNAMIC}/AcAddDetail`;

  const customFieldDefs = await getCustomFieldDefinitions(token, hosts);

  // 1. Preserve existing System Fields
  const existingFullName = String(existingRecord.FullName || existingRecord.LeadName || existingRecord.Name || "");
  const existingCompany = String(existingRecord.CompanyName || "");

  // 2. Build merged CustomFields array (preserving non-automation custom fields)
  const existingCustomFields = Array.isArray(existingRecord.CustomField) ? existingRecord.CustomField : [];
  const mergedCustomFields = buildMergedCustomFields(leadData, customFieldDefs, existingCustomFields);

  // 3. Keep existing FullName/Company unless explicitly provided in incoming payload
  const finalTitle = leadData.name || leadData.Name || leadData.LeadName || existingFullName || "Lead";
  const finalCompany = leadData.company || leadData.CompanyName || existingCompany;

  // 4. Construct AcAddDetail payload using captured TEB Cloud UI structure
  const innerData = {
    ...existingRecord,
    FullName: finalTitle,
    CompanyName: finalCompany,
    CustomField: mergedCustomFields,
  };

  const savePayload = {
    data: {
      Module: "LeadManagement",
      Code: "LEAD",
      PrimaryKey: leadId,
      Data: JSON.stringify(innerData),
      Action: "ADD",
    },
  };

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    Type: "WEB",
  };

  const res = await fetch(updateUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(savePayload),
    cache: "no-store",
  });

  if (!res.ok) {
    const errText = await res.text();
    return {
      success: false,
      leadId,
      isNewLead: false,
      message: `Failed to update lead (${res.status}): ${errText}`,
      fields: savePayload,
    };
  }

  const responseJson = await res.json();

  return {
    success: responseJson?.Succeeded !== false && responseJson?.Data !== false,
    leadId,
    isNewLead: false,
    message: responseJson?.Messages?.[0] || responseJson?.Message || "Lead updated successfully in TEB Cloud",
    fields: savePayload,
    rawResponse: responseJson,
  };
}

/**
 * Main Orchestrator for Incoming Webhook Execution with Supabase Staging.
 */
export async function executeLeadWebhookAutomation(payload: Record<string, unknown>) {
  const rawPhone = String(
    payload.phone || payload.Phone || payload.mobile || payload.Mobile || payload.phoneNumber || payload.waId || ""
  );

  if (!rawPhone) {
    return {
      success: false,
      status: 400,
      error: "Missing required 'phone' or 'phoneNumber' or 'waId' parameter in webhook body payload.",
    };
  }

  const cleanedPhone = cleanPhoneNumber(rawPhone);
  const { secretKey: _sk, ...leadData } = payload;

  // 1. Instantly buffer request to Supabase DB (status = 'pending')
  const supabaseLogId = await createPendingLeadLog(cleanedPhone, payload);

  try {
    // 2. Get TEB JWT token
    const token = await getAutomationToken();

    // 3. Search for Lead by Phone Number
    const leadMatch = await searchLeadByPhone(cleanedPhone, token);

    // 4. Update Existing Lead or Create New Lead
    if (leadMatch) {
      const updateResult = await updateLead(leadMatch.id, leadData, token, leadMatch.rawRecord);
      if (updateResult.success) {
        await markLeadLogCompleted(supabaseLogId, leadMatch.id, "UPDATED_EXISTING_LEAD");
        return {
          success: true,
          status: 200,
          action: "UPDATED_EXISTING_LEAD",
          supabaseLogId,
          lead: leadMatch,
          result: updateResult,
        };
      } else {
        await markLeadLogFailed(supabaseLogId, updateResult.message);
        return {
          success: false,
          status: 500,
          action: "UPDATED_EXISTING_LEAD",
          supabaseLogId,
          error: updateResult.message,
        };
      }
    } else {
      // Create New Lead if search returns no existing lead
      const createResult = await createLead(cleanedPhone, leadData, token);
      if (createResult.success) {
        await markLeadLogCompleted(supabaseLogId, createResult.leadId, "CREATED_NEW_LEAD");
        return {
          success: true,
          status: 201,
          action: "CREATED_NEW_LEAD",
          supabaseLogId,
          lead: {
            id: createResult.leadId,
            phone: cleanedPhone,
            title: String(leadData.name || leadData.Name || leadData.LeadName || `New Lead (${cleanedPhone})`),
          },
          result: createResult,
        };
      } else {
        await markLeadLogFailed(supabaseLogId, createResult.message);
        return {
          success: false,
          status: 500,
          action: "CREATED_NEW_LEAD",
          supabaseLogId,
          error: createResult.message,
        };
      }
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "Automation failure";
    await markLeadLogFailed(supabaseLogId, errMsg);
    return {
      success: false,
      status: 500,
      supabaseLogId,
      error: errMsg,
    };
  }
}
