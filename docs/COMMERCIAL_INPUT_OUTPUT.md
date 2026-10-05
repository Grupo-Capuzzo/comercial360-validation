# INPUT → CRM → OUTPUT — implementação e limites

## Escopo e colaboração

Branch de entrega: `codex/commercial-delivery`, baseada em `f779a3ab73fdb12ee844d16faa8f0b82da55b985`, descendente de `dd36dc50e6fc6937ebf8f53ffcc4370875bd1586`. O SHA `f779a3ab...` é a base anterior, não o commit da implementação comercial. Publicação autorizada somente por commit/push desta entrega e Draft PR empilhado sobre `codex/finance-first-load`; nenhum merge, deploy, migration aplicada ou disparo manual de workflow está autorizado.

Esta frente mantém Portal, Comercial/CRM, Jurídico e o contrato de consumo dos outputs. Nenhuma apuração, pagamento, baixa, amortização ou remessa foi acrescentada. Os arquivos financeiros antigos continuam intactos.

Divisão definida para trabalho paralelo:

| Frente | Arquivos sob responsabilidade proposta |
| --- | --- |
| Nossa frente — Portal/Comercial/Jurídico | Input, CRM, formalização/Jurídico e produtor do output: `src/lib/commercial/**`, `src/components/commercial/**`, `src/app/api/comercial/**`, `src/app/contato/**`, jornada contratual no CRM, `tools/commercial-output/**`, `tests/commercial/**` |
| Fernando — Financeiro | Módulo Financeiro e consumidor do output: `src/app/financeiro/**`, `src/app/api/financeiro/**`, `src/components/financeiro/**` quando existentes; novos componentes/serviços exclusivamente financeiros na branch dele |
| Manutenção de migração — pendente de confirmação | `tools/finance-migration/**`, `tools/finance-first-load/**`, scripts/projeções em `tools/portal-integration/**`. Preservados; manutenção não transferida automaticamente a Fernando |
| Compartilhados — combinar antes de editar | `src/services/portal.service.ts`, `src/types/database.ts` e tipos globais, `src/lib/supabase/**`, `src/proxy.ts`, navegação/layout, permissões, SQLs/migrations, workflows, dependências e contrato de consumo do output |

Não alteramos arquivos financeiros nesta entrega. Fernando deve criar uma branch própria a partir do **novo commit publicado desta implementação comercial**, não editar `codex/commercial-delivery` e não trabalhar sobre `main` como se as dependências já estivessem incorporadas. Revisar o contrato v1 abaixo antes do consumo operacional. A manutenção dos scripts de migração exige confirmação entre os responsáveis, sem atribuição automática. Os PRs anteriores permanecem inalterados.

### Envio e automações verificados

O novo Draft PR usa `codex/finance-first-load` como base, mantendo sua dependência do PR #3 e das entregas anteriores, sem retarget/merge dos PRs existentes. Sua diferença deve conter somente os arquivos comerciais e estes dois documentos. `next-env.d.ts`, caches, resultados locais e dependências instaladas ficam fora do commit.

Na conferência pré-envio: repositório privado; zero webhooks e zero deployments retornados pela API do GitHub; check-runs da base pertencentes somente ao GitHub Actions. Os três workflows versionados não possuem trigger `push`; recebem PR para `main` e restringem os jobs às branches de migração/integração anteriores. O PR comercial empilhado não corresponde a esses gatilhos. Nenhum workflow foi alterado ou disparado manualmente. Não foi identificado serviço conhecido de publicação automática; configurações independentes no painel da hospedagem não foram verificadas nem modificadas. Não habilitar deploy ou carga ao disponibilizar esta entrega.

## Contrato de consumo v1 — implementação efetiva

Fontes: tipo `Output` em `src/lib/commercial/journey.ts`; DTO `consume`; route `src/app/api/comercial/outputs/[empresa]/route.ts`; função SQL **não aplicada** `commercial_consume_outputs`. O domínio TypeScript tem testes sintéticos; a integração do endpoint com os novos RPCs não foi homologada em PostgreSQL/Supabase.

### Endpoint, autorização e retorno

`GET /api/comercial/outputs/{empresa}` recebe o identificador da empresa pelo caminho e utiliza os cookies da sessão Supabase existente. Não há autenticação própria, token do consumidor, chave administrativa ou acesso anônimo ao output. O serviço valida `auth.getUser()`; a revisão SQL exige `auth.uid()`, usuário ativo em `comercial_360.crm_usuarios` e capacidade `financeiro` para aquela empresa em `crm.commercial_permissions`. `can_write` não é necessário para consumir. Não permite ler outra empresa nem escrever no CRM. Configuração/permissões ainda não foram aplicadas.

Sucesso previsto: HTTP 200 com **array JSON direto de outputs**, sem envelope. Sem registros: `[]`. Header do handler: `Cache-Control: private, no-store`. Não há atributo `apiVersion` no payload; “v1” é o nome deste contrato documental, não um campo que o código envie.

| Campo | Tipo JSON / TypeScript | Significado efetivo |
| --- | --- | --- |
| `id`, `business` | `string` | ID estável e igual do negócio/output; na revisão SQL é o UUID da oportunidade |
| `version` | `number` inteiro | Revisão da jornada no fechamento; não é número da versão deste contrato de API |
| `client`, `company` | `string` | Referências de cliente e empresa; UUIDs no SQL proposto, sem documento/nome pessoal no DTO |
| `opportunity`, `proposal` | `string \| null` no tipo | Referências; o produtor novo implementado exige oportunidade e proposta no fechamento |
| `items` | `Item[]` | Itens do mesmo negócio/contrato, não vendas independentes |
| `items[].id`, `product`, `description` | `string` | ID do item, referência do produto e descrição |
| `items[].quantity` | `number` inteiro | Quantidade positiva; validação comercial limita de 1 a 100000 |
| `items[].unitPrice` | `string` decimal | Valor unitário não negativo, ponto e exatamente duas casas, ex. `"100.00"` |
| `total` | `string` decimal | Soma dos itens; domínio usa centavos/BigInt, SQL proposto usa numeric |
| `conditions` | `string` | Condições da proposta registrada/aceita |
| `contract` | `Contract` | Referências e formalização do único contrato deste negócio |
| `contract.id`, `template` | `string` | Referências do contrato e modelo aprovado |
| `contract.templateVersion` | `number` inteiro | Versão do modelo contratual |
| `contract.fields` | `Record<string,string>` | No DTO entregue ao Financeiro é sempre `{}`; cadastro contratual removido |
| `contract.documents` | `Record<string,string>` | Tipo de documento → referência privada; não arquivos, URLs públicas ou concessão automática de acesso |
| `contract.signatureEvidence` | `string \| null` | Referência de evidência atestada pelo Jurídico; não verificação criptográfica de assinatura |
| `contract.legalApproved` | `boolean` | Revisão jurídica; o fechamento exige `true` |
| `formalization` | literal `"completed"` | Não expõe proposta pendente como output concluído |
| `closedAt` | `string` de data/hora | Data efetiva, não data da migração. Domínio normaliza ISO UTC; SQL proposto conserva a string validada por cast timestamptz. Comparar como instante, não pelo texto |
| `source` | `"crm_new" \| "imported_history"` no tipo | A revisão SQL atual produz/aceita apenas `crm_new`; publicação histórica ainda não implementada no SQL |
| `originReferences` | `string[]` | Rastreabilidade; o produtor SQL atual envia `[]`, sem inventar vínculos legados |
| `triggersNewSale` | `boolean` | Classificação: true no produtor novo; não dispara automação por si só |
| `affectsInvestmentPositions` | literal `false` | Não acrescenta patrimônio ou altera posições |

Não converter valores monetários com `Number/parseFloat` para contabilização. Preservar as strings e usar decimal exato/centavos. Sem campo de moeda, desconto discriminado, status de pagamento, vencimento, remessa, conta bancária ou plano de amortização no DTO atual: Fernando não deve inferir esses dados.

Identidade/idempotência: deduplicar por `id`/`business` e `version`, sem multiplicar saídas pelo número de itens. Repetir fechamento conserva o output e sua revisão. Edição após fechamento é bloqueada; fluxo de aditivo/revisão pós-fechamento não existe nesta versão. Consumir o mesmo output novamente não é autorização para gerar operação financeira duplicada.

### Exemplo exclusivamente sintético do DTO de consumo

```json
[
  {
    "id": "00000000-0000-4000-8000-000000000001",
    "version": 6,
    "business": "00000000-0000-4000-8000-000000000001",
    "client": "00000000-0000-4000-8000-000000000002",
    "company": "00000000-0000-4000-8000-000000000003",
    "opportunity": "00000000-0000-4000-8000-000000000001",
    "proposal": "synthetic-proposal",
    "items": [
      { "id": "synthetic-item-a", "product": "00000000-0000-4000-8000-000000000004", "description": "Item sintético A", "quantity": 2, "unitPrice": "0.10" },
      { "id": "synthetic-item-b", "product": "00000000-0000-4000-8000-000000000004", "description": "Item sintético B", "quantity": 1, "unitPrice": "100.00" }
    ],
    "total": "100.20",
    "conditions": "Condições comerciais exclusivamente sintéticas",
    "contract": {
      "id": "synthetic-contract",
      "template": "synthetic-approved-template",
      "templateVersion": 1,
      "fields": {},
      "documents": { "synthetic_document": "private-synthetic-reference" },
      "signatureEvidence": "synthetic-evidence-reference",
      "legalApproved": true
    },
    "formalization": "completed",
    "closedAt": "2026-09-30T12:00:00.000Z",
    "source": "crm_new",
    "originReferences": [],
    "triggersNewSale": true,
    "affectsInvestmentPositions": false
  }
]
```

### Erros e limites atuais

O handler responde objeto `{ "code": "..." }`, sem detalhes de pessoas ou erro bruto SQL:

| HTTP | `code` do handler/serviço | Condição implementada |
| --- | --- | --- |
| 401 | `session_required` | Sessão não autenticada; proxy também pode negar antes do handler |
| 403 | `access_denied` | RPC responde SQLSTATE 42501, inclusive empresa/módulo não autorizados |
| 409 | `version_or_submission_conflict` | Mapeamento compartilhado de SQLSTATE 40001/23505; não é mecanismo de paginação |
| 422 | `commercial_requirements_not_met` | Mapeamento compartilhado de SQLSTATE 22023 |
| 503 | `commercial_structure_unavailable` | Configuração ausente, RPC/estrutura indisponível ou outros erros SQL não mapeados |
| 503 | `query_failed` | Exceção inesperada capturada pelo handler de outputs |

Os códigos 409/422 fazem parte do adaptador compartilhado; a função proposta de listagem não gera especificamente esses casos. Um ID de empresa malformado não tem validação dedicada no handler: erro de conversão SQL pode cair em 503; não há garantia de 400/404 para esse caso. Falhas anteriores ao handler, como infraestrutura/proxy, não são cobertas por este envelope.

A listagem proposta traz **todos** os outputs visíveis da empresa em um array, ordenados por `recorded_at` no SQL. Não implementa limite máximo, paginação, cursor, filtros, consulta por ID, totalizadores ou leitura incremental. Empates de timestamp não têm desempate garantido. Não há limite de tamanho da resposta ou contrato de streaming. Ausência de paginação é uma limitação a revisar antes de volume operacional; não presumir parâmetro `limit` ou `since`.

**Persistência SQL não aplicada:** o endpoint está em código, mas não entrega registros operacionais sem as estruturas/permissões revisadas. O exemplo demonstra formato, não uma gravação realizada. Não executar o SQL nem importar dados para poder revisar este contrato.

## O que existe e o que foi acrescentado

O modelo consultado possui `comercial_360.leads`, clientes/produtos/empresas, `crm.oportunidades`, tarefas, interações e conversões. As views de vencimentos/eventos e detecções de contratos não equivalem a propostas aprovadas, contratos assinados ou outputs comerciais. Não foi localizada integração de assinatura implementada no código inspecionado.

A função antiga de conversão encerra a oportunidade sem comprovação contratual e sem a nova idempotência. Ela não é usada na geração do novo output. A movimentação `FECHADO` pela interface agora orienta a formalização; isso não altera nem protege sozinho a RPC antiga no destino. Revisar suas permissões e eventuais consumidores antes da entrada em operação.

- `/contato`: entrada simples, nome, telefone/WhatsApp, e-mail, produto/serviço e empresa do contato opcional. Exige ao menos um canal de contato válido. Não pede dados bancários ou documentos contratuais.
- `/api/comercial/input`: somente POST; lista permitida de campos; limite real de bytes; mesma origem; UUID de submissão. O visitante não envia cliente, empresa de atendimento, responsável, permissões ou data. Não recebe identificadores internos nem resultados de consulta de pessoas.
- Origem pública canônica: em produção configurar `COMMERCIAL_PUBLIC_ORIGIN=https://crm.grupocapuzzo.com.br` (ou o domínio realmente aprovado, sem barra final). A validação não confia na URL interna reconstruída pelo Next.js ou em `X-Forwarded-Host`. Sem essa configuração, mutações falham fechadas. O ensaio local usa somente loopback.
- `/api/comercial/catalogo`: somente produtos habilitados pelo roteamento aprovado. Não publica o catálogo interno completo ou dados de clientes.
- O recebimento proposto insere na tabela de leads existente. Empresa de atendimento e responsável são determinados pelo produto/roteamento no banco. Data e origem são produzidas pelo sistema.
- A chave de submissão é independente de e-mail/telefone. Mesmo envio é idempotente; uma chave nova pode representar outro interesse legítimo. Não há upsert de cliente público. Após falha ambígua, o formulário conserva chave/payload; novo contato exige ação explícita após confirmação.
- `/crm/[id]/formalizacao`: vínculo de cliente previamente confirmado, itens e condições da proposta, aceite, complementação pelo modelo aprovado, revisão jurídica e confirmação de fechamento.
- A complementação mantém oportunidade/cliente/contrato; não cria outro lead. Alterar os dados invalida a revisão e a evidência anterior de assinatura. Modelo/produto/versão incompatível bloqueiam o fechamento.
- Não há link externo de complementação nesta entrega: somente o usuário autenticado/autorizado pode operar a oportunidade. Portanto, não há token público genérico para consultar cadastros.

## Estados e output

`lead → qualified → proposal → accepted → preparing_contract → awaiting_signature → closed`

O aceite não é fechamento. Gerar/anexar documento não é assinatura. A referência de evidência é conferida e atestada pelo Jurídico autorizado; não constitui verificação criptográfica de um provedor externo. Só após revisão jurídica, assinatura quando exigida, dados/documentos do modelo aprovado, cliente vinculado e data efetiva pode existir output.

Contrato de consumo v1: ID estável do negócio/output; versão; cliente; empresa; oportunidade; proposta; itens, quantidades e valores unitários decimais; total e condições; contrato/documentos; formalização concluída; data efetiva; origem e referências da origem. Um negócio com vários itens produz um contrato e um output. Valores não passam por soma binária de floats.

Endpoint previsto para Fernando: `GET /api/comercial/outputs/[empresa]`. Usa a sessão Supabase existente e a capacidade de leitura do Financeiro naquela empresa. Remove os campos cadastrais contratuais do DTO; referências documentais não são URLs públicas nem concedem acesso automático ao arquivo. Não concede escrita no CRM. Não consulta nem altera posições de investimento. Fernando deduplica pelo ID do negócio/output e versão; a decisão de transformar o output em operação financeira pertence ao seu módulo, não a este produtor.

Fechamento repetido não gera outra saída. Requests, snapshots e versões registram rastreabilidade. Após fechamento, mudanças são bloqueadas: não há edição silenciosa do output. Um fluxo de aditivo/revisão pós-fechamento precisará de regra aprovada e endpoint próprio, ainda não implementado.

## Persistência — proposta executável, não aplicada

`tools/commercial-output/sql/commercial-journey.review.sql` é uma revisão SQL com `BEGIN/ROLLBACK`, não uma migration aplicada ou habilitada em deploy. Acrescenta estruturas comerciais no schema `crm`, com FKs para o CRM existente: roteamento, capacidades por empresa/módulo, modelos aprovados, vínculos confirmados, estado da jornada, requests/snapshots, outputs e submissões. Não substitui tabelas existentes.

O SQL propõe funções restritas em `api_comercial`, RLS habilitado e revogação de acesso direto de `anon/authenticated`. O visitante recebe apenas catálogo autorizado e inserção de contato; não SELECT de clientes. Funções de jornada/consumo verificam `auth.uid()`, usuário ativo e capacidades. Escrita da complementação é Comercial; atestado é Jurídico; consumo é Financeiro. Não há nova autenticação ou criação de conta de login para clientes.

As novas estruturas/funções **não existem no destino confirmado**. Não foram aplicadas. Sem elas, as interfaces mostram indisponibilidade e não gravam em memória, SQLite ou outro fallback. O formulário é executável no ensaio local com respostas sintéticas, mas ainda não recebe contatos operacionalmente no Supabase.

Antes de transformar a revisão em migration: ensaiar PostgreSQL e grants/RLS com papéis efetivos sem SUPERUSER/BYPASSRLS/propriedade; definir proprietário não-login com privilégios mínimos para SECURITY DEFINER; integrar as capacidades à autorização do Portal já proposta; confirmar concorrência/CAS, FKs, rollback e idempotência no banco. Não tratar os testes TypeScript como prova dessas funções SQL.

Somente dois triggers de usuário foram encontrados no recorte inspecionado de oportunidades/conversões/leads: atualização de timestamp e registro de alteração da etapa. Suas definições não fazem chamadas externas. Isso não audita jobs externos, Edge Functions, webhook da hospedagem ou todos os schemas. Não foram disparados ou desligados jobs.

Não existe outbox de venda, geração de assinatura, e-mail ou chamada financeira nesta implementação. `triggersNewSale` no output é classificação, não execução de automação. O histórico deve sempre tê-la falsa.

## Reclassificação do legado

Os campos técnicos foram reutilizados de `tools/finance-migration/schema.json`; nenhuma nova conferência integral da base real foi feita.

| Origem | Destino/conceito comercial | Regra |
| --- | --- | --- |
| `clients.id` | Referência de cliente existente/novo aprovado | Usar decisão de identidade; nunca combinar por nome |
| `private_loan_clients.id` | Referência de identidade da origem, domínio Financeiro | Não contar automaticamente como pessoa/venda distinta; conservar vínculos comprovados |
| `condominiums.id` | Referência de produto/empreendimento | Não equivale a negócio individual |
| `shares.id`, `client_id`, `condominium_id`, `acquisition_date` | Itens/rastreabilidade candidatos de negócio histórico | Cota não é contrato/venda; agrupamento, identidade e data efetiva precisam de evidência |
| Apurações, itens mensais, empréstimos/parcelas/pagamentos, remessas, logs e backups | Preservação integral da origem e entrega ao domínio de Fernando | Não transformar em vendas, quitações ou novas oportunidades |

`classifyHistory` entrega `pending`, `link_existing` ou `historical_completed`, sempre sem nova oportunidade, automação de venda ou atualização de posições. Falta de agrupamento contratual gera pendência, não contrato inventado. Não substitui data de fechamento pela data da migração. Sobreposição com posições já existentes nunca gera acréscimo patrimonial automático.

O SQL desta rodada só aceita outputs novos do CRM; publicação histórica no Supabase permanece bloqueada até aprovação de identidades, agrupamentos e evidências. Títulos Privados permanece previsto, sem expansão da operação financeira nem exclusão do legado. Relatórios individuais/correspondências continuam privados e não foram incorporados à branch.

## Testes e execução local

Com Node 24 e dependências do lockfile:

```powershell
node --test tests/commercial/*.test.mjs
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js .
node node_modules/next/dist/bin/next build --webpack
node node_modules/playwright/cli.js test --config tests/commercial/playwright.config.mjs
```

Os testes do domínio percorrem a jornada completa em repositório **somente de teste**. O navegador testa o formulário Next.js local: catálogo/recebimento são interceptados com dados sintéticos; o teste de indisponibilidade chama o handler real sem configuração Supabase. Não são ensaios PostgreSQL, JWT/RLS ou homologação ponta a ponta contra Supabase.

Os testes Python anteriores podem continuar executados localmente sem ampliar funcionalidades financeiras. Os ensaios SQL/JWT prévios continuam preservados, mas não validam os novos objetos. Resultados efetivos desta rodada estão em `docs/COMMERCIAL_TEST_RESULTS.md`.

## Decisões específicas restantes

1. Produto/rota de atendimento: aprovar quais produtos aceitam contato público, empresa válida e responsável ativo. Recomendação: liberar apenas rotas explicitamente revisadas, com catálogo mínimo. Impacto: sem rota não existe recebimento operacional.
2. Modelo contratual de cada produto: fornecer modelo aprovado/versionado, campos e documentos obrigatórios e exigência de assinatura. Recomendação: derivar do Jurídico, não usar a fixture sintética como exigência real. Impacto: sem aprovação a complementação/fechamento bloqueiam.
3. Evidência de formalização: atestado manual documentado do Jurídico ou integração já existente comprovada. Recomendação: confirmar o provedor/processo atual antes de adaptar qualquer integração; não criar integração paralela. Impacto: a referência textual sozinha não verifica assinatura digital.
4. Identidades e agrupamentos legados: aprovar vínculo e contrato real por grupo; quando não houver prova, manter pendente. Recomendação: não converter cotas em vendas nem somar posições já presentes. Impacto: histórico não publicável enquanto não houver comprovação.
5. Consumo e colaboração com Fernando: confirmar DTO v1, capacidades por empresa e os diretórios de responsabilidade. Recomendação: consumo somente leitura e deduplicação por negócio/versão; novas operações financeiras exclusivamente na branch dele. Impacto: evitar trabalho simultâneo e dupla contagem.
6. Recebimento público/antiabuso: limite por produto é apenas contenção global. Recomendação: revisar WAF/CAPTCHA/limite por origem e privacidade antes de habilitar a RPC anônima. Impacto: Origin no Next.js não impede chamadas diretas ao RPC ou abuso distribuído.

A arquitetura não está em discussão. Nenhuma destas decisões autoriza aplicação de migrations, carga real ou escrita remota nesta etapa.
