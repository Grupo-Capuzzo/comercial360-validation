import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PortalError } from "@/services/portal.service";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/** Reviewed RPC contract. Missing structures fail closed; never an in-memory production fallback. */
export async function commercialRpc(name: string, args: Record<string,unknown>, authenticated=true) {
  if(!isSupabaseConfigured) throw new PortalError(503,"commercial_structure_unavailable");
  const db=await createSupabaseServerClient() as unknown as SupabaseClient;
  if(authenticated) { const {data,error}=await db.auth.getUser(); if(error || !data.user) throw new PortalError(401,"session_required"); }
  const {data,error}=await db.schema("api_comercial").rpc(name,args);
  if(error) {
    if(error.code==="42501") throw new PortalError(403,"access_denied");
    if(error.code==="40001" || error.code==="23505") throw new PortalError(409,"version_or_submission_conflict");
    if(error.code==="22023") throw new PortalError(422,"commercial_requirements_not_met");
    throw new PortalError(503,"commercial_structure_unavailable");
  }
  return data;
}
