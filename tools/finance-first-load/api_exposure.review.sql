-- SEPARATE REVIEW ONLY. Not executed by the load executor.
-- Confirm current Supabase Data API configuration and its management method first.
-- Preserve every existing exposed schema; never expose private source/control.
-- Apply only AFTER schema, RLS/grants and approved existing-user access review.
BEGIN;
DO $$
DECLARE current_schemas text;
BEGIN
 SELECT split_part(setting,'=',2) INTO current_schemas
 FROM pg_roles r CROSS JOIN LATERAL unnest(r.rolconfig) setting
 WHERE r.rolname='authenticator' AND setting LIKE 'pgrst.db_schemas=%';
 IF current_schemas IS DISTINCT FROM 'public, graphql_public, comercial_360, api_comercial' THEN
  RAISE EXCEPTION 'API_configuration_changed_requires_new_review';
 END IF;
 IF to_regnamespace('portal_acesso') IS NULL OR to_regnamespace('financeiro') IS NULL THEN
  RAISE EXCEPTION 'approved_schemas_not_installed';
 END IF;
END $$;
ALTER ROLE authenticator SET pgrst.db_schemas='public, graphql_public, comercial_360, api_comercial, portal_acesso, financeiro';
NOTIFY pgrst,'reload config';
NOTIFY pgrst,'reload schema';
COMMIT;
-- If project-managed configuration is authoritative, add only those two schemas
-- in Data API settings instead. Do not run both methods independently.
-- Recovery of this CONFIGURATION is a separate reviewed action: remove only the
-- two new exposures after verifying no concurrent configuration change; do not
-- overwrite CRM schemas. Row recovery never runs ALTER ROLE automatically.
