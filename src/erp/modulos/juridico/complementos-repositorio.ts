import { createHash } from "node:crypto";
import { CasoNaoEncontrado, ConflitoJuridico, ValidacaoJuridica, AREAS } from "./modelo";
import { criarRepositorio, transacao, type TransacaoJuridica } from "./repositorio";
export type Pedido = { id: string; empresa: string; solicitante: string; area: string; descricao: string; situacao: string; prazo: string | null; resposta_final: string; versao: number; criado_em: string };
export type Documento = { id: string; nome: string; tipo: string; tamanho: number; sha256: string; criado_em: string; conteudo?: Uint8Array };
type Entrada = Record<string,string>;
function texto(v: string, max: number) {
  const s = (v ?? "").trim(); if (!s || s.length > max) throw new ValidacaoJuridica(`Preencha os campos obrigatórios (limite: ${max} caracteres).`); return s;
}
function data(v: string) {
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0,10)!==v) throw new ValidacaoJuridica("Prazo inválido.");
  return v;
}
export function validarDocumento(nome: string, bytes: Uint8Array) {
  if (!bytes.length || bytes.length > 5242880) throw new ValidacaoJuridica("Cada documento deve ter até 5 MB.");
  nome = nome.replace(/[\\/\r\n\x00-\x1f"]/g, "_").slice(0,180);
  const hex = Buffer.from(bytes.subarray(0,8)).toString("hex");
  const ext = nome.toLowerCase().split(".").at(-1);
  const tipo = ext === "pdf" && hex.startsWith("25504446") ? "application/pdf"
    : ext === "png" && hex === "89504e470d0a1a0a" ? "image/png"
    : (ext === "jpg" || ext === "jpeg") && hex.startsWith("ffd8ff") ? "image/jpeg"
    : ext === "docx" && hex.startsWith("504b0304") ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : null;
  if (!tipo) throw new ValidacaoJuridica("Arquivo inválido. Envie PDF, DOCX, PNG ou JPEG. O conteúdo precisa corresponder ao tipo.");
  return { nome, tipo, sha256: createHash("sha256").update(bytes).digest("hex") };
}
export function criarComplementos(executar: TransacaoJuridica = transacao) {
  function executarPedido<T>(empresas: string[], autor: string, legal: boolean, fn: Parameters<TransacaoJuridica>[3]) {
    return executar(empresas,autor,"",async db => {
      await db.consultar("SELECT set_config('juridico.papel',$1,true)",[legal ? "juridico" : "solicitante"]);
      return fn(db);
    }) as Promise<T>;
  }
  return {
    listarPedidos(empresas: string[],autor: string,legal: boolean,pagina: number) {
      return executarPedido<Pedido[]>(empresas,autor,legal, db => db.consultar("SELECT *, prazo::text AS prazo, criado_em::text AS criado_em FROM juridico.pedidos WHERE empresa=ANY($1::text[]) ORDER BY juridico.pedidos.criado_em DESC,id LIMIT 51 OFFSET $2",[empresas,(pagina-1)*50]));
    },
    consultarPedido(empresas: string[],autor: string,legal: boolean,id: string) {
      return executarPedido<Pedido>(empresas,autor,legal,async db => {
        const p = (await db.consultar<Pedido>("SELECT *, prazo::text AS prazo FROM juridico.pedidos WHERE id=$1 AND empresa=ANY($2::text[])",[id,empresas]))[0];
        if (!p) throw new CasoNaoEncontrado(); return p;
      });
    },
    criarPedido(empresas: string[],autor: string,empresa: string,d: Entrada) {
      if (!empresas.includes(empresa)) throw new CasoNaoEncontrado();
      if (!AREAS.includes(d.area)) throw new ValidacaoJuridica("Área inválida.");
      const descricao = texto(d.descricao,10000);
      return executarPedido<string>(empresas,autor,false,async db => {
        await db.consultar("INSERT INTO juridico.pedidos(id,empresa,solicitante,area,descricao) VALUES ($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING RETURNING id",[d.id,empresa,autor,d.area,descricao]);
        const p = (await db.consultar<Pedido>("SELECT id FROM juridico.pedidos WHERE id=$1 AND empresa=$2 AND solicitante=$3",[d.id,empresa,autor]))[0];
        if (!p) throw new ConflitoJuridico("Formulário já utilizado."); return p.id;
      });
    },
    responder(empresas: string[],autor: string,id: string,d: Entrada) {
      if (!["aberto","em_atendimento","concluido","cancelado"].includes(d.situacao)) throw new ValidacaoJuridica("Situação inválida.");
      const prazo = data(d.prazo), resposta = (d.resposta_final ?? "").trim();
      if (resposta.length>10000 || (d.situacao==="concluido" && !resposta)) throw new ValidacaoJuridica("Informe uma resposta final (até 10000 caracteres) para concluir.");
      if (!Number.isSafeInteger(Number(d.versao)) || Number(d.versao)<1) throw new ValidacaoJuridica("Versão inválida.");
      return executar(empresas,autor,"",async db => {
        const rows = await db.consultar("UPDATE juridico.pedidos SET situacao=$1,prazo=$2,resposta_final=$3,versao=versao+1 WHERE id=$4 AND empresa=ANY($5::text[]) AND versao=$6 RETURNING id",[d.situacao,prazo,resposta,id,empresas,Number(d.versao)]);
        if (!rows.length) throw new ConflitoJuridico("Pedido alterado em outra sessão ou indisponível. Reabra antes de salvar.");
      });
    },
    documentos(empresas: string[],autor: string,legal: boolean,tipo: "caso" | "pedido",id: string) {
      return executarPedido<Documento[]>(empresas,autor,legal,db => db.consultar(`SELECT id,nome,tipo,octet_length(conteudo) AS tamanho,sha256,criado_em::text FROM juridico.anexos WHERE ${tipo}_id=$1 AND empresa=ANY($2::text[]) ORDER BY criado_em DESC LIMIT 20`,[id,empresas]));
    },
    anexar(empresas: string[],autor: string,legal: boolean,tipo: "caso" | "pedido",id: string,documentoId: string,nome: string,bytes: Uint8Array) {
      if (tipo==="caso" && !legal) throw new CasoNaoEncontrado();
      const arquivo = validarDocumento(nome,bytes);
      return executarPedido<void>(empresas,autor,legal,async db => {
        const tabela = tipo==="caso" ? "casos" : "pedidos";
        await db.consultar("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",["juridico-anexo:"+tipo+":"+id]);
        const alvo = (await db.consultar<{empresa:string}>(`SELECT empresa FROM juridico.${tabela} WHERE id=$1 AND empresa=ANY($2::text[])`,[id,empresas]))[0];
        if (!alvo) throw new CasoNaoEncontrado();
        const repetido = await db.consultar("SELECT id FROM juridico.anexos WHERE id=$1 AND "+tipo+"_id=$2",[documentoId,id]);
        if (repetido.length) return;
        const limite = (await db.consultar<{n:number;total:number}>(`SELECT count(*)::int AS n,COALESCE(sum(octet_length(conteudo)),0)::int AS total FROM juridico.anexos WHERE ${tipo}_id=$1`,[id]))[0];
        if (limite.n>=20 || limite.total+bytes.length>52428800) throw new ValidacaoJuridica("Limite de anexos atingido: 20 arquivos ou 50 MB por ficha.");
        await db.consultar(`INSERT INTO juridico.anexos(id,empresa,${tipo}_id,nome,tipo,conteudo,sha256,autor) VALUES($1,$2,$3,$4,$5,$6::bytea,$7,$8)`,[documentoId,alvo.empresa,id,arquivo.nome,arquivo.tipo,Buffer.from(bytes),arquivo.sha256,autor]);
        if (tipo==="caso") await db.consultar("INSERT INTO juridico.eventos(caso_id,empresa,tipo,descricao,autor) VALUES($1,$2,'anotacao',$3,$4)",[id,alvo.empresa,"Documento anexado: "+arquivo.nome+" · SHA-256 "+arquivo.sha256,autor]);
      });
    },
    baixar(empresas: string[],autor: string,legal: boolean,id: string) {
      return executarPedido<Documento>(empresas,autor,legal,async db => {
        const arquivo = (await db.consultar<Documento>("SELECT id,nome,tipo,conteudo FROM juridico.anexos WHERE id=$1 AND empresa=ANY($2::text[])",[id,empresas]))[0];
        if (!arquivo) throw new CasoNaoEncontrado(); return arquivo;
      });
    },
    encaminhar(empresas: string[],autor: string,empresa: string,d: Entrada) {
      if (!empresas.includes(empresa)) throw new CasoNaoEncontrado();
      const referencia = texto(d.referencia,200), resumo = texto(d.resumo,4000), historico = texto(d.historico,9500);
      return executar(empresas,autor,"Encaminhamento manual da cobrança",async db => {
        const existente = (await db.consultar<{caso_id:string}>("SELECT caso_id FROM juridico.encaminhamentos WHERE empresa=$1 AND referencia=$2",[empresa,referencia]))[0];
        if (existente) return existente.caso_id;
        const interno = criarRepositorio(async (_e,_a,_m,fn) => fn(db));
        const id = await interno.salvar(empresas,autor,empresa,{...d,titulo:"Cobrança — "+d.cliente_nome,descricao:resumo,condicao:"devedor",situacao:"ativo",fase:"Triagem",instancia:"Não se aplica",responsavel:"Jurídico — triagem",prazo:"",prazo_descricao:""});
        await db.consultar("INSERT INTO juridico.encaminhamentos(empresa,referencia,caso_id,resumo,historico,autor) VALUES($1,$2,$3,$4,$5,$6)",[empresa,referencia,id,resumo,historico,autor]);
        await interno.anotar(empresas,autor,id,"anotacao","Encaminhamento manual do Financeiro. Referência: "+referencia+"\nResumo: "+resumo);
        await interno.anotar(empresas,autor,id,"contato","Linha do tempo informada pelo Financeiro (não importada automaticamente):\n"+historico);
        return id;
      });
    },
  };
}
