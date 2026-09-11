import { tebRequest } from "@/lib/api/client";
import type { TebApiEnvelope } from "@/lib/api/types";

/** Live Dynamic `AcGetData` wrapper used by Ask filters and lookups. */
export interface TebAcGetDataRequest {
  Module: string;
  Code: string;
  PrimaryKey?: string | number;
  Data?: string;
  Action: string;
  FilterModule?: string;
  FilterId?: string | number | null;
  ComponentCode?: string;
}

export async function acGetData<T = unknown>(payload: TebAcGetDataRequest): Promise<TebApiEnvelope<T>> {
  return tebRequest<T>("DYNAMIC", "AcGetData", {
    method: "POST",
    body: { data: payload },
  });
}
