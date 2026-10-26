// Testes do consumidor de outputs comerciais no Financeiro — DADOS EXCLUSIVAMENTE SINTÉTICOS.
// Não exercitam Supabase, RPC, RLS nem persistência (estruturas SQL ainda não aplicadas).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {publish,consume,transition} from '../../src/lib/commercial/journey.ts';
import {paraCentavos,deCentavos,formatarCentavosBRL,validarOutput,interpretarResposta,consultarOutputs,planejarRecebimento,impressaoDigital} from '../../src/lib/financeiro/commercial-outputs.ts';

const EMPRESA='00000000-0000-4000-8000-000000000003';
// Exemplo sintético idêntico ao de docs/COMMERCIAL_INPUT_OUTPUT.md.
const exemplo=()=>({id:'00000000-0000-4000-8000-000000000001',version:6,business:'00000000-0000-4000-8000-000000000001',client:'00000000-0000-4000-8000-000000000002',company:EMPRESA,opportunity:'00000000-0000-4000-8000-000000000001',proposal:'synthetic-proposal',
  items:[{id:'synthetic-item-a',product:'00000000-0000-4000-8000-000000000004',description:'Item sintético A',quantity:2,unitPrice:'0.10'},{id:'synthetic-item-b',product:'00000000-0000-4000-8000-000000000004',description:'Item sintético B',quantity:1,unitPrice:'100.00'}],
  total:'100.20',conditions:'Condições comerciais exclusivamente sintéticas',
  contract:{id:'synthetic-contract',template:'synthetic-approved-template',templateVersion:1,fields:{},documents:{synthetic_document:'private-synthetic-reference'},signatureEvidence:'synthetic-evidence-reference',legalApproved:true},
  formalization:'completed',closedAt:'2026-09-30T12:00:00.000Z',source:'crm_new',originReferences:[],triggersNewSale:true,affectsInvestmentPositions:false});
const vazio={doNegocio:()=>[]};
const registroCom=(...rs)=>({doNegocio:id=>rs.filter(r=>r.id===id)});

test('dinheiro em centavos exatos, sem float',()=>{
  assert.equal(paraCentavos('100.20'),10020n);assert.equal(deCentavos(10020n),'100.20');assert.equal(deCentavos(5n),'0.05');
  assert.equal(formatarCentavosBRL(1001000000n),'R$ 10.010.000,00');
  for(const v of ['100.2','1e3','-1.00','01.00',100.2,'100,20',''])assert.throws(()=>paraCentavos(v),/valor_monetario_invalido/);
});
test('aceita o exemplo sintético do contrato v1',()=>{const o=validarOutput(exemplo());assert.equal(o.total,'100.20');});
test('aceita o DTO real produzido por publish()+consume() do Comercial',()=>{
  const sales={id:'s',company:EMPRESA,modules:['comercial'],write:true},legal={...sales,modules:['juridico']},fin={...sales,modules:['financeiro'],write:false};
  const t={id:'tpl',version:1,product:'p',approved:true,fields:[{name:'nome',label:'n',required:true,maxLength:50}],documents:['doc'],signatureRequired:true};
  const cmds=[{action:'qualify',client:'c',opportunity:'o'},{action:'propose',proposal:{id:'pr',items:[{id:'i1',product:'p',description:'d',quantity:3,unitPrice:'33.33'}],conditions:'x',accepted:false}},{action:'accept'},{action:'complete',contractId:'k',fields:{nome:'z'},documents:{doc:'ref'}},{action:'formalize',signatureEvidence:'ev',legalApproved:true},{action:'close',closedAt:'2026-09-30T12:00:00Z'}];
  const j=cmds.reduce((s,c)=>transition(s,c,c.action==='formalize'?legal:sales,t),{id:'b',lead:'l',client:null,company:EMPRESA,opportunity:null,product:'p',stage:'lead',proposal:null,contract:null,version:0,source:'crm_new',closedAt:null});
  const dto=JSON.parse(JSON.stringify(consume(publish(j,sales,t),fin)));
  assert.equal(validarOutput(dto).total,'99.99');
});
for(const [nome,mut,erro] of [
  ['campo extra',o=>{o.cpf='x'},'output_campos_inesperados'],
  ['campo ausente',o=>{delete o.conditions},'output_campos_inesperados'],
  ['total divergente',o=>{o.total='100.21'},'output_total_divergente'],
  ['valor como número',o=>{o.items[0].unitPrice=0.1},'valor_monetario_invalido'],
  ['business diferente do id',o=>{o.business='outro'},'output_identidade_invalida'],
  ['formalização pendente',o=>{o.formalization='pending'},'output_formalizacao_nao_concluida'],
  ['afeta posições',o=>{o.affectsInvestmentPositions=true},'output_afeta_posicoes'],
  ['itens repetidos',o=>{o.items[1].id=o.items[0].id},'output_itens_duplicados'],
  ['data inválida',o=>{o.closedAt='30/09/2026'},'output_data_invalida'],
  ['contrato com campo extra',o=>{o.contract.url='https://x'},'output_contrato_campos_inesperados'],
])test(`rejeita: ${nome}`,()=>{const o=exemplo();mut(o);assert.throws(()=>validarOutput(o),new RegExp(erro));});

test('indisponibilidade nunca vira lista vazia nem saldo zero',()=>{
  for(const [st,body,estado] of [[503,{code:'commercial_structure_unavailable'},'indisponivel'],[503,{code:'query_failed'},'indisponivel'],[401,{code:'session_required'},'sem_sessao'],[403,{code:'access_denied'},'sem_permissao'],[409,{code:'version_or_submission_conflict'},'conflito'],[422,{code:'commercial_requirements_not_met'},'requisitos_nao_atendidos'],[502,null,'indisponivel'],[200,{},'resposta_invalida']]){
    const r=interpretarResposta(st,body);assert.equal(r.estado,estado);assert.equal('outputs' in r,false);
  }
});
test('200 com [] é "nenhum output", e itens inválidos são separados sem derrubar os válidos',()=>{
  assert.deepEqual(interpretarResposta(200,[]),{estado:'ok',outputs:[],rejeitados:[]});
  const ruim={...exemplo(),total:'1.00'};const r=interpretarResposta(200,[exemplo(),ruim]);
  assert.equal(r.outputs.length,1);assert.deepEqual(r.rejeitados,[{indice:1,motivo:'output_total_divergente'}]);
});
test('consulta usa a rota do Comercial com a sessão (mesma origem, sem chave) e trata falha de rede',async()=>{
  let chamada;const f=async(url,init)=>{chamada={url,init};return new Response(JSON.stringify([exemplo()]),{status:200});};
  const r=await consultarOutputs(EMPRESA,f);assert.equal(r.estado,'ok');assert.equal(chamada.url,`/api/comercial/outputs/${EMPRESA}`);
  assert.equal(chamada.init.credentials,'same-origin');assert.equal(chamada.init.method,'GET');assert.equal(JSON.stringify(chamada.init.headers).includes('authorization'),false);
  assert.equal((await consultarOutputs(EMPRESA,async()=>{throw new Error('offline');})).estado,'indisponivel');
  assert.equal((await consultarOutputs(EMPRESA,async()=>new Response('<html>',{status:200}))).estado,'resposta_invalida');
});

test('negócio com vários itens gera UMA decisão, com total exato',()=>{
  const d=planejarRecebimento([validarOutput(exemplo())],EMPRESA,vazio);
  assert.equal(d.length,1);assert.equal(d[0].tipo,'novo');assert.equal(d[0].itens,2);assert.equal(d[0].totalCentavos,10020n);
});
test('mesmo output/versão já recebido não é processado de novo',()=>{
  const o=validarOutput(exemplo());const reg=registroCom({id:o.id,version:6,impressao:impressaoDigital(o)});
  assert.deepEqual(planejarRecebimento([o],EMPRESA,reg),[{tipo:'ja_recebido',id:o.id,version:6}]);
});
test('mesmo output repetido no mesmo lote conta uma vez',()=>{
  const d=planejarRecebimento([exemplo(),exemplo(),exemplo()].map(validarOutput),EMPRESA,vazio);assert.equal(d.length,1);
});
test('mesma versão com conteúdo diferente é conflito, não novo lançamento',()=>{
  const o=validarOutput(exemplo());const reg=registroCom({id:o.id,version:6,impressao:'outra'});
  assert.equal(planejarRecebimento([o],EMPRESA,reg)[0].tipo,'conflito_mesma_versao');
  const b={...exemplo(),conditions:'mudou'};assert.equal(planejarRecebimento([exemplo(),b].map(validarOutput),EMPRESA,vazio)[1].tipo,'conflito_mesma_versao');
});
test('versão posterior exige regra explícita; versão anterior é ignorada',()=>{
  const o=validarOutput(exemplo());
  assert.equal(planejarRecebimento([{...o,version:7}],EMPRESA,registroCom({id:o.id,version:6,impressao:'x'}))[0].tipo,'versao_posterior_requer_regra');
  assert.equal(planejarRecebimento([o],EMPRESA,registroCom({id:o.id,version:7,impressao:'x'}))[0].tipo,'versao_anterior_ignorada');
  const lote=planejarRecebimento([{...o,version:7},o],EMPRESA,vazio);
  assert.deepEqual(lote.map(d=>d.tipo),['novo','versao_posterior_requer_regra']);
});
test('histórico importado e triggersNewSale=false não geram efeito financeiro automático',()=>{
  const h=validarOutput({...exemplo(),source:'imported_history',triggersNewSale:false});
  assert.deepEqual(planejarRecebimento([h],EMPRESA,vazio)[0],{tipo:'sem_efeito_financeiro',id:h.id,version:6,motivo:'historico_importado'});
  const n=validarOutput({...exemplo(),triggersNewSale:false});assert.equal(planejarRecebimento([n],EMPRESA,vazio)[0].motivo,'nao_dispara_venda');
});
test('output de outra empresa ou sem aprovação jurídica é bloqueado',()=>{
  assert.equal(planejarRecebimento([validarOutput(exemplo())],'outra-empresa',vazio)[0].motivo,'outra_empresa');
  const o=exemplo();o.contract.legalApproved=false;assert.equal(planejarRecebimento([validarOutput(o)],EMPRESA,vazio)[0].motivo,'sem_aprovacao_juridica');
});
test('planejar não altera os outputs recebidos',()=>{const o=validarOutput(exemplo());const antes=JSON.stringify(o);planejarRecebimento([o],EMPRESA,vazio);assert.equal(JSON.stringify(o),antes);});
