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

let cachedCustomFieldDefs: any[] | null = null;
let cachedDefaultLocationId = "";

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
  return "68a41460b74ff993b1731077"; // Default fallback
}

/**
 * Formats custom field objects for TEB SaveLeadDetail DTO.
 */
export function formatCustomFields(leadData: Record<string, unknown>, customFieldDefs: any[]) {
  const reserved = new Set([
    "name", "Name", "LeadName", "FullName", "title", "Title",
    "phone", "Phone", "mobile", "Mobile", "phoneNumber", "waId",
    "email", "Email", "secretKey"
  ]);

  const customFields: any[] = [];
  for (const [key, value] of Object.entries(leadData)) {
    if (!reserved.has(key) && value !== undefined && value !== null && String(value).trim() !== "") {
      const def = customFieldDefs.find(
        (d) => d.ControlName === key || String(d.ControlName).toLowerCase() === key.toLowerCase()
      );
      customFields.push({
        Id: def?.Id || "",
        CustomFieldId: def?.Id || "",
        Code: key,
        ControlName: key,
        PropertyName: key,
        Label: def?.Title || key,
        Value: String(value),
        ControlType: def?.ControlType || "TEXT",
      });
    }
  }
  return customFields;
}

/**
 * Searches TEB for a Lead matching the provided phone number.
 */
export async function searchLeadByPhone(
  phoneNumber: string,
  token: string
): Promise<LeadSearchResult | null> {
  const hosts = getTebHosts();
  const cleanedPhone = cleanPhoneNumber(phoneNumber);
  
  if (!cleanedPhone) {
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

  try {
    const res = await fetch(searchUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        SearchText: cleanedPhone,
        PageNumber: 1,
        PageSize: 10,
      }),
      cache: "no-store",
    });

    if (res.ok) {
      const payload = await res.json();
      const items = extractLeadItems(payload);
      if (items && items.length > 0) {
        const match = items.find((item: Record<string, unknown>) => {
          const itemPhone = cleanPhoneNumber(
            String(item.phone || item.Phone || item.Mobile || item.mobile || item.MobileNumber || "")
          );
          return itemPhone.includes(cleanedPhone) || cleanedPhone.includes(itemPhone);
        }) || items[0];

        const leadId = String(match.Id || match.id || match.LeadId || match.leadId || match.ID || "");
        if (leadId) {
          return {
            id: leadId,
            leadCode: String(match.LeadCode || match.Code || match.code || ""),
            phone: String(match.phone || match.Phone || match.MobileNumber || cleanedPhone),
            email: String(match.email || match.Email || ""),
            title: String(match.Title || match.Name || match.LeadName || match.FullName || ""),
            rawRecord: match,
          };
        }
      }
    }
  } catch {
    // Ignore error and try fallback
  }

  return null;
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
 * Creates a NEW Lead record in TEB Cloud using live SaveLeadDetail API.
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

  const leadTitle = String(
    leadData.name || leadData.Name || leadData.LeadName || leadData.title || leadData.Title || `New Lead (${phoneNumber})`
  );

  const customFieldArray = formatCustomFields(leadData, customFieldDefs);
  const emailVal = String(leadData.email || leadData.Email || "");

  const savePayload = {
    FullName: leadTitle,
    LeadName: leadTitle,
    Location: locationId,
    LocationId: locationId,
    Site: locationId,
    CurrencyId: "049",
    Phone: [
      { Title: "Work", Country: "+91", Icon: "mat_outline:call", Type: "PHONE", Value: phoneNumber }
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
 * Updates an existing Lead record in TEB Cloud.
 */
export async function updateLead(
  leadId: string,
  leadData: Record<string, unknown>,
  token: string,
  existingRecord?: Record<string, unknown>
): Promise<LeadOperationResult> {
  const hosts = getTebHosts();
  const updateUrl = `${hosts.MICRO}/gateway/Lead/SaveLeadDetail`;

  const customFieldDefs = await getCustomFieldDefinitions(token, hosts);
  const locationId = await getDefaultLocationId(token, hosts);

  const leadTitle = String(
    leadData.name || leadData.Name || leadData.LeadName || existingRecord?.FullName || existingRecord?.LeadName || "Lead"
  );
  const phoneVal = cleanPhoneNumber(
    String(leadData.phone || leadData.Phone || leadData.mobile || leadData.phoneNumber || leadData.waId || existingRecord?.phone || existingRecord?.Phone || "")
  );
  const emailVal = String(leadData.email || leadData.Email || existingRecord?.email || existingRecord?.Email || "");

  const customFieldArray = formatCustomFields(leadData, customFieldDefs);

  const savePayload = {
    Id: leadId,
    LeadId: leadId,
    FullName: leadTitle,
    LeadName: leadTitle,
    CompanyName: String(leadData.company || leadData.CompanyName || existingRecord?.CompanyName || ""),
    Location: locationId,
    LocationId: locationId,
    Site: locationId,
    CurrencyId: String(existingRecord?.CurrencyId || "049"),
    Owner: String(existingRecord?.OwnerId || (Array.isArray(existingRecord?.AssigneeId) ? existingRecord.AssigneeId[0] : "68ac22e2a608471805479fce")),
    OwnerId: String(existingRecord?.OwnerId || (Array.isArray(existingRecord?.AssigneeId) ? existingRecord.AssigneeId[0] : "68ac22e2a608471805479fce")),
    WorkFlow: String(existingRecord?.WorkflowId || "6a3e3ff89b6e94694c113a08"),
    WorkflowId: String(existingRecord?.WorkflowId || "6a3e3ff89b6e94694c113a08"),
    StatusName: String(existingRecord?.StatusName || "NPD Discussion"),
    Phone: [
      { Title: "Work", Country: "+91", Icon: "mat_outline:call", Type: "PHONE", Value: phoneVal }
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
    success: responseJson?.Succeeded !== false,
    leadId,
    isNewLead: false,
    message: responseJson?.Messages?.[0] || "Lead updated successfully in TEB Cloud",
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
      // Create New Lead
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
