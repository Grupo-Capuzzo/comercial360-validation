"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Journey, Template } from "@/lib/commercial/journey";
export function CommercialJourneyPanel({opportunity}:{opportunity:string}) {
  const [state,setState]=useState<{journey:Journey;template:Template|null}|null>(null); const [message,setMessage]=useState(""); const [busy,setBusy]=useState(false);
  const pending=useRef<{body:string;request:string}|null>(null);
  const [items,setItems]=useState([{id:'',description:'',quantity:1,unitPrice:''}]);
  useEffect(()=>{let active=true; void fetch(`/api/comercial/jornada/${opportunity}`).then(async r=>{if(!r.ok) throw new Error(); const value=await r.json(); if(active) setState(value);}).catch(()=>{if(active) setMessage("Jornada indisponível: estruturas ou acesso ainda não habilitados. Nenhum fechamento foi efetuado.");}); return()=>{active=false;};},[opportunity]);
  async function send(command:Record<string,unknown>) {
    if(!state || busy) return;
    if(pending.current) {
      const previous=JSON.parse(pending.current.body);
      if(previous.action===command.action) {
        if(command.action==='propose') command={...command,proposal:{...command.proposal as Record<string,unknown>,id:previous.proposal.id}};
        if(command.action==='complete') command={...command,contractId:previous.contractId};
      }
    }
    const body=JSON.stringify({...command,expectedVersion:state.journey.version});
    if(pending.current && pending.current.body!==body) {setMessage("Confirme o reenvio da ação pendente antes de alterar seus dados."); return;}
    pending.current??={body,request:crypto.randomUUID()}; setBusy(true);
    try { const response=await fetch(`/api/comercial/jornada/${opportunity}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...JSON.parse(body),request:pending.current.request})});
      if(!response.ok) {setMessage(response.status===409?"Conflito de versão. Recarregue e confira o estado atual.":"Ação não confirmada. Verifique permissões e requisitos contratuais."); if(response.status<500) pending.current=null; return;}
      setState(await response.json()); pending.current=null; setMessage("Etapa registrada na mesma oportunidade.");
    } catch {setMessage("Conexão interrompida. Reenvie a mesma ação para confirmar, sem duplicação.");} finally {setBusy(false);}
  }
  function propose(event:FormEvent<HTMLFormElement>) {event.preventDefault(); const f=new FormData(event.currentTarget); void send({action:"propose",proposal:{id:crypto.randomUUID(),items:items.map((item,index)=>({...item,id:item.id || `item-${index+1}`,product:state?.journey.product})),conditions:String(f.get("conditions")),accepted:false}});}
  function complete(event:FormEvent<HTMLFormElement>) { event.preventDefault(); if(!state?.template) return; const data=new FormData(event.currentTarget); const fields=Object.fromEntries(state.template.fields.map(f=>[f.name,String(data.get(`field:${f.name}`)??"")])); const documents=Object.fromEntries(state.template.documents.map(d=>[d,String(data.get(`document:${d}`)??"")])); void send({action:"complete",fields,documents,contractId:state.journey.contract?.id??crypto.randomUUID()}); }
  if(!state) return <p role="status" data-testid="commercial-journey-message">{message || "Carregando jornada…"}</p>;
  const {journey,template}=state;
  return <section className="space-y-5 rounded border p-5">
    <h1 className="text-2xl font-semibold">Jornada contratual</h1><p>Oportunidade {opportunity} · {journey.stage} · revisão {journey.version}</p>
    {!template && <p role="status">Não há modelo contratual aprovado para este produto. Complementação e fechamento permanecem bloqueados.</p>}
    {journey.stage==='lead' && <form onSubmit={event=>{event.preventDefault();const data=new FormData(event.currentTarget);void send({action:'qualify',client:String(data.get('client')),opportunity});}}><label>Referência do cliente previamente confirmado<input name="client" required/></label><button disabled={busy}>Qualificar e usar vínculo aprovado</button><p>O banco exige uma correspondência aprovada para esta oportunidade. Não vincula por nome, e-mail ou CPF.</p></form>}
    {journey.stage==="qualified" || journey.stage==="proposal" ? <form onSubmit={e=>{try{propose(e);}catch{e.preventDefault();setMessage("Itens inválidos. Informe a lista estruturada.");}}} className="space-y-3">
      {items.map((item,index)=><fieldset key={index} className="space-y-2 rounded border p-3"><legend>Item {index+1}</legend>
        <label className="block">Descrição<input required maxLength={300} value={item.description} onChange={e=>setItems(list=>list.map((i,n)=>n===index?{...i,description:e.target.value}:i))} className="block w-full border p-2"/></label>
        <label className="block">Quantidade<input type="number" min={1} max={100000} step={1} required value={item.quantity} onChange={e=>setItems(list=>list.map((i,n)=>n===index?{...i,quantity:Number(e.target.value)}:i))}/></label>
        <label className="block">Valor unitário (ex.: 1000.00)<input required inputMode="decimal" pattern="(0|[1-9][0-9]{0,11})\.[0-9]{2}" value={item.unitPrice} onChange={e=>setItems(list=>list.map((i,n)=>n===index?{...i,unitPrice:e.target.value}:i))}/></label>
        {items.length>1 && <button type="button" onClick={()=>setItems(list=>list.filter((_,n)=>n!==index))}>Remover item</button>}
      </fieldset>)}
      <button type="button" disabled={items.length>=100} onClick={()=>setItems(list=>[...list,{id:crypto.randomUUID(),description:'',quantity:1,unitPrice:''}])}>Adicionar item ao mesmo negócio</button>
      <label className="block">Condições aprovadas<textarea name="conditions" required className="block w-full rounded border p-2"/></label><button disabled={busy}>Registrar proposta</button>
    </form>:null}
    {journey.stage==="proposal" && <button disabled={busy} onClick={()=>void send({action:"accept"})}>Registrar aceite da proposta</button>}
    {template && ["accepted","preparing_contract","awaiting_signature"].includes(journey.stage) && <form onSubmit={complete} className="space-y-3">
      <h2>Complementação — modelo {template.id}, versão {template.version}</h2>
      {template.fields.map(field=><label key={field.name} className="block">{field.label}<input name={`field:${field.name}`} required={field.required} maxLength={field.maxLength} defaultValue={journey.contract?.fields[field.name]??""} className="block w-full rounded border p-2"/></label>)}
      {template.documents.map(document=><label key={document} className="block">Referência privada do documento: {document}<input name={`document:${document}`} required maxLength={500} defaultValue={journey.contract?.documents[document]??""} className="block w-full rounded border p-2"/></label>)}
      <button disabled={busy}>Salvar complementação na oportunidade</button><p>Alterar a complementação invalida o aceite jurídico e a evidência anterior de assinatura.</p>
    </form>}
    {["preparing_contract","awaiting_signature"].includes(journey.stage) && <form onSubmit={event=>{event.preventDefault();const data=new FormData(event.currentTarget);void send({action:"formalize",signatureEvidence:String(data.get("evidence")??"")||null,legalApproved:data.get("approved")==="on"});}}>
      <h2>Jurídico — revisão de evidências</h2><label className="block">Referência da comprovação de assinatura<input name="evidence" maxLength={500} className="block w-full border p-2"/></label>
      <label><input type="checkbox" name="approved"/> Revisão jurídica concluída</label><button disabled={busy}>Registrar revisão jurídica</button><p>Registrar uma referência não realiza nem comprova automaticamente uma assinatura digital. A evidência precisa ser conferida pelo Jurídico.</p>
    </form>}
    {journey.stage==="awaiting_signature" && <form onSubmit={event=>{event.preventDefault();const data=new FormData(event.currentTarget);void send({action:"close",closedAt:new Date(String(data.get("date"))).toISOString()});}}><label>Data efetiva do fechamento<input name="date" type="datetime-local" required/></label><button disabled={busy || !journey.contract?.legalApproved || Boolean(template?.signatureRequired && !journey.contract?.signatureEvidence)}>Confirmar fechamento e disponibilizar output</button></form>}
    {journey.stage==="closed" && <p>Output comercial disponível para consumidor autorizado da empresa. Nenhuma operação financeira foi executada.</p>}
    {message && <p role="status" data-testid="commercial-journey-message">{message}</p>}
  </section>;
}
