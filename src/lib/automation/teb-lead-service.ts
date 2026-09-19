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

/**
 * Builds a TEB-compatible CustomFields array from dynamic WATI attributes.
 */
export function formatCustomFields(leadData: Record<string, unknown>) {
  const reserved = new Set(["name", "Name", "LeadName", "title", "Title", "phone", "Phone", "mobile", "Mobile", "phoneNumber", "waId", "email", "Email", "secretKey"]);
  const customFields: Array<{ Code: string; DbFieldName: string; Value: unknown }> = [];
  
  for (const [key, value] of Object.entries(leadData)) {
    if (!reserved.has(key) && value !== undefined && value !== null) {
      customFields.push({
        Code: key,
        DbFieldName: key.toLowerCase(),
        Value: value,
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

  const searchUrl = `${hosts.DYNAMIC}/api/dynamic/FnGetGridFilterData`;

  const searchPayload = {
    ModuleCode: "LeadManagement",
    ScreenCode: "MANAGE",
    SearchText: cleanedPhone,
    Filters: [
      {
        DbFieldName: "phone",
        Value: cleanedPhone,
        Operator: "contains",
      },
    ],
    PageNumber: 1,
    PageSize: 10,
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

  try {
    const res = await fetch(searchUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(searchPayload),
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
            title: String(match.Title || match.Name || match.LeadName || ""),
            rawRecord: match,
          };
        }
      }
    }
  } catch {
    // Continue to fallback search
  }

  return searchLeadFallback(cleanedPhone, token, hosts);
}

async function searchLeadFallback(
  cleanedPhone: string,
  token: string,
  hosts: Record<string, string>
): Promise<LeadSearchResult | null> {
  const fallbackUrl = `${hosts.DYNAMIC}/FnGetFormDetail()?$filter=contains(phone, '${cleanedPhone}') or contains(mobile, '${cleanedPhone}')`;

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    Type: "WEB",
  };

  try {
    const res = await fetch(fallbackUrl, { method: "GET", headers, cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    const items = extractLeadItems(data);
    if (!items || items.length === 0) return null;

    const match = items[0];
    const leadId = String(match.Id || match.id || match.LeadId || "");
    if (!leadId) return null;

    return {
      id: leadId,
      leadCode: String(match.LeadCode || match.Code || ""),
      phone: String(match.phone || match.Phone || cleanedPhone),
      email: String(match.email || match.Email || ""),
      title: String(match.Title || match.Name || ""),
      rawRecord: match,
    };
  } catch {
    return null;
  }
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
 * Creates a NEW Lead record in TEB Cloud when no matching phone number is found.
 */
export async function createLead(
  phoneNumber: string,
  leadData: Record<string, unknown>,
  token: string
): Promise<LeadOperationResult> {
  const hosts = getTebHosts();
  const createUrl = `${hosts.DYNAMIC}/api/dynamic/FnSaveLead`;

  const leadTitle = String(
    leadData.name || leadData.Name || leadData.LeadName || leadData.title || leadData.Title || `New Lead (${phoneNumber})`
  );

  const customFieldsArray = formatCustomFields(leadData);

  const createPayload = {
    Title: leadTitle,
    LeadName: leadTitle,
    Name: leadTitle,
    Phone: phoneNumber,
    MobileNumber: phoneNumber,
    phone: phoneNumber,
    CustomFields: customFieldsArray,
    ...leadData,
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
    body: JSON.stringify(createPayload),
    cache: "no-store",
  });

  if (!res.ok) {
    const errText = await res.text();
    return createLeadFallback(phoneNumber, leadData, token, hosts, errText);
  }

  const responseJson = await res.json().catch(() => ({}));
  const newId = String(responseJson?.Data?.Id || responseJson?.Data?.LeadId || responseJson?.Id || "NEW_LEAD");

  return {
    success: true,
    leadId: newId,
    isNewLead: true,
    message: "New Lead created successfully in TEB Cloud",
    fields: createPayload,
    rawResponse: responseJson,
  };
}

async function createLeadFallback(
  phoneNumber: string,
  leadData: Record<string, unknown>,
  token: string,
  hosts: Record<string, string>,
  primaryError: string
): Promise<LeadOperationResult> {
  const fallbackUrl = `${hosts.USER}/api/Lead/AcSaveLead`;

  const customFieldsArray = formatCustomFields(leadData);

  const createPayload = {
    Phone: phoneNumber,
    MobileNumber: phoneNumber,
    CustomFields: customFieldsArray,
    ...leadData,
  };

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    Type: "WEB",
  };

  try {
    const res = await fetch(fallbackUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(createPayload),
      cache: "no-store",
    });

    if (res.ok) {
      const json = await res.json().catch(() => ({}));
      const newId = String(json?.Data?.Id || json?.Data?.LeadId || json?.Id || "NEW_LEAD");
      return {
        success: true,
        leadId: newId,
        isNewLead: true,
        message: "New Lead created via fallback endpoint",
        fields: createPayload,
        rawResponse: json,
      };
    }
  } catch {
    // Ignore fallback error
  }

  return {
    success: false,
    leadId: "",
    isNewLead: true,
    message: `Failed to create new lead: ${primaryError}`,
    fields: createPayload,
  };
}

/**
 * Updates an existing Lead record in TEB.
 */
export async function updateLead(
  leadId: string,
  leadData: Record<string, unknown>,
  token: string
): Promise<LeadOperationResult> {
  const hosts = getTebHosts();
  const updateUrl = `${hosts.DYNAMIC}/api/dynamic/FnUpdateLead`;

  const customFieldsArray = formatCustomFields(leadData);

  const updatePayload = {
    Id: leadId,
    LeadId: leadId,
    CustomFields: customFieldsArray,
    ...leadData,
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
    body: JSON.stringify(updatePayload),
    cache: "no-store",
  });

  if (!res.ok) {
    const errText = await res.text();
    return updateLeadFallback(leadId, leadData, token, hosts, errText);
  }

  const responseJson = await res.json().catch(() => ({}));

  return {
    success: true,
    leadId,
    isNewLead: false,
    message: "Lead updated successfully in TEB Cloud",
    fields: leadData,
    rawResponse: responseJson,
  };
}

async function updateLeadFallback(
  leadId: string,
  leadData: Record<string, unknown>,
  token: string,
  hosts: Record<string, string>,
  primaryError: string
): Promise<LeadOperationResult> {
  const fallbackUrl = `${hosts.USER}/api/Lead/AcUpdateLead`;

  const customFieldsArray = formatCustomFields(leadData);

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    Type: "WEB",
  };

  try {
    const res = await fetch(fallbackUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ Id: leadId, CustomFields: customFieldsArray, ...leadData }),
      cache: "no-store",
    });

    if (res.ok) {
      const json = await res.json().catch(() => ({}));
      return {
        success: true,
        leadId,
        isNewLead: false,
        message: "Lead updated via fallback endpoint",
        fields: leadData,
        rawResponse: json,
      };
    }
  } catch {
    // Ignore fallback error
  }

  return {
    success: false,
    leadId,
    isNewLead: false,
    message: `Failed to update lead: ${primaryError}`,
    fields: leadData,
  };
}

/**
 * Main Orchestrator for Incoming Webhook Execution with Supabase Staging.
 */
export async function executeLeadWebhookAutomation(payload: Record<string, unknown>) {
  const rawPhone = String(
    payload.phone || payload.Phone || payload.mobile || payload.Mobile || payload.phoneNumber || ""
  );

  if (!rawPhone) {
    return {
      success: false,
      status: 400,
      error: "Missing required 'phone' or 'phoneNumber' parameter in webhook body payload.",
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
      const updateResult = await updateLead(leadMatch.id, leadData, token);
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
