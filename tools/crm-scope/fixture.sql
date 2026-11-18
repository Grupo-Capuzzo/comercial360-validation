CREATE ROLE anon; CREATE ROLE authenticated;
CREATE SCHEMA auth; CREATE SCHEMA erp; CREATE SCHEMA comercial_360; CREATE SCHEMA crm;
CREATE SCHEMA seguranca_comercial; CREATE SCHEMA api_comercial; CREATE SCHEMA portal_acesso;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz);
CREATE TABLE erp.portal_usuarios(id bigint PRIMARY KEY,nome text,email text,perfil text,ativo bigint);
CREATE TABLE erp.portal_empresa_status(slug text,status text);
CREATE TABLE erp.portal_usuario_empresas(usuario_id bigint,empresa_slug text);
CREATE TABLE erp.portal_usuario_modulos(usuario_id bigint,empresa_slug text,modulo_id text);
CREATE TABLE comercial_360.crm_usuarios(auth_user_id uuid,ativo boolean);
CREATE TABLE seguranca_comercial.usuarios(usuario_id uuid,auth_user_id uuid,ativo boolean,perfil text,pode_ver_dados_pessoais boolean,pode_ver_valores boolean);
CREATE TABLE portal_acesso.permissoes(usuario_id uuid,empresa_id uuid,modulo text,pode_ler boolean,pode_gravar boolean);
CREATE FUNCTION portal_acesso.sessao_ativa() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT auth.uid() IS NOT NULL AND coalesce(current_setting('test.revoked',true),'') <> 'yes' $$;
CREATE TABLE comercial_360.empresas(empresa_id uuid PRIMARY KEY,nome text);
CREATE TABLE comercial_360.categorias_produto(categoria_id uuid PRIMARY KEY,codigo text,nome text);
CREATE TABLE comercial_360.produtos(produto_id uuid PRIMARY KEY,empresa_id uuid,categoria_id uuid,codigo text,nome text);
CREATE TABLE comercial_360.clientes(cliente_id_global uuid PRIMARY KEY,nome_preferencial text);
CREATE TABLE comercial_360.cliente_produtos(cliente_produto_id uuid PRIMARY KEY,cliente_id_global uuid,produto_id uuid,produto_codigo text,produto_nome text,status text,data_inicio date,data_vencimento date,atualizado_em timestamptz);
CREATE TABLE comercial_360.leads(lead_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),produto_id uuid,nome text,email text,telefone text,origem text,origem_tipo text,status text,objetivo text,faixa_valor text,investimento_mensal text,interesse_simulacao text,detalhes jsonb,criado_por uuid,atualizado_por uuid,atualizado_em timestamptz);
CREATE TABLE crm.oportunidades(oportunidade_id uuid PRIMARY KEY,cliente_id_global uuid,produto_id uuid,titulo text,valor_potencial numeric,etapa_tipo text);
CREATE TABLE crm.tarefas(tarefa_id uuid PRIMARY KEY,oportunidade_id uuid,cliente_id_global uuid,titulo text,status text);
CREATE TABLE crm.notas(nota_id uuid PRIMARY KEY,oportunidade_id uuid);
CREATE TABLE crm.interacoes(interacao_id uuid PRIMARY KEY,oportunidade_id uuid,cliente_id_global uuid,resumo text);
CREATE TABLE crm.audit(id uuid,action text,actor uuid);
CREATE TABLE comercial_360.events(evento_id uuid PRIMARY KEY,cliente_id_global uuid,produto_codigo text);

CREATE FUNCTION seguranca_comercial.crm_pipeline_seguro() RETURNS TABLE(etapa_id uuid,codigo text,nome text,ordem smallint,tipo text,probabilidade_padrao numeric,ativo boolean)
LANGUAGE sql SECURITY DEFINER AS $$ SELECT '60000000-0000-4000-8000-000000000001'::uuid,'ABERTO'::text,'Aberto'::text,1::smallint,'aberta'::text,10::numeric,true $$;
CREATE FUNCTION seguranca_comercial.crm_oportunidades_seguro() RETURNS TABLE(oportunidade_id uuid,cliente_id_global uuid,produto_id uuid,titulo text,valor_potencial numeric,etapa_tipo text)
LANGUAGE sql SECURITY DEFINER AS $$ SELECT o.oportunidade_id,o.cliente_id_global,o.produto_id,o.titulo,CASE WHEN u.pode_ver_valores THEN o.valor_potencial ELSE NULL END,o.etapa_tipo FROM crm.oportunidades o JOIN seguranca_comercial.usuarios u ON u.auth_user_id=auth.uid() $$;
CREATE FUNCTION seguranca_comercial.crm_tarefas_seguro() RETURNS SETOF crm.tarefas LANGUAGE sql SECURITY DEFINER AS $$ SELECT * FROM crm.tarefas $$;
-- Use RETURNS TABLE, matching the live contracts (not a SETOF composite).
DROP FUNCTION seguranca_comercial.crm_tarefas_seguro();
CREATE FUNCTION seguranca_comercial.crm_tarefas_seguro() RETURNS TABLE(tarefa_id uuid,oportunidade_id uuid,cliente_id_global uuid,titulo text,status text)
LANGUAGE sql SECURITY DEFINER AS $$ SELECT * FROM crm.tarefas $$;
CREATE FUNCTION seguranca_comercial.crm_interacoes_seguro() RETURNS TABLE(interacao_id uuid,oportunidade_id uuid,cliente_id_global uuid,resumo text)
LANGUAGE sql SECURITY DEFINER AS $$ SELECT * FROM crm.interacoes $$;
CREATE FUNCTION seguranca_comercial.cliente_produtos_seguro() RETURNS TABLE(cliente_produto_id uuid,cliente_id_global uuid,produto_id uuid,produto_codigo text,produto_nome text,status text,data_inicio date,data_vencimento date,atualizado_em timestamptz)
LANGUAGE sql SECURITY DEFINER AS $$ SELECT * FROM comercial_360.cliente_produtos $$;
CREATE FUNCTION seguranca_comercial.cliente_360_seguro() RETURNS TABLE(cliente_id_global uuid,nome_preferencial text,status_cliente text,produtos jsonb,total_vinculos_produto bigint,total_produtos_ativos bigint,total_eventos_contratuais bigint,primeira_data_inicio date,proximo_limite_contratual date,dados_atualizados_em timestamptz)
LANGUAGE sql SECURITY DEFINER AS $$ SELECT c.cliente_id_global,c.nome_preferencial,'ativo'::text,'[{"secret_other_company":"must_not_leak"}]'::jsonb,999::bigint,999::bigint,999::bigint,NULL::date,NULL::date,now() FROM comercial_360.clientes c $$;
CREATE FUNCTION seguranca_comercial.produtos_resumo_seguro() RETURNS TABLE(produto_id uuid,produto_codigo text,produto_nome text,categoria_codigo text,categoria_nome text,vinculos_total bigint,vinculos_ativos bigint,vinculos_inativos bigint,vinculos_em_validacao bigint,clientes_distintos bigint,ultima_atualizacao_origem_em timestamptz)
LANGUAGE sql SECURITY DEFINER AS $$ SELECT p.produto_id,p.codigo,p.nome,'TEST','Test',count(cp.*),count(cp.*),0::bigint,0::bigint,count(distinct cp.cliente_id_global),NULL::timestamptz FROM comercial_360.produtos p LEFT JOIN comercial_360.cliente_produtos cp USING(produto_id) GROUP BY p.produto_id $$;
CREATE FUNCTION seguranca_comercial.eventos_contratuais_seguro() RETURNS TABLE(evento_id uuid,cliente_id_global uuid,produto_codigo text)
LANGUAGE sql SECURITY DEFINER AS $$ SELECT * FROM comercial_360.events $$;
CREATE FUNCTION seguranca_comercial.crm_atualizar_oportunidade(p_dados jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN INSERT INTO crm.audit VALUES((p_dados->>'oportunidade_id')::uuid,'update',auth.uid()); RETURN (p_dados->>'oportunidade_id')::uuid; END $$;
CREATE FUNCTION seguranca_comercial.crm_mover_oportunidade(p_dados jsonb) RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$ SELECT seguranca_comercial.crm_atualizar_oportunidade(p_dados) $$;
CREATE FUNCTION seguranca_comercial.crm_criar_tarefa(p_dados jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$ DECLARE id uuid:=gen_random_uuid(); BEGIN INSERT INTO crm.tarefas VALUES(id,(p_dados->>'oportunidade_id')::uuid,NULL,p_dados->>'titulo','pendente'); INSERT INTO crm.audit VALUES(id,'create_task',auth.uid()); RETURN id; END $$;
CREATE FUNCTION seguranca_comercial.crm_concluir_tarefa(p_dados jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN UPDATE crm.tarefas SET status='concluida' WHERE tarefa_id=(p_dados->>'tarefa_id')::uuid; RETURN (p_dados->>'tarefa_id')::uuid; END $$;
CREATE FUNCTION seguranca_comercial.lead_criar_oportunidade(p_lead_id uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$ DECLARE id uuid:=gen_random_uuid(); BEGIN INSERT INTO crm.oportunidades SELECT id,NULL,produto_id,nome,0,'aberta' FROM comercial_360.leads WHERE lead_id=p_lead_id; RETURN id; END $$;
CREATE FUNCTION api_comercial.crm_concluir_tarefa(p_dados jsonb) RETURNS uuid LANGUAGE sql AS $$ SELECT seguranca_comercial.crm_concluir_tarefa(p_dados) $$;
CREATE VIEW api_comercial.crm_oportunidades WITH(security_invoker=true) AS SELECT * FROM seguranca_comercial.crm_oportunidades_seguro();
CREATE VIEW api_comercial.crm_tarefas WITH(security_invoker=true) AS SELECT * FROM seguranca_comercial.crm_tarefas_seguro();
GRANT USAGE ON SCHEMA api_comercial,seguranca_comercial,auth,comercial_360 TO authenticated;
GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA comercial_360 TO authenticated;
GRANT SELECT ON api_comercial.crm_oportunidades,api_comercial.crm_tarefas TO authenticated;
ALTER TABLE comercial_360.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE comercial_360.produtos ENABLE ROW LEVEL SECURITY;
ALTER TABLE comercial_360.clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE comercial_360.cliente_produtos ENABLE ROW LEVEL SECURITY;
CREATE POLICY legacy ON comercial_360.leads FOR ALL TO authenticated USING(true) WITH CHECK(true);
CREATE POLICY legacy ON comercial_360.produtos FOR ALL TO authenticated USING(true) WITH CHECK(true);
CREATE POLICY legacy ON comercial_360.clientes FOR ALL TO authenticated USING(true) WITH CHECK(true);
CREATE POLICY legacy ON comercial_360.cliente_produtos FOR ALL TO authenticated USING(true) WITH CHECK(true);
