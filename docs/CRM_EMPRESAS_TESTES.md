# Validação — CRM por empresa
Data: 18/11/2026. Base main 018403f. Somente ambiente local descartável.

| Verificação | Resultado |
| --- | --- |
| Typecheck tsc --noEmit | Aprovado |
| Build next build --webpack / Next 16.3.8 | Aprovado |
| ESLint de todos os arquivos alterados nesta entrega | Aprovado |
| Suíte ampliada Node (CRM, Comercial, Financeiro, Jurídico, recuperação e diagnóstico) | 140 testes aprovados, 0 falhas |
| Reexecução final dos testes CRM após endurecimento | 31 testes aprovados, 0 falhas |
| Migration e rollback | Executados somente em PostgreSQL PGlite em memória |
| git diff --check | Aprovado |
| ESLint completo | Seis erros preexistentes e 21 avisos; ver abaixo |
| Navegador com Auth local real / validação visual | Pendente; não executado nesta entrega |
| Homologação com definições completas do banco real | Pendente |
| Carga representativa / EXPLAIN e advisors | Pendente |

O ensaio CRM cobre mapeamento pendente, autorização ERP/Portal/CRM, consolidação restrita, cliente compartilhado sem duplicação, oportunidades/tarefas/leads/produtos, IDs forjados, múltiplos IDs no mesmo payload, views/RPCs antigas, RLS em tabelas REST, mascaramento de valores, auditoria original representativa, escrita revogada, sessão revogada, empresa inativa, revogação de módulo/empresa, paginação e preservação de registros no rollback. Os testes HTTP verificam os handlers/proxy reais com serviços simulados, incluindo status 403, no-store, negação de origem externa e preservação de recuperação de senha.

O fixture SQL usa assinaturas e funções legadas representativas. Não é uma reprodução integral do schema de produção. Nenhum teste conectou ao banco real, criou usuários reais, enviou mensagens ou alterou operações financeiras/jurídicas.

O lint completo continua falhando em arquivos idênticos à main, conferidos por git diff --exit-code:
- src/erp/base/dec.ts: prefer-const.
- src/erp/base/pyextra.ts: no-this-alias.
- src/erp/core/jinja.ts: prefer-rest-params.
- src/erp/core/py.ts: prefer-const.
- src/erp/modulos/titulos/index.ts: prefer-const.
- src/erp/templates.gen.ts: ban-ts-comment.

As verificações e pendências de publicação estão detalhadas em CRM_EMPRESAS_DIAGNOSTICO.md. A entrega permanece Draft e não deve ser publicada antes da homologação.
