# CRM Geral e CRM por empresa — revisão
Base: main 018403f, isolada em codex/crm-empresa-segregacao. Auditoria somente leitura realizada em 17–18/11/2026. Nenhuma alteração no banco real.

## Diagnóstico
- /crm carregava oportunidades e tarefas sem empresa; /comercial/[empresa] validava uma permissão e abria Dashboard sem passar a empresa.
- O menu ERP chamava o UUID comercial de Grupo Capuzzo de CRM Geral. Agora CRM Geral tem a rota /crm; a URL antiga tem apenas redirecionamento autorizado de compatibilidade.
- As views api_comercial têm security_invoker, mas várias delegam a funções SECURITY DEFINER de seguranca_comercial. Somente acrescentar RLS ou filtros React não restringiria essas funções.
- Há três controles independentes: empresas/módulos no ERP, portal_acesso.permissoes e cadastro ativo em comercial_360.crm_usuarios; também há a camada de mascaramento seguranca_comercial.usuarios.
- erp.acesso_comercial concedia leitura comercial em todas as empresas do Portal ao marcar CRM Geral. A administração deixa de chamar essa concessão ampla; a nova autorização lê ERP e permissões existentes a cada requisição. Direitos de empresa e leitura/gravação precisam coincidir. Não há provisionamento automático a partir do Auth.
- O catálogo ERP é definido em src/erp/modulos/portal.ts. Não foi encontrada tabela erp.empresas no catálogo consultado.

## Matriz de correspondência
Nenhuma linha abaixo foi homologada. A migration semeia apenas os sete slugs e nomes, com empresa_id NULL; não preenche candidatos nem cria empresas comerciais.

| ERP / slug | Identificador comercial validado | Evidência / pendência |
| --- | --- | --- |
| Capuzzo Assessoria & Consultoria / assessoria | nenhum | Não equiparar a Grupo Capuzzo |
| Capuzzo Cred / cred | nenhum | Cadastro comercial correspondente não confirmado |
| Ether Nexus / ethernexus | nenhum | Existe candidato eedb1f91-0f95-4072-a80c-ff216f97e8de; nome igual não prova correspondência |
| Grão / grao | nenhum | Cadastro comercial correspondente não confirmado |
| Hortstufas / hortstufas | nenhum | Cadastro comercial correspondente não confirmado |
| Terceiriza Fácil / terceiriza | nenhum | Cadastro comercial correspondente não confirmado |
| World Gym / worldgym | nenhum | Existe “Word Gym”, 05cf491e-d9ad-4dd5-93da-6a3ffef74241; divergência a validar |

Grupo Capuzzo permanece com o UUID 40ca9f00-a17c-4605-9323-a15974c52817. Ele não representa as sete empresas nem recebe alias para assessoria. Na auditoria, os produtos estavam distribuídos em Grupo Capuzzo (13), Ether Nexus (1), Word Gym (1). Não havia oportunidade com produto_id NULL; isso não valida a atribuição empresarial.

## Implementação
- Workspace reutiliza Dashboard, CrmPage, ClientsPage, ProductsPage e LeadsPage. Interações têm lista própria. Responsáveis e tarefas continuam no pipeline existente.
- O scope chega explicitamente aos serviços; troca de empresa remonta o workspace e limpa o estado anterior. O menu da empresa permanece no escopo e identifica seu nome.
- API /api/crm/[escopo] valida sessão e contexto no servidor; operações são revalidadas no banco. Respostas privadas usam no-store. O proxy nega links diretos antes do streaming, com HTTP 403.
- As funções originais são copiadas para namespace privado, com EXECUTE revogado dos papéis web. Os contratos originais são substituídos mantendo os mesmos OIDs, para proteger também as views/RPCs preexistentes. As cópias preservam mascaramento, validações e auditoria.
- Políticas RESTRICTIVE acrescentam segregação a leads, produtos, vínculos e clientes, em composição com o RLS existente.
- Usuário somente de empresa não precisa receber CRM Geral. CRM Geral consolida a interseção autorizada, sem assumir um UUID global.
- Cliente mantém cliente_id_global: relacionamentos e indicadores são derivados somente dos vínculos permitidos, sem duplicar a identidade nem reaproveitar agregados globais.
- Empresa não conciliada mostra pendência e não consulta registros. Negócios sem associação comprovada são visíveis para classificação somente ao administrador ERP sem restrição de empresas; não são operáveis. Usuário com empresas restritas não recebe registros de origem incerta.
- produto_id → produtos.empresa_id é a evidência operacional atual. A ausência de produto, vínculo não homologado ou código ambíguo não gera atribuição. Itens/empresas arbitrários no payload são rejeitados. Vendas futuras multiproduto precisam de contrato explícito, incluindo validação de todos os itens, antes da ativação.
- Gravações exigem pode_gravar; não transformam a antiga permissão de leitura em escrita. O contrato de formalização continua obrigatório para fechamento.

## SQL proposto e rollback
Arquivo gerado pela CLI: supabase/migrations/20261118125652_crm_company_scope.sql.
Rollback: tools/crm-scope/rollback.review.sql.
Aplicação e rollback foram ensaiados exclusivamente em PostgreSQL WASM em memória. A migration não cria nem copia clientes/oportunidades, não altera grants existentes de usuários e não modifica cálculos financeiros/jurídicos. Ela acrescenta estruturas privadas, guards, políticas, índices e RPCs. A substituição dos contratos de segurança é parte sensível da revisão.

Antes de aplicar: capturar definições/ACLs atuais, conferir se as assinaturas continuam iguais e revisar o SQL com a equipe. Fazer rehearsal numa cópia descartável da estrutura real; validar planos de consulta e advisors. Exportar company_map e o snapshot privado antes de executar o rollback. Reverter aplicação e banco de forma coordenada; o frontend novo depende dos novos RPCs.

## Comparação dos PRs antigos
PR #4 (codex/commercial-delivery) e #5 (release/portal-v1) foram comparados contra main; nenhum merge, cherry-pick ou cópia foi feito. A comparação completa de #4 contra a main atual contém diferenças em 277 arquivos; a de #5, em 296, incluindo remoção de implementações ERP/Jurídico/Orçamentos atuais. Os arquivos da jornada comercial usados nesta entrega já estavam na main. As branches antigas não são base adequada para esta separação.

## Pendências antes de publicar
1. Homologar as sete correspondências por evidência empresarial e definir o destino correto dos produtos ainda em Grupo Capuzzo. Não resolver apenas por nomes.
2. Revisar a interseção dos direitos ERP/Portal/CRM. Usuário sem um dos cadastros ativos permanece bloqueado; concessões de escrita precisam ser expressas. Não houve alteração de usuários reais nesta entrega.
3. Homologar migration/rollback sobre estrutura real descartável e revisar todas as assinaturas/caminhos RPC. Os testes em memória usam funções legadas representativas, não reproduzem integralmente as rotinas reais de produção.
4. Executar teste de navegador com Supabase Auth local real para login, administração, recuperação, troca de empresa e negação de links. Os testes HTTP desta entrega usam o código real com serviços simulados; não substituem essa homologação.
5. Validar carga representativa e EXPLAIN. A resposta é paginada em lotes de 200 e o frontend percorre todos os lotes; a camada de compatibilidade ainda agrega os resultados seguros antes do corte por página. Para volumes altos, substituir por consulta com filtro/keyset aplicado antes da materialização.
6. Pendências de qualidade sem chave empresarial ficam explicitamente indisponíveis nos escopos restritos; não são apresentadas como zero. Chat e saldo agregado antigos sem vínculo de negócio permanecem reservados ao administrador irrestrito, até existir classificação segura dessas projeções.
7. Homologar indicador de qualidade e históricos pendentes, validação visual/responsiva e operações de responsáveis conforme papéis reais.
8. Não fazer deploy nem executar migration na Hostinger/Supabase de produção antes da aprovação.

## Reprodução
npm ci --ignore-scripts
npm run test:crm-scope
npm run typecheck
npm run build

Suíte ampliada (PowerShell):
$env:JURIDICO_TEST_RUNTIME = Join-Path (Get-Location) 'node_modules/@electric-sql/pglite/dist/index.js'
node --test tests/crm-scope/*.test.mjs tests/*.test.mjs tests/commercial/*.test.mjs tests/financeiro/*.test.mjs

O ensaio cria seu próprio PostgreSQL em memória, não lê .env e não conecta ao Supabase. Consultas de diagnóstico reutilizáveis estão em tools/crm-scope/audit.readonly.sql.
