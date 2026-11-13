import assert from 'node:assert/strict';
import { test } from 'node:test';
import { financeAreas, getFinanceArea } from '../../src/lib/finance/navigation.ts';

test('finance release exposes the agreed condominium navigation', () => {
  assert.deepEqual(financeAreas.map((area) => area.slug), [
    'clientes', 'cotas', 'apuracoes', 'vencimentos',
    'renovacoes-retiradas', 'historico', 'relatorios',
    'validacao-projecao', 'titulos-privados',
  ]);
});

test('existing Supabase projections are reused without inventing financial writes', () => {
  assert.deepEqual(getFinanceArea('clientes')?.sources, ['clientes']);
  assert.deepEqual(getFinanceArea('cotas')?.sources, ['cotas']);
  assert.deepEqual(getFinanceArea('apuracoes')?.sources, ['apuracoes']);
  assert.deepEqual(getFinanceArea('historico')?.sources, ['apuracoes']);
  assert.deepEqual(getFinanceArea('titulos-privados')?.sources, ['titulos', 'parcelas']);
  for (const slug of ['vencimentos', 'renovacoes-retiradas', 'relatorios', 'validacao-projecao']) {
    const area = getFinanceArea(slug);
    assert.equal(area?.operations, 'planned');
    assert.deepEqual(area?.sources, []);
  }
});

test('unknown paths are not silently assigned to a financial query', () => {
  assert.equal(getFinanceArea('remessas'), undefined);
});
