"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { parseContact } from "@/lib/commercial/journey";
export function CommercialInputForm() {
  const [products,setProducts]=useState<{code:string;name:string}[]>([]);
  const [message,setMessage]=useState(""); const [busy,setBusy]=useState(false); const [received,setReceived]=useState(false);
  const submission=useRef<string|null>(null); const submittedBody=useRef<string|null>(null);
  useEffect(()=>{ let active=true; void fetch("/api/comercial/catalogo").then(async response=>{ if(!response.ok) throw new Error(); const result=await response.json(); if(active) setProducts(result.products); }).catch(()=>{ if(active) setMessage("Entrada indisponível: o catálogo autorizado ainda não foi habilitado."); }); return()=>{active=false;}; },[]);
  async function send(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); if(busy || received) return; const form=event.currentTarget;
    try {
      const contact=parseContact(Object.fromEntries(new FormData(form))); const body=JSON.stringify(contact);
      // Preserve key and payload after ambiguous network errors, including a page refresh.
      const saved=sessionStorage.getItem("commercial_submission");
      const prior=saved ? JSON.parse(saved) as {key:string;body:string} : null;
      if(!submission.current) { submission.current=prior?.key ?? crypto.randomUUID(); submittedBody.current=prior?.body ?? body; }
      if(submittedBody.current!==body) { setMessage("Há um envio pendente com outros dados. Reenvie os dados originais antes de iniciar um novo contato."); return; }
      sessionStorage.setItem("commercial_submission",JSON.stringify({key:submission.current,body}));
      setBusy(true); setMessage("");
      const response=await fetch("/api/comercial/input",{method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":submission.current},body});
      if(!response.ok) { setMessage(response.status===503 ? "Recebimento indisponível. Seus dados não foram confirmados; tente novamente mais tarde.":"Não foi possível confirmar o envio. Confira os dados e reenvie a mesma solicitação."); return; }
      sessionStorage.removeItem("commercial_submission"); setReceived(true); setMessage("Contato recebido. Nossa equipe dará continuidade ao atendimento.");
    } catch { setMessage("Confira nome, produto e ao menos um contato válido. Se houve falha de conexão, reenvie os mesmos dados."); } finally { setBusy(false); }
  }
  return <section className="mx-auto max-w-xl space-y-5 rounded-2xl border border-slate-200 bg-white p-6">
    <h1 className="text-2xl font-semibold">Fale com o Comercial</h1><p>Informe seu interesse. Dados contratuais serão solicitados somente durante a negociação.</p>
    <form onSubmit={send} className="space-y-4">
      {([['nome','Nome','text'],['telefone','Telefone / WhatsApp','tel'],['email','E-mail','email'],['empresa_contato','Sua empresa (opcional)','text']] as const).map(([name,label,type])=><label key={name} className="block">{label}<input className="mt-1 block w-full rounded border p-2" name={name} type={type} required={name==='nome'} maxLength={name==='email'?254:name==='telefone'?32:160} disabled={received}/></label>)}
      <label className="block">Produto / serviço de interesse<select name="interesse" required disabled={!products.length || received} className="mt-1 block w-full rounded border p-2"><option value="">Selecione</option>{products.map(product=><option key={product.code} value={product.code}>{product.name}</option>)}</select></label>
      <button className="rounded bg-[var(--navy)] px-4 py-2 text-white disabled:opacity-50" disabled={busy || received || !products.length}>{busy?'Enviando…':'Enviar interesse'}</button>
    </form>
    {message && <p role="status" data-testid="commercial-input-message">{message}</p>}
    {received && <button type="button" onClick={()=>{submission.current=null; submittedBody.current=null; setReceived(false); setMessage("");}}>Iniciar outra solicitação</button>}
  </section>;
}
