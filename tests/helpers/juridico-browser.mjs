import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

/** Servidor efêmero e exclusivamente local com usuário sintético. Nunca entra no build. */
export async function validarNavegador(app, user) {
  for (const [nome, rota] of Object.entries({ portal_inicio: '/inicio', portal_grupo: '/grupo', portal_treinamentos: '/treinamentos', portal_minha_senha: '/grupo/senha', portal_logout: '/logout' })) app.get(nome, rota, () => 'fixture');
  app.contextProcessor(() => ({ portal_user: user, acesso_juridico: true, visao_juridica: user.perfil==='juridico'||user.modo_juridico===true }));
  const raiz = path.resolve('public/login-grupo/static');
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname.startsWith('/login-grupo/static/')) {
        const arquivo = path.resolve(raiz, '.' + url.pathname.slice('/login-grupo/static'.length));
        if (!arquivo.startsWith(raiz + path.sep)) { res.writeHead(404).end(); return; }
        res.setHeader('content-type', arquivo.endsWith('.css') ? 'text/css' : arquivo.endsWith('.png') ? 'image/png' : 'application/octet-stream');
        res.end(await readFile(arquivo)); return;
      }
      const partes = []; for await (const p of req) partes.push(p);
      const resposta = await app.despachar(new Request('http://127.0.0.1'+req.url, { method: req.method, headers: req.headers,
        ...(req.method === 'POST' ? { body: Buffer.concat(partes) } : {}) }), r => { r.g.portal_user = user; });
      res.writeHead(resposta.status, Object.fromEntries(resposta.headers)); res.end(Buffer.from(await resposta.arrayBuffer()));
    } catch { res.writeHead(500).end('Erro no servidor isolado de QA'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const erros = []; page.on('pageerror', e => erros.push(e.message));
    await page.route('https://fonts.googleapis.com/**', route => route.abort());
    await page.goto('http://127.0.0.1:'+server.address().port+'/erp/juridico');
    assert.equal(await page.getByRole('link',{name:'Início',exact:true}).count(),0);
    assert.equal(await page.getByRole('link',{name:'CRM Geral',exact:true}).count(),0);
    await page.getByRole('link', { name: 'Novo caso', exact: true }).click();
    await page.locator('[name=empresa]').selectOption('assessoria');
    for (const [nome, valor] of Object.entries({ titulo: 'Caso QA pelo navegador', cliente_nome: 'Cliente Browser QA', cliente_documento: '52998224725',
      cliente_telefone: '11999999999', responsavel: 'Responsável QA', descricao: 'Caso sintético para teste de interface', prazo: '2026-12-15', prazo_descricao: 'Revisão QA' })) await page.locator('[name='+nome+']').fill(valor);
    await page.locator('[name=area]').selectOption('Consultivo');
    await Promise.all([page.waitForURL(/\/caso\/[a-f0-9-]+$/), page.getByRole('button', { name: 'Salvar caso', exact: true }).click()]);
    assert.ok(await page.getByRole('heading', { name: 'Caso QA pelo navegador' }).isVisible());
    await page.locator('textarea[name=descricao]').fill('Movimentação registrada no navegador');
    await page.getByRole('button', { name: 'Registrar movimentação', exact: true }).click();
    await page.getByText('Movimentação registrada no navegador', { exact: true }).waitFor();
    await page.getByRole('link', { name: 'Editar caso e prazo' }).click();
    await page.locator('[name=fase]').selectOption('Análise');
    await page.locator('[name=prazo]').fill('2026-12-20');
    await page.locator('[name=motivo]').fill('Prazo anterior cumprido, nova revisão definida');
    await page.getByRole('button', { name: 'Salvar caso', exact: true }).click();
    await page.getByRole('heading', { name: 'Caso QA pelo navegador' }).waitFor();
    const saida = 'tests/isolated/juridico-qa'; await mkdir(saida, { recursive: true });
    await page.screenshot({ path: saida+'/ficha-desktop.png', fullPage: true });
    await page.getByRole('link', { name: 'Editar caso e prazo' }).click();
    await page.locator('[name=situacao]').selectOption('encerrado');
    await page.locator('[name=motivo]').fill('Conclusão do teste funcional pelo navegador');
    await page.getByRole('button', { name: 'Salvar caso', exact: true }).click();
    await page.getByText(/Caso encerrado —/).waitFor();
    await page.getByRole('link', { name: 'Voltar ao Jurídico da empresa' }).click();
    await page.locator('[name=busca]').fill('Cliente Browser QA');
    await page.locator('[name=situacao]').selectOption('encerrado');
    await page.getByRole('button', { name: 'Filtrar casos' }).click();
    await page.getByRole('link', { name: 'Caso QA pelo navegador', exact: true }).waitFor();
    await page.screenshot({ path: saida+'/painel-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: saida+'/painel-mobile.png', fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    assert.deepEqual(erros, []);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
