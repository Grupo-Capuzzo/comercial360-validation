# Integração em revisão, não publicada

Dependência imutável: PR #1, commit `95f3620ea39df745b3c24d40e311fe5a2e8a9b18`.
Ensaio anterior: https://github.com/bea44triz/comercial360-validation/actions/runs/37045041056
Resultado observado: 27 testes Python + 13 PostgreSQL, zero falhas/ignorados, PostgreSQL 17.11.

Esta branch preserva o CRM em andamento e acrescenta `/portal`, seleção de empresas,
`/comercial/[empresa]`, cinco consultas `/financeiro/[empresa]/[secao]` e APIs equivalentes.
Reutiliza login Supabase; não cria contas nem permite escrita financeira pelo navegador.
As telas diferenciam carregamento, ausência, permissão, erro e carga não realizada.
Valores monetários são texto decimal na API; a referência histórica não é saldo atual.

## Destino e decisões, sem dados identificáveis

Destino consultado somente em leitura: `umvldqzzliqmgkvoedyd`, `servopa-integrations`.
Agro, Civil e Saúde correspondem a produtos da empresa Grupo Capuzzo, não novas empresas.
Não existe empresa distinta com o nome Capuzzo Assessoria & Consultoria: decidir se é
apenas apresentação da empresa existente ou uma entidade separada antes da carga.
Correspondências privadas: 74 candidatos por documento validado e único, quatro
propostas de cadastro, quatro registros sem documento válido, quatro registros com
documento duplicado na origem. Nenhum vínculo aplicado. Vínculos exatos de origem
dessas tabelas não foram encontrados. Relatório identificável fica fora do GitHub.

## Fonte de verdade e projeções

O inventário campo a campo das 26 tabelas permanece em ../finance-migration/MAPPING.md.

| Origem | Destino/finalidade | Restrição |
|---|---|---|
| clients, private_loan_clients | clientes CRM aprovados e identificadores de origem; consulta clientes/vínculos | nunca criar login; documentos duplicados bloqueiam |
| condominiums | produtos CRM aprovados | não criar empresas automaticamente |
| shares | cotas históricas, vencimentos, renovações e retiradas nos detalhes preservados | posição CRM existente é referência, não inserção duplicada |
| monthly_calculations, monthly_calculation_items | apurações e histórico por lote/período | preservar resultados; não recalcular |
| private_loans | títulos e vinculos_titulos | cliente, produto, empresa e lote aprovados |
| private_loan_installments | parcelas históricas | conservar título, vencimento, valor e status |
| private_loan_payments, private_loan_amortizations, private_loan_extensions | eventos de recebimento/amortização/prorrogação | evento original não implica nova movimentação |
| private_loan_calculations_log | evidência privada de cálculo | não reprocessar histórico |
| bank_remittance_files, bank_remittance_items | evidência de remessa, sem emissão | gerada não significa paga |
| bank_configs | origem privada; futura configuração operacional revisada | não expor dados bancários na projeção |
| central_etapas, central_subetapas, central_tarefas | plano de ação, hierarquia original | autorização planejamento ainda não implementada |
| audit_logs, backups, email_logs | evidência privada, relatórios por lote | não disparar ações antigas |
| portal_* | referência privada; acesso novo via Supabase Auth | não importar senhas/sessões nem criar usuários |

`financeiro.registros_consulta` é projeção de leitura aprovada por empresa/origem/lote,
não livro de novas movimentações. `registros_lista` é security_invoker, sem acesso anon.
As cinco telas já têm serviços reais, mas o projetor completo das 26 tabelas para esta
projeção ainda precisa de implementação e validação; CI semeia linhas sintéticas.
Não somar projeção histórica às investment_positions nos dashboards. A correspondência
individual das posições existentes ainda não foi homologada. Consultas antigas do CRM
foram preservadas; não se declara seu isolamento completo entre empresas validado.

## Primeira carga: barreiras e recuperação

`prepare_load.py` gera proposta local sem conexão ou escrita remota. Exige destino,
ambiente, hash/lote, correspondências aprovadas, estruturas/quantidades e evidências
de simulação, reconciliação, efeitos e backup. Não modifica o guard do importador local.
Não há aprovação de carga nesta branch. Configuração e saída reais ficam fora do Git.

Backup operacional disponível ainda NÃO foi comprovado. Alternativa sem presumir
recurso pago: pg_dump consistente, criptografado, em área privada, incluindo schemas
afetados e dependências; ensaio de restauração em PostgreSQL privado isolado antes da
carga. Exige conexão autorizada e acesso suficiente; não foi executado remotamente.
Inventariar triggers, cron/jobs, webhooks e integrações antes de aprovar, sem desligar
serviços silenciosamente. Recuperação seletiva deve recusar linhas alteradas/referidas;
preservar snapshot antes/depois por lote e não apagar cadastros preexistentes.

Extração de 01/10/2026 é referência deste lote, não saldo atual. Corte e registros
posteriores dependem de conciliação final com Fernando. Não tratar saldo como evento.

## Escopo restante

Cadastro e edição financeiros, regras de novas apurações/movimentações, renovações,
retiradas, recebimentos, amortizações, relatórios, evidências de remessas e plano de
ação ainda não estão concluídos. Sem pagamento, remessa, email ou fallback SQLite.
DDL de revisão não foi aplicada no destino. RLS/JWT local não homologa políticas reais
do CRM, Hostinger, DNS, carga real ou integração publicada.

## CI

Workflow usa Ubuntu padrão, timeout 15 minutos, PostgreSQL 17 descartável, Supabase
local recém-inicializado, usuários sintéticos e JWT emitido pelo Auth real local.
40 regressões anteriores e oito testes browser; sem retries ou aceitação de skips.
Credencial administrativa local só prepara o banco; Next/browser recebem chave pública
e sessão de usuário. Lint, tipos e build são etapas obrigatórias. Resultados só são
considerados executados após consulta da execução real no GitHub Actions.
