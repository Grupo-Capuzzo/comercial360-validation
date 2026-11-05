# Jurídico V1 — histórico do primeiro fluxo local

> Este documento descreve o estado anterior à ativação. A situação atual, migrations aplicadas, testes e instruções de homologação estão em [JURIDICO_ENTREGA_20261105.md](JURIDICO_ENTREGA_20261105.md).

Branch: `codex/juridico-v1-inicial`. Base: `main`, `b08639f8`.

Esta entrega evolui a navegação inicial para cadastro e consulta de casos por empresa, ficha do cliente dentro do caso, movimentações, edição, substituição/conclusão do próximo prazo, encerramento e cancelamento. Usa os templates, temas e classes existentes do Fernando, sem alterar folhas de estilo. Não apresenta números fictícios nem trata falha de consulta como tabela vazia.

Rotas: `/erp/juridico`, `/erp/juridico/empresa/<slug>`, `/erp/juridico/novo`, `/erp/juridico/caso/<id>`, edição em `/editar` e POST de movimentação em `/movimentacao`. O acesso exige usuário ativo com sessão em modo Administrador ou perfil interno `juridico`. O filtro padrão de módulos liberados não concede acesso jurídico a usuários comuns. A rota da empresa e as operações sobre casos conferem a lista de empresas visíveis ao usuário. Os controles são no servidor; esconder botões não é a proteção.

Nenhum usuário/perfil foi atribuído ou alterado. O perfil Jurídico ainda precisa de fluxo administrativo e validação do modelo de permissões antes de liberar o setor para a advogada. A navegação inicial pode ser revista pelo administrador atual. Permissões de CRM e Financeiro permanecem intactas.

## Regras implementadas

- Dados do cliente são uma ficha vinculada ao caso nesta etapa, não um cadastro global compartilhado entre empresas.
- Área, fase, instância e situação são campos separados. As opções iniciais ficam em `modelo.ts` e nos CHECKs da migration, para revisão de negócio antes da ativação.
- Um próximo prazo por caso; mudar ou limpar o prazo preserva o anterior no histórico e exige motivo.
- Régua visual em 30/15/7 dias e vencidos. São dias civis de São Paulo; não há cálculo de prazo processual, dias úteis ou envio automático de avisos.
- Toda criação/edição gera evento pelo trigger na mesma transação. O histórico inclui estado anterior/novo e ID do autor no Portal.
- Encerrar/cancelar exige motivo; não existe exclusão de casos ou edição/exclusão de eventos no backend.
- Versão otimista impede sobrescrever outra edição. Reenvio do mesmo formulário de cadastro usa o mesmo UUID e não duplica o caso.
- Busca por cliente/título, filtros por área/situação e páginas de 50 casos; histórico também paginado.
- CSRF obrigatório nos POSTs, HTML escapado, respostas privadas sem cache, erros de banco sem dados sensíveis nos logs.

## Migration preparada, NÃO aplicada ao Supabase

Arquivo: `supabase/migrations/20261105162110_juridico_casos_historico.sql`, gerado pelo Supabase CLI.

SHA-256: `625b3669589b3e87ccb455f56f491a44ad646ac642d11f39764faa65c7ab0c5e`.

Cria apenas o schema privado `juridico`, tabelas `casos` e `eventos`, índices, funções e triggers de auditoria. Não altera tabelas financeiras, CRM ou Auth. A role `erp_app` deve existir. Não cria roles remotas.

RLS habilitada e forçada. Grants somente ao backend `erp_app` (casos: SELECT/INSERT/UPDATE; eventos: SELECT/INSERT). Sem grants a `anon` ou `authenticated` e sem exposição na Data API. Policies dependem do contexto de empresas/autoria validado pelo servidor e definido com SET LOCAL dentro da transação; não usam metadados editáveis do usuário. Esse desenho confia no servidor ERP e na credencial privada `erp_app`, não é uma API SQL direta para o navegador.

## Checklist de ativação (requer autorização; não executado)

1. Revisar opções de fase/instância, campos obrigatórios e SQL com a responsável jurídica.
2. Confirmar projeto `umvldqzzliqmgkvoedyd`, backup, role `erp_app` sem superuser/bypassrls e histórico das migrations oficiais já aplicadas. Este checkout de main não contém o histórico completo das seis migrations da release anterior: reconciliar com os arquivos oficiais antes de qualquer db push; não usar repair/include-all automaticamente.
3. Conferir ausência de schema `juridico` preexistente e revisar dependências/privilégios. O SQL não usa IF NOT EXISTS para esconder colisões.
4. Aplicar somente a nova migration revisada via Supabase CLI, após autorização. Conferir tabelas, RLS, policies, triggers e grants no projeto alvo.
5. Validar em homologação usando uma conta já existente autorizada, incluindo negação para outra empresa e usuário comum. Nenhuma senha/usuário precisa ser criado para aplicar o schema.
6. Revisar e publicar o código só depois dessas validações; testar cadastro → movimentação → prazo → encerramento no site.
7. Antes de liberar a advogada, concluir a administração do perfil Jurídico e sua restrição de navegação para Jurídico/Empresas/Treinamentos. Esta entrega NÃO habilita um perfil em produção nem modifica permissões existentes de CRM.

Rollback preferencial: retornar ao código anterior e desabilitar a entrada do módulo, preservando as tabelas e o histórico. Não remover schema/tabelas com registros. Remoção estrutural só por nova autorização, após backup e verificação de dependências; nenhum rollback destrutivo automático.

Não há execução de migrations no startup, no build, no cadastro ou no CI desta entrega. A aplicação sem schema responde 503 com aviso explícito de ativação pendente.

## Validação local

Testes de schema, RLS e operações executados em PostgreSQL WebAssembly (PGlite 0.3.14), em memória, com dados sintéticos e sem conexão ao Supabase. Isso não substitui homologação no projeto integrado.

Instalar o runtime de teste fora do checkout, sem modificar package.json/lockfile:

```powershell
npm install --prefix ../juridico-test-runtime --no-audit --no-fund --ignore-scripts @electric-sql/pglite@0.3.14
$env:JURIDICO_TEST_RUNTIME = (Resolve-Path ../juridico-test-runtime/node_modules/@electric-sql/pglite/dist/index.js).Path
$env:JURIDICO_BROWSER = '1' # Chrome instalado, teste de interface opcional
node --test tests/juridico-inicial.test.mjs tests/juridico-funcional.test.mjs
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js src/erp/modulos/juridico src/erp/modulos/portal.ts src/erp/registro.ts tests/juridico*.mjs tests/helpers/juridico-browser.mjs
$env:ERP_SEM_AGENDADOR = '1'
npm run build
```

O teste de navegador usa servidor efêmero em 127.0.0.1, com usuário sintético definido somente no harness de testes. Não há bypass de Auth no código do Portal. Capturas desktop/mobile ficam em `tests/isolated/juridico-qa/` (ignoradas pelo Git). O login real do Supabase e o backend publicado não foram testados nesta etapa.

Resultado: 7 testes aprovados, incluindo execução do fluxo no Chrome desktop/mobile; typecheck, lint dos arquivos do Jurídico e build de produção aprovados. O lint global ainda acusa 5 erros preexistentes: `base/dec.ts:61`, `base/pyextra.ts:238`, `core/jinja.ts:349`, `core/py.ts:282` e a diretiva `@ts-nocheck` já existente no gerador `templates.gen.ts:1`. Não foram corrigidos arquivos financeiros/core fora do escopo. `next-env.d.ts` foi atualizado automaticamente pelo build para os tipos de produção do Next.js.

## Próximas entregas

Administração do perfil Jurídico e restrições de navegação; pedidos internos e suas permissões de solicitante; anexos privados; avisos por e-mail pela integração Gmail existente; recebimento do histórico de cobrança; WhatsApp via n8n por último. Os indicadores do Início e notificações automáticas ainda não fazem parte deste fluxo.

Uma migration foi criada e aplicada SOMENTE ao banco em memória dos testes, nunca ao Supabase. Nenhuma escrita remota, importação, envio de e-mail ou chamada ao n8n. Sem commit, push, merge ou publicação nesta entrega. Alterações locais anteriores preservadas.
