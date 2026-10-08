# Primeira carga controlada — revisão, não autorização

Base de código validada: `dd36dc50e6fc6937ebf8f53ffcc4370875bd1586`.
Os 54 cenários anteriores (33 Python, 13 PostgreSQL e 8 navegador) pertencem a
essa versão, não aos componentes novos deste diretório.
Repositório oficial: `Grupo-Capuzzo/comercial360-validation`.
PRs [#1](https://github.com/Grupo-Capuzzo/comercial360-validation/pull/1) e
[#2](https://github.com/Grupo-Capuzzo/comercial360-validation/pull/2) permanecem
dependentes, sem merge. Trabalho seguinte: `codex/finance-first-load`, criada
exatamente a partir desse SHA. Esta rodada autoriza apenas código e ensaio sintético.

## Componentes executáveis

- `report_matches.py`: relatório privado de decisões; não aplica candidatos.
- `projection.py`: IDs explícitos, vínculos originais e valores preservados;
  cotas históricas não criam nem somam posições do CRM; remessas não viram pagamentos.
- `executor.py`: prévia, carga transacional, reconciliação, idempotência e
  recuperação seletiva. Divergências, extras, pendências e alteração de origem bloqueiam.
- `postgres_store.py`: adaptador PostgreSQL distinto da conexão local de testes;
  TLS verificando certificado/host, conexão direta ao projeto aprovado;
  hashes de estrutura, políticas, funções, jobs e linhas de referência;
  journal com imagem anterior e fingerprint integral após a gravação.
- `control.review.sql`: controle de lotes, correspondências, journal,
  relacionamentos e proteção de origem. SQL apenas preparado, não aplicado.
- `api_exposure.review.sql`: revisão separada da exposição dos dois schemas
  consultáveis; não é executada pelo importador e nunca expõe os schemas privados.
- `cli.py`: `plan` é leitura; `apply` e `recover` exigem aprovação privada e
  confirmação do digest. Não são executados em build, deploy ou import do módulo.

Arquivos com dados reais, correspondências, aprovação, backups e recibos devem
ficar fora de **qualquer checkout Git**. Não colocar credenciais em argumentos,
stdout, YAML ou frontend. `CAPUZZO_OPERATIONAL_DSN` pertence exclusivamente ao
processo privado de execução futura; não adicionar às variáveis `NEXT_PUBLIC_*`.
Nenhuma proteção de `tools/finance-migration/local_connection.py` foi removida.

## Contrato de aprovação privada

`matches`: `approved`, `project_ref`, `source_sha256`, `empresa_id`, `portal_name`,
`products` (ID condomínio → UUID produto), `loan_product_id`, `clients` e
`investment_policy={approved:true,mode:"historical_only",dashboard_authority:"existing_crm"}`.
Cada registro de cliente precisa de `table`, `source_id`, `approved`, `decision`
(`link`, `create` ou `hold`), `destination_cliente_id_global` e
`evidence_reference`; `hold` exige motivo e impede a carga integral.
`create` exige seed mínimo aprovado; nunca cria conta Auth.

`approval`: versão 1, ambiente operacional, identidade do projeto, aprovação
expressa e referência, revisores owner/financial_reviewer, source_system,
source_sha256, batch_id=`source_system:source_sha256`, reference_at,
matches_sha256, plan_sha256, schema_hashes, expected_conditions_sha256, expected_changes.
`evidence` exige cinco arquivos privados existentes, aprovados e com hashes:
backup, restore_test, effects_review, simulation e reconciliation.
Recibo presente/hash correto não prova seu conteúdo: a revisão humana deve
confirmar escopo, ambiente, data e resultado antes de marcar `approved`.

Não existe aprovação padrão embutida no código. O executor não transforma o
relatório de candidatos em decisões aprovadas. Identidade via API de gerenciamento
e certificado devem ser reconfirmados imediatamente antes da execução futura.
Conexão direta indisponível (por exemplo IPv6) é bloqueio: não usar pooler
ou reduzir TLS sem revisar explicitamente o adaptador e ensaiá-lo.

## Sequência futura exata

1. Resolver todos os vínculos; assinar empresa/produtos, política de cotas e corte.
2. Revisar DDLs e efeitos de sincronizações/integrações; aprovar janela curta.
3. Criar backup privado do destino com utilitários PostgreSQL compatíveis;
   registrar hash/escopo/hora e testar restauração em banco isolado autorizado.
   Não presumir PITR, plano pago ou restauração já disponível.
4. Executar ensaio PostgreSQL novo com dados sintéticos após autorização de CI.
5. Produzir correspondências **aprovadas** e aprovação preliminar em área privada.
6. `python tools/finance-first-load/cli.py --mode plan --source <copia.sqlite>
   --matches <correspondencias.json> --approval <proposta.json> --output <previa.json>`.
   Somente leitura; comparar condições, estruturas, registros, conflitos e totais.
7. Aprovar os hashes/quantidades/recibos exatos dessa prévia; nada pendente.
8. Sob autorização posterior da carga, executar o mesmo comando com
   `--mode apply --confirm APPLY:<digest-da-aprovacao>` e saída privada nova.
   Uma transação: locks → comparar condições → DDL aprovada → carga →
   journal → constraints → reconciliação → nova checagem da origem → commit.
9. Conferir recibo privado e ledger; divergência aborta antes do commit.
   Erro ao escrever recibo depois do commit não significa rollback: consultar ledger.
10. Liberar consultas somente a usuários Auth existentes explicitamente autorizados
    por empresa/módulo, sem criação de usuários ou permissões automática pela carga.

## Recuperação

Falha antes de commit: rollback de dados **e DDL** da transação.
Após commit: `--mode recover --confirm RECOVER:<digest>:<batch_id>` com mesmos
arquivos aprovados. Só remove linhas criadas pelo lote e restaura estado alterado
do próprio lote. Mantém metadados e journal; bloqueia se qualquer linha mudou
ou ganhou referência externa. Não executa DROP/TRUNCATE nem restaura banco
inteiro sobre o CRM. Esquemas criados ficam vazios/protegidos após recuperação.
Backup é proteção adicional e material para recuperação manual seletiva;
restaurar em instância isolada e comparar, nunca sobrescrever o CRM operacional.

## Limites funcionais

Cinco consultas atuais recebem histórico: clientes, cotas, apurações, títulos
e parcelas. Remessas, plano de ação, recebimentos e renovações têm projeção
separada. Outros registros permanecem privados, sem exposição ao navegador.
Quantidades e decisões da origem real ficam somente nos relatórios privados,
fora deste repositório e dos artefatos de CI.
Controles, relacionamentos e links não são novos clientes ou novos investimentos.

Não há novas posições CRM; as posições existentes permanecem intocadas.
Correspondência cota individual ↔
posição agregada não está comprovada. Não haverá soma ao saldo atual.
Operações financeiras de escrita, apurações novas, retiradas, amortizações,
emissão/envio de remessas, pagamento, exportação bancária e e-mails seguem
indisponíveis até implementação/revisão própria. Extração não inclui eventos
posteriores a 01/10/2026. Autorização e reconciliação de produção estão pendentes.

A exposição futura de API exige revisão explícita de configuração e acesso;
acrescentar apenas `portal_acesso` e `financeiro` depois de revisar RLS/grants.
O SQL separado falha se essa configuração mudar e não é aplicado pela carga;
se a configuração gerenciada do projeto for autoritativa, usar o painel Data API,
preservando todos os schemas atuais. Nenhuma configuração foi alterada.
Sem essa etapa e permissões aprovadas, as cinco consultas não funcionarão no
destino real. API/SSR/JWT do destino não foram homologados por esta preparação.

`src/services/portal.service.ts` mantém `.limit(500)`: conjuntos maiores não são
exibidos integralmente na listagem inicial.
Busca por identificador permite consultas filtradas; paginação completa e busca
cadastral legível exigem ajuste próprio de UI/API e ensaio de navegador posterior.
Não alterar a versão validada silenciosamente. Esta carga não homologa Financeiro
completo nem cobre funcionalidades de escrita.

## Colaboração sem sobreposição

Agente: `tools/finance-first-load/**` e futuro workflow exclusivo desses ensaios;
não edita o CRM, UI, correspondências aprovadas pelo revisor ou PRs anteriores.
Fernando: branch própria a partir do SHA validado; revisão financeira,
correspondências e regra de corte em documentos privados fora do Git.
Não alterar simultaneamente os scripts desta branch; combinar qualquer mudança
de regras/campos antes da implementação. GitHub de Fernando não foi confirmado;
nenhum convite ou atribuição de CODEOWNERS foi realizado.

## Evidências e execução local

`python -m unittest discover -s tools/finance-first-load -p 'test_*.py' -v`
executa somente testes unitários sintéticos; `MemoryStore` não é PostgreSQL.
Última execução local: 47 novos testes + 33 regressões existentes = 80 aprovados,
sem falhas, erros ou ignorados. Novos testes PostgreSQL preparados: 15;
regressões PostgreSQL previstas: 13; verificação adicional de dump/restore
sintético. Nenhum desses ensaios PostgreSQL novos foi executado nesta etapa.
Sementes de cadastro aceitam CPF/CNPJ numérico com dígitos verificadores;
formatos documentais diferentes bloqueiam e exigem revisão explícita, não limpeza
silenciosa. WAL não vazio bloqueia aprovação por hash só do arquivo principal;
não altera ou faz checkpoint da origem. O plano completo de valores/IDs também
tem hash aprovado, além do hash da origem, contagens e condições atuais.
`postgres_rehearsal.py` exige PostgreSQL 17 local explicitamente marcado e falha
se indisponível. Não valida Supabase JWT/SSR, apenas identidade SQL sintética.
Não há PostgreSQL/Docker/psql/psycopg disponíveis neste host no diagnóstico desta
etapa; ensaio PostgreSQL novo e restauração real ainda não foram executados.
Não reutilizar o verde dos 54 cenários como resultado dos novos componentes.
