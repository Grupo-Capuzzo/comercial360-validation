-- REVIEW ONLY. Revert application commit together with DB rollback.
-- No customer/opportunity/financial data is deleted.
BEGIN;
DO $restore$ DECLARE f record; BEGIN
 FOR f IN SELECT * FROM crm_scope_private.original_functions LOOP EXECUTE f.definition; END LOOP;
END $restore$;
DROP POLICY crm_company_read ON comercial_360.leads;
DROP POLICY crm_company_insert ON comercial_360.leads;
DROP POLICY crm_company_update ON comercial_360.leads;
DROP POLICY crm_company_products ON comercial_360.produtos;
DROP POLICY crm_company_links ON comercial_360.cliente_produtos;
DROP POLICY crm_company_clients ON comercial_360.clientes;
DROP FUNCTION api_comercial.crm_escopo_contexto(text),api_comercial.crm_escopo_consultar(text,text,integer),api_comercial.crm_escopo_operar(text,text,jsonb);
DROP INDEX comercial_360.crm_scope_lead_product;
-- Export the reviewed company mapping and this private snapshot before this step.
DROP SCHEMA crm_scope_private CASCADE;
COMMIT;
