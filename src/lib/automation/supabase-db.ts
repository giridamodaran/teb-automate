import { createClient, SupabaseClient } from "@supabase/supabase-js";

export interface LeadWebhookRecord {
  id?: string;
  phone: string;
  payload: Record<string, unknown>;
  status: "pending" | "processing" | "completed" | "failed";
  teb_lead_id?: string | null;
  teb_action?: "UPDATED_EXISTING_LEAD" | "CREATED_NEW_LEAD" | null;
  error_message?: string | null;
  created_at?: string;
  processed_at?: string | null;
}

let supabaseClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (supabaseClient) return supabaseClient;

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return null;
  }

  try {
    supabaseClient = createClient(url, key, {
      auth: { persistSession: false },
    });
    return supabaseClient;
  } catch (err) {
    console.warn("Failed to initialize Supabase client:", err);
    return null;
  }
}

/**
 * Creates an initial staging log in Supabase with status = 'pending'.
 */
export async function createPendingLeadLog(
  phone: string,
  payload: Record<string, unknown>
): Promise<string | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  try {
    const { data, error } = await supabase
      .from("lead_webhooks")
      .insert({
        phone,
        payload,
        status: "pending",
      })
      .select("id")
      .single();

    if (error) {
      console.error("Supabase insert pending log error:", error.message);
      return null;
    }

    return data?.id || null;
  } catch (err) {
    console.error("Supabase createPendingLeadLog error:", err);
    return null;
  }
}

/**
 * Updates a log record in Supabase to status = 'completed'.
 */
export async function markLeadLogCompleted(
  logId: string | null,
  tebLeadId: string,
  tebAction: "UPDATED_EXISTING_LEAD" | "CREATED_NEW_LEAD"
): Promise<void> {
  if (!logId) return;
  const supabase = getSupabaseClient();
  if (!supabase) return;

  try {
    await supabase
      .from("lead_webhooks")
      .update({
        status: "completed",
        teb_lead_id: tebLeadId,
        teb_action: tebAction,
        processed_at: new Date().toISOString(),
      })
      .eq("id", logId);
  } catch (err) {
    console.error("Supabase markLeadLogCompleted error:", err);
  }
}

/**
 * Updates a log record in Supabase to status = 'failed'.
 */
export async function markLeadLogFailed(
  logId: string | null,
  errorMessage: string
): Promise<void> {
  if (!logId) return;
  const supabase = getSupabaseClient();
  if (!supabase) return;

  try {
    await supabase
      .from("lead_webhooks")
      .update({
        status: "failed",
        error_message: errorMessage,
        processed_at: new Date().toISOString(),
      })
      .eq("id", logId);
  } catch (err) {
    console.error("Supabase markLeadLogFailed error:", err);
  }
}
