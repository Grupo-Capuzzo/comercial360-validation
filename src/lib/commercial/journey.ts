/** Pure commercial rules: no financial, signature or email side effects. */
export type Contact = { nome: string; telefone: string; email: string; interesse: string; empresa_contato: string };
export type Actor = { id: string; company: string; modules: string[]; write: boolean };
export type Item = { id: string; product: string; description: string; quantity: number; unitPrice: string };
export type Template = { id: string; version: number; product: string; approved: boolean; fields: { name: string; label: string; required: boolean; maxLength: number }[]; documents: string[]; signatureRequired: boolean };
export type Proposal = { id: string; items: Item[]; conditions: string; accepted: boolean };
export type Contract = { id: string; template: string; templateVersion: number; fields: Record<string, string>; documents: Record<string, string>; signatureEvidence: string | null; legalApproved: boolean };
export type Journey = { id: string; lead: string | null; client: string | null; company: string; opportunity: string | null; product: string; stage: "lead" | "qualified" | "proposal" | "accepted" | "preparing_contract" | "awaiting_signature" | "closed"; proposal: Proposal | null; contract: Contract | null; version: number; source: "crm_new" | "imported_history"; closedAt: string | null };
export type Output = { id: string; version: number; business: string; client: string; company: string; opportunity: string | null; proposal: string | null; items: Item[]; total: string; conditions: string; contract: Contract; formalization: "completed"; closedAt: string; source: Journey["source"]; originReferences: string[]; triggersNewSale: boolean; affectsInvestmentPositions: false };
export type Command = { action: "qualify"; client: string; opportunity: string } | { action: "propose"; proposal: Proposal } | { action: "accept" } | { action: "complete"; fields: Record<string,string>; documents: Record<string,string>; contractId: string } | { action: "formalize"; signatureEvidence: string | null; legalApproved: boolean } | { action: "close"; closedAt: string };
export function rule(ok: unknown, code: string): asserts ok { if (!ok) throw new Error(code); }
export function authorize(actor: Actor, company: string, module: string, write = false) { rule(actor.id && actor.company === company && actor.modules.includes(module) && (!write || actor.write), "access_denied"); }
export function parseContact(raw: unknown): Contact {
  rule(raw && typeof raw === "object" && !Array.isArray(raw), "invalid_contact");
  const value = raw as Record<string,unknown>;
  rule(Object.keys(value).every(k => ["nome","telefone","email","interesse","empresa_contato"].includes(k)), "unexpected_contact_field");
  const text = (key: string,max: number) => { const v = value[key] ?? ""; rule(typeof v === "string" && v.length <= max, "invalid_"+key); return v.trim(); };
  const result = { nome:text("nome",160), telefone:text("telefone",32), email:text("email",254).toLowerCase(), interesse:text("interesse",100), empresa_contato:text("empresa_contato",160) };
  rule(result.nome.length >= 2 && result.interesse, "name_interest_required"); rule(result.telefone || result.email, "contact_channel_required");
  rule(!result.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email), "invalid_email");
  rule(!result.telefone || /^\+?[\d ()-]{8,32}$/.test(result.telefone) && result.telefone.replace(/\D/g,"").length >= 8, "invalid_phone"); return result;
}
export function cents(value: string): bigint { rule(typeof value === "string" && /^(0|[1-9]\d{0,11})\.\d{2}$/.test(value), "invalid_money"); return BigInt(value.replace(".","")); }
export function total(items: Item[]): string {
  rule(items.length > 0 && items.length <= 100 && new Set(items.map(i=>i.id)).size === items.length, "invalid_items");
  const sum = items.reduce((s,i)=>{ rule(i.id && i.product && i.description && Number.isSafeInteger(i.quantity) && i.quantity>0 && i.quantity<=100000, "invalid_item"); return s+cents(i.unitPrice)*BigInt(i.quantity); },BigInt(0));
  const text = sum.toString().padStart(3,"0"); return text.slice(0,-2)+"."+text.slice(-2);
}
export function approvedTemplate(template: Template | null, product: string): asserts template is Template {
  rule(template?.approved && template.product===product && template.id && Number.isSafeInteger(template.version) && template.version>0, "approved_template_required");
  rule(new Set(template.fields.map(f=>f.name)).size===template.fields.length && template.fields.every(f=>/^[a-z][a-z0-9_]{0,63}$/.test(f.name) && f.maxLength>0 && f.maxLength<=2000), "invalid_template");
}
export function contractReady(contract: Contract, template: Template) {
  rule(contract.id && contract.template===template.id && contract.templateVersion===template.version, "template_version_conflict");
  rule(Object.keys(contract.fields).every(k=>template.fields.some(f=>f.name===k)), "unexpected_contract_field");
  for (const field of template.fields) { const v=contract.fields[field.name]; rule((!field.required && v===undefined) || typeof v==="string" && (!field.required || v.trim().length>0) && v.length<=field.maxLength, "contract_field_required:"+field.name); }
  rule(Object.keys(contract.documents).every(k=>template.documents.includes(k)), "unexpected_document");
  rule(template.documents.every(k=>typeof contract.documents[k]==="string" && contract.documents[k].length>0 && contract.documents[k].length<=500), "contract_document_required");
}
export function transition(current: Journey, command: Command, actor: Actor, template: Template | null): Journey {
  authorize(actor,current.company,command.action==="formalize" ? "juridico":"comercial",true); rule(current.source==="crm_new", "legacy_not_open_opportunity");
  const next=structuredClone(current);
  if(command.action==="close" && current.stage==="closed") { rule(new Date(command.closedAt).toISOString()===current.closedAt,"closed_output_immutable"); return next; }
  rule(current.stage!=="closed", "closed_output_immutable");
  if(command.action==="qualify") { rule(current.stage==="lead" && command.client && command.opportunity,"qualification_required"); next.client=command.client; next.opportunity=command.opportunity; next.stage="qualified"; }
  else if(command.action==="propose") { rule(["qualified","proposal"].includes(current.stage),"qualification_required"); total(command.proposal.items); rule(command.proposal.id && command.proposal.conditions.trim() && !command.proposal.accepted && command.proposal.items.every(i=>i.product===current.product),"invalid_proposal"); next.proposal=structuredClone(command.proposal); next.stage="proposal"; }
  else if(command.action==="accept") { rule(current.stage==="proposal" && next.proposal,"proposal_required"); next.proposal.accepted=true; next.stage="accepted"; }
  else if(command.action==="complete") {
    rule(["accepted","preparing_contract","awaiting_signature"].includes(current.stage),"accepted_proposal_required"); approvedTemplate(template,current.product);
    rule(!current.contract || current.contract.id===command.contractId,"same_contract_required");
    const contract: Contract={id:command.contractId,template:template.id,templateVersion:template.version,fields:structuredClone(command.fields),documents:structuredClone(command.documents),signatureEvidence:null,legalApproved:false};
    contractReady(contract,template); next.contract=contract; next.stage="preparing_contract";
  } else if(command.action==="formalize") {
    rule(["preparing_contract","awaiting_signature"].includes(current.stage) && next.contract,"contract_required"); approvedTemplate(template,current.product); contractReady(next.contract,template);
    rule(command.signatureEvidence===null || typeof command.signatureEvidence==="string" && command.signatureEvidence.trim().length>0 && command.signatureEvidence.length<=500,"invalid_signature_evidence");
    next.contract.signatureEvidence=command.signatureEvidence; next.contract.legalApproved=command.legalApproved===true; next.stage="awaiting_signature";
  } else if(command.action==="close") {
    approvedTemplate(template,current.product); rule(current.stage==="awaiting_signature" && current.client && current.opportunity && current.proposal?.accepted && current.contract,"formalization_required"); contractReady(current.contract,template);
    rule(current.contract.legalApproved && (!template.signatureRequired || current.contract.signatureEvidence),"signature_legal_required");
    rule(/^\d{4}-\d{2}-\d{2}T/.test(command.closedAt) && Number.isFinite(Date.parse(command.closedAt)),"effective_closing_date_required"); next.stage="closed"; next.closedAt=new Date(command.closedAt).toISOString();
  } else { throw new Error("invalid_command"); }
  next.version++; return next;
}
export function publish(journey: Journey,actor: Actor,template: Template,originReferences: string[]=[]): Output {
  authorize(actor,journey.company,"comercial",true); approvedTemplate(template,journey.product);
  rule(journey.stage==="closed" && journey.client && journey.proposal?.accepted && journey.contract && journey.closedAt,"output_not_ready"); contractReady(journey.contract,template);
  rule(journey.contract.legalApproved && (!template.signatureRequired || journey.contract.signatureEvidence),"signature_legal_required");
  return structuredClone({id:journey.id,version:journey.version,business:journey.id,client:journey.client,company:journey.company,opportunity:journey.opportunity,proposal:journey.proposal.id,items:journey.proposal.items,total:total(journey.proposal.items),conditions:journey.proposal.conditions,contract:journey.contract,formalization:"completed",closedAt:journey.closedAt,source:journey.source,originReferences,triggersNewSale:journey.source==="crm_new",affectsInvestmentPositions:false});
}
export function consume(output: Output,actor: Actor): Output { authorize(actor,output.company,"financeiro"); const dto=structuredClone(output); dto.contract.fields={}; return dto; }
export function classifyHistory(group: { approvedIdentity: boolean; approvedGrouping: boolean; groupKey: string|null; effectiveDate: string|null; sourceItems: string[]; existingOutput: string|null; overlapsPosition: boolean }) {
  const pending: string[]=[];
  if(!group.approvedIdentity) pending.push("identity_not_approved"); if(!group.approvedGrouping || !group.groupKey) pending.push("contract_group_not_proven");
  if(!group.effectiveDate || !Number.isFinite(Date.parse(group.effectiveDate))) pending.push("effective_date_not_proven");
  if(!group.sourceItems.length || new Set(group.sourceItems).size!==group.sourceItems.length) pending.push("invalid_source_items");
  return {disposition:pending.length ? "pending":group.existingOutput ? "link_existing":"historical_completed",pending,createOpportunity:false,financialActions:[],newSaleAutomation:false,updatePositions:false,source:"imported_history",effectiveDate:group.effectiveDate};
}
