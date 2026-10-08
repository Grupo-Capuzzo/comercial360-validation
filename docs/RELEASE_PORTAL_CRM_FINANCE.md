# Publicação conjunta: Portal, Comercial e Condomínios

Diagnóstico de 05/10/2026. Documento técnico, sem dados reais. Não constitui autorização de banco, importação ou deploy.

## Atualização: interface Next.js de Condomínios

O pacote Flask é a referência visual e funcional do Financeiro de Condomínios. Não será publicado como aplicação Python, executado, copiado para `src/app` nem usado com SQLite operacional. A primeira release adapta sua navegação ao Portal Next.js e preserva as regras de negócio como referência do responsável financeiro.

Telas adicionadas/adaptadas nesta release:

| Tela Flask de referência | Rota Next.js | Estado na release |
| --- | --- | --- |
| `dashboard.html`, `condominio.html` | `/financeiro/[empresa]` | Dashboard de Condomínios, com resumo de consultas e navegação. |
| `clientes_lista.html`, `clientes_detalhe.html` | `/financeiro/[empresa]/clientes` | Leitura Supabase existente. |
| `cotas_lista.html`, `cotas_form.html`, `cotas_editar_lote.html` | `/financeiro/[empresa]/cotas` | Leitura Supabase existente; inclusão, edição e lote bloqueados. |
| `apuracao.html` | `/financeiro/[empresa]/apuracoes` | Leitura Supabase existente; cálculo e gravação bloqueados. |
| `condominios_vencimentos.html` | `/financeiro/[empresa]/vencimentos` | Estrutura visual; sem consulta ou ação operacional ainda. |
| telas de renovação/retirada de cotas | `/financeiro/[empresa]/renovacoes-retiradas` | Estrutura visual; sem renovação, retirada ou confirmação. |
| `historico.html`, `historico_detalhe.html` | `/financeiro/[empresa]/historico` | Leitura da projeção de apurações disponível; edição e exportação bloqueadas. |
| `relatorios.html` | `/financeiro/[empresa]/relatorios` | Estrutura visual; geração/exportação indisponível. |
| `validacao_sistema.html` | `/financeiro/[empresa]/validacao-projecao` | Estrutura visual; validação/cálculo indisponível. |
| templates de `titulos_privados` | `/financeiro/[empresa]/titulos-privados` | Leituras de títulos e parcelas existentes; empréstimo, Price, recebimento, prorrogação e amortização bloqueados. |

As rotas que leem dados chamam exclusivamente `financialRecords`, que já aplica sessão Supabase e autorização por empresa/módulo. Vencimentos, renovações/retiradas, relatórios e validação não chamam uma API inventada. Em qualquer tela de leitura, ausência de carga e erro de estrutura continuam distintos de zero; em telas sem operação, o botão é desabilitado e informa o bloqueio real.

## Versões e limites da verificação

Repositório privado confirmado: Grupo-Capuzzo/comercial360-validation; branch padrão main.
Fetch realizado. PRs #1, #2, #3 e #4 continuam abertos, sem merge.
As cinco branches remotas encontradas foram main, codex/finance-migration-ci,
codex/portal-finance-integration, codex/finance-first-load e codex/commercial-delivery.
Não foi encontrada branch separada identificável como entrega posterior do Fernando nem branch de release.

- Portal e consultas financeiras: codex/portal-finance-integration, dd36dc50e6fc6937ebf8f53ffcc4370875bd1586.
- Executor/projetor sintético: codex/finance-first-load, f779a3ab73fdb12ee844d16faa8f0b82da55b985.
- Comercial: codex/commercial-delivery, 5e6a1d63a3dcb5db972ca719ca92ede835981dac; PR #4 tem base codex/finance-first-load.
- Controle financeiro original: portal-grupo-capuzzo.zip, disponível localmente, inspecionado sem executar Flask ou abrir SQLite. Ele é a referência de layout, navegação, informações, nomenclaturas, fluxos e regras futuras para a interface Next.js.

5e6a1d63 é a base comercial anterior. A interface financeira desta atualização é uma camada de navegação e leitura sobre essa cadeia; não porta cálculos ou escrita financeira. Não foi feito merge, deploy ou importação.

## Quadro de funcionalidades

| Funcionalidade | Implementação atual | Dependência / situação para publicar |
| --- | --- | --- |
| Login, sessão e seleção de empresa/módulo | Next: src/lib/supabase, src/services/portal.service.ts, src/app/portal; branch comercial inclui dd36 | Supabase Auth, portal_acesso.sessao_ativa, empresas_portal e permissoes. Estrutura portal_acesso ausente no destino: bloqueado até aprovação. |
| CRM existente | Next: telas e serviços CRM, preservados na branch comercial | Estruturas existentes do CRM preservadas; não substituir conexão nem conceder acesso geral. Teste combinado ainda pendente. |
| Input, jornada e formalização jurídica/output v1 | Next: src/app/contato, src/lib/commercial, src/services/commercial-journey.service.ts e tools/commercial-output/sql/commercial-journey.review.sql | SQL de revisão ainda não aplicado; configurar rotas de atendimento, permissões, modelos aprovados e vínculos. Referência manual de formalização não comprova integração com assinatura digital. |
| Cinco listas financeiras | Next: src/app/financeiro/[empresa]/[secao]/page.tsx; portal.service.ts; GET financeiro | Clientes, cotas, apurações, títulos e parcelas são consultas de projeção histórica, limitadas a 500 linhas por seção. Dependem de financeiro.estado_carga e registros_lista. Não representam saldo atual nem o controle completo. |
| Dashboard e detalhes de condomínios | Next: `/financeiro/[empresa]`; original: `templates/dashboard.html` e `condominio.html` | Dashboard e navegação adaptados; detalhes/cálculos operacionais permanecem indisponíveis até entrega Supabase aprovada. |
| Cadastro e manutenção de clientes financeiros | Next: `/financeiro/[empresa]/clientes`; original: rotas `/clientes` e templates `clientes_*` | Consulta Supabase disponível; CRUD, ativação/inativação e importação seguem bloqueados. |
| Cotas individuais, múltiplas e edição em lote | Next: `/financeiro/[empresa]/cotas`; original: rotas `/cotas` e templates `cotas_*` | Consulta Supabase disponível; UI de operação, transações, constraints e escrita continuam bloqueadas. |
| Vencimentos, renovação e retirada | Original: database.py; /condominios/vencimentos e operações /cotas | Regras existentes devem vir da entrega do Fernando; não recriar ou modificar por esta frente. Persistência operacional equivalente não identificada. |
| Apuração mensal e consolidação | Next: `/financeiro/[empresa]/apuracoes`; original: calculations.py e `/apuracao` | Consulta Supabase disponível; cálculo Decimal e gravação não foram portados. |
| Histórico, detalhes, correção e relatórios | Next: `/financeiro/[empresa]/historico` e `/relatorios`; original: `/historico`, `/relatorios`, reports.py | Histórico lê a projeção de apurações; detalhes completos, correção, geração e exportação seguem bloqueados. |
| Validação financeira do sistema | Next: `/financeiro/[empresa]/validacao-projecao`; original: `/condominios/validacao-sistema` | Estrutura visual apenas; não considerar homologada a operação de validação. |
| Auditoria e backup operacional | Original: /auditoria, /backup, database.py e backup.py | Backup/restore sintético das ferramentas não é backup operacional existente do Supabase. Plano de recuperação seletiva deve ser aprovado; não restaurar banco inteiro sobre CRM. |
| Banco, remessas e e-mails | Original: bank_files_inter.py, bank_files_itau.py, gmail_integration.py e rotas específicas | Código original existe, mas integração/credenciais/permissões e aprovação operacional não estão demonstradas. Nenhum envio, pagamento ou remessa habilitado nesta etapa. Gerar remessa não significa pagar. |
| Títulos Privados | Next: `/financeiro/[empresa]/titulos-privados`; original contém operações | Consultas históricas de títulos e parcelas; espaço preservado sem expandir operação financeira. |

Não foram classificados recursos Python existentes como funcionalidades novas a desenvolver. A lacuna é sua integração/adaptação, sob coordenação do responsável financeiro. Não colocar Flask/Jinja em src/app, executar Flask ou manter SQLite operacional como atalho.

## Banco: aprovação separada

Projeto confirmado por metadados: umvldqzzliqmgkvoedyd, servopa-integrations, ACTIVE_HEALTHY.
Consulta limitada a nomes de schemas confirmou comercial_360 e api_comercial; portal_acesso, financeiro e financeiro_origem não existem. Não houve leitura de clientes, base real ou escrita remota.

Arquivos existentes a revisar, não aplicar indiscriminadamente:

1. tools/finance-migration/migrations/portal_acesso.review.sql e portal_consulta.review.sql: permissões, sessão, empresas autorizadas, estado de carga, registros_consulta e view registros_lista.
2. tools/commercial-output/sql/commercial-journey.review.sql: jornada, input idempotente, permissões, modelos, vínculos aprovados e output versionado; arquivo de revisão com transação encerrada por ROLLBACK. Validar compatibilidade das estruturas CRM e proprietários das funções antes de preparar migration aplicável.
3. financeiro_operacional.review.sql: fatia histórica de títulos/vínculos; NÃO equivale a schema operacional completo de condomínios.
4. financeiro_origem.review.sql, tools/finance-first-load/control.review.sql e api_exposure.review.sql: somente se aprovado o escopo de carga/projeção. Não são condição para importar automaticamente no deploy.
5. DDL operacional de condomínios da entrega revisada do Fernando: ainda não localizada; não é possível declarar a lista mínima final de migrations sem esse artefato.

Expor apenas schemas/RPCs necessários ao PostgREST, manter RLS e permissões por empresa/módulo. Não expor financeiro_origem genericamente, não abrir dados para anon, não usar service_role no navegador. Usuários de acesso são distintos de clientes financeiros. Não criar usuários nesta etapa.

Histórico entra diretamente no domínio financeiro aprovado, preservando data/IDs e vínculos confirmados, sem refazer lead/proposta. Novos negócios seguem CRM -> formalização/output -> consumidor financeiro. Evitar dupla contagem com posições existentes; nenhum disparo de nova venda, assinatura ou rotina financeira para o legado. Extração de 01/10/2026 não contém lançamentos posteriores.

## Hostinger: configuração candidata

O código atual usa Next.js 16.3.8, não 16.3.3. É aplicação Node persistente, com SSR, sessão e APIs; .next não é export estático.
Hostinger documenta Next.js backend em Node.js Web Apps Business/Cloud e Node 22/24. Preferir Node 24, correspondente ao ambiente local já testado. Plano e limites da conta não foram consultados no hPanel.

- Criar Web App Next.js backend no plano compatível, sem excluir o site principal grupocapuzzo.com.br.
- Raiz do projeto: pasta do package.json, não tools nem pasta Flask.
- Instalação reproduzível: npm ci, incluindo devDependencies necessárias ao build.
- Build: npm run build (já executa next build --webpack).
- Start genérico: npm run start -- --hostname 0.0.0.0, respeitando PORT fornecido pelo runtime. Não usar next dev. Confirmar no painel como o preset Next gerencia o start/porta; não presumir controle de PM2 ou porta pública 3000 em hospedagem gerenciada.
- Output Next: .next quando o preset solicitar. Não trocar por out nem ativar export estático.
- next.config.mjs atual contém reactStrictMode; nenhuma alteração comprovadamente necessária. Não há next.config.ts nesta versão. Não ativar standalone ou criar server.js sem exigência do runtime. Build atual usa webpack; Turbopack de desenvolvimento não é requisito de hospedagem.
- Roteamento/proxy da Web App é gerenciado pela Hostinger. VPS seria configuração manual, mas não está sendo adotada silenciosamente. Não abrir a porta interna na Internet nem configurar proxy Flask paralelo.

Variáveis efetivamente usadas:

```text
NEXT_PUBLIC_SUPABASE_URL=https://umvldqzzliqmgkvoedyd.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<chave pública do projeto confirmado>
COMMERCIAL_PUBLIC_ORIGIN=https://crm.grupocapuzzo.com.br
NODE_ENV=production
PORT=<gerenciado/confirmado no runtime Hostinger>
```

As duas NEXT_PUBLIC precisam estar corretas no build e no runtime. Não fornecer senha PostgreSQL, service_role, chaves Gmail/banco ou credenciais de importação à Web App. Nenhum processo de migração será anexado ao build/start. Varredura de src encontrou localhost apenas na validação explícita da origem de desenvolvimento; não há endpoint operacional localhost identificado nesse recorte.

Conectar crm.grupocapuzzo.com.br à Web App. No provedor DNS autoritativo, criar o registro do host crm conforme alvo real fornecido pelo painel: A para IP informado OU CNAME para hostname informado, nunca ambos no mesmo nome. Não inventar IP, não alterar MX, raiz ou nameservers sem necessidade. Validar SSL/HTTPS. Endereço/alvo concreto e suporte ao subdomínio no fluxo da conta devem ser confirmados no painel antes de editar DNS.

Supabase Auth: preparar Site URL https://crm.grupocapuzzo.com.br e permitir somente URLs reais de retorno usadas pela aplicação. Não inventar /auth/callback: nenhum uso dessa rota ou redirectTo foi encontrado na busca atual de src. Configuração Site URL é compartilhada pelo projeto: conferir impacto nos outros consumidores antes de alterar. Login por senha atual não demanda OAuth. Testar cookies, renovação, logout e autorização no domínio definitivo; não abrir wildcard geral em produção.

Publicação inicial controlada deve selecionar um SHA aprovado. Integração GitHub da Hostinger pode publicar a cada push: não conectá-la às branches de desenvolvimento como parte desta inspeção. ZIP de código sanitizado é alternativa documentada, sem dados/credenciais, não o pacote Flask original. Integrações externas só podem ser confirmadas no hPanel; não foram alteradas.

Referências oficiais consultadas:

- https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/
- https://www.hostinger.com/support/how-to-select-the-node-js-version-for-your-application/
- https://www.hostinger.com/support/how-to-connect-a-custom-domain-to-a-node-js-application/
- https://supabase.com/docs/guides/auth/redirect-urls

## Testes e próximo ponto de integração

Foram executados nesta interface: três testes Node de estrutura/navegação financeira, lint, typecheck e build. O build confirmou as rotas dinâmicas `/financeiro/[empresa]` e `/financeiro/[empresa]/[secao]`. O teste de navegador autenticado foi atualizado para esperar a entrada no Dashboard, mas não foi executado porque `tests/isolated/` não está presente neste workspace; ele requer o ambiente Supabase sintético isolado previamente usado. Não foram repetidos a conferência da base, Flask, verificador financeiro ou workflows.
Preservar as evidências anteriores dos commits: dd36 (54 cenários isolados), f779 (80 Python + 28 PostgreSQL), 5e6 (49 testes Node comerciais, quatro navegador locais, lint/typecheck/build documentados em COMMERCIAL_TEST_RESULTS.md). Essas evidências não homologam CRUD/apuração/renovação/retirada do original no Next/Supabase nem produção.

Próxima evolução financeira: o responsável financeiro implementa operações e regras no Supabase; esta frente integra telas, autorização e testes sem modificar cálculos de negócio. Coordenar `src/services/portal.service.ts`, navegação, tipos Supabase, RLS, SQL, output v1 e dependências; não resolver conflitos financeiros nem alterar regras sozinho. Manutenção dos scripts de migração continua pendente de confirmação, não transferida automaticamente.

Testes pertinentes da versão combinada: lint/typecheck/build; caminho login -> empresa -> Financeiro -> Condomínios; casos positivos/negativos de empresa/módulo; operações financeiras efetivamente incorporadas e sua persistência/rollback com dados sintéticos; ausência de efeitos de pagamento/remessa/e-mail; integração output v1; estados sem carga e erro sem saldos falsos. Nova rodada CI exige autorização; nada foi disparado.

Bloqueios objetivos de operação: aplicar e revisar as migrations de acesso/projeção, aprovar a carga histórica, e entregar a persistência/regras Supabase para cada ação. O ZIP original já foi localizado e reconhecido como referência completa de Condomínios; não é necessário solicitar outra branch.

Nenhum commit, push, merge, deploy, migration, importação real ou alteração de regras financeiras foi realizado nesta inspeção. Único arquivo acrescentado: este documento; next-env.d.ts preexistente permanece preservado.
