import { randomUUID } from "node:crypto";
import { abort,g,get,post,request,render_template,redirect,url_for,Resposta } from "../../core/flask";
import { AREAS, CasoNaoEncontrado, ValidacaoJuridica } from "./modelo";
import { temAcessoJuridico,emVisaoJuridica } from "./acesso";
import { criarComplementos } from "./complementos-repositorio";
import { criarRepositorio } from "./repositorio";
type Empresa = {slug:string;nome:string;tema_full:Record<string,string>};
type Usuario = {id:number;ativo:number;perfil:string;admin:boolean;modo_juridico?:boolean};
type Portal = {empresas_visiveis:(u:Usuario)=>Promise<Empresa[]>;pode_ver_modulo:(u:Usuario,s:string,m:string)=>Promise<boolean>;TEMA_GRUPO:Record<string,string>};
type Seguro = (fn:()=>Promise<unknown>)=>Promise<unknown>;
const uuid = (id:string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
function identificador(id:string) { if (!uuid(id)) abort(404); return id; }
function campos(nomes:string[]) { return Object.fromEntries(nomes.map(n=>[n,String(request().form.get(n)??"")])); }
export function registrarComplementos(seguro:Seguro,csrf:()=>void,portal:Portal,repo=criarComplementos(),casos=criarRepositorio()) {
  async function contexto() {
    const user:Usuario=g().portal_user;
    if (!user || user.ativo!==1 || user.id==null) abort(403);
    const empresas=await portal.empresas_visiveis(user);
    return {user,empresas,slugs:empresas.map(e=>e.slug),autor:String(user.id),legal:temAcessoJuridico(user),t:portal.TEMA_GRUPO};
  }
  get("juridico.pedidos","/juridico/pedidos",()=>seguro(async()=>{
    const c=await contexto(), pagina=Number(request().args.get("pagina")||1);
    if (!Number.isSafeInteger(pagina)||pagina<1||pagina>10000) abort(400);
    const lista=await repo.listarPedidos(c.slugs,c.autor,c.legal,pagina);
    return render_template("juridico/pedidos.html",{...c,pedidos:lista.slice(0,50),pagina,proxima:lista.length>50,areas:AREAS,id_novo:randomUUID()});
  }));
  post("juridico.pedido_criar","/juridico/pedidos",()=>seguro(async()=>{
    const c=await contexto();csrf();
    const d=campos(["id","empresa","area","descricao"]);identificador(d.id);
    const id=await repo.criarPedido(c.slugs,c.autor,d.empresa,d);
    return redirect(url_for("juridico.pedido",{id}),303);
  }));
  get("juridico.pedido","/juridico/pedidos/<id>",(id:string)=>seguro(async()=>{
    const c=await contexto();identificador(id);
    const pedido=await repo.consultarPedido(c.slugs,c.autor,c.legal,id);
    const documentos=await repo.documentos(c.slugs,c.autor,c.legal,"pedido",id);
    return render_template("juridico/pedido.html",{...c,pedido,documentos,anexo_id:randomUUID()});
  }));
  post("juridico.pedido_responder","/juridico/pedidos/<id>/resposta",(id:string)=>seguro(async()=>{
    const c=await contexto();csrf();identificador(id);if(!c.legal)abort(403);
    await repo.responder(c.slugs,c.autor,id,campos(["situacao","prazo","resposta_final","versao"]));
    return redirect(url_for("juridico.pedido",{id}),303);
  }));
  get("juridico.documentos","/juridico/caso/<id>/documentos",(id:string)=>seguro(async()=>{
    const c=await contexto();identificador(id);if(!c.legal)abort(403);
    // Leitura do caso valida a existência e o escopo antes de mostrar anexos.
    await casos.consultar(c.slugs,c.autor,id);
    const documentos=await repo.documentos(c.slugs,c.autor,c.legal,"caso",id);
    return render_template("juridico/documentos.html",{...c,id,documentos,anexo_id:randomUUID()});
  }));
  async function anexar(tipo:"caso"|"pedido",id:string) {
    const c=await contexto();csrf();identificador(id);
    if(tipo==="caso"&&!c.legal)abort(403);
    const arquivo=request().files.get("arquivo")?.[0];
    if(!arquivo)throw new ValidacaoJuridica("Selecione um documento.");
    const documentoId=identificador(String(request().form.get("anexo_id")??""));
    await repo.anexar(c.slugs,c.autor,c.legal,tipo,id,documentoId,arquivo.filename,arquivo.read());
    return redirect(url_for(tipo==="caso"?"juridico.documentos":"juridico.pedido",{id}),303);
  }
  post("juridico.documento_caso","/juridico/caso/<id>/documentos",(id:string)=>seguro(()=>anexar("caso",id)));
  post("juridico.documento_pedido","/juridico/pedidos/<id>/documentos",(id:string)=>seguro(()=>anexar("pedido",id)));
  get("juridico.documento_baixar","/juridico/documento/<id>",(id:string)=>seguro(async()=>{
    const c=await contexto();identificador(id);
    const arquivo=await repo.baixar(c.slugs,c.autor,c.legal,id);
    const resposta=new Resposta(Buffer.from(arquivo.conteudo!),200,arquivo.tipo);
    resposta.headers.set("content-disposition","attachment; filename*=UTF-8''"+encodeURIComponent(arquivo.nome));
    resposta.headers.set("x-content-type-options","nosniff");resposta.headers.set("content-security-policy","default-src 'none'");
    return resposta;
  }));
  async function empresasFinanceiras() {
    const c=await contexto();if(emVisaoJuridica(c.user))abort(403);
    const financeiras=await Promise.all(c.empresas.map(async e=>await portal.pode_ver_modulo(c.user,e.slug,"financas")?e:null));
    return {...c,empresas:financeiras.filter((e):e is Empresa=>e!==null)};
  }
  get("juridico.encaminhar","/juridico/encaminhar",()=>seguro(async()=>{
    const c=await empresasFinanceiras();if(!c.empresas.length)abort(403);
    return render_template("juridico/encaminhar.html",{...c,cadastro_id:randomUUID(),areas:AREAS,empresa_selecionada:request().args.get("empresa")});
  }));
  post("juridico.encaminhar_salvar","/juridico/encaminhar",()=>seguro(async()=>{
    const c=await empresasFinanceiras();csrf();
    const d=campos(["cadastro_id","empresa","referencia","resumo","historico","cliente_nome","cliente_tipo","cliente_documento","cliente_telefone","cliente_email","area"]);
    identificador(d.cadastro_id);
    if(request().form.get("confirmado")!=="1")throw new ValidacaoJuridica("Confirme o encaminhamento e a conferência do histórico.");
    if(!c.empresas.some(e=>e.slug===d.empresa))throw new CasoNaoEncontrado();
    const id=await repo.encaminhar([d.empresa],c.autor,d.empresa,d);
    // Quem não pertence ao Jurídico recebe confirmação sem acesso à ficha interna.
    return render_template("juridico/encaminhado.html",{...c,id});
  }));
}
