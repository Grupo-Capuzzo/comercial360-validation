-- REVIEW ONLY. First read-only operational slice: historic loan titles.
-- No imported client becomes a login user. Mappings require human-approved IDs.
BEGIN;
CREATE SCHEMA financeiro;
REVOKE ALL ON SCHEMA financeiro FROM PUBLIC,anon;
CREATE TABLE financeiro.vinculos_titulos (
  source_system text NOT NULL,
  origem_id bigint NOT NULL,
  empresa_id uuid NOT NULL REFERENCES comercial_360.empresas(empresa_id),
  cliente_id_global uuid NOT NULL REFERENCES comercial_360.clientes(cliente_id_global),
  produto_id uuid NOT NULL REFERENCES comercial_360.produtos(produto_id),
  lote_id text NOT NULL,
  original_amount numeric NOT NULL,
  contracted_amount numeric NOT NULL,
  status text NOT NULL,
  loan_number text,
  PRIMARY KEY(source_system,origem_id),
  FOREIGN KEY(source_system,origem_id) REFERENCES financeiro_origem.private_loans(source_system,id),
  FOREIGN KEY(source_system,lote_id) REFERENCES financeiro_origem.lotes(source_system,id)
);
ALTER TABLE financeiro.vinculos_titulos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON financeiro.vinculos_titulos FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA financeiro TO authenticated;
GRANT SELECT ON financeiro.vinculos_titulos TO authenticated;
CREATE POLICY financeiro_leitura ON financeiro.vinculos_titulos
 FOR SELECT TO authenticated USING (EXISTS (
   SELECT 1 FROM portal_acesso.permissoes p
   WHERE p.usuario_id=(SELECT auth.uid()) AND p.empresa_id=vinculos_titulos.empresa_id
   AND p.modulo='financeiro' AND p.pode_ler
 ));
CREATE INDEX vinculos_titulos_empresa ON financeiro.vinculos_titulos(empresa_id);
-- No grants for modifying titles or permissions; write rules are a later slice.
COMMIT;
