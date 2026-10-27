# Mapeamento técnico para revisão

Este documento contém somente estrutura. Nenhum registro, total financeiro real ou manifesto é versionado. O destino proposto `financeiro_origem` é uma camada privada de fidelidade e conferência no Postgres; não substitui a modelagem operacional/API e não tem grants para navegador. O namespace é proposto, ainda não aplicado. `api_comercial` e `comercial_360` existentes permanecem intactos.

Chave estável: `source_system` + tabela + PK original. `lote_id` identifica o snapshot/hash separadamente. IDs bigint/text preservados. REAL → numeric via Decimal(str(valor)), sem arredondamento na carga; o SQLite original preserva a representação binária. TEXT → text sem trim/normalização, inclusive datas, fusos, vazio e NULL. INTEGER → bigint. Datas operacionais tipadas serão derivadas apenas após classificar formatos e aprovar fuso; histórico textual permanece disponível. Nenhum saldo será convertido em nova movimentação.

| Origem | Destino proposto | Chave | Validação / pendência |
|---|---|---|---|
| audit_logs | financeiro_origem.audit_logs | source_system + id | Contagem, fingerprint de todas as colunas e FKs; manter histórico. |
| backups | financeiro_origem.backups | source_system + id | Metadados apenas; arquivos externos pendentes. |
| bank_configs | financeiro_origem.bank_configs | source_system + id | Sem remessa/pagamento automático; included/skipped e caminhos originais preservados. |
| bank_remittance_files | financeiro_origem.bank_remittance_files | source_system + id | Sem remessa/pagamento automático; included/skipped e caminhos originais preservados. |
| bank_remittance_items | financeiro_origem.bank_remittance_items | source_system + id | Sem remessa/pagamento automático; included/skipped e caminhos originais preservados. |
| central_etapas | financeiro_origem.central_etapas | source_system + id | Manter hierarquia completa; acesso ao planejamento por autorização específica. |
| central_subetapas | financeiro_origem.central_subetapas | source_system + id | Manter hierarquia completa; acesso ao planejamento por autorização específica. |
| central_tarefas | financeiro_origem.central_tarefas | source_system + id | Manter hierarquia completa; acesso ao planejamento por autorização específica. |
| clients | financeiro_origem.clients | source_system + id | Identidade CRM pendente: identificador de origem existente primeiro; documento validado único somente como candidato, nunca nome. |
| condominiums | financeiro_origem.condominiums | source_system + id | Contagem, fingerprint de todas as colunas e FKs; manter histórico. |
| email_logs | financeiro_origem.email_logs | source_system + id | Histórico inerte; nunca reenviar sent/draft_created/error. |
| monthly_calculation_items | financeiro_origem.monthly_calculation_items | source_system + id | Contagem, fingerprint de todas as colunas e FKs; manter histórico. |
| monthly_calculations | financeiro_origem.monthly_calculations | source_system + id | Contagem, fingerprint de todas as colunas e FKs; manter histórico. |
| portal_empresa_status | financeiro_origem.portal_empresa_status | source_system + slug | Tabela vazia preservada; mapear slug à empresa existente, sem criar empresas por condomínio. |
| portal_favoritos | financeiro_origem.portal_favoritos | source_system + usuario_id + empresa_slug | Vazia intencionalmente; zero importação. Auth/vínculos substituem o legado; nunca importar senha_hash. |
| portal_login_tentativas | financeiro_origem.portal_login_tentativas | source_system + id | Vazia intencionalmente; zero importação. Auth/vínculos substituem o legado; nunca importar senha_hash. |
| portal_usuario_empresas | financeiro_origem.portal_usuario_empresas | source_system + usuario_id + empresa_slug | Vazia intencionalmente; zero importação. Auth/vínculos substituem o legado; nunca importar senha_hash. |
| portal_usuarios | financeiro_origem.portal_usuarios | source_system + id | Vazia intencionalmente; zero importação. Auth/vínculos substituem o legado; nunca importar senha_hash. |
| private_loan_amortizations | financeiro_origem.private_loan_amortizations | source_system + id | Contagem, fingerprint de todas as colunas e FKs; manter histórico. |
| private_loan_calculations_log | financeiro_origem.private_loan_calculations_log | source_system + id | Contagem, fingerprint de todas as colunas e FKs; manter histórico. |
| private_loan_clients | financeiro_origem.private_loan_clients | source_system + id | linked_client_id preservado; não somar como pessoas novas. |
| private_loan_extensions | financeiro_origem.private_loan_extensions | source_system + id | Contagem, fingerprint de todas as colunas e FKs; manter histórico. |
| private_loan_installments | financeiro_origem.private_loan_installments | source_system + id | Contagem, fingerprint de todas as colunas e FKs; manter histórico. |
| private_loan_payments | financeiro_origem.private_loan_payments | source_system + id | Contagem, fingerprint de todas as colunas e FKs; manter histórico. |
| private_loans | financeiro_origem.private_loans | source_system + id | loan_number vazio não é chave; preservar PK. |
| shares | financeiro_origem.shares | source_system + id | Contagem, fingerprint de todas as colunas e FKs; manter histórico. |

## Campos e relacionamentos

### audit_logs

| Campo origem | Campo destino | Conversão |
|---|---|---|
| id | financeiro_origem.audit_logs.id | bigint |
| entity_type | financeiro_origem.audit_logs.entity_type | text, valor exato |
| entity_id | financeiro_origem.audit_logs.entity_id | bigint |
| action | financeiro_origem.audit_logs.action | text, valor exato |
| old_value | financeiro_origem.audit_logs.old_value | text, valor exato |
| new_value | financeiro_origem.audit_logs.new_value | text, valor exato |
| created_at | financeiro_origem.audit_logs.created_at | text, valor exato |
| user_note | financeiro_origem.audit_logs.user_note | text, valor exato |

### backups

| Campo origem | Campo destino | Conversão |
|---|---|---|
| id | financeiro_origem.backups.id | bigint |
| file_name | financeiro_origem.backups.file_name | text, valor exato |
| file_path | financeiro_origem.backups.file_path | text, valor exato |
| created_at | financeiro_origem.backups.created_at | text, valor exato |
| reason | financeiro_origem.backups.reason | text, valor exato |

### bank_configs

| Campo origem | Campo destino | Conversão |
|---|---|---|
| id | financeiro_origem.bank_configs.id | bigint |
| bank_code | financeiro_origem.bank_configs.bank_code | text, valor exato |
| bank_name | financeiro_origem.bank_configs.bank_name | text, valor exato |
| company_name | financeiro_origem.bank_configs.company_name | text, valor exato |
| company_document | financeiro_origem.bank_configs.company_document | text, valor exato |
| agency | financeiro_origem.bank_configs.agency | text, valor exato |
| agency_digit | financeiro_origem.bank_configs.agency_digit | text, valor exato |
| account_number | financeiro_origem.bank_configs.account_number | text, valor exato |
| account_digit | financeiro_origem.bank_configs.account_digit | text, valor exato |
| address_street | financeiro_origem.bank_configs.address_street | text, valor exato |
| address_number | financeiro_origem.bank_configs.address_number | text, valor exato |
| address_complement | financeiro_origem.bank_configs.address_complement | text, valor exato |
| city | financeiro_origem.bank_configs.city | text, valor exato |
| zip_code | financeiro_origem.bank_configs.zip_code | text, valor exato |
| state | financeiro_origem.bank_configs.state | text, valor exato |
| remittance_sequence | financeiro_origem.bank_configs.remittance_sequence | bigint |
| active | financeiro_origem.bank_configs.active | bigint |
| created_at | financeiro_origem.bank_configs.created_at | text, valor exato |
| updated_at | financeiro_origem.bank_configs.updated_at | text, valor exato |
| agreement_code | financeiro_origem.bank_configs.agreement_code | text, valor exato |

### bank_remittance_files

| Campo origem | Campo destino | Conversão |
|---|---|---|
| id | financeiro_origem.bank_remittance_files.id | bigint |
| calculation_id | financeiro_origem.bank_remittance_files.calculation_id | bigint |
| condominium_code | financeiro_origem.bank_remittance_files.condominium_code | text, valor exato |
| bank_code | financeiro_origem.bank_remittance_files.bank_code | text, valor exato |
| bank_name | financeiro_origem.bank_remittance_files.bank_name | text, valor exato |
| file_name | financeiro_origem.bank_remittance_files.file_name | text, valor exato |
| file_path | financeiro_origem.bank_remittance_files.file_path | text, valor exato |
| conference_file_path | financeiro_origem.bank_remittance_files.conference_file_path | text, valor exato |
| payment_date | financeiro_origem.bank_remittance_files.payment_date | text, valor exato |
| total_amount | financeiro_origem.bank_remittance_files.total_amount | numeric, sem arredondar |
| total_payments | financeiro_origem.bank_remittance_files.total_payments | bigint |
| status | financeiro_origem.bank_remittance_files.status | text, valor exato |
| created_at | financeiro_origem.bank_remittance_files.created_at | text, valor exato |
| notes | financeiro_origem.bank_remittance_files.notes | text, valor exato |

- bank_remittance_files.calculation_id → monthly_calculations.id (inclui source_system, FK diferida).
### bank_remittance_items

| Campo origem | Campo destino | Conversão |
|---|---|---|
| id | financeiro_origem.bank_remittance_items.id | bigint |
| remittance_file_id | financeiro_origem.bank_remittance_items.remittance_file_id | bigint |
| calculation_item_id | financeiro_origem.bank_remittance_items.calculation_item_id | bigint |
| client_id | financeiro_origem.bank_remittance_items.client_id | bigint |
| client_name | financeiro_origem.bank_remittance_items.client_name | text, valor exato |
| client_document | financeiro_origem.bank_remittance_items.client_document | text, valor exato |
| pix_key | financeiro_origem.bank_remittance_items.pix_key | text, valor exato |
| pix_key_type | financeiro_origem.bank_remittance_items.pix_key_type | text, valor exato |
| amount | financeiro_origem.bank_remittance_items.amount | numeric, sem arredondar |
| status | financeiro_origem.bank_remittance_items.status | text, valor exato |
| notes | financeiro_origem.bank_remittance_items.notes | text, valor exato |

- bank_remittance_items.client_id → clients.id (inclui source_system, FK diferida).
- bank_remittance_items.remittance_file_id → bank_remittance_files.id (inclui source_system, FK diferida).
### central_etapas

| Campo origem | Campo destino | Conversão |
|---|---|---|
| id | financeiro_origem.central_etapas.id | text, valor exato |
| tarefa_id | financeiro_origem.central_etapas.tarefa_id | text, valor exato |
| ordem | financeiro_origem.central_etapas.ordem | bigint |
| nome | financeiro_origem.central_etapas.nome | text, valor exato |
| responsavel | financeiro_origem.central_etapas.responsavel | text, valor exato |
| prazo | financeiro_origem.central_etapas.prazo | text, valor exato |
| percentual | financeiro_origem.central_etapas.percentual | bigint |
| observacoes | financeiro_origem.central_etapas.observacoes | text, valor exato |

### central_subetapas

| Campo origem | Campo destino | Conversão |
|---|---|---|
| id | financeiro_origem.central_subetapas.id | text, valor exato |
| etapa_id | financeiro_origem.central_subetapas.etapa_id | text, valor exato |
| ordem | financeiro_origem.central_subetapas.ordem | bigint |
| nome | financeiro_origem.central_subetapas.nome | text, valor exato |
| feito | financeiro_origem.central_subetapas.feito | bigint |
| prazo | financeiro_origem.central_subetapas.prazo | text, valor exato |
| concluido_em | financeiro_origem.central_subetapas.concluido_em | text, valor exato |

### central_tarefas

| Campo origem | Campo destino | Conversão |
|---|---|---|
| id | financeiro_origem.central_tarefas.id | text, valor exato |
| titulo | financeiro_origem.central_tarefas.titulo | text, valor exato |
| responsavel | financeiro_origem.central_tarefas.responsavel | text, valor exato |
| prazo_total | financeiro_origem.central_tarefas.prazo_total | text, valor exato |
| status | financeiro_origem.central_tarefas.status | text, valor exato |
| descricao | financeiro_origem.central_tarefas.descricao | text, valor exato |
| criado_em | financeiro_origem.central_tarefas.criado_em | text, valor exato |
| atualizado_em | financeiro_origem.central_tarefas.atualizado_em | text, valor exato |
| prioridade | financeiro_origem.central_tarefas.prioridade | text, valor exato |

### clients

| Campo origem | Campo destino | Conversão |
|---|---|---|
| id | financeiro_origem.clients.id | bigint |
| cpf | financeiro_origem.clients.cpf | text, valor exato |
| full_name | financeiro_origem.clients.full_name | text, valor exato |
| email | financeiro_origem.clients.email | text, valor exato |
| pix_key | financeiro_origem.clients.pix_key | text, valor exato |
| phone | financeiro_origem.clients.phone | text, valor exato |
| status | financeiro_origem.clients.status | text, valor exato |
| notes | financeiro_origem.clients.notes | text, valor exato |
| created_at | financeiro_origem.clients.created_at | text, valor exato |
| updated_at | financeiro_origem.clients.updated_at | text, valor exato |
| bank_name | financeiro_origem.clients.bank_name | text, valor exato |
| bank_agency | financeiro_origem.clients.bank_agency | text, valor exato |
| bank_account | financeiro_origem.clients.bank_account | text, valor exato |
| bank_account_digit | financeiro_origem.clients.bank_account_digit | text, valor exato |
| bank_account_type | financeiro_origem.clients.bank_account_type | text, valor exato |
| bank_holder_name | financeiro_origem.clients.bank_holder_name | text, valor exato |
| bank_holder_document | financeiro_origem.clients.bank_holder_document | text, valor exato |
| bank_notes | financeiro_origem.clients.bank_notes | text, valor exato |

### condominiums

| Campo origem | Campo destino | Conversão |
|---|---|---|
| id | financeiro_origem.condominiums.id | bigint |
| name | financeiro_origem.condominiums.name | text, valor exato |
| code | financeiro_origem.condominiums.code | text, valor exato |
| default_monthly_rate | financeiro_origem.condominiums.default_monthly_rate | numeric, sem arredondar |
| payment_day | financeiro_origem.condominiums.payment_day | bigint |
| accrual_start_day | financeiro_origem.condominiums.accrual_start_day | bigint |
| accrual_end_day | financeiro_origem.condominiums.accrual_end_day | bigint |
| active | financeiro_origem.condominiums.active | bigint |

### email_logs

| Campo origem | Campo destino | Conversão |
|---|---|---|
| id | financeiro_origem.email_logs.id | bigint |
| client_id | financeiro_origem.email_logs.client_id | bigint |
| condominium_code | financeiro_origem.email_logs.condominium_code | text, valor exato |
| reference_year | financeiro_origem.email_logs.reference_year | bigint |
| reference_month | financeiro_origem.email_logs.reference_month | bigint |
| to_email | financeiro_origem.email_logs.to_email | text, valor exato |
| subject | financeiro_origem.email_logs.subject | text, valor exato |
| body | financeiro_origem.email_logs.body | text, valor exato |
| gmail_draft_id | financeiro_origem.email_logs.gmail_draft_id | text, valor exato |
| gmail_message_id | financeiro_origem.email_logs.gmail_message_id | text, valor exato |
| status | financeiro_origem.email_logs.status | text, valor exato |
| created_at | financeiro_origem.email_logs.created_at | text, valor exato |
| notes | financeiro_origem.email_logs.notes | text, valor exato |

- email_logs.client_id → clients.id (inclui source_system, FK diferida).
### monthly_calculation_items

| Campo origem | Campo destino | Conversão |
|---|---|---|
| id | financeiro_origem.monthly_calculation_items.id | bigint |
| monthly_calculation_id | financeiro_origem.monthly_calculation_items.monthly_calculation_id | bigint |
| share_id | financeiro_origem.monthly_calculation_items.share_id | bigint |
| client_id | financeiro_origem.monthly_calculation_items.client_id | bigint |
| condominium_id | financeiro_origem.monthly_calculation_items.condominium_id | bigint |
| period_start | financeiro_origem.monthly_calculation_items.period_start | text, valor exato |
| period_end | financeiro_origem.monthly_calculation_items.period_end | text, valor exato |
| active_days | financeiro_origem.monthly_calculation_items.active_days | bigint |
| total_period_days | financeiro_origem.monthly_calculation_items.total_period_days | bigint |
| applied_rate | financeiro_origem.monthly_calculation_items.applied_rate | numeric, sem arredondar |
| share_value | financeiro_origem.monthly_calculation_items.share_value | numeric, sem arredondar |
| income_value | financeiro_origem.monthly_calculation_items.income_value | numeric, sem arredondar |
| calculation_details | financeiro_origem.monthly_calculation_items.calculation_details | text, valor exato |

- monthly_calculation_items.condominium_id → condominiums.id (inclui source_system, FK diferida).
- monthly_calculation_items.client_id → clients.id (inclui source_system, FK diferida).
- monthly_calculation_items.share_id → shares.id (inclui source_system, FK diferida).
- monthly_calculation_items.monthly_calculation_id → monthly_calculations.id (inclui source_system, FK diferida).
### monthly_calculations

| Campo origem | Campo destino | Conversão |
|---|---|---|
| id | financeiro_origem.monthly_calculations.id | bigint |
| calculation_month | financeiro_origem.monthly_calculations.calculation_month | bigint |
| calculation_year | financeiro_origem.monthly_calculations.calculation_year | bigint |
| condominium_id | financeiro_origem.monthly_calculations.condominium_id | bigint |
| agro_special_rate | financeiro_origem.monthly_calculations.agro_special_rate | numeric, sem arredondar |
| calculated_at | financeiro_origem.monthly_calculations.calculated_at | text, valor exato |
| notes | financeiro_origem.monthly_calculations.notes | text, valor exato |

- monthly_calculations.condominium_id → condominiums.id (inclui source_system, FK diferida).
### portal_empresa_status

| Campo origem | Campo destino | Conversão |
|---|---|---|
| slug | financeiro_origem.portal_empresa_status.slug | text, valor exato |
| status | financeiro_origem.portal_empresa_status.status | text, valor exato |
| obs | financeiro_origem.portal_empresa_status.obs | text, valor exato |

### portal_favoritos

| Campo origem | Campo destino | Conversão |
|---|---|---|
| usuario_id | financeiro_origem.portal_favoritos.usuario_id | bigint |
| empresa_slug | financeiro_origem.portal_favoritos.empresa_slug | text, valor exato |

### portal_login_tentativas

| Campo origem | Campo destino | Conversão |
|---|---|---|
| id | financeiro_origem.portal_login_tentativas.id | bigint |
| email | financeiro_origem.portal_login_tentativas.email | text, valor exato |
| momento | financeiro_origem.portal_login_tentativas.momento | text, valor exato |
| sucesso | financeiro_origem.portal_login_tentativas.sucesso | bigint |

### portal_usuario_empresas

| Campo origem | Campo destino | Conversão |
|---|---|---|
| usuario_id | financeiro_origem.portal_usuario_empresas.usuario_id | bigint |
| empresa_slug | financeiro_origem.portal_usuario_empresas.empresa_slug | text, valor exato |

### portal_usuarios

| Campo origem | Campo destino | Conversão |
|---|---|---|
| id | financeiro_origem.portal_usuarios.id | bigint |
| nome | financeiro_origem.portal_usuarios.nome | text, valor exato |
| email | financeiro_origem.portal_usuarios.email | text, valor exato |
| senha_hash | financeiro_origem.portal_usuarios.senha_hash | text, valor exato; não importar |
| perfil | financeiro_origem.portal_usuarios.perfil | text, valor exato |
| ativo | financeiro_origem.portal_usuarios.ativo | bigint |
| criado_em | financeiro_origem.portal_usuarios.criado_em | text, valor exato |
| ultimo_login | financeiro_origem.portal_usuarios.ultimo_login | text, valor exato |

### private_loan_amortizations

| Campo origem | Campo destino | Conversão |
|---|---|---|
| id | financeiro_origem.private_loan_amortizations.id | bigint |
| loan_id | financeiro_origem.private_loan_amortizations.loan_id | bigint |
| payment_date | financeiro_origem.private_loan_amortizations.payment_date | text, valor exato |
| amount | financeiro_origem.private_loan_amortizations.amount | numeric, sem arredondar |
| amortization_type | financeiro_origem.private_loan_amortizations.amortization_type | text, valor exato |
| applied_to | financeiro_origem.private_loan_amortizations.applied_to | text, valor exato |
| notes | financeiro_origem.private_loan_amortizations.notes | text, valor exato |
| created_at | financeiro_origem.private_loan_amortizations.created_at | text, valor exato |
| installment_id | financeiro_origem.private_loan_amortizations.installment_id | bigint |
| target_mode | financeiro_origem.private_loan_amortizations.target_mode | text, valor exato |
| price_action | financeiro_origem.private_loan_amortizations.price_action | text, valor exato |
| amount_before | financeiro_origem.private_loan_amortizations.amount_before | numeric, sem arredondar |
| amount_after | financeiro_origem.private_loan_amortizations.amount_after | numeric, sem arredondar |
| recalculated_schedule_json | financeiro_origem.private_loan_amortizations.recalculated_schedule_json | text, valor exato |

- private_loan_amortizations.installment_id → private_loan_installments.id (inclui source_system, FK diferida).
- private_loan_amortizations.loan_id → private_loans.id (inclui source_system, FK diferida).
### private_loan_calculations_log

| Campo origem | Campo destino | Conversão |
|---|---|---|
| id | financeiro_origem.private_loan_calculations_log.id | bigint |
| loan_id | financeiro_origem.private_loan_calculations_log.loan_id | bigint |
| calculation_date | financeiro_origem.private_loan_calculations_log.calculation_date | text, valor exato |
| base_date | financeiro_origem.private_loan_calculations_log.base_date | text, valor exato |
| base_amount | financeiro_origem.private_loan_calculations_log.base_amount | numeric, sem arredondar |
| days_overdue | financeiro_origem.private_loan_calculations_log.days_overdue | bigint |
| monthly_rate | financeiro_origem.private_loan_calculations_log.monthly_rate | numeric, sem arredondar |
| daily_rate | financeiro_origem.private_loan_calculations_log.daily_rate | numeric, sem arredondar |
| calculated_amount | financeiro_origem.private_loan_calculations_log.calculated_amount | numeric, sem arredondar |
| calculation_details | financeiro_origem.private_loan_calculations_log.calculation_details | text, valor exato |
| created_at | financeiro_origem.private_loan_calculations_log.created_at | text, valor exato |

- private_loan_calculations_log.loan_id → private_loans.id (inclui source_system, FK diferida).
### private_loan_clients

| Campo origem | Campo destino | Conversão |
|---|---|---|
| id | financeiro_origem.private_loan_clients.id | bigint |
| linked_client_id | financeiro_origem.private_loan_clients.linked_client_id | bigint |
| name | financeiro_origem.private_loan_clients.name | text, valor exato |
| document | financeiro_origem.private_loan_clients.document | text, valor exato |
| email | financeiro_origem.private_loan_clients.email | text, valor exato |
| phone | financeiro_origem.private_loan_clients.phone | text, valor exato |
| pix_key | financeiro_origem.private_loan_clients.pix_key | text, valor exato |
| notes | financeiro_origem.private_loan_clients.notes | text, valor exato |
| status | financeiro_origem.private_loan_clients.status | text, valor exato |
| created_at | financeiro_origem.private_loan_clients.created_at | text, valor exato |
| updated_at | financeiro_origem.private_loan_clients.updated_at | text, valor exato |

- private_loan_clients.linked_client_id → clients.id (inclui source_system, FK diferida).
### private_loan_extensions

| Campo origem | Campo destino | Conversão |
|---|---|---|
| id | financeiro_origem.private_loan_extensions.id | bigint |
| loan_id | financeiro_origem.private_loan_extensions.loan_id | bigint |
| reference_date | financeiro_origem.private_loan_extensions.reference_date | text, valor exato |
| paid_date | financeiro_origem.private_loan_extensions.paid_date | text, valor exato |
| extension_amount | financeiro_origem.private_loan_extensions.extension_amount | numeric, sem arredondar |
| covered_until_date | financeiro_origem.private_loan_extensions.covered_until_date | text, valor exato |
| principal_kept_amount | financeiro_origem.private_loan_extensions.principal_kept_amount | numeric, sem arredondar |
| notes | financeiro_origem.private_loan_extensions.notes | text, valor exato |
| created_at | financeiro_origem.private_loan_extensions.created_at | text, valor exato |

- private_loan_extensions.loan_id → private_loans.id (inclui source_system, FK diferida).
### private_loan_installments

| Campo origem | Campo destino | Conversão |
|---|---|---|
| id | financeiro_origem.private_loan_installments.id | bigint |
| loan_id | financeiro_origem.private_loan_installments.loan_id | bigint |
| installment_number | financeiro_origem.private_loan_installments.installment_number | bigint |
| due_date | financeiro_origem.private_loan_installments.due_date | text, valor exato |
| principal_amount | financeiro_origem.private_loan_installments.principal_amount | numeric, sem arredondar |
| interest_amount | financeiro_origem.private_loan_installments.interest_amount | numeric, sem arredondar |
| installment_amount | financeiro_origem.private_loan_installments.installment_amount | numeric, sem arredondar |
| paid_amount | financeiro_origem.private_loan_installments.paid_amount | numeric, sem arredondar |
| paid_date | financeiro_origem.private_loan_installments.paid_date | text, valor exato |
| status | financeiro_origem.private_loan_installments.status | text, valor exato |
| notes | financeiro_origem.private_loan_installments.notes | text, valor exato |
| created_at | financeiro_origem.private_loan_installments.created_at | text, valor exato |
| updated_at | financeiro_origem.private_loan_installments.updated_at | text, valor exato |

- private_loan_installments.loan_id → private_loans.id (inclui source_system, FK diferida).
### private_loan_payments

| Campo origem | Campo destino | Conversão |
|---|---|---|
| id | financeiro_origem.private_loan_payments.id | bigint |
| loan_id | financeiro_origem.private_loan_payments.loan_id | bigint |
| installment_id | financeiro_origem.private_loan_payments.installment_id | bigint |
| payment_date | financeiro_origem.private_loan_payments.payment_date | text, valor exato |
| amount | financeiro_origem.private_loan_payments.amount | numeric, sem arredondar |
| payment_type | financeiro_origem.private_loan_payments.payment_type | text, valor exato |
| notes | financeiro_origem.private_loan_payments.notes | text, valor exato |
| created_at | financeiro_origem.private_loan_payments.created_at | text, valor exato |

- private_loan_payments.installment_id → private_loan_installments.id (inclui source_system, FK diferida).
- private_loan_payments.loan_id → private_loans.id (inclui source_system, FK diferida).
### private_loans

| Campo origem | Campo destino | Conversão |
|---|---|---|
| id | financeiro_origem.private_loans.id | bigint |
| private_client_id | financeiro_origem.private_loans.private_client_id | bigint |
| linked_client_id | financeiro_origem.private_loans.linked_client_id | bigint |
| loan_number | financeiro_origem.private_loans.loan_number | text, valor exato |
| original_amount | financeiro_origem.private_loans.original_amount | numeric, sem arredondar |
| contracted_amount | financeiro_origem.private_loans.contracted_amount | numeric, sem arredondar |
| interest_rate_monthly | financeiro_origem.private_loans.interest_rate_monthly | numeric, sem arredondar |
| interest_rate_daily | financeiro_origem.private_loans.interest_rate_daily | numeric, sem arredondar |
| interest_type | financeiro_origem.private_loans.interest_type | text, valor exato |
| calculation_method | financeiro_origem.private_loans.calculation_method | text, valor exato |
| start_date | financeiro_origem.private_loans.start_date | text, valor exato |
| first_due_date | financeiro_origem.private_loans.first_due_date | text, valor exato |
| final_due_date | financeiro_origem.private_loans.final_due_date | text, valor exato |
| installments_count | financeiro_origem.private_loans.installments_count | bigint |
| installment_amount | financeiro_origem.private_loans.installment_amount | numeric, sem arredondar |
| status | financeiro_origem.private_loans.status | text, valor exato |
| notes | financeiro_origem.private_loans.notes | text, valor exato |
| created_at | financeiro_origem.private_loans.created_at | text, valor exato |
| updated_at | financeiro_origem.private_loans.updated_at | text, valor exato |

- private_loans.linked_client_id → clients.id (inclui source_system, FK diferida).
- private_loans.private_client_id → private_loan_clients.id (inclui source_system, FK diferida).
### shares

| Campo origem | Campo destino | Conversão |
|---|---|---|
| id | financeiro_origem.shares.id | bigint |
| condominium_id | financeiro_origem.shares.condominium_id | bigint |
| client_id | financeiro_origem.shares.client_id | bigint |
| share_number | financeiro_origem.shares.share_number | text, valor exato |
| share_value | financeiro_origem.shares.share_value | numeric, sem arredondar |
| acquisition_date | financeiro_origem.shares.acquisition_date | text, valor exato |
| maturity_date | financeiro_origem.shares.maturity_date | text, valor exato |
| status | financeiro_origem.shares.status | text, valor exato |
| last_renewal_date | financeiro_origem.shares.last_renewal_date | text, valor exato |
| withdrawal_date | financeiro_origem.shares.withdrawal_date | text, valor exato |
| notes | financeiro_origem.shares.notes | text, valor exato |
| created_at | financeiro_origem.shares.created_at | text, valor exato |
| updated_at | financeiro_origem.shares.updated_at | text, valor exato |
| withdrawal_requested | financeiro_origem.shares.withdrawal_requested | bigint |
| withdrawal_request_date | financeiro_origem.shares.withdrawal_request_date | text, valor exato |
| withdrawal_effective_date | financeiro_origem.shares.withdrawal_effective_date | text, valor exato |
| withdrawal_notes | financeiro_origem.shares.withdrawal_notes | text, valor exato |
| accrual_until_withdrawal | financeiro_origem.shares.accrual_until_withdrawal | bigint |

- shares.client_id → clients.id (inclui source_system, FK diferida).
- shares.condominium_id → condominiums.id (inclui source_system, FK diferida).

Relações adicionais verificadas e previstas na DDL: central_etapas.tarefa_id → central_tarefas.id; central_subetapas.etapa_id → central_etapas.id; bank_remittance_items.calculation_item_id → monthly_calculation_items.id. Audit_logs.entity_type/entity_id é polimórfico: resolver sem inventar FK universal. Conferir consistência semântica de empréstimo/parcela e condomínio/apuração também após a carga.

## Destino consultado

Projeto confirmado pela conexão do CRM e MCP: servopa-integrations, umvldqzzliqmgkvoedyd, PostgreSQL 17. Existem comercial_360.clientes (cliente_id_global UUID, cpf_cnpj_normalizado text), cliente_identificadores (sistema_origem/tabela_origem/identificador_origem), empresas (empresa_id UUID), produtos e investimento_posicoes. api_comercial expõe consultas do CRM. Não encontramos namespaces portal/financeiro nem tabelas detalhadas por padrões de condomínios/empréstimos/remessas na consulta de catálogo. Isso não comprova ausência de dados correlatos em outras estruturas.

Correspondência com CRM: primeiro vínculo estável já aprovado em cliente_identificadores; documento completo validado e único nas duas bases produz candidato para revisão. Duplicidade, documento ausente/inválido e discrepância entre candidatos bloqueiam vinculação automática. Não foram consultados registros pessoais remotos; quantidade de conflitos e alterações no CRM ainda não mensurável. Empresas/produtos precisam de correspondência explícita aprovada; agro/civil/saude são condomínios, não empresas novas.

Nenhum trigger de usuário encontrado em comercial_360/api_comercial. Event triggers de infraestrutura DDL existem. Inventário de cron/webhooks/Edge Functions externos ainda precisa de conferência completa antes da carga; ausência de trigger nestes schemas não é ausência global de automações.
