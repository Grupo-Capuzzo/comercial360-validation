-- REVIEW ONLY. Additional private journal and operational referential checks.
BEGIN;
CREATE SCHEMA financeiro_controle;
REVOKE ALL ON SCHEMA financeiro_controle FROM PUBLIC,anon,authenticated;
CREATE TABLE financeiro_controle.execucoes (
 lote_id text PRIMARY KEY REFERENCES financeiro_origem.lotes(id),
 approval_sha256 text NOT NULL, plan_sha256 text NOT NULL,
 status text NOT NULL CHECK(status IN ('completed','recovered')),
 summary jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE financeiro_controle.journal (
 lote_id text NOT NULL REFERENCES financeiro_origem.lotes(id),
 sequence_no bigint GENERATED ALWAYS AS IDENTITY,
 entity text NOT NULL, item_key jsonb NOT NULL,
 operation text NOT NULL CHECK(operation IN ('insert','update')),
 before_row jsonb, after_sha256 text NOT NULL,
 PRIMARY KEY(lote_id,entity,item_key)
);
ALTER TABLE financeiro_controle.execucoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE financeiro_controle.journal ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA financeiro_controle FROM PUBLIC,anon,authenticated;
CREATE INDEX journal_batch_sequence ON financeiro_controle.journal(lote_id,sequence_no);
CREATE TABLE financeiro_controle.correspondencias (
 source_system text NOT NULL,tabela_origem text NOT NULL CHECK(tabela_origem IN ('clients','private_loan_clients')),
 origem_id text NOT NULL,cliente_id_global uuid NOT NULL REFERENCES comercial_360.clientes(cliente_id_global),
 lote_id text NOT NULL,criterio text NOT NULL CHECK(criterio IN ('link','create')),evidence_reference text NOT NULL,
 PRIMARY KEY(source_system,tabela_origem,origem_id),
 FOREIGN KEY(source_system,lote_id) REFERENCES financeiro_origem.lotes(source_system,id)
);
ALTER TABLE financeiro_controle.correspondencias ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON financeiro_controle.correspondencias FROM PUBLIC,anon,authenticated;
CREATE INDEX correspondencias_cliente ON financeiro_controle.correspondencias(cliente_id_global);
CREATE TABLE financeiro.relacoes_consulta (
 source_system text NOT NULL,parent_table text NOT NULL,parent_id text NOT NULL,
 child_table text NOT NULL,child_id text NOT NULL,lote_id text NOT NULL,
 PRIMARY KEY(source_system,parent_table,parent_id,child_table,child_id),
 FOREIGN KEY(source_system,lote_id) REFERENCES financeiro_origem.lotes(source_system,id),
 FOREIGN KEY(source_system,parent_table,parent_id) REFERENCES financeiro.registros_consulta(source_system,tabela_origem,origem_id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(source_system,child_table,child_id) REFERENCES financeiro.registros_consulta(source_system,tabela_origem,origem_id) DEFERRABLE INITIALLY DEFERRED
);
ALTER TABLE financeiro.relacoes_consulta ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON financeiro.relacoes_consulta FROM PUBLIC,anon,authenticated;
-- Deliberately not exposed yet: existing screens read the safe read projection only.
CREATE INDEX relacoes_consulta_child ON financeiro.relacoes_consulta(source_system,child_table,child_id);
CREATE INDEX registros_consulta_lote ON financeiro.registros_consulta(lote_id);
CREATE INDEX registros_consulta_cliente ON financeiro.registros_consulta(cliente_id_global);
CREATE INDEX registros_consulta_produto ON financeiro.registros_consulta(produto_id);
-- Match the active-session condition used by the five current read screens.
ALTER POLICY financeiro_leitura ON financeiro.vinculos_titulos USING (
 portal_acesso.sessao_ativa() AND EXISTS(SELECT 1 FROM portal_acesso.permissoes p
 WHERE p.usuario_id=auth.uid() AND p.empresa_id=vinculos_titulos.empresa_id
 AND p.modulo='financeiro' AND p.pode_ler));
ALTER TABLE financeiro.registros_consulta ADD FOREIGN KEY(posicao_crm_id) REFERENCES comercial_360.investimento_posicoes(posicao_id);

CREATE FUNCTION financeiro_controle.validar_projecao() RETURNS trigger
 LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE present boolean;
BEGIN
 IF NEW.tabela_origem NOT IN ('clients','private_loan_clients','shares','monthly_calculations','monthly_calculation_items','private_loans','private_loan_installments','private_loan_payments','private_loan_amortizations','private_loan_extensions','bank_remittance_files','bank_remittance_items','central_tarefas','central_etapas','central_subetapas') THEN
  RAISE EXCEPTION 'unsupported_origin_table' USING ERRCODE='23514';
 END IF;
 EXECUTE format('SELECT EXISTS(SELECT 1 FROM financeiro_origem.%I WHERE source_system=$1 AND id::text=$2 AND lote_id=$3)',NEW.tabela_origem)
 INTO present USING NEW.source_system,NEW.origem_id,NEW.lote_id;
 IF NOT present THEN RAISE EXCEPTION 'missing_origin_batch' USING ERRCODE='23503'; END IF;
 IF NEW.produto_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM comercial_360.produtos p WHERE p.produto_id=NEW.produto_id AND p.empresa_id=NEW.empresa_id) THEN
  RAISE EXCEPTION 'product_company_mismatch' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION financeiro_controle.validar_projecao() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER validar_projecao BEFORE INSERT OR UPDATE ON financeiro.registros_consulta
 FOR EACH ROW EXECUTE FUNCTION financeiro_controle.validar_projecao();

CREATE FUNCTION financeiro_controle.proteger_origem() RETURNS trigger
 LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM financeiro.registros_consulta r WHERE r.source_system=OLD.source_system AND r.tabela_origem=TG_TABLE_NAME AND r.origem_id=OLD.id::text) THEN
  RAISE EXCEPTION 'origin_has_operational_reference' USING ERRCODE='23503';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION financeiro_controle.proteger_origem() FROM PUBLIC,anon,authenticated;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['clients','private_loan_clients','shares','monthly_calculations','monthly_calculation_items','private_loans','private_loan_installments','private_loan_payments','private_loan_amortizations','private_loan_extensions','bank_remittance_files','bank_remittance_items','central_tarefas','central_etapas','central_subetapas'] LOOP
  EXECUTE format('CREATE TRIGGER proteger_origem BEFORE DELETE OR UPDATE ON financeiro_origem.%I FOR EACH ROW EXECUTE FUNCTION financeiro_controle.proteger_origem()',t);
 END LOOP;
END $$;
COMMIT;
