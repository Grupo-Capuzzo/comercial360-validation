import { parseContact, rule } from "./journey";

export const noStore = { "Cache-Control": "private, no-store" };
export async function readJson(request: Request): Promise<Record<string,unknown>> {
  // Next/reverse proxies may reconstruct an internal URL. Never trust forwarded
  // headers to define the allowed external origin for an authenticated mutation.
  const configured=process.env.COMMERCIAL_PUBLIC_ORIGIN;
  rule(process.env.NODE_ENV!=="production" || configured,"origin_not_configured");
  let expected=new URL(request.url).origin;
  if(configured) {
    const url=new URL(configured);
    rule(url.origin===configured && (url.protocol==='https:' || url.protocol==='http:' && ['127.0.0.1','localhost'].includes(url.hostname)),"origin_config_invalid");
    expected=url.origin;
  }
  rule(request.headers.get("origin") === expected, "origin_denied");
  rule(request.headers.get("content-type")?.split(";")[0] === "application/json", "json_required");
  // Limit the actual streamed bytes, not only a visitor-controlled Content-Length.
  const reader=request.body?.getReader(); rule(reader,"body_required");
  const chunks: Uint8Array[]=[]; let length=0;
  try { while(true) { const {done,value}=await reader.read(); if(done) break; length+=value.byteLength; rule(length<=32768,"body_too_large"); chunks.push(value); } }
  finally { await reader.cancel(); }
  const bytes=new Uint8Array(length); let offset=0; for(const chunk of chunks) { bytes.set(chunk,offset); offset+=chunk.length; }
  const body=JSON.parse(new TextDecoder().decode(bytes)); rule(body && typeof body==="object" && !Array.isArray(body),"invalid_body"); return body;
}
export function intakePayload(body: Record<string,unknown>, request: Request) {
  const key=request.headers.get("Idempotency-Key"); rule(key && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key),"submission_key_required");
  return { contact:parseContact(body), submission:key };
}
