-- READ ONLY. Metadata and aggregate discrepancies, no personal data exports.
SELECT empresa_id,codigo,nome,ativa FROM comercial_360.empresas ORDER BY nome;
SELECT empresa_id,count(*) produtos FROM comercial_360.produtos GROUP BY empresa_id;
SELECT count(*) oportunidades_sem_produto FROM crm.oportunidades WHERE produto_id IS NULL;
SELECT count(*) tarefas_sem_oportunidade FROM crm.tarefas WHERE oportunidade_id IS NULL;
SELECT count(*) usuarios_erp_ativos_sem_crm
FROM erp.portal_usuarios e JOIN auth.users a ON lower(a.email)=lower(e.email)
WHERE e.ativo=1 AND NOT EXISTS(SELECT 1 FROM comercial_360.crm_usuarios c WHERE c.auth_user_id=a.id AND c.ativo);
SELECT n.nspname,p.proname,p.prosecdef,pg_get_function_identity_arguments(p.oid)
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname IN ('seguranca_comercial','api_comercial') ORDER BY n.nspname,p.proname;
SELECT schemaname,tablename,policyname,cmd,qual,with_check FROM pg_policies
WHERE schemaname IN ('crm','comercial_360','portal_acesso');
