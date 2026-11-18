-- REVIEW ONLY. Never apply to production before the synthetic rehearsal and approval.
-- No business row, user entitlement, finance calculation or existing identifier is changed.
BEGIN;
CREATE SCHEMA crm_scope_private;
REVOKE ALL ON SCHEMA crm_scope_private FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA crm_scope_private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
CREATE TABLE crm_scope_private.company_map (
 slug text PRIMARY KEY CHECK (slug IN ('assessoria','cred','ethernexus','grao','hortstufas','terceiriza','worldgym')),
 nome text NOT NULL, empresa_id uuid UNIQUE REFERENCES comercial_360.empresas(empresa_id),
 validated_at timestamptz, validated_by uuid REFERENCES auth.users(id), evidence text,
 CHECK ((validated_at IS NULL AND validated_by IS NULL) OR
        (empresa_id IS NOT NULL AND validated_at IS NOT NULL AND validated_by IS NOT NULL AND length(trim(evidence)) > 0))
);
ALTER TABLE crm_scope_private.company_map ENABLE ROW LEVEL SECURITY;
INSERT INTO crm_scope_private.company_map(slug,nome) VALUES
 ('assessoria','Capuzzo Assessoria & Consultoria'), ('cred','Capuzzo Cred'),
 ('ethernexus','Ether Nexus'), ('grao','Grão'), ('hortstufas','Hortstufas'),
 ('terceiriza','Terceiriza Fácil'), ('worldgym','World Gym');
-- No guessed mappings, including Grupo Capuzzo -> assessoria.
CREATE TABLE crm_scope_private.original_functions (
 signature text PRIMARY KEY, definition text NOT NULL, backup_name text NOT NULL
);
ALTER TABLE crm_scope_private.original_functions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA crm_scope_private FROM PUBLIC, anon, authenticated;

-- Copy the original security functions before replacing their public contracts.
-- Original validation, value masking and audit code remain in the private copies.
DO $copy$
DECLARE f record; backup text; definition text;
BEGIN
 FOR f IN SELECT p.oid,p.proname,pg_get_function_identity_arguments(p.oid) args
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='seguranca_comercial' AND
 (p.proname IN ('cliente_360_seguro','cliente_produtos_seguro','produtos_resumo_seguro',
  'dashboard_executivo_seguro','contratos_vencimentos_seguro','eventos_contratuais_seguro',
  'investimentos_posicoes_atuais_seguro','investimentos_saldos_atuais_seguro','cliente_chat_seguro',
  'lead_criar_oportunidade') OR p.proname LIKE 'crm_%' AND p.proname NOT IN ('crm_usuario_operacional','crm_responsavel_valido'))
 LOOP
  backup := 'original_' || f.proname;
  definition := pg_get_functiondef(f.oid);
  INSERT INTO crm_scope_private.original_functions VALUES
    (format('seguranca_comercial.%I(%s)',f.proname,f.args),definition,backup);
  EXECUTE replace(definition,format('FUNCTION seguranca_comercial.%I(',f.proname),
    format('FUNCTION crm_scope_private.%I(',backup));
  EXECUTE format('REVOKE ALL ON FUNCTION crm_scope_private.%I(%s) FROM PUBLIC,anon,authenticated',backup,f.args);
 END LOOP;
 IF NOT EXISTS (SELECT 1 FROM crm_scope_private.original_functions WHERE backup_name='original_crm_oportunidades_seguro') THEN
  RAISE EXCEPTION 'Expected security functions missing; stop and audit this database';
 END IF;
END $copy$;

-- Never trust Auth user_metadata or a browser supplied user ID for authorization.
CREATE FUNCTION crm_scope_private.erp_user() RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$
 SELECT min(u.id) FROM erp.portal_usuarios u JOIN auth.users a ON lower(a.email)=lower(u.email)
 WHERE a.id=(SELECT auth.uid()) AND a.email_confirmed_at IS NOT NULL AND u.ativo=1
 AND EXISTS(SELECT 1 FROM comercial_360.crm_usuarios c WHERE c.auth_user_id=a.id AND c.ativo)
 AND EXISTS(SELECT 1 FROM seguranca_comercial.usuarios s WHERE s.auth_user_id=a.id AND s.ativo AND s.perfil<>'pendente' AND s.pode_ver_dados_pessoais)
 AND portal_acesso.sessao_ativa()
 HAVING count(*)=1
$$;
CREATE FUNCTION crm_scope_private.general_access() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$
 SELECT EXISTS(SELECT 1 FROM erp.portal_usuarios u WHERE u.id=crm_scope_private.erp_user() AND
 (u.perfil='admin' OR EXISTS(SELECT 1 FROM erp.portal_usuario_modulos m WHERE m.usuario_id=u.id AND m.empresa_slug='_grupo' AND m.modulo_id='crm')))
$$;
-- Pending rows have no provable company: only the unrestricted ERP administrator
-- with CRM Geral may inspect them, and nobody may operate them before classification.
CREATE FUNCTION crm_scope_private.pending_access() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$
 SELECT crm_scope_private.general_access() AND EXISTS(SELECT 1 FROM erp.portal_usuarios u
 WHERE u.id=crm_scope_private.erp_user() AND u.perfil='admin'
 AND NOT EXISTS(SELECT 1 FROM erp.portal_usuario_empresas e WHERE e.usuario_id=u.id))
$$;
CREATE FUNCTION crm_scope_private.company_access(company uuid, writing boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$
 SELECT EXISTS(SELECT 1 FROM crm_scope_private.company_map m
 JOIN erp.portal_usuarios u ON u.id=crm_scope_private.erp_user()
 WHERE m.empresa_id=company AND m.validated_at IS NOT NULL
 AND (u.perfil='admin' OR NOT EXISTS(SELECT 1 FROM erp.portal_empresa_status st WHERE st.slug=m.slug AND st.status='inativo'))
 AND (EXISTS(SELECT 1 FROM erp.portal_usuario_empresas e WHERE e.usuario_id=u.id AND e.empresa_slug=m.slug)
   OR u.perfil='admin' AND NOT EXISTS(SELECT 1 FROM erp.portal_usuario_empresas e WHERE e.usuario_id=u.id))
 AND (u.perfil='admin' OR NOT EXISTS(SELECT 1 FROM erp.portal_usuario_modulos x WHERE x.usuario_id=u.id AND x.empresa_slug=m.slug)
   OR EXISTS(SELECT 1 FROM erp.portal_usuario_modulos x WHERE x.usuario_id=u.id AND x.empresa_slug=m.slug AND x.modulo_id='comercial'))
 AND EXISTS(SELECT 1 FROM portal_acesso.permissoes p WHERE p.usuario_id=(SELECT auth.uid()) AND p.empresa_id=company AND p.modulo='comercial' AND p.pode_ler AND (NOT writing OR p.pode_gravar)))
$$;
CREATE FUNCTION crm_scope_private.context(scope text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $$
DECLARE m crm_scope_private.company_map; u erp.portal_usuarios;
BEGIN
 SELECT * INTO u FROM erp.portal_usuarios WHERE id=crm_scope_private.erp_user();
 IF u.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='crm_scope_forbidden'; END IF;
 IF scope='geral' THEN
  IF NOT crm_scope_private.general_access() THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='crm_scope_forbidden'; END IF;
  RETURN jsonb_build_object('scope','geral','nome','CRM GERAL','empresa_id',NULL,'general',true,'can_general',true,'mapped',true,
   'can_write',EXISTS(SELECT 1 FROM crm_scope_private.company_map c WHERE crm_scope_private.company_access(c.empresa_id,true)));
 END IF;
 SELECT * INTO m FROM crm_scope_private.company_map c WHERE c.slug=scope OR c.empresa_id::text=scope AND c.validated_at IS NOT NULL;
 IF m.slug IS NULL OR NOT (
   (EXISTS(SELECT 1 FROM erp.portal_usuario_empresas e WHERE e.usuario_id=u.id AND e.empresa_slug=m.slug)
     OR u.perfil='admin' AND NOT EXISTS(SELECT 1 FROM erp.portal_usuario_empresas e WHERE e.usuario_id=u.id))
   AND (u.perfil='admin' OR NOT EXISTS(SELECT 1 FROM erp.portal_usuario_modulos x WHERE x.usuario_id=u.id AND x.empresa_slug=m.slug)
    OR EXISTS(SELECT 1 FROM erp.portal_usuario_modulos x WHERE x.usuario_id=u.id AND x.empresa_slug=m.slug AND x.modulo_id='comercial'))
 ) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='crm_scope_forbidden'; END IF;
 IF u.perfil<>'admin' AND EXISTS(SELECT 1 FROM erp.portal_empresa_status st WHERE st.slug=m.slug AND st.status='inativo') THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='crm_scope_forbidden';
 END IF;
 IF m.validated_at IS NOT NULL AND NOT crm_scope_private.company_access(m.empresa_id) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='crm_scope_forbidden';
 END IF;
 RETURN jsonb_build_object('scope',m.slug,'nome',m.nome,'empresa_id',m.empresa_id,'general',false,
 'can_general',crm_scope_private.general_access(),'mapped',m.validated_at IS NOT NULL,'can_write',crm_scope_private.company_access(m.empresa_id,true));
END $$;

CREATE FUNCTION crm_scope_private.product_access(product uuid, scope text, writing boolean DEFAULT false)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $$
DECLARE company uuid; target uuid;
BEGIN
 SELECT p.empresa_id INTO company FROM comercial_360.produtos p WHERE p.produto_id=product;
 IF scope='geral' THEN
  IF NOT crm_scope_private.general_access() THEN RETURN false; END IF;
  IF NOT writing AND NOT EXISTS(SELECT 1 FROM crm_scope_private.company_map m WHERE m.empresa_id=company AND m.validated_at IS NOT NULL)
  THEN RETURN crm_scope_private.pending_access(); END IF;
 ELSE
  SELECT m.empresa_id INTO target FROM crm_scope_private.company_map m
  WHERE (m.slug=scope OR m.empresa_id::text=scope) AND m.validated_at IS NOT NULL;
  IF target IS NULL OR company IS DISTINCT FROM target THEN RETURN false; END IF;
 END IF;
 RETURN crm_scope_private.company_access(company,writing);
END $$;
CREATE FUNCTION crm_scope_private.opportunity_access(opportunity uuid, scope text, writing boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$
 SELECT EXISTS(SELECT 1 FROM crm.oportunidades o WHERE o.oportunidade_id=opportunity AND crm_scope_private.product_access(o.produto_id,scope,writing))
$$;
CREATE FUNCTION crm_scope_private.client_access(client uuid, scope text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$
 SELECT EXISTS(SELECT 1 FROM comercial_360.cliente_produtos cp WHERE cp.cliente_id_global=client AND crm_scope_private.product_access(cp.produto_id,scope))
 OR EXISTS(SELECT 1 FROM crm.oportunidades o WHERE o.cliente_id_global=client AND crm_scope_private.product_access(o.produto_id,scope))
$$;

-- Exact same masked records as the original functions; filter at the DB boundary.
CREATE FUNCTION crm_scope_private.rows(scope text, kind text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $$
DECLARE ctx jsonb; source text; result jsonb; links jsonb; events jsonb; products jsonb; clients jsonb; leads jsonb;
BEGIN
 ctx:=crm_scope_private.context(scope);
 IF NOT (ctx->>'mapped')::boolean THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='company_mapping_pending'; END IF;
 IF kind='dashboard' THEN
  products:=crm_scope_private.rows(scope,'products'); clients:=crm_scope_private.rows(scope,'clients'); leads:=crm_scope_private.rows(scope,'leads');
  RETURN jsonb_build_array(jsonb_build_object('products',products,'leadsTotal',jsonb_array_length(leads),
   'executive',jsonb_build_object('clientes_total',jsonb_array_length(clients),
    'clientes_ativos',(SELECT count(*) FROM jsonb_array_elements(clients)c WHERE c->>'status_cliente'='ativo'),
    'clientes_inativos',(SELECT count(*) FROM jsonb_array_elements(clients)c WHERE c->>'status_cliente'='inativo'),
    'clientes_em_validacao',(SELECT count(*) FROM jsonb_array_elements(clients)c WHERE c->>'status_cliente'='em_validacao'),
    'vinculos_total',(SELECT coalesce(sum((p->>'vinculos_total')::bigint),0) FROM jsonb_array_elements(products)p),
    'vinculos_ativos',(SELECT coalesce(sum((p->>'vinculos_ativos')::bigint),0) FROM jsonb_array_elements(products)p),
    'vinculos_inativos',(SELECT coalesce(sum((p->>'vinculos_inativos')::bigint),0) FROM jsonb_array_elements(products)p),
    'vinculos_em_validacao',(SELECT coalesce(sum((p->>'vinculos_em_validacao')::bigint),0) FROM jsonb_array_elements(products)p),
    'eventos_contratuais',jsonb_array_length(crm_scope_private.rows(scope,'events')),
    'pendencias_qualidade',NULL,'consultado_em',now())));
 END IF;
 source:=CASE kind WHEN 'pipeline' THEN 'crm_pipeline_seguro'
 WHEN 'opportunities' THEN 'crm_oportunidades_seguro' WHEN 'tasks' THEN 'crm_tarefas_seguro'
 WHEN 'interactions' THEN 'crm_interacoes_seguro' WHEN 'notes' THEN 'crm_notas_seguro'
 WHEN 'conversions' THEN 'crm_conversoes_seguro' WHEN 'clients' THEN 'cliente_360_seguro'
 WHEN 'products' THEN 'produtos_resumo_seguro' WHEN 'links' THEN 'cliente_produtos_seguro'
 WHEN 'events' THEN 'eventos_contratuais_seguro' WHEN 'expirations' THEN 'contratos_vencimentos_seguro'
 WHEN 'positions' THEN 'investimentos_posicoes_atuais_seguro' WHEN 'balances' THEN 'investimentos_saldos_atuais_seguro'
 WHEN 'chat' THEN 'cliente_chat_seguro' ELSE NULL END;
 IF kind='leads' THEN
  SELECT coalesce(jsonb_agg(to_jsonb(l) || jsonb_build_object('produto_codigo',p.codigo,'produto_nome',p.nome,
   'categoria_codigo',c.codigo,'categoria_nome',c.nome) ORDER BY l.lead_id),'[]') INTO result
  FROM comercial_360.leads l JOIN comercial_360.produtos p USING(produto_id)
  JOIN comercial_360.categorias_produto c USING(categoria_id) WHERE crm_scope_private.product_access(l.produto_id,scope);
  RETURN result;
 END IF;
 IF source IS NULL THEN RAISE EXCEPTION 'invalid_kind'; END IF;
 EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(r)),''[]''::jsonb) FROM crm_scope_private.%I() r','original_'||source) INTO result;
 IF kind='pipeline' THEN RETURN result; END IF;
 IF kind='balances' OR kind='chat' THEN
  -- These legacy projections contain cross-company nested content and no business key.
  -- Do not infer its company from a shared client identity.
  IF NOT crm_scope_private.pending_access() OR scope<>'geral' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='legacy_projection_requires_classification'; END IF;
  RETURN result;
 END IF;
 IF kind='clients' THEN
  links:=crm_scope_private.rows(scope,'links'); events:=crm_scope_private.rows(scope,'events');
  SELECT coalesce(jsonb_agg(
   (c - ARRAY['produtos','total_vinculos_produto','total_produtos_ativos','total_eventos_contratuais','primeira_data_inicio','proximo_limite_contratual','dados_atualizados_em'])
   || jsonb_build_object(
   'produtos',(SELECT coalesce(jsonb_agg(jsonb_build_object('produto_codigo',v->>'produto_codigo','produto_nome',v->>'produto_nome','status',v->>'status')),'[]') FROM jsonb_array_elements(links)v WHERE v->>'cliente_id_global'=c->>'cliente_id_global'),
   'total_vinculos_produto',(SELECT count(*) FROM jsonb_array_elements(links)v WHERE v->>'cliente_id_global'=c->>'cliente_id_global'),
   'total_produtos_ativos',(SELECT count(*) FROM jsonb_array_elements(links)v WHERE v->>'cliente_id_global'=c->>'cliente_id_global' AND v->>'status'='ativo'),
   'total_eventos_contratuais',(SELECT count(*) FROM jsonb_array_elements(events)v WHERE v->>'cliente_id_global'=c->>'cliente_id_global'),
   'primeira_data_inicio',(SELECT min(v->>'data_inicio') FROM jsonb_array_elements(links)v WHERE v->>'cliente_id_global'=c->>'cliente_id_global'),
   'proximo_limite_contratual',(SELECT min(v->>'data_vencimento') FROM jsonb_array_elements(links)v WHERE v->>'cliente_id_global'=c->>'cliente_id_global'),
   'dados_atualizados_em',(SELECT max(v->>'atualizado_em') FROM jsonb_array_elements(links)v WHERE v->>'cliente_id_global'=c->>'cliente_id_global')
   ) ORDER BY c->>'cliente_id_global'),'[]') INTO result
  FROM jsonb_array_elements(result)c WHERE crm_scope_private.client_access((c->>'cliente_id_global')::uuid,scope);
  RETURN result;
 END IF;
 IF kind='opportunities' THEN
  SELECT coalesce(jsonb_agg(r || jsonb_build_object('classificacao',
   CASE WHEN EXISTS(SELECT 1 FROM comercial_360.produtos p JOIN crm_scope_private.company_map m USING(empresa_id)
    WHERE p.produto_id=(r->>'produto_id')::uuid AND m.validated_at IS NOT NULL) THEN 'classificado' ELSE 'pendente' END)),'[]') INTO result
  FROM jsonb_array_elements(result)r;
 END IF;
 IF kind IN ('tasks','interactions','notes','conversions') THEN
  SELECT coalesce(jsonb_agg(r ORDER BY coalesce(r->>'tarefa_id',r->>'interacao_id',r->>'nota_id',r->>'conversao_id')),'[]') INTO result
  FROM jsonb_array_elements(result)r WHERE
   CASE WHEN r->>'oportunidade_id' IS NOT NULL THEN crm_scope_private.opportunity_access((r->>'oportunidade_id')::uuid,scope)
   ELSE scope='geral' AND crm_scope_private.pending_access() END;
  RETURN result;
 END IF;
 SELECT coalesce(jsonb_agg(r ORDER BY coalesce(r->>'oportunidade_id',r->>'cliente_produto_id',r->>'evento_id',r->>'posicao_id',r->>'produto_id')),'[]') INTO result
 FROM jsonb_array_elements(result)r WHERE crm_scope_private.product_access(
   coalesce((r->>'produto_id')::uuid,(SELECT (array_agg(p.produto_id))[1] FROM comercial_360.produtos p WHERE p.codigo=r->>'produto_codigo' HAVING count(*)=1)),scope);
 RETURN result;
END $$;

-- Central write guard used by new and pre-existing RPCs. Lock rows until commit.
CREATE FUNCTION crm_scope_private.assert_write(scope text, action text, payload jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE product uuid; opportunity uuid; task crm.tarefas; note crm.notas;
BEGIN
 PERFORM crm_scope_private.context(scope);
 -- Validate every supplied reference independently: an allowed opportunity must
 -- never hide a forbidden task/lead/note in the same legacy RPC payload.
 IF payload ? 'tarefa_id' AND NOT EXISTS(SELECT 1 FROM crm.tarefas t JOIN crm.oportunidades o USING(oportunidade_id)
  WHERE t.tarefa_id=(payload->>'tarefa_id')::uuid AND crm_scope_private.product_access(o.produto_id,scope,true)) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='crm_task_forbidden';
 END IF;
 IF payload ? 'nota_id' AND NOT EXISTS(SELECT 1 FROM crm.notas n JOIN crm.oportunidades o USING(oportunidade_id)
  WHERE n.nota_id=(payload->>'nota_id')::uuid AND crm_scope_private.product_access(o.produto_id,scope,true)) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='crm_note_forbidden';
 END IF;
 IF payload ? 'lead_id' AND NOT EXISTS(SELECT 1 FROM comercial_360.leads l
  WHERE l.lead_id=(payload->>'lead_id')::uuid AND crm_scope_private.product_access(l.produto_id,scope,true)) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='crm_lead_forbidden';
 END IF;
 IF payload ? 'cliente_id_global' AND NOT crm_scope_private.client_access((payload->>'cliente_id_global')::uuid,scope) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='crm_client_forbidden';
 END IF;
 IF jsonb_typeof(payload)<>'object' THEN RAISE EXCEPTION 'invalid_payload'; END IF;
 IF payload ? 'oportunidade_id' THEN
  SELECT o.oportunidade_id,o.produto_id INTO opportunity,product FROM crm.oportunidades o
  WHERE o.oportunidade_id=(payload->>'oportunidade_id')::uuid FOR UPDATE;
  IF opportunity IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='crm_record_forbidden'; END IF;
 ELSIF payload ? 'tarefa_id' THEN
  SELECT * INTO task FROM crm.tarefas WHERE tarefa_id=(payload->>'tarefa_id')::uuid FOR UPDATE;
  SELECT o.produto_id INTO product FROM crm.oportunidades o WHERE o.oportunidade_id=task.oportunidade_id FOR UPDATE;
 ELSIF payload ? 'nota_id' THEN
  SELECT * INTO note FROM crm.notas WHERE nota_id=(payload->>'nota_id')::uuid FOR UPDATE;
  SELECT o.produto_id INTO product FROM crm.oportunidades o WHERE o.oportunidade_id=note.oportunidade_id FOR UPDATE;
 ELSIF payload ? 'lead_id' THEN
  SELECT l.produto_id INTO product FROM comercial_360.leads l WHERE l.lead_id=(payload->>'lead_id')::uuid FOR UPDATE;
 ELSE product:=(payload->>'produto_id')::uuid;
 END IF;
 IF NOT coalesce(crm_scope_private.product_access(product,scope,true),false) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='crm_record_forbidden';
 END IF;
 -- Product reassignment, if supported by an existing RPC, must be authorized too.
 IF payload ? 'produto_id' AND NOT crm_scope_private.product_access((payload->>'produto_id')::uuid,scope,true) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='crm_product_forbidden';
 END IF;
 -- No multiproduct or company override until the business contract supports it.
 IF payload ?| ARRAY['empresa_id','company','empresas','produtos','items','itens'] THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='explicit_business_classification_required';
 END IF;
 IF action='crm_mover_oportunidade' AND upper(payload->>'etapa_codigo')='FECHADO' THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='formalization_required';
 END IF;
END $$;

CREATE FUNCTION api_comercial.crm_escopo_contexto(p_escopo text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT crm_scope_private.context(p_escopo) $$;
CREATE FUNCTION api_comercial.crm_escopo_consultar(p_escopo text,p_tipo text,p_pagina integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $$
DECLARE rows jsonb; page jsonb;
BEGIN
 IF p_pagina<0 OR p_pagina>999999 THEN RAISE EXCEPTION 'invalid_page'; END IF;
 rows:=crm_scope_private.rows(p_escopo,p_tipo);
 SELECT coalesce(jsonb_agg(value ORDER BY ord),'[]') INTO page FROM jsonb_array_elements(rows) WITH ORDINALITY r(value,ord)
 WHERE ord>p_pagina::bigint*200 AND ord<=(p_pagina::bigint+1)*200;
 RETURN jsonb_build_object('rows',page,'next',CASE WHEN jsonb_array_length(rows)>(p_pagina::bigint+1)*200 THEN p_pagina+1 ELSE NULL END);
END $$;

CREATE FUNCTION api_comercial.crm_escopo_operar(p_escopo text,p_acao text,p_dados jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE id uuid; expected text[]; old_scope text;
BEGIN
 expected:=CASE p_acao
 WHEN 'crm_mover_oportunidade' THEN ARRAY['oportunidade_id','etapa_codigo','motivo_perda']
 WHEN 'crm_atualizar_oportunidade' THEN ARRAY['oportunidade_id','proxima_acao','proxima_acao_em','previsao_fechamento']
 WHEN 'crm_criar_tarefa' THEN ARRAY['oportunidade_id','titulo','descricao','tipo','prioridade','prazo_em']
 WHEN 'crm_concluir_tarefa' THEN ARRAY['tarefa_id']
 WHEN 'lead_create' THEN ARRAY['produto_id','nome','email','telefone','origem','objetivo','faixa_valor','investimento_mensal','interesse_simulacao']
 WHEN 'lead_status' THEN ARRAY['lead_id','status']
 WHEN 'lead_criar_oportunidade' THEN ARRAY['lead_id'] ELSE NULL END;
 IF expected IS NULL OR jsonb_typeof(p_dados)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_dados) k WHERE NOT k=ANY(expected)) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='invalid_action_payload';
 END IF;
 PERFORM crm_scope_private.assert_write(p_escopo,p_acao,p_dados);
 -- Nested legacy operations inherit this scope, but recheck the actual record.
 old_scope:=current_setting('crm_scope.scope',true);
 PERFORM set_config('crm_scope.scope',p_escopo,true);
 IF p_acao='lead_create' THEN
  IF length(trim(p_dados->>'nome'))<2 OR length(p_dados->>'nome')>200 THEN RAISE EXCEPTION 'invalid_name'; END IF;
  INSERT INTO comercial_360.leads(produto_id,nome,email,telefone,origem,origem_tipo,status,objetivo,faixa_valor,investimento_mensal,interesse_simulacao,detalhes,criado_por)
  VALUES((p_dados->>'produto_id')::uuid,trim(p_dados->>'nome'),nullif(trim(p_dados->>'email'),''),nullif(trim(p_dados->>'telefone'),''),
   coalesce(nullif(p_dados->>'origem',''),'CRM Comercial 360'),'manual','novo',p_dados->>'objetivo',p_dados->>'faixa_valor',p_dados->>'investimento_mensal',p_dados->>'interesse_simulacao','{}',auth.uid())
  RETURNING lead_id INTO id;
 ELSIF p_acao='lead_status' THEN
  IF NOT p_dados->>'status'=ANY(ARRAY['novo','em_contato','qualificado','proposta','negociacao','convertido','perdido']) THEN RAISE EXCEPTION 'invalid_status'; END IF;
  UPDATE comercial_360.leads SET status=p_dados->>'status',atualizado_por=auth.uid(),atualizado_em=now() WHERE lead_id=(p_dados->>'lead_id')::uuid RETURNING lead_id INTO id;
 ELSIF p_acao='lead_criar_oportunidade' THEN
  id:=crm_scope_private.original_lead_criar_oportunidade((p_dados->>'lead_id')::uuid);
 ELSE
  EXECUTE format('SELECT crm_scope_private.%I($1)','original_'||p_acao) INTO id USING p_dados;
 END IF;
 PERFORM set_config('crm_scope.scope',coalesce(old_scope,''),true);
 RETURN id;
END $$;
REVOKE ALL ON FUNCTION api_comercial.crm_escopo_contexto(text),api_comercial.crm_escopo_consultar(text,text,integer),api_comercial.crm_escopo_operar(text,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION api_comercial.crm_escopo_contexto(text),api_comercial.crm_escopo_consultar(text,text,integer),api_comercial.crm_escopo_operar(text,text,jsonb) TO authenticated;

-- Replace the SAME OIDs: existing security_invoker views remain attached to these
-- contracts. Renaming originals would leave views pointing at the unguarded code.
DO $wrap$
DECLARE f record; kind text; return_type text; columns text;
BEGIN
 FOR f IN SELECT p.oid,p.proname,pg_get_function_identity_arguments(p.oid) args FROM pg_proc p
 JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='seguranca_comercial'
 AND EXISTS(SELECT 1 FROM crm_scope_private.original_functions b WHERE b.backup_name='original_'||p.proname)
 LOOP
  return_type:=pg_get_function_result(f.oid);
  IF f.args='' THEN
   kind:=CASE f.proname
   WHEN 'crm_pipeline_seguro' THEN 'pipeline' WHEN 'crm_oportunidades_seguro' THEN 'opportunities'
   WHEN 'crm_tarefas_seguro' THEN 'tasks' WHEN 'crm_interacoes_seguro' THEN 'interactions'
   WHEN 'crm_notas_seguro' THEN 'notes' WHEN 'crm_conversoes_seguro' THEN 'conversions'
   WHEN 'cliente_360_seguro' THEN 'clients' WHEN 'produtos_resumo_seguro' THEN 'products'
   WHEN 'cliente_produtos_seguro' THEN 'links' WHEN 'eventos_contratuais_seguro' THEN 'events'
   WHEN 'contratos_vencimentos_seguro' THEN 'expirations' WHEN 'investimentos_posicoes_atuais_seguro' THEN 'positions'
   WHEN 'investimentos_saldos_atuais_seguro' THEN 'balances' WHEN 'cliente_chat_seguro' THEN 'chat'
   WHEN 'dashboard_executivo_seguro' THEN 'executive' ELSE NULL END;
   IF kind IS NULL THEN RAISE EXCEPTION 'Unhandled reader %',f.proname; END IF;
   columns:=substring(return_type FROM 7 FOR length(return_type)-7);
   IF kind='executive' THEN
    EXECUTE format('CREATE OR REPLACE FUNCTION seguranca_comercial.%I() RETURNS %s LANGUAGE sql STABLE SECURITY DEFINER SET search_path='''' AS %L',
      f.proname,return_type,'SELECT * FROM jsonb_to_recordset(jsonb_build_array(crm_scope_private.rows(''geral'',''dashboard'')->0->''executive'')) AS r('||columns||')');
   ELSE
    EXECUTE format('CREATE OR REPLACE FUNCTION seguranca_comercial.%I() RETURNS %s LANGUAGE sql STABLE SECURITY DEFINER SET search_path='''' AS %L',
      f.proname,return_type,'SELECT * FROM jsonb_to_recordset(crm_scope_private.rows(''geral'','||quote_literal(kind)||')) AS r('||columns||')');
   END IF;
  ELSIF f.proname='lead_criar_oportunidade' THEN
   EXECUTE 'CREATE OR REPLACE FUNCTION seguranca_comercial.lead_criar_oportunidade(p_lead_id uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=''''
    AS $b$ DECLARE s text:=coalesce(nullif(current_setting(''crm_scope.scope'',true),''''),''geral''); BEGIN
    PERFORM crm_scope_private.assert_write(s,''lead_criar_oportunidade'',jsonb_build_object(''lead_id'',p_lead_id));
    RETURN crm_scope_private.original_lead_criar_oportunidade(p_lead_id); END $b$';
  ELSIF f.args='p_dados jsonb' THEN
   EXECUTE format('CREATE OR REPLACE FUNCTION seguranca_comercial.%I(p_dados jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='''' AS %L',
    f.proname,'DECLARE s text:=coalesce(nullif(current_setting(''crm_scope.scope'',true),''''),''geral''); BEGIN PERFORM crm_scope_private.assert_write(s,'||quote_literal(f.proname)||',p_dados); RETURN crm_scope_private.'||quote_ident('original_'||f.proname)||'(p_dados); END');
  ELSE RAISE EXCEPTION 'Unhandled function %',f.proname;
  END IF;
 END LOOP;
END $wrap$;

-- Defense in depth for existing direct REST paths, composed with existing policies.
-- The helpers check the same union of authorized companies; they do not trust UI scope.
GRANT USAGE ON SCHEMA crm_scope_private TO authenticated;
GRANT EXECUTE ON FUNCTION crm_scope_private.product_access(uuid,text,boolean),crm_scope_private.client_access(uuid,text) TO authenticated;
-- Restrictive writes must not require CRM Geral for company-only users.
CREATE FUNCTION crm_scope_private.any_product_access(product uuid,writing boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM crm_scope_private.company_map m WHERE crm_scope_private.product_access(product,m.slug,writing))
$$;
GRANT EXECUTE ON FUNCTION crm_scope_private.any_product_access(uuid,boolean) TO authenticated;
-- Avoid granting the mapping table to browser roles.
CREATE POLICY crm_company_read ON comercial_360.leads AS RESTRICTIVE FOR SELECT TO authenticated
 USING(crm_scope_private.product_access(produto_id,'geral') OR crm_scope_private.any_product_access(produto_id,false));
CREATE POLICY crm_company_insert ON comercial_360.leads AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK(crm_scope_private.any_product_access(produto_id,true));
CREATE POLICY crm_company_update ON comercial_360.leads AS RESTRICTIVE FOR UPDATE TO authenticated
 USING(crm_scope_private.any_product_access(produto_id,true)) WITH CHECK(crm_scope_private.any_product_access(produto_id,true));
CREATE POLICY crm_company_products ON comercial_360.produtos AS RESTRICTIVE FOR SELECT TO authenticated
 USING(crm_scope_private.product_access(produto_id,'geral') OR crm_scope_private.any_product_access(produto_id,false));
CREATE POLICY crm_company_links ON comercial_360.cliente_produtos AS RESTRICTIVE FOR SELECT TO authenticated
 USING(crm_scope_private.product_access(produto_id,'geral') OR crm_scope_private.any_product_access(produto_id,false));
-- Original blanket CRM enrollment never grants access by itself.
CREATE POLICY crm_company_clients ON comercial_360.clientes AS RESTRICTIVE FOR SELECT TO authenticated
 USING(crm_scope_private.client_access(cliente_id_global,'geral') OR
 EXISTS(SELECT 1 FROM comercial_360.cliente_produtos cp WHERE cp.cliente_id_global=clientes.cliente_id_global AND crm_scope_private.any_product_access(cp.produto_id,false)));

CREATE INDEX crm_scope_lead_product ON comercial_360.leads(produto_id,lead_id);
COMMIT;
