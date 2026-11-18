-- Official Release V1 migration; generated with Supabase CLI 2.119.0.
-- Source: tools/finance-migration/migrations/portal_consulta.review.sql
-- Conversion only: outer transaction wrappers removed; no other SQL changes.
-- REVIEW: Next.js + REAL Supabase Auth. Never apply to production in CI.
CREATE FUNCTION portal_acesso.sessao_ativa() RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
 AS $$ SELECT auth.uid() IS NOT NULL AND EXISTS (
 SELECT 1 FROM auth.sessions s WHERE s.user_id=auth.uid()
 AND s.id::text=auth.jwt()->>'session_id') $$;
REVOKE ALL ON FUNCTION portal_acesso.sessao_ativa() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION portal_acesso.sessao_ativa() TO authenticated;
CREATE TABLE portal_acesso.empresas_portal (empresa_id uuid PRIMARY KEY REFERENCES comercial_360.empresas(empresa_id),nome text NOT NULL);
ALTER TABLE portal_acesso.empresas_portal ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON portal_acesso.empresas_portal FROM PUBLIC,anon,authenticated;
GRANT SELECT ON portal_acesso.empresas_portal TO authenticated;
CREATE POLICY empresa_autorizada ON portal_acesso.empresas_portal FOR SELECT TO authenticated
 USING (portal_acesso.sessao_ativa() AND EXISTS (SELECT 1 FROM portal_acesso.permissoes p WHERE p.empresa_id=empresas_portal.empresa_id AND p.usuario_id=auth.uid() AND p.pode_ler));
CREATE TABLE financeiro.estado_carga (empresa_id uuid PRIMARY KEY REFERENCES comercial_360.empresas(empresa_id),situacao text NOT NULL CHECK(situacao IN ('nao_carregado','sintetico','historico_importado')),data_referencia text);
CREATE TABLE financeiro.registros_consulta (
 empresa_id uuid NOT NULL REFERENCES comercial_360.empresas(empresa_id),source_system text NOT NULL,tabela_origem text NOT NULL,origem_id text NOT NULL,
 tipo text NOT NULL CHECK(tipo IN ('clientes','cotas','apuracoes','titulos','parcelas','renovacoes','retiradas','recebimentos','amortizacoes','remessas','plano_acao')),
 lote_id text NOT NULL,cliente_id_global uuid REFERENCES comercial_360.clientes(cliente_id_global),produto_id uuid REFERENCES comercial_360.produtos(produto_id),posicao_crm_id uuid,
 descricao text NOT NULL,status text,valor_preservado numeric,data_referencia text,detalhes jsonb NOT NULL DEFAULT '{}',
 PRIMARY KEY(source_system,tabela_origem,origem_id),FOREIGN KEY(source_system,lote_id) REFERENCES financeiro_origem.lotes(source_system,id),
 CHECK(tipo IN ('apuracoes','remessas','plano_acao') OR cliente_id_global IS NOT NULL)
);
CREATE INDEX registros_consulta_empresa_tipo ON financeiro.registros_consulta(empresa_id,tipo);
ALTER TABLE financeiro.registros_consulta ENABLE ROW LEVEL SECURITY;
ALTER TABLE financeiro.estado_carga ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON financeiro.registros_consulta,financeiro.estado_carga FROM PUBLIC,anon,authenticated;
GRANT SELECT ON financeiro.registros_consulta,financeiro.estado_carga TO authenticated;
CREATE POLICY consulta_financeiro ON financeiro.registros_consulta FOR SELECT TO authenticated
 USING (portal_acesso.sessao_ativa() AND EXISTS (SELECT 1 FROM portal_acesso.permissoes p WHERE p.usuario_id=auth.uid() AND p.empresa_id=registros_consulta.empresa_id AND p.modulo='financeiro' AND p.pode_ler));
CREATE POLICY estado_financeiro ON financeiro.estado_carga FOR SELECT TO authenticated
 USING (portal_acesso.sessao_ativa() AND EXISTS (SELECT 1 FROM portal_acesso.permissoes p WHERE p.usuario_id=auth.uid() AND p.empresa_id=estado_carga.empresa_id AND p.modulo='financeiro' AND p.pode_ler));
CREATE VIEW financeiro.registros_lista WITH(security_invoker=true) AS SELECT empresa_id,tipo,origem_id,descricao,status,valor_preservado::text AS valor,data_referencia,detalhes FROM financeiro.registros_consulta;
REVOKE ALL ON financeiro.registros_lista FROM PUBLIC,anon;
GRANT SELECT ON financeiro.registros_lista TO authenticated;
