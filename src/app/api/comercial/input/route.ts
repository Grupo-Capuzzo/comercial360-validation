import { intakePayload, noStore, readJson } from "@/lib/commercial/http";
import { commercialRpc } from "@/services/commercial-journey.service";
import { PortalError } from "@/services/portal.service";
export async function POST(request: Request) {
  try {
    const input=intakePayload(await readJson(request),request);
    // Anonymous, insert-only RPC: no lookup/upsert by email/CPF, no admin key.
    await commercialRpc("commercial_receive_input",{p_submission:input.submission,p_contact:input.contact},false);
    return Response.json({received:true},{status:202,headers:noStore});
  } catch(error) {
    const validationCodes=["origin_denied","origin_not_configured","origin_config_invalid","json_required","body_required","body_too_large","invalid_body","submission_key_required","invalid_contact","unexpected_contact_field","name_interest_required","contact_channel_required","invalid_email","invalid_phone","invalid_nome","invalid_telefone","invalid_interesse","invalid_empresa_contato"];
    const code=error instanceof PortalError ? error.code:error instanceof Error && validationCodes.includes(error.message) ? error.message:"invalid_submission";
    return Response.json({code},{status:error instanceof PortalError ? error.status:["origin_not_configured","origin_config_invalid"].includes(code)?503:400,headers:noStore});
  }
}
