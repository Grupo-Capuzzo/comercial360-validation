import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import ts from 'typescript';
const require = createRequire(import.meta.url);
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(readFileSync(file, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText, file);
const { temAcessoJuridico } = require('../src/erp/modulos/juridico/acesso.ts');
const { emVisaoJuridica, rotaDaVisaoJuridica } = require('../src/erp/modulos/juridico/acesso.ts');

test('Jurídico exige registro ativo e perfil autorizado; concessão genérica de módulos não basta', () => {
  assert.equal(temAcessoJuridico(null), false);
  assert.equal(temAcessoJuridico({ ativo: 1, perfil: 'usuario' }), false);
  assert.equal(temAcessoJuridico({ ativo: 0, admin: true }), false);
  assert.equal(temAcessoJuridico({ ativo: 1, perfil: 'admin', admin: false }), false);
  assert.equal(temAcessoJuridico({ ativo: 1, admin: true }), true);
  assert.equal(temAcessoJuridico({ ativo: 1, perfil: 'juridico' }), true);
  assert.equal(temAcessoJuridico({ ativo: 1, perfil: 'admin',admin:false,modo_juridico:true }),true);
  assert.equal(emVisaoJuridica({perfil:'usuario',modo_juridico:true}),false);
  for(const rota of ['/crm-geral','/central/plano','/financas/assessoria','/grupo/admin','/grupo/empresa/assessoria/modulo/financas']) assert.equal(rotaDaVisaoJuridica(rota),false);
  for(const rota of ['/juridico','/grupo','/treinamentos','/grupo/visao-juridico','/grupo/empresa/assessoria/modulo/juridico']) assert.equal(rotaDaVisaoJuridica(rota),true);
});

test('painel inicial usa os templates existentes sem fingir indicadores ou cadastro de casos', () => {
  const { criarAmbiente } = require('../src/erp/core/jinja.ts');
  const { FONTES } = require('../src/erp/templates.gen.ts');
  const env = criarAmbiente(FONTES);
  const base = { t: {}, portal_user: null, url_for: () => '/fixture', ic: () => '', get_flashed_messages: () => [],
    empresa: null, empresas: [{ slug: 'assessoria', nome: 'Empresa teste' }], areas: ['Cível', 'Contratos'], casos: [], filtros: { busca: '', pagina: 1 }, situacoes: ['ativo'] };
  const geral = env.render('juridico/painel.html', base);
  assert.match(geral, /Jurídico Geral/);
  assert.match(geral, /Empresa teste/);
  assert.match(geral, /Nenhum caso encontrado para estes filtros/);
  assert.doesNotMatch(geral, /\b0 casos|Nenhum caso cadastrado/);
  const empresa = env.render('juridico/painel.html', { ...base, empresa: base.empresas[0] });
  assert.match(empresa, /Voltar aos módulos da empresa/);
});

test('rotas diretas negam usuários comuns e não revelam empresa fora do escopo', async () => {
  const app = require('../src/erp/core/app.ts');
  app.get('portal_empresa', '/grupo/empresa/<slug>', () => 'fixture');
  const source = readFileSync(new URL('../src/erp/modulos/juridico/index.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const compiled = { exports: {} };
  let reads = 0;
  const dependencies = name => {
    if (name === '../../core/flask') return require('../src/erp/core/flask.ts');
    if (name === './acesso') return { temAcessoJuridico };
    if (name === './modelo') return require('../src/erp/modulos/juridico/modelo.ts');
    if (name === './repositorio') return require('../src/erp/modulos/juridico/repositorio.ts');
    if (name === './complementos') return require('../src/erp/modulos/juridico/complementos.ts');
    if (name === './complementos-repositorio') return require('../src/erp/modulos/juridico/complementos-repositorio.ts');
    if (name === '../portal') return { TEMA_GRUPO: {}, empresas_visiveis: async () => { reads++; return [{ slug: 'assessoria', nome: 'Empresa permitida', tema_full: {} }]; } };
    return require(name);
  };
  new Function('require', 'module', 'exports', js)(dependencies, compiled, compiled.exports);
  compiled.exports.registrar({ listar: async () => [] });
  const invoke = (path, user) => app.despachar(new Request('http://localhost/erp'+path), req => { req.g.portal_user = user; });
  assert.equal((await invoke('/juridico', { ativo: 1, perfil: 'usuario' })).status, 403);
  assert.equal((await invoke('/juridico', null)).status, 403);
  assert.equal(reads, 0);
  const user = { id: 1, ativo: 1, perfil: 'juridico' };
  assert.equal((await invoke('/juridico/empresa/nao-permitida', user)).status, 404);
  assert.equal((await invoke('/juridico/empresa/assessoria', user)).status, 200);
});
