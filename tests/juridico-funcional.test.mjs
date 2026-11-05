import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import ts from 'typescript';

// PostgreSQL isolado em memória. Nunca lê .env nem conecta ao Supabase.
const runtime = process.env.JURIDICO_TEST_RUNTIME;
if (!runtime) throw new Error('Defina JURIDICO_TEST_RUNTIME com o caminho de @electric-sql/pglite instalado fora do projeto. Consulte docs/JURIDICO_V1_INICIAL.md.');
const { PGlite } = await import(pathToFileURL(runtime).href);
const require = createRequire(import.meta.url);
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(readFileSync(file, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText, file);
const modelo = require('../src/erp/modulos/juridico/modelo.ts');
const { criarRepositorio } = require('../src/erp/modulos/juridico/repositorio.ts');
const entrada = { cadastro_id: '10643825-e533-41ac-957e-fb2396061011', titulo: 'Caso de teste isolado', cliente_nome: 'Cliente de teste', cliente_tipo: 'PF', cliente_documento: '52998224725',
  cliente_telefone: '11999999999', cliente_email: '', condicao: 'devedor', area: 'Cível', fase: 'Triagem',
  instancia: 'Não se aplica', situacao: 'ativo', numero_processo: '', vara: '', comarca: '', parte_contraria: '',
  descricao: 'Registro sintético, sem dados de produção', responsavel: 'Responsável de teste', prazo: '2026-12-10', prazo_descricao: 'Revisar documentação' };
const db = new PGlite();
await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE erp_app LOGIN;');
await db.exec(readFileSync(new URL('../supabase/migrations/20261105162110_juridico_casos_historico.sql', import.meta.url), 'utf8'));
await db.exec(readFileSync(new URL('../supabase/migrations/20261105170136_juridico_documentos_pedidos_encaminhamentos.sql', import.meta.url), 'utf8'));
const transacao = async (empresas, autor, descricao, fn) => {
  await db.exec('BEGIN; SET LOCAL ROLE erp_app;');
  try {
    await db.query("SELECT set_config('juridico.empresas', $1, true), set_config('juridico.autor', $2, true), set_config('juridico.descricao', $3, true),set_config('juridico.papel','juridico',true)", [JSON.stringify(empresas), autor, descricao]);
    const result = await fn({ consultar: async (sql, params = []) => (await db.query(sql, params)).rows });
    await db.exec('COMMIT'); return result;
  } catch (e) { await db.exec('ROLLBACK'); throw e; }
};
const repo = criarRepositorio(transacao);
const { criarComplementos, validarDocumento } = require('../src/erp/modulos/juridico/complementos-repositorio.ts');
const complementos = criarComplementos(transacao);
const tema = new Function('return (' + readFileSync(new URL('../src/erp/modulos/portal.ts', import.meta.url), 'utf8').match(/export const TEMA_GRUPO[^=]*= (\{[\s\S]*?\n\});/)[1] + ')')();

test('validação de campos e régua de prazos sem cálculo processual', () => {
  for (const dados of [{ ...entrada, cliente_documento: '11111111111' }, { ...entrada, prazo: '2026-02-30' },
    { ...entrada, fase: 'injetada' }, { ...entrada, prazo_descricao: '' }, { ...entrada, cliente_email: 'inválido' }]) {
    assert.throws(() => modelo.validarCaso(dados), modelo.ValidacaoJuridica);
  }
  assert.equal(modelo.validarCaso({ ...entrada, cliente_tipo: 'PJ', cliente_documento: '11222333000181' }).cliente_tipo, 'PJ');
  assert.match(modelo.alertaPrazo('2026-11-12', '2026-11-05').rotulo, /Urgente/);
  assert.match(modelo.alertaPrazo('2026-11-20', '2026-11-05').rotulo, /Atenção/);
  assert.match(modelo.alertaPrazo('2026-12-05', '2026-11-05').rotulo, /Próximo/);
  assert.match(modelo.alertaPrazo('2026-11-04', '2026-11-05').rotulo, /Vencido/);
});

test('PostgreSQL real: cadastro, histórico atômico, prazo, concorrência, encerramento e RLS', async () => {
  const id = await repo.salvar(['assessoria'], '101', 'assessoria', entrada);
  let ficha = await repo.consultar(['assessoria'], '101', id);
  assert.equal(ficha.caso.versao, 1);
  assert.equal(ficha.eventos.length, 1);
  assert.equal(ficha.eventos[0].tipo, 'cadastro');
  assert.equal(await repo.salvar(['assessoria'], '101', 'assessoria', entrada), id);
  assert.equal((await repo.consultar(['assessoria'], '101', id)).eventos.length, 1);
  await repo.anotar(['assessoria'], '101', id, 'contato', 'Contato registrado no teste');
  await repo.salvar(['assessoria'], '101', 'assessoria', { ...entrada, fase: 'Análise', prazo: '2026-12-20', versao: '1', motivo: 'Prazo anterior cumprido; próxima revisão agendada' }, id);
  ficha = await repo.consultar(['assessoria'], '101', id);
  assert.equal(ficha.caso.versao, 2);
  assert.equal(ficha.caso.prazo, '2026-12-20');
  const alteracao = ficha.eventos.find(e => e.tipo === 'alteracao');
  assert.equal(alteracao.anterior.prazo, '2026-12-10');
  assert.equal(alteracao.novo.fase, 'Análise');
  await assert.rejects(repo.salvar(['assessoria'], '101', 'assessoria', { ...entrada, versao: '1', motivo: 'Edição atrasada' }, id), modelo.ConflitoJuridico);
  assert.equal((await repo.consultar(['assessoria'], '101', id)).eventos.length, 3);
  await assert.rejects(repo.consultar(['ether'], '102', id), modelo.CasoNaoEncontrado);
  await assert.rejects(repo.anotar(['ether'], '102', id, 'contato', 'Sem acesso'), modelo.CasoNaoEncontrado);
  assert.deepEqual(await repo.listar(['ether'], '102', { busca: '', area: '', situacao: 'ativo', pagina: 1 }), []);
  assert.deepEqual(await transacao(['ether'], '102', 'Tentativa', tx => tx.consultar('UPDATE juridico.casos SET empresa = $1, versao = versao + 1 WHERE id = $2 RETURNING id', ['ether', id])), []);
  await repo.salvar(['assessoria'], '101', 'assessoria', { ...entrada, situacao: 'encerrado', versao: '2', motivo: 'Conclusão registrada' }, id);
  ficha = await repo.consultar(['assessoria'], '101', id);
  assert.equal(ficha.caso.situacao, 'encerrado');
  assert.ok(ficha.caso.encerrado_em);
  assert.equal((await repo.listar(['assessoria'], '101', { busca: 'Cliente', area: 'Cível', situacao: 'encerrado', pagina: 1 })).length, 1);
  await assert.rejects(transacao(['assessoria'], '101', '', tx => tx.consultar('DELETE FROM juridico.casos WHERE id = $1', [id])), /permission denied/);
  await assert.rejects(transacao(['assessoria', 'ether'], '101', 'Empresa não pode mudar', tx => tx.consultar('UPDATE juridico.casos SET empresa = $1, versao = versao + 1 WHERE id = $2', ['ether', id])), /imutável/);
  await assert.rejects(transacao(['assessoria'], '101', '', tx => tx.consultar("INSERT INTO juridico.eventos (caso_id, empresa, tipo, descricao, autor) VALUES ($1, 'assessoria', 'anotacao', 'Autor forjado', '102')", [id])), /row-level security/);
  await assert.rejects(transacao(['assessoria'], '101', '', tx => tx.consultar("UPDATE juridico.eventos SET descricao = 'alterado' WHERE caso_id = $1", [id])), /permission denied/);
  // Falha de auditoria reverte a alteração inteira.
  await assert.rejects(transacao(['assessoria'], '101', '', tx => tx.consultar('UPDATE juridico.casos SET versao = versao + 1 WHERE id = $1', [id])), /Motivo/);
  assert.equal((await repo.consultar(['assessoria'], '101', id)).caso.versao, 3);
  await repo.salvar(['assessoria'], '101', 'assessoria', { ...entrada, situacao: 'cancelado', versao: '3', motivo: 'Cancelamento para teste' }, id);
  assert.equal((await repo.consultar(['assessoria'], '101', id)).caso.situacao, 'cancelado');
  await db.exec('SET ROLE erp_app');
  assert.equal((await db.query('SELECT * FROM juridico.casos')).rows.length, 0); // SET LOCAL não vazou.
  await db.exec('RESET ROLE; SET ROLE anon');
  await assert.rejects(db.query('SELECT * FROM juridico.casos'), /permission denied/);
  await db.exec('RESET ROLE; SET ROLE authenticated');
  await assert.rejects(db.query('SELECT * FROM juridico.casos'), /permission denied/);
  await db.exec('RESET ROLE');
});

test('busca literal, filtros e paginação limitam os resultados', async () => {
  for (let i = 0; i < 52; i++) await repo.salvar(['assessoria'], '101', 'assessoria', { ...entrada, cadastro_id: randomUUID(), titulo: i === 0 ? 'Busca % literal' : 'Caso de paginação', cliente_nome: 'Cliente paginação', area: 'Contratos' });
  const filtro = { busca: 'Cliente paginação', area: 'Contratos', situacao: 'ativo', pagina: 1 };
  const a = await repo.listar(['assessoria'], '101', filtro);
  const b = await repo.listar(['assessoria'], '101', { ...filtro, pagina: 2 });
  assert.equal(a.length, 51); assert.equal(b.length, 2);
  assert.equal(new Set([...a.slice(0, 50), ...b].map(c => c.id)).size, 52);
  assert.equal((await repo.listar(['assessoria'], '101', { ...filtro, busca: '%' })).length, 1);
  assert.equal((await repo.listar(['assessoria'], '101', { ...filtro, busca: "' OR true --" })).length, 0);
});

test('pedidos: solicitante vê somente os próprios; resposta e prazo exclusivos do Jurídico',async()=>{
  const id=randomUUID();
  assert.equal(await complementos.criarPedido(['assessoria'],'201','assessoria',{id,area:'Contratos',descricao:'Revisar contrato de teste'}),id);
  assert.equal((await complementos.consultarPedido(['assessoria'],'201',false,id)).situacao,'aberto');
  await assert.rejects(complementos.consultarPedido(['assessoria'],'202',false,id),modelo.CasoNaoEncontrado);
  assert.equal((await complementos.listarPedidos(['assessoria'],'202',false,1)).length,0);
  await transacao(['assessoria'],'201','',async tx=>{
    await tx.consultar("SELECT set_config('juridico.papel','solicitante',true)");
    assert.equal((await tx.consultar("SELECT id FROM juridico.casos")).length,0);
    assert.equal((await tx.consultar("SELECT * FROM juridico.pedidos_auditoria")).length,0);
    assert.equal((await tx.consultar("UPDATE juridico.pedidos SET prazo='2026-12-01',versao=versao+1 WHERE id=$1 RETURNING id",[id])).length,0);
  });
  await complementos.responder(['assessoria'],'101',id,{situacao:'concluido',prazo:'2026-12-10',resposta_final:'Revisão concluída',versao:'1'});
  assert.equal((await complementos.consultarPedido(['assessoria'],'201',false,id)).resposta_final,'Revisão concluída');
  await assert.rejects(complementos.responder(['assessoria'],'101',id,{situacao:'concluido',prazo:'',resposta_final:'Outra resposta',versao:'1'}),modelo.ConflitoJuridico);
});

test('documentos privados validam conteúdo, limites, autoria e acesso; encaminhamento é atômico e idempotente',async()=>{
  const pedidoId=randomUUID(), anexoId=randomUUID(), pdf=Buffer.from('%PDF-1.7\nDocumento QA');
  await complementos.criarPedido(['assessoria'],'201','assessoria',{id:pedidoId,area:'Consultivo',descricao:'Pedido para anexar'});
  await complementos.anexar(['assessoria'],'201',false,'pedido',pedidoId,anexoId,'teste.pdf',pdf);
  await complementos.anexar(['assessoria'],'201',false,'pedido',pedidoId,anexoId,'teste.pdf',pdf);
  assert.equal((await complementos.documentos(['assessoria'],'201',false,'pedido',pedidoId)).length,1);
  assert.deepEqual(Buffer.from((await complementos.baixar(['assessoria'],'201',false,anexoId)).conteudo),pdf);
  await assert.rejects(complementos.baixar(['assessoria'],'202',false,anexoId),modelo.CasoNaoEncontrado);
  await assert.rejects(complementos.baixar(['ether'],'201',false,anexoId),modelo.CasoNaoEncontrado);
  assert.throws(()=>validarDocumento('falso.pdf',Buffer.from('<script>teste</script>')),modelo.ValidacaoJuridica);
  assert.throws(()=>validarDocumento('grande.pdf',new Uint8Array(5242881)),modelo.ValidacaoJuridica);
  const dados={...entrada,cadastro_id:randomUUID(),referencia:'Contrato QA-2026-1',resumo:'Negociação sem acordo',historico:'2026-11-01 — ligação — sem retorno\n2026-11-03 — mensagem — proposta recusada'};
  const casoId=await complementos.encaminhar(['assessoria'],'101','assessoria',dados);
  assert.equal(await complementos.encaminhar(['assessoria'],'101','assessoria',dados),casoId);
  const ficha=await repo.consultar(['assessoria'],'101',casoId);
  assert.equal(ficha.caso.fase,'Triagem');assert.equal(ficha.eventos.length,3);
  assert.ok(ficha.eventos.some(e=>e.descricao.includes('2026-11-01')));
  const docCaso=randomUUID();
  await complementos.anexar(['assessoria'],'101',true,'caso',casoId,docCaso,'evidencia.pdf',pdf);
  await assert.rejects(complementos.baixar(['assessoria'],'201',false,docCaso),modelo.CasoNaoEncontrado);
  assert.equal((await repo.consultar(['assessoria'],'101',casoId)).eventos.length,4);
});

test('fluxo HTTP: formulário → caso → movimentação → edição; CSRF, IDOR e erros seguros', async () => {
  const app = require('../src/erp/core/app.ts');
  app.templateGlobal('ic', () => '');
  const { Sessao } = require('../src/erp/core/sessao.ts');
  app.get('portal_empresa', '/grupo/empresa/<slug>', () => 'fixture');
  app.get('portal_grupo','/grupo',()=> 'fixture');
  const source = readFileSync(new URL('../src/erp/modulos/juridico/index.ts', import.meta.url), 'utf8');
  const compiled = { exports: {} };
  const deps = name => {
    if (name === '../../core/flask') return require('../src/erp/core/flask.ts');
    if (name === './acesso') return require('../src/erp/modulos/juridico/acesso.ts');
    if (name === './modelo') return modelo;
    if (name === './repositorio') return { criarRepositorio: () => repo };
    if (name === './complementos') return require('../src/erp/modulos/juridico/complementos.ts');
    if (name === './complementos-repositorio') return { criarComplementos: () => complementos };
    if (name === '../portal') return { TEMA_GRUPO: tema, pode_ver_modulo:async(u,s,m)=>u.perfil==='admin'&&s==='assessoria'&&m==='financas', empresas_visiveis: async () => [{ slug: 'assessoria', nome: 'Empresa de teste', tema_full: tema }] };
    return require(name);
  };
  new Function('require', 'module', 'exports', ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)(deps, compiled, compiled.exports);
  let falhar = false;
  compiled.exports.registrar({ ...repo, listar: (...args) => { if (falhar) throw Object.assign(new Error('SEGREDO_NAO_LOGAR'), { code: '42P01' }); return repo.listar(...args); } },complementos);
  const user = { id: 101, ativo: 1, perfil: 'juridico' };
  const sessao = new Sessao(); sessao.set('_csrf', 'csrf-fixo-teste');
  const cookie = sessao.cookie().split(';')[0];
  const invoke = (path, body, pessoa = user, comCookie = true) => app.despachar(new Request('http://localhost/erp'+path, {
    method: body ? 'POST' : 'GET', headers: { ...(comCookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
    ...(body ? { body: new URLSearchParams(body) } : {}),
  }), req => { req.g.portal_user = pessoa; });
  assert.equal((await invoke('/juridico/novo')).status, 200);
  assert.equal((await invoke('/juridico/novo', { ...entrada, empresa: 'assessoria' })).status, 400);
  assert.equal((await invoke('/juridico/novo', { ...entrada, empresa: 'assessoria', _csrf: 'csrf-fixo-teste' }, user, false)).status, 400);
  assert.equal((await invoke('/juridico/novo', { ...entrada, empresa: 'ether', _csrf: 'csrf-fixo-teste' })).status, 404);
  const criado = await invoke('/juridico/novo', { ...entrada, cadastro_id: '10643825-e533-41ac-957e-fb2396061012', titulo: '<script>alert(1)</script>', empresa: 'assessoria', _csrf: 'csrf-fixo-teste' });
  assert.equal(criado.status, 303);
  const path = criado.headers.get('location').replace('/erp', '');
  const ficha = await invoke(path); assert.equal(ficha.status, 200);
  const html = await ficha.text(); assert.ok(html.includes('&lt;script&gt;')); assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.equal((await invoke(path+'/editar')).status, 200);
  assert.equal((await invoke(path+'/movimentacao', { _csrf: 'csrf-fixo-teste', tipo: 'contato', descricao: 'Teste de contato HTTP' })).status, 303);
  assert.equal((await invoke(path+'/editar', { ...entrada, versao: '1', motivo: 'Novo prazo pelo formulário', prazo: '2026-12-15', empresa: 'assessoria', _csrf: 'csrf-fixo-teste' })).status, 303);
  assert.equal((await invoke(path+'/editar', { ...entrada, versao: '1', motivo: 'Sessão atrasada', empresa: 'assessoria', _csrf: 'csrf-fixo-teste' })).status, 409);
  assert.equal((await invoke(path, undefined, { id: 102, ativo: 1, perfil: 'usuario' })).status, 403);
  assert.equal((await invoke('/juridico')).status, 200);
  const solicitante={id:301,ativo:1,perfil:'usuario'}, terceiro={id:302,ativo:1,perfil:'usuario'};
  assert.equal((await invoke('/juridico/pedidos',undefined,solicitante)).status,200);
  const pedidoId=randomUUID();
  assert.equal((await invoke('/juridico/pedidos',{_csrf:'csrf-fixo-teste',id:pedidoId,empresa:'assessoria',area:'Consultivo',descricao:'Pedido via HTTP'},solicitante)).status,303);
  assert.equal((await invoke('/juridico/pedidos/'+pedidoId,undefined,terceiro)).status,404);
  assert.equal((await invoke('/juridico/pedidos/'+pedidoId+'/resposta',{_csrf:'csrf-fixo-teste',versao:'1',situacao:'concluido',prazo:'',resposta_final:'Tentativa'},solicitante)).status,403);
  assert.equal((await invoke('/juridico/pedidos/'+pedidoId+'/resposta',{_csrf:'csrf-fixo-teste',versao:'1',situacao:'concluido',prazo:'',resposta_final:'Resposta aprovada'})).status,303);
  const pedidoHtml=await (await invoke('/juridico/pedidos/'+pedidoId,undefined,solicitante)).text();
  assert.ok(pedidoHtml.includes('Resposta aprovada'));assert.ok(!pedidoHtml.includes('Atender pedido'));
  assert.equal((await invoke(path+'/documentos')).status,200);
  assert.equal((await invoke('/juridico/encaminhar')).status,403);
  const financeiro={id:101,perfil:'admin',admin:true,ativo:1};
  assert.equal((await invoke('/juridico/encaminhar',undefined,financeiro)).status,200);
  assert.equal((await invoke('/juridico/encaminhar',{...entrada,cadastro_id:randomUUID(),_csrf:'csrf-fixo-teste',empresa:'assessoria',referencia:'HTTP-001',resumo:'Negociação encerrada sem acordo',historico:'2026-11-01 — ligação sem retorno',confirmado:'1'},financeiro)).status,200);
  falhar = true;
  const original = console.error, logs = [];
  console.error = (...args) => logs.push(args);
  let indisponivel;
  try { indisponivel = await invoke('/juridico'); } finally { console.error = original; }
  assert.equal(indisponivel.status, 503);
  assert.ok(!JSON.stringify(logs).includes('SEGREDO_NAO_LOGAR'));
  assert.match(await indisponivel.text(), /ainda não foi aplicada/);
  if (process.env.JURIDICO_BROWSER === '1') {
    falhar = false;
    const { validarNavegador } = await import('./helpers/juridico-browser.mjs');
    await validarNavegador(app, { ...user, nome: 'Jurídico QA', email: 'qa@example.invalid', admin: false, crm: false });
  }
  await db.close();
});
