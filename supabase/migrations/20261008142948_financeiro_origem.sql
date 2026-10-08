-- Official Release V1 migration; generated with Supabase CLI 2.119.0.
-- Source: tools/finance-migration/migrations/financeiro_origem.review.sql
-- Conversion only: outer transaction wrappers removed; no other SQL changes.
-- REVIEW DRAFT. Not applied. Private fidelity layer; no browser grants.
CREATE SCHEMA financeiro_origem;
REVOKE ALL ON SCHEMA financeiro_origem FROM PUBLIC, anon, authenticated;
CREATE TABLE financeiro_origem.lotes (id text PRIMARY KEY, source_system text NOT NULL, snapshot_sha256 text NOT NULL, reference_at text NOT NULL, UNIQUE(source_system,snapshot_sha256));
ALTER TABLE financeiro_origem.lotes ENABLE ROW LEVEL SECURITY;
CREATE TABLE financeiro_origem."audit_logs" (
  source_system text NOT NULL,
  lote_id text NOT NULL REFERENCES financeiro_origem.lotes(id),
  source_fingerprint text NOT NULL,
  "id" bigint,
  "entity_type" text NOT NULL,
  "entity_id" bigint,
  "action" text NOT NULL,
  "old_value" text,
  "new_value" text,
  "created_at" text NOT NULL,
  "user_note" text,
  PRIMARY KEY (source_system, "id")
);
ALTER TABLE financeiro_origem."audit_logs" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON financeiro_origem."audit_logs" FROM PUBLIC, anon, authenticated;
CREATE TABLE financeiro_origem."backups" (
  source_system text NOT NULL,
  lote_id text NOT NULL REFERENCES financeiro_origem.lotes(id),
  source_fingerprint text NOT NULL,
  "id" bigint,
  "file_name" text NOT NULL,
  "file_path" text NOT NULL,
  "created_at" text NOT NULL,
  "reason" text,
  PRIMARY KEY (source_system, "id")
);
ALTER TABLE financeiro_origem."backups" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON financeiro_origem."backups" FROM PUBLIC, anon, authenticated;
CREATE TABLE financeiro_origem."bank_configs" (
  source_system text NOT NULL,
  lote_id text NOT NULL REFERENCES financeiro_origem.lotes(id),
  source_fingerprint text NOT NULL,
  "id" bigint,
  "bank_code" text NOT NULL,
  "bank_name" text NOT NULL,
  "company_name" text,
  "company_document" text,
  "agency" text,
  "agency_digit" text,
  "account_number" text,
  "account_digit" text,
  "address_street" text,
  "address_number" text,
  "address_complement" text,
  "city" text,
  "zip_code" text,
  "state" text,
  "remittance_sequence" bigint NOT NULL,
  "active" bigint NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  "agreement_code" text,
  PRIMARY KEY (source_system, "id")
);
ALTER TABLE financeiro_origem."bank_configs" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON financeiro_origem."bank_configs" FROM PUBLIC, anon, authenticated;
CREATE TABLE financeiro_origem."bank_remittance_files" (
  source_system text NOT NULL,
  lote_id text NOT NULL REFERENCES financeiro_origem.lotes(id),
  source_fingerprint text NOT NULL,
  "id" bigint,
  "calculation_id" bigint,
  "condominium_code" text,
  "bank_code" text,
  "bank_name" text,
  "file_name" text,
  "file_path" text,
  "conference_file_path" text,
  "payment_date" text,
  "total_amount" numeric,
  "total_payments" bigint,
  "status" text NOT NULL,
  "created_at" text NOT NULL,
  "notes" text,
  PRIMARY KEY (source_system, "id")
);
ALTER TABLE financeiro_origem."bank_remittance_files" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON financeiro_origem."bank_remittance_files" FROM PUBLIC, anon, authenticated;
CREATE TABLE financeiro_origem."bank_remittance_items" (
  source_system text NOT NULL,
  lote_id text NOT NULL REFERENCES financeiro_origem.lotes(id),
  source_fingerprint text NOT NULL,
  "id" bigint,
  "remittance_file_id" bigint NOT NULL,
  "calculation_item_id" bigint,
  "client_id" bigint,
  "client_name" text,
  "client_document" text,
  "pix_key" text,
  "pix_key_type" text,
  "amount" numeric,
  "status" text NOT NULL,
  "notes" text,
  PRIMARY KEY (source_system, "id")
);
ALTER TABLE financeiro_origem."bank_remittance_items" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON financeiro_origem."bank_remittance_items" FROM PUBLIC, anon, authenticated;
CREATE TABLE financeiro_origem."central_etapas" (
  source_system text NOT NULL,
  lote_id text NOT NULL REFERENCES financeiro_origem.lotes(id),
  source_fingerprint text NOT NULL,
  "id" text,
  "tarefa_id" text NOT NULL,
  "ordem" bigint NOT NULL,
  "nome" text NOT NULL,
  "responsavel" text NOT NULL,
  "prazo" text NOT NULL,
  "percentual" bigint NOT NULL,
  "observacoes" text NOT NULL,
  PRIMARY KEY (source_system, "id")
);
ALTER TABLE financeiro_origem."central_etapas" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON financeiro_origem."central_etapas" FROM PUBLIC, anon, authenticated;
CREATE TABLE financeiro_origem."central_subetapas" (
  source_system text NOT NULL,
  lote_id text NOT NULL REFERENCES financeiro_origem.lotes(id),
  source_fingerprint text NOT NULL,
  "id" text,
  "etapa_id" text NOT NULL,
  "ordem" bigint NOT NULL,
  "nome" text NOT NULL,
  "feito" bigint NOT NULL,
  "prazo" text NOT NULL,
  "concluido_em" text NOT NULL,
  PRIMARY KEY (source_system, "id")
);
ALTER TABLE financeiro_origem."central_subetapas" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON financeiro_origem."central_subetapas" FROM PUBLIC, anon, authenticated;
CREATE TABLE financeiro_origem."central_tarefas" (
  source_system text NOT NULL,
  lote_id text NOT NULL REFERENCES financeiro_origem.lotes(id),
  source_fingerprint text NOT NULL,
  "id" text,
  "titulo" text NOT NULL,
  "responsavel" text NOT NULL,
  "prazo_total" text NOT NULL,
  "status" text NOT NULL,
  "descricao" text NOT NULL,
  "criado_em" text NOT NULL,
  "atualizado_em" text NOT NULL,
  "prioridade" text NOT NULL,
  PRIMARY KEY (source_system, "id")
);
ALTER TABLE financeiro_origem."central_tarefas" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON financeiro_origem."central_tarefas" FROM PUBLIC, anon, authenticated;
CREATE TABLE financeiro_origem."clients" (
  source_system text NOT NULL,
  lote_id text NOT NULL REFERENCES financeiro_origem.lotes(id),
  source_fingerprint text NOT NULL,
  "id" bigint,
  "cpf" text NOT NULL,
  "full_name" text NOT NULL,
  "email" text,
  "pix_key" text,
  "phone" text,
  "status" text NOT NULL,
  "notes" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  "bank_name" text,
  "bank_agency" text,
  "bank_account" text,
  "bank_account_digit" text,
  "bank_account_type" text,
  "bank_holder_name" text,
  "bank_holder_document" text,
  "bank_notes" text,
  PRIMARY KEY (source_system, "id")
);
ALTER TABLE financeiro_origem."clients" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON financeiro_origem."clients" FROM PUBLIC, anon, authenticated;
CREATE TABLE financeiro_origem."condominiums" (
  source_system text NOT NULL,
  lote_id text NOT NULL REFERENCES financeiro_origem.lotes(id),
  source_fingerprint text NOT NULL,
  "id" bigint,
  "name" text NOT NULL,
  "code" text NOT NULL,
  "default_monthly_rate" numeric NOT NULL,
  "payment_day" bigint NOT NULL,
  "accrual_start_day" bigint NOT NULL,
  "accrual_end_day" bigint NOT NULL,
  "active" bigint NOT NULL,
  PRIMARY KEY (source_system, "id")
);
ALTER TABLE financeiro_origem."condominiums" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON financeiro_origem."condominiums" FROM PUBLIC, anon, authenticated;
CREATE TABLE financeiro_origem."email_logs" (
  source_system text NOT NULL,
  lote_id text NOT NULL REFERENCES financeiro_origem.lotes(id),
  source_fingerprint text NOT NULL,
  "id" bigint,
  "client_id" bigint,
  "condominium_code" text,
  "reference_year" bigint,
  "reference_month" bigint,
  "to_email" text,
  "subject" text,
  "body" text,
  "gmail_draft_id" text,
  "gmail_message_id" text,
  "status" text NOT NULL,
  "created_at" text NOT NULL,
  "notes" text,
  PRIMARY KEY (source_system, "id")
);
ALTER TABLE financeiro_origem."email_logs" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON financeiro_origem."email_logs" FROM PUBLIC, anon, authenticated;
CREATE TABLE financeiro_origem."monthly_calculation_items" (
  source_system text NOT NULL,
  lote_id text NOT NULL REFERENCES financeiro_origem.lotes(id),
  source_fingerprint text NOT NULL,
  "id" bigint,
  "monthly_calculation_id" bigint NOT NULL,
  "share_id" bigint NOT NULL,
  "client_id" bigint NOT NULL,
  "condominium_id" bigint NOT NULL,
  "period_start" text NOT NULL,
  "period_end" text NOT NULL,
  "active_days" bigint NOT NULL,
  "total_period_days" bigint NOT NULL,
  "applied_rate" numeric NOT NULL,
  "share_value" numeric NOT NULL,
  "income_value" numeric NOT NULL,
  "calculation_details" text,
  PRIMARY KEY (source_system, "id")
);
ALTER TABLE financeiro_origem."monthly_calculation_items" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON financeiro_origem."monthly_calculation_items" FROM PUBLIC, anon, authenticated;
CREATE TABLE financeiro_origem."monthly_calculations" (
  source_system text NOT NULL,
  lote_id text NOT NULL REFERENCES financeiro_origem.lotes(id),
  source_fingerprint text NOT NULL,
  "id" bigint,
  "calculation_month" bigint NOT NULL,
  "calculation_year" bigint NOT NULL,
  "condominium_id" bigint,
  "agro_special_rate" numeric,
  "calculated_at" text NOT NULL,
  "notes" text,
  PRIMARY KEY (source_system, "id")
);
ALTER TABLE financeiro_origem."monthly_calculations" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON financeiro_origem."monthly_calculations" FROM PUBLIC, anon, authenticated;
CREATE TABLE financeiro_origem."portal_empresa_status" (
  source_system text NOT NULL,
  lote_id text NOT NULL REFERENCES financeiro_origem.lotes(id),
  source_fingerprint text NOT NULL,
  "slug" text,
  "status" text NOT NULL,
  "obs" text NOT NULL,
  PRIMARY KEY (source_system, "slug")
);
ALTER TABLE financeiro_origem."portal_empresa_status" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON financeiro_origem."portal_empresa_status" FROM PUBLIC, anon, authenticated;
CREATE TABLE financeiro_origem."portal_favoritos" (
  source_system text NOT NULL,
  lote_id text NOT NULL REFERENCES financeiro_origem.lotes(id),
  source_fingerprint text NOT NULL,
  "usuario_id" bigint NOT NULL,
  "empresa_slug" text NOT NULL,
  PRIMARY KEY (source_system, "usuario_id", "empresa_slug")
);
ALTER TABLE financeiro_origem."portal_favoritos" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON financeiro_origem."portal_favoritos" FROM PUBLIC, anon, authenticated;
CREATE TABLE financeiro_origem."portal_login_tentativas" (
  source_system text NOT NULL,
  lote_id text NOT NULL REFERENCES financeiro_origem.lotes(id),
  source_fingerprint text NOT NULL,
  "id" bigint,
  "email" text NOT NULL,
  "momento" text NOT NULL,
  "sucesso" bigint NOT NULL,
  PRIMARY KEY (source_system, "id")
);
ALTER TABLE financeiro_origem."portal_login_tentativas" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON financeiro_origem."portal_login_tentativas" FROM PUBLIC, anon, authenticated;
CREATE TABLE financeiro_origem."portal_usuario_empresas" (
  source_system text NOT NULL,
  lote_id text NOT NULL REFERENCES financeiro_origem.lotes(id),
  source_fingerprint text NOT NULL,
  "usuario_id" bigint NOT NULL,
  "empresa_slug" text NOT NULL,
  PRIMARY KEY (source_system, "usuario_id", "empresa_slug")
);
ALTER TABLE financeiro_origem."portal_usuario_empresas" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON financeiro_origem."portal_usuario_empresas" FROM PUBLIC, anon, authenticated;
CREATE TABLE financeiro_origem."portal_usuarios" (
  source_system text NOT NULL,
  lote_id text NOT NULL REFERENCES financeiro_origem.lotes(id),
  source_fingerprint text NOT NULL,
  "id" bigint,
  "nome" text NOT NULL,
  "email" text NOT NULL,
  "senha_hash" text NOT NULL,
  "perfil" text NOT NULL,
  "ativo" bigint NOT NULL,
  "criado_em" text NOT NULL,
  "ultimo_login" text NOT NULL,
  PRIMARY KEY (source_system, "id")
);
ALTER TABLE financeiro_origem."portal_usuarios" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON financeiro_origem."portal_usuarios" FROM PUBLIC, anon, authenticated;
CREATE TABLE financeiro_origem."private_loan_amortizations" (
  source_system text NOT NULL,
  lote_id text NOT NULL REFERENCES financeiro_origem.lotes(id),
  source_fingerprint text NOT NULL,
  "id" bigint,
  "loan_id" bigint NOT NULL,
  "payment_date" text NOT NULL,
  "amount" numeric NOT NULL,
  "amortization_type" text NOT NULL,
  "applied_to" text NOT NULL,
  "notes" text,
  "created_at" text NOT NULL,
  "installment_id" bigint,
  "target_mode" text,
  "price_action" text,
  "amount_before" numeric,
  "amount_after" numeric,
  "recalculated_schedule_json" text,
  PRIMARY KEY (source_system, "id")
);
ALTER TABLE financeiro_origem."private_loan_amortizations" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON financeiro_origem."private_loan_amortizations" FROM PUBLIC, anon, authenticated;
CREATE TABLE financeiro_origem."private_loan_calculations_log" (
  source_system text NOT NULL,
  lote_id text NOT NULL REFERENCES financeiro_origem.lotes(id),
  source_fingerprint text NOT NULL,
  "id" bigint,
  "loan_id" bigint NOT NULL,
  "calculation_date" text NOT NULL,
  "base_date" text NOT NULL,
  "base_amount" numeric NOT NULL,
  "days_overdue" bigint NOT NULL,
  "monthly_rate" numeric NOT NULL,
  "daily_rate" numeric NOT NULL,
  "calculated_amount" numeric NOT NULL,
  "calculation_details" text,
  "created_at" text NOT NULL,
  PRIMARY KEY (source_system, "id")
);
ALTER TABLE financeiro_origem."private_loan_calculations_log" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON financeiro_origem."private_loan_calculations_log" FROM PUBLIC, anon, authenticated;
CREATE TABLE financeiro_origem."private_loan_clients" (
  source_system text NOT NULL,
  lote_id text NOT NULL REFERENCES financeiro_origem.lotes(id),
  source_fingerprint text NOT NULL,
  "id" bigint,
  "linked_client_id" bigint,
  "name" text NOT NULL,
  "document" text,
  "email" text,
  "phone" text,
  "pix_key" text,
  "notes" text,
  "status" text NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  PRIMARY KEY (source_system, "id")
);
ALTER TABLE financeiro_origem."private_loan_clients" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON financeiro_origem."private_loan_clients" FROM PUBLIC, anon, authenticated;
CREATE TABLE financeiro_origem."private_loan_extensions" (
  source_system text NOT NULL,
  lote_id text NOT NULL REFERENCES financeiro_origem.lotes(id),
  source_fingerprint text NOT NULL,
  "id" bigint,
  "loan_id" bigint NOT NULL,
  "reference_date" text NOT NULL,
  "paid_date" text NOT NULL,
  "extension_amount" numeric NOT NULL,
  "covered_until_date" text NOT NULL,
  "principal_kept_amount" numeric,
  "notes" text,
  "created_at" text NOT NULL,
  PRIMARY KEY (source_system, "id")
);
ALTER TABLE financeiro_origem."private_loan_extensions" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON financeiro_origem."private_loan_extensions" FROM PUBLIC, anon, authenticated;
CREATE TABLE financeiro_origem."private_loan_installments" (
  source_system text NOT NULL,
  lote_id text NOT NULL REFERENCES financeiro_origem.lotes(id),
  source_fingerprint text NOT NULL,
  "id" bigint,
  "loan_id" bigint NOT NULL,
  "installment_number" bigint NOT NULL,
  "due_date" text NOT NULL,
  "principal_amount" numeric NOT NULL,
  "interest_amount" numeric NOT NULL,
  "installment_amount" numeric NOT NULL,
  "paid_amount" numeric NOT NULL,
  "paid_date" text,
  "status" text NOT NULL,
  "notes" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  PRIMARY KEY (source_system, "id")
);
ALTER TABLE financeiro_origem."private_loan_installments" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON financeiro_origem."private_loan_installments" FROM PUBLIC, anon, authenticated;
CREATE TABLE financeiro_origem."private_loan_payments" (
  source_system text NOT NULL,
  lote_id text NOT NULL REFERENCES financeiro_origem.lotes(id),
  source_fingerprint text NOT NULL,
  "id" bigint,
  "loan_id" bigint NOT NULL,
  "installment_id" bigint,
  "payment_date" text NOT NULL,
  "amount" numeric NOT NULL,
  "payment_type" text NOT NULL,
  "notes" text,
  "created_at" text NOT NULL,
  PRIMARY KEY (source_system, "id")
);
ALTER TABLE financeiro_origem."private_loan_payments" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON financeiro_origem."private_loan_payments" FROM PUBLIC, anon, authenticated;
CREATE TABLE financeiro_origem."private_loans" (
  source_system text NOT NULL,
  lote_id text NOT NULL REFERENCES financeiro_origem.lotes(id),
  source_fingerprint text NOT NULL,
  "id" bigint,
  "private_client_id" bigint NOT NULL,
  "linked_client_id" bigint,
  "loan_number" text,
  "original_amount" numeric NOT NULL,
  "contracted_amount" numeric NOT NULL,
  "interest_rate_monthly" numeric NOT NULL,
  "interest_rate_daily" numeric,
  "interest_type" text NOT NULL,
  "calculation_method" text NOT NULL,
  "start_date" text NOT NULL,
  "first_due_date" text,
  "final_due_date" text,
  "installments_count" bigint NOT NULL,
  "installment_amount" numeric,
  "status" text NOT NULL,
  "notes" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  PRIMARY KEY (source_system, "id")
);
ALTER TABLE financeiro_origem."private_loans" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON financeiro_origem."private_loans" FROM PUBLIC, anon, authenticated;
CREATE TABLE financeiro_origem."shares" (
  source_system text NOT NULL,
  lote_id text NOT NULL REFERENCES financeiro_origem.lotes(id),
  source_fingerprint text NOT NULL,
  "id" bigint,
  "condominium_id" bigint NOT NULL,
  "client_id" bigint NOT NULL,
  "share_number" text NOT NULL,
  "share_value" numeric NOT NULL,
  "acquisition_date" text NOT NULL,
  "maturity_date" text,
  "status" text NOT NULL,
  "last_renewal_date" text,
  "withdrawal_date" text,
  "notes" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  "withdrawal_requested" bigint,
  "withdrawal_request_date" text,
  "withdrawal_effective_date" text,
  "withdrawal_notes" text,
  "accrual_until_withdrawal" bigint NOT NULL,
  PRIMARY KEY (source_system, "id")
);
ALTER TABLE financeiro_origem."shares" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON financeiro_origem."shares" FROM PUBLIC, anon, authenticated;
ALTER TABLE financeiro_origem."bank_remittance_files" ADD FOREIGN KEY (source_system, "calculation_id") REFERENCES financeiro_origem."monthly_calculations" (source_system, "id") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE financeiro_origem."bank_remittance_items" ADD FOREIGN KEY (source_system, "client_id") REFERENCES financeiro_origem."clients" (source_system, "id") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE financeiro_origem."bank_remittance_items" ADD FOREIGN KEY (source_system, "remittance_file_id") REFERENCES financeiro_origem."bank_remittance_files" (source_system, "id") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE financeiro_origem."email_logs" ADD FOREIGN KEY (source_system, "client_id") REFERENCES financeiro_origem."clients" (source_system, "id") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE financeiro_origem."monthly_calculation_items" ADD FOREIGN KEY (source_system, "condominium_id") REFERENCES financeiro_origem."condominiums" (source_system, "id") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE financeiro_origem."monthly_calculation_items" ADD FOREIGN KEY (source_system, "client_id") REFERENCES financeiro_origem."clients" (source_system, "id") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE financeiro_origem."monthly_calculation_items" ADD FOREIGN KEY (source_system, "share_id") REFERENCES financeiro_origem."shares" (source_system, "id") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE financeiro_origem."monthly_calculation_items" ADD FOREIGN KEY (source_system, "monthly_calculation_id") REFERENCES financeiro_origem."monthly_calculations" (source_system, "id") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE financeiro_origem."monthly_calculations" ADD FOREIGN KEY (source_system, "condominium_id") REFERENCES financeiro_origem."condominiums" (source_system, "id") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE financeiro_origem."private_loan_amortizations" ADD FOREIGN KEY (source_system, "installment_id") REFERENCES financeiro_origem."private_loan_installments" (source_system, "id") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE financeiro_origem."private_loan_amortizations" ADD FOREIGN KEY (source_system, "loan_id") REFERENCES financeiro_origem."private_loans" (source_system, "id") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE financeiro_origem."private_loan_calculations_log" ADD FOREIGN KEY (source_system, "loan_id") REFERENCES financeiro_origem."private_loans" (source_system, "id") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE financeiro_origem."private_loan_clients" ADD FOREIGN KEY (source_system, "linked_client_id") REFERENCES financeiro_origem."clients" (source_system, "id") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE financeiro_origem."private_loan_extensions" ADD FOREIGN KEY (source_system, "loan_id") REFERENCES financeiro_origem."private_loans" (source_system, "id") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE financeiro_origem."private_loan_installments" ADD FOREIGN KEY (source_system, "loan_id") REFERENCES financeiro_origem."private_loans" (source_system, "id") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE financeiro_origem."private_loan_payments" ADD FOREIGN KEY (source_system, "installment_id") REFERENCES financeiro_origem."private_loan_installments" (source_system, "id") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE financeiro_origem."private_loan_payments" ADD FOREIGN KEY (source_system, "loan_id") REFERENCES financeiro_origem."private_loans" (source_system, "id") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE financeiro_origem."private_loans" ADD FOREIGN KEY (source_system, "linked_client_id") REFERENCES financeiro_origem."clients" (source_system, "id") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE financeiro_origem."private_loans" ADD FOREIGN KEY (source_system, "private_client_id") REFERENCES financeiro_origem."private_loan_clients" (source_system, "id") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE financeiro_origem."shares" ADD FOREIGN KEY (source_system, "client_id") REFERENCES financeiro_origem."clients" (source_system, "id") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE financeiro_origem."shares" ADD FOREIGN KEY (source_system, "condominium_id") REFERENCES financeiro_origem."condominiums" (source_system, "id") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE financeiro_origem."central_etapas" ADD FOREIGN KEY (source_system, "tarefa_id") REFERENCES financeiro_origem."central_tarefas" (source_system, id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE financeiro_origem."central_subetapas" ADD FOREIGN KEY (source_system, "etapa_id") REFERENCES financeiro_origem."central_etapas" (source_system, id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE financeiro_origem."bank_remittance_items" ADD FOREIGN KEY (source_system, "calculation_item_id") REFERENCES financeiro_origem."monthly_calculation_items" (source_system, id) DEFERRABLE INITIALLY DEFERRED;
REVOKE ALL ON financeiro_origem.lotes FROM PUBLIC, anon, authenticated;
-- Enforce origin/batch coherence at database level, not only in Python.
ALTER TABLE financeiro_origem.lotes ADD UNIQUE (source_system,id);
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='financeiro_origem' AND tablename<>'lotes' LOOP
    EXECUTE format('ALTER TABLE financeiro_origem.%I ADD FOREIGN KEY (source_system,lote_id) REFERENCES financeiro_origem.lotes(source_system,id) DEFERRABLE INITIALLY DEFERRED',t.tablename);
  END LOOP;
END $$;
CREATE TABLE financeiro_origem.ocorrencias (
  lote_id text NOT NULL,
  source_system text NOT NULL,
  tabela text NOT NULL,
  chave text NOT NULL,
  fingerprint text NOT NULL,
  PRIMARY KEY(lote_id,tabela,chave),
  FOREIGN KEY(source_system,lote_id) REFERENCES financeiro_origem.lotes(source_system,id)
);
ALTER TABLE financeiro_origem.ocorrencias ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON financeiro_origem.ocorrencias FROM PUBLIC,anon,authenticated;
