import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
// Local test compilation only; no server, credentials or production auth changes.
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(readFileSync(file, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText, file);
const { diagnosticoAssessoria, erroSeguro } = require('../src/erp/core/diagnostico-assessoria.ts');
const db = require('../src/erp/core/db.ts');

test('marcadores de processamento permanecem isolados por requisição e não expõem contexto', async () => {
  const app = require('../src/erp/core/app.ts');
  const before = process.env.ERP_ASSESSORIA_DIAGNOSTICO;
  const original = console.info;
  const logs = [];
  try {
    process.env.ERP_ASSESSORIA_DIAGNOSTICO = '1';
    console.info = (...args) => logs.push(JSON.parse(args[1]));
    app.get('diagnostic-stage-fixture', '/inicio', async () => {
      app.marcarEtapaDiagnostico('painel.leituras.fim');
      await new Promise(resolve => setTimeout(resolve, 2));
      app.marcarEtapaDiagnostico('painel.calculos.fim');
      return 'PRIVATE-context';
    });
    const responses = await Promise.all([1, 2].map(() => app.despachar(new Request('http://localhost/erp/inicio'))));
    const ids = responses.map(response => response.headers.get('x-erp-diagnostic-id'));
    assert.notEqual(ids[0], ids[1]);
    for (const id of ids) assert.deepEqual(logs.filter(log => log.id === id).map(log => log.fase),
      ['handler.inicio', 'painel.leituras.fim', 'painel.calculos.fim', 'resposta']);
    assert.doesNotMatch(JSON.stringify(logs), /PRIVATE/);
    logs.length = 0;
    delete process.env.ERP_ASSESSORIA_DIAGNOSTICO;
    assert.equal((await app.despachar(new Request('http://localhost/erp/inicio'))).status, 200);
    assert.equal(logs.length, 0);
  } finally {
    console.info = original;
    if (before === undefined) delete process.env.ERP_ASSESSORIA_DIAGNOSTICO;
    else process.env.ERP_ASSESSORIA_DIAGNOSTICO = before;
  }
});

function proxyFixture(getClaims) {
  const source = readFileSync(new URL('../src/lib/supabase/proxy.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
  } }).outputText;
  const compiledModule = { exports: {} };
  let cookies;
  const dependencies = name => {
    if (name === '@supabase/ssr') return { createServerClient: (_url, _key, options) => {
      cookies = options.cookies;
      return { auth: { getClaims: () => getClaims(cookies) } };
    } };
    if (name === '@/lib/supabase/config') return { supabaseConfig: { url: 'https://fixture.example.invalid', publishableKey: 'fixture-only' } };
    if (name === '@/erp/core/diagnostico-assessoria') return require('../src/erp/core/diagnostico-assessoria.ts');
    return require(name);
  };
  new Function('require', 'module', 'exports', js)(dependencies, compiledModule, compiledModule.exports);
  return compiledModule.exports;
}

test('proxy registra início antes de aguardar Auth e preserva cookies SSR, sem conteúdo sensível nos logs', async () => {
  const before = process.env.ERP_ASSESSORIA_DIAGNOSTICO;
  const original = console.info;
  const logs = [];
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const { NextRequest } = require('next/server');
  try {
    process.env.ERP_ASSESSORIA_DIAGNOSTICO = '1';
    console.info = (...args) => logs.push(args);
    const { updateSession } = proxyFixture(async cookies => {
      await pending;
      cookies.setAll([{ name: 'fixture-session', value: 'PRIVATE-cookie', options: { httpOnly: true, path: '/' } }], { 'Cache-Control': 'private, no-store' });
      return { data: { claims: { sub: 'fixture-user' } }, error: null };
    });
    const request = new NextRequest('http://localhost/erp/inicio');
    const responsePromise = updateSession(request);
    assert.deepEqual(logs.map(entry => JSON.parse(entry[1]).fase), ['proxy.inicio', 'proxy.auth.inicio']);
    release();
    const response = await responsePromise;
    assert.equal(response.status, 200);
    assert.equal(request.cookies.get('fixture-session').value, 'PRIVATE-cookie');
    assert.match(response.headers.get('set-cookie'), /fixture-session=PRIVATE-cookie/);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(logs.map(entry => JSON.parse(entry[1]).fase), ['proxy.inicio', 'proxy.auth.inicio', 'proxy.auth.fim', 'proxy.fim']);
    assert.doesNotMatch(JSON.stringify(logs), /PRIVATE|fixture-user|fixture-session/);
  } finally {
    release();
    console.info = original;
    if (before === undefined) delete process.env.ERP_ASSESSORIA_DIAGNOSTICO;
    else process.env.ERP_ASSESSORIA_DIAGNOSTICO = before;
  }
});

test('instrumentação não libera Início sem sessão nem engole rejeição da validação Auth', async () => {
  const { NextRequest } = require('next/server');
  const unauthorized = proxyFixture(async () => ({ data: { claims: null }, error: null }));
  const response = await unauthorized.updateSession(new NextRequest('http://localhost/erp/inicio'));
  assert.equal(response.status, 307);
  assert.equal(new URL(response.headers.get('location')).pathname, '/login');
  const failure = new Error('private network detail');
  const networkFailure = proxyFixture(async () => { throw failure; });
  await assert.rejects(networkFailure.updateSession(new NextRequest('http://localhost/erp/financas/assessoria')), error => error === failure);
});

test('diagnóstico desligado por padrão e restrito às duas rotas com falha reportada', () => {
  const before = process.env.ERP_ASSESSORIA_DIAGNOSTICO;
  try {
    delete process.env.ERP_ASSESSORIA_DIAGNOSTICO;
    assert.equal(diagnosticoAssessoria('/financas/assessoria'), null);
    process.env.ERP_ASSESSORIA_DIAGNOSTICO = '1';
    for (const path of ['/inicio/agenda', '/financas/assessoria/receber', '/financas/cred/', '/financas/assessoria-extra']) {
      assert.equal(diagnosticoAssessoria(path), null);
    }
    assert.ok(diagnosticoAssessoria('/financas/assessoria/'));
    assert.ok(diagnosticoAssessoria('/inicio'));
  } finally {
    if (before === undefined) delete process.env.ERP_ASSESSORIA_DIAGNOSTICO;
    else process.env.ERP_ASSESSORIA_DIAGNOSTICO = before;
  }
});

test('erros não expõem mensagem, parâmetros, valores, SQL ou credenciais', () => {
  const error = { name: 'PostgresError', code: '42501', message: 'private-message', query: 'private-query', parameters: ['private-value'], detail: 'private-detail' };
  assert.deepEqual(erroSeguro(error), { tipo: 'Error', codigo: '42501' });
  assert.deepEqual(erroSeguro({ name: 'private-name', code: 'private-code' }), { tipo: 'Error', codigo: 'UNKNOWN' });
});

test('consultas bem-sucedidas e falhas são medidas sem mudar o resultado ou engolir erros', async () => {
  const previous = globalThis.__erpSql;
  const original = Object.assign(new Error('PRIVATE financial detail'), { code: '57014' });
  globalThis.__erpSql = { unsafe: async (_query, params) => {
    if (params[0] === 'FAIL') throw original;
    return [{ result: params[0] }];
  } };
  const measurements = [];
  try {
    await db.comCacheDeLeitura(async () => {
      assert.deepEqual(await db.q('SELECT ? AS result', ['PRIVATE']), [{ result: 'PRIVATE' }]);
      await assert.rejects(db.q('SELECT ? AS result', ['FAIL']), error => error === original);
      assert.equal(db.medidasBanco().n, 2);
    }, measurement => measurements.push(measurement));
    assert.equal(measurements.length, 2);
    assert.equal(measurements[0].consulta, measurements[1].consulta);
    assert.match(measurements[0].consulta, /^[0-9a-f]{12}$/);
    assert.equal(measurements[1].sucesso, false);
    assert.equal(measurements[1].codigo, '57014');
    assert.doesNotMatch(JSON.stringify(measurements), /PRIVATE|FAIL|SELECT|financial/);
  } finally { globalThis.__erpSql = previous; }
});

test('cache e isolamento de medições entre requisições são preservados', async () => {
  const previous = globalThis.__erpSql;
  let calls = 0;
  globalThis.__erpSql = { unsafe: async () => { calls++; await new Promise(resolve => setTimeout(resolve, 2)); return [{ value: 1 }]; } };
  const a = [], b = [];
  try {
    await Promise.all([a, b].map(measurements => db.comCacheDeLeitura(async () => {
      await db.q('SELECT 1');
      await db.q('SELECT 1');
      assert.equal(db.medidasBanco().n, 1);
    }, measurement => measurements.push(measurement))));
    assert.equal(calls, 2);
    assert.equal(a.length, 1);
    assert.equal(b.length, 1);
  } finally { globalThis.__erpSql = previous; }
});

test('logs de consulta e resposta contêm apenas identificação e medidas', () => {
  const before = process.env.ERP_ASSESSORIA_DIAGNOSTICO;
  const original = console.info;
  const logs = [];
  try {
    process.env.ERP_ASSESSORIA_DIAGNOSTICO = '1';
    console.info = (...args) => logs.push(args);
    const diagnostic = diagnosticoAssessoria('/financas/assessoria');
    diagnostic.consulta({ consulta: 'abcdef123456', ms: 3, sucesso: true, codigo: null });
    diagnostic.finalizar(200, 5, { n: 1, ms: 3 });
    assert.equal(logs.length, 2);
    const query = JSON.parse(logs[0][1]);
    assert.deepEqual(Object.keys(query).sort(), ['id', 'pagina', 'fase', 'consulta', 'ms', 'sucesso', 'codigo'].sort());
    assert.equal(JSON.parse(logs[1][1]).id, query.id);
  } finally {
    console.info = original;
    if (before === undefined) delete process.env.ERP_ASSESSORIA_DIAGNOSTICO;
    else process.env.ERP_ASSESSORIA_DIAGNOSTICO = before;
  }
});

test('falha crítica preserva HTTP 500 e não publica detalhes financeiros na resposta ou no log', async () => {
  const app = require('../src/erp/core/app.ts');
  const original = console.error;
  const logs = [];
  try {
    console.error = (...args) => logs.push(args);
    app.get('diagnostic-critical-fixture', '/financas/assessoria/', () => {
      throw Object.assign(new Error('PRIVATE financial and connection details'), { code: '42501' });
    });
    const response = await app.despachar(new Request('http://localhost/erp/financas/assessoria'));
    assert.equal(response.status, 500);
    assert.doesNotMatch(await response.text(), /PRIVATE|financial|connection/);
    assert.match(JSON.stringify(logs), /42501/);
    assert.doesNotMatch(JSON.stringify(logs), /PRIVATE|financial|connection/);
  } finally { console.error = original; }
});

test('painel vazio renderiza e falha de produtos é explícita, sem indicadores inventados', () => {
  const { criarAmbiente } = require('../src/erp/core/jinja.ts');
  const { FONTES } = require('../src/erp/templates.gen.ts');
  const env = criarAmbiente(FONTES);
  const zero = { valor: 0, n: 0 };
  const context = {
    empresa: { slug: 'assessoria', nome: 'Assessoria' }, t: {}, portal_user: null,
    request: { args: {}, endpoint: 'financas.painel' }, menu: [], modulos: [],
    url_for: () => '/test-only', get_flashed_messages: () => [], csrf_token: () => '',
    fic: () => '', ic: () => '', moeda: value => String(value ?? ''), data_br: value => value || '',
    hoje_iso: '2026-10-30', contas: [], cards: {}, mes: { entradas: 0, saidas: 0 }, saldo_atual: 0,
    proj: Array.from({ length: 31 }, () => ({ dia: '2026-10-30', saldo: 0 })), proximos: [],
    ind: { receber: zero, pagar: zero, receber_venc: zero, pagar_venc: zero, receber_30: zero, pagar_30: zero,
      atraso: 0, inadimplencia: 0, cobertura: null, liquido_30: 0 },
    maior: 1, produtos: null, sem_contas: true, sem_lanc: true,
  };
  const empty = env.render('financas/painel.html', context);
  assert.match(empty, /Nenhuma conta cadastrada/);
  assert.doesNotMatch(empty, /Dados indisponíveis/);
  const failed = env.render('financas/painel.html', { ...context, produtos_indisponiveis: true });
  assert.match(failed, /role="alert"/);
  assert.match(failed, /Dados indisponíveis/);
  assert.doesNotMatch(failed, /Patrimônio ativo|Carteira a receber/);
});
