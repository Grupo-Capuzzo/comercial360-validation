-- Official Release V1 migration; generated with Supabase CLI 2.119.0.
-- Source: tools/finance-migration/migrations/portal_acesso.review.sql
-- Conversion only: outer transaction wrappers removed; no other SQL changes.
-- REVIEW DRAFT. No account provisioning or client-to-user automatic linkage.
CREATE SCHEMA portal_acesso;
REVOKE ALL ON SCHEMA portal_acesso FROM PUBLIC, anon;
CREATE TABLE portal_acesso.permissoes (
  usuario_id uuid NOT NULL REFERENCES auth.users(id),
  empresa_id uuid NOT NULL REFERENCES comercial_360.empresas(empresa_id),
  modulo text NOT NULL CHECK (modulo IN ('portal','comercial','financeiro','planejamento')),
  pode_ler boolean NOT NULL DEFAULT false,
  pode_gravar boolean NOT NULL DEFAULT false,
  PRIMARY KEY(usuario_id,empresa_id,modulo)
);
ALTER TABLE portal_acesso.permissoes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON portal_acesso.permissoes FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA portal_acesso TO authenticated;
GRANT SELECT ON portal_acesso.permissoes TO authenticated;
CREATE POLICY consultar_proprias_permissoes ON portal_acesso.permissoes
  FOR SELECT TO authenticated USING (usuario_id=(SELECT auth.uid()));
-- The private fidelity layer remains inaccessible to browser roles.
-- Operational financial policies require approved company binding before exposure.
