# Primeira fatia operacional e rastreabilidade

Estado: SQL e projetor local preparados; nenhuma API/tela ou escrita remota realizada.

| Origem | Destino operacional | Vínculo obrigatório | Consulta/API/tela proposta | Autorização |
|---|---|---|---|---|
| private_loans | financeiro.vinculos_titulos | empresa_id, cliente_id_global, produto_id revisados individualmente | listagem de títulos históricos por empresa no Financeiro Next.js | SELECT com permissão financeiro/pode_ler da empresa; sem escrita pelo navegador |
| clients e private_loan_clients | comercial_360.clientes + cliente_identificadores existentes | identificação de origem/documento validada; conflitos revisados | ficha de cliente existente, sem criar login | conservar autorização existente do CRM; não modificar nesta fatia |
| condominiums e shares | modelo de posições/contratos ainda em revisão | condomínio não equivale automaticamente a empresa; produtos precisam de vínculo aprovado | posições/cotas e vínculos: pendentes | RLS por empresa pendente; camada bruta sem grants |
| monthly_calculations e items | apurações e histórico operacional ainda em revisão | empresa, produto, cliente e período | apurações históricas: pendentes | não expor antes das políticas/testes |
| installments/payments/amortizations/extensions | parcelas e eventos operacionais ainda em revisão | título original e IDs estáveis | histórico completo: pendente | preservar valores/eventos; não recalcular histórico |
| bank_configs/remittance_files/items | configuração e evidência de remessa ainda em revisão | empresa e origem; arquivos externos não incluídos automaticamente | consulta restrita, sem emissão de remessa | sem pagamento/e-mail ou acesso bruto pelo navegador |
| central_* | planejamento ainda em revisão | empresa e hierarquia explícitas | tarefas: pendentes | módulo planejamento separado |
| audit_logs/backups/email_logs/calculations_log | evidência privada de origem | lote + PK original | sem consulta pública | camada privada |
| portal_* | acesso via Supabase Auth + portal_acesso | usuários e empresas aprovados separadamente dos clientes | entrada Portal -> empresa -> módulo | não importar senhas ou gerar usuários |

`local_projection.project_titles` aceita um dicionário de vínculos explícitos em memória, preserva valores/status do título e valida produto/empresa. O mesmo vínculo é idempotente; diferenças abortam sem sobrescrita. Não constitui conciliação automática de identidade e não cria clientes, produtos, usuários ou permissões. A DDL conserva FKs até a origem/lote para impedir recuperação enquanto existirem vínculos operacionais.

Grants permitem apenas SELECT; RLS verifica permissão atual em tabela (não user_metadata ou autorização por nome). Uma futura consulta Next.js deve utilizar a sessão Supabase do usuário e o schema operacional aprovado, nunca service_role. Exposição do schema na Data API, política de sessão e testes Supabase reais ainda precisam de homologação. O projetor não é uma API pública e só conecta ao banco sintético local marcado.

Testes preparados distinguem papéis SQL com auth.uid sintético de tokens Supabase assinados: o primeiro NÃO comprova login, validação JWT, sessão SSR ou isolamento ponta a ponta. A entrega completa do Financeiro depende de completar as linhas pendentes e as regras de leitura/gravação, sem fallback SQLite.
