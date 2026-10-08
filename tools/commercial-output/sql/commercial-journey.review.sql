-- REVIEW ONLY. Not applied. Requires approval and isolated PostgreSQL/RLS tests.
-- Extends the inspected crm/comercial_360 model; does not replace CRM RPCs.
-- No real records, approved templates, routes, permissions or identity links included.
begin;
create table crm.commercial_routes (
  product uuid primary key references comercial_360.produtos(produto_id),
  company uuid not null references comercial_360.empresas(empresa_id),
  responsible uuid not null references auth.users(id), enabled boolean not null default false,
  hourly_limit integer not null check(hourly_limit between 1 and 100)
);
create table crm.commercial_permissions (
  user_id uuid not null references auth.users(id), company uuid not null references comercial_360.empresas(empresa_id),
  module text not null check(module in ('comercial','juridico','financeiro')), can_write boolean not null default false,
  primary key(user_id,company,module)
);
create table crm.commercial_templates (
  product uuid primary key references comercial_360.produtos(produto_id), definition jsonb not null,
  check(jsonb_typeof(definition)='object'), check(coalesce(definition->>'approved','')='true'),
  check(coalesce(jsonb_typeof(definition->'fields'),'')='array'),
  check(coalesce(jsonb_typeof(definition->'documents'),'')='array'),
  check(coalesce(jsonb_typeof(definition->'signatureRequired'),'')='boolean'),
  check(coalesce(definition->>'version','') ~ '^[1-9][0-9]*$'),
  check(coalesce(definition->>'id','')<>''),
  check(coalesce(definition->>'product','')=product::text)
);
create table crm.commercial_client_links (
  opportunity uuid primary key references crm.oportunidades(oportunidade_id), client uuid not null references comercial_360.clientes(cliente_id_global),
  confirmed_by uuid not null references auth.users(id), approval_reference text not null check(length(approval_reference)>0)
);
create table crm.commercial_journeys (
  opportunity uuid primary key references crm.oportunidades(oportunidade_id),
  company uuid not null references comercial_360.empresas(empresa_id), state jsonb not null,
  version integer not null check(version>0), check((state->>'version')::integer=version)
);
create table crm.commercial_requests (
  opportunity uuid not null references crm.oportunidades(oportunidade_id), request uuid not null,
  command jsonb not null, response jsonb not null, actor uuid not null references auth.users(id),
  recorded_at timestamptz not null default now(), primary key(opportunity,request)
);
create table crm.commercial_outputs (
  business uuid not null references crm.oportunidades(oportunidade_id), version integer not null,
  company uuid not null references comercial_360.empresas(empresa_id), payload jsonb not null,
  recorded_at timestamptz not null default now(), primary key(business,version), unique(business),
  check(payload->>'formalization'='completed'), check(payload->>'source'='crm_new'),
  check(payload->>'affectsInvestmentPositions'='false')
);
-- Changes after closing are rejected. A separately reviewed amendment RPC must append
-- revisions before unique(business) can be extended; never UPDATE output history.
create table crm.commercial_submissions (
  submission uuid primary key, fingerprint text not null, lead uuid not null references comercial_360.leads(lead_id),
  product uuid not null references comercial_360.produtos(produto_id), received_at timestamptz not null default now()
);
create index commercial_journeys_company on crm.commercial_journeys(company);
create index commercial_outputs_company on crm.commercial_outputs(company);
create index commercial_submissions_product_received on crm.commercial_submissions(product,received_at);
create index commercial_routes_company on crm.commercial_routes(company);
create index commercial_routes_responsible on crm.commercial_routes(responsible);
create index commercial_links_client on crm.commercial_client_links(client);
create index commercial_links_confirmer on crm.commercial_client_links(confirmed_by);
create index commercial_requests_actor on crm.commercial_requests(actor);
create index commercial_permissions_company on crm.commercial_permissions(company);
create index commercial_submissions_lead on crm.commercial_submissions(lead);
alter table crm.commercial_routes enable row level security;
alter table crm.commercial_permissions enable row level security;
alter table crm.commercial_templates enable row level security;
alter table crm.commercial_client_links enable row level security;
alter table crm.commercial_journeys enable row level security;
alter table crm.commercial_requests enable row level security;
alter table crm.commercial_outputs enable row level security;
alter table crm.commercial_submissions enable row level security;
revoke all on crm.commercial_routes,crm.commercial_permissions,crm.commercial_templates,crm.commercial_client_links,crm.commercial_journeys,crm.commercial_requests,crm.commercial_outputs,crm.commercial_submissions from public,anon,authenticated;

create function seguranca_comercial.commercial_allowed(p_company uuid,p_module text,p_write boolean default false) returns boolean
language sql stable security definer set search_path='' as $$
select auth.uid() is not null and exists(select 1 from crm.commercial_permissions p where p.user_id=auth.uid() and p.company=p_company and p.module=p_module and (not p_write or p.can_write))
and exists(select 1 from comercial_360.crm_usuarios u where u.auth_user_id=auth.uid() and u.ativo);
$$;
create function api_comercial.commercial_intake_catalog() returns jsonb language sql stable security definer set search_path='' as $$
select coalesce(jsonb_agg(jsonb_build_object('code',p.codigo,'name',p.nome) order by p.nome),'[]'::jsonb)
from crm.commercial_routes r join comercial_360.produtos p on p.produto_id=r.product join comercial_360.empresas e on e.empresa_id=r.company
where r.enabled and p.ativo and e.ativa and p.empresa_id=r.company
and exists(select 1 from comercial_360.crm_usuarios u where u.auth_user_id=r.responsible and u.ativo);
$$;
create function api_comercial.commercial_receive_input(p_submission uuid,p_contact jsonb) returns boolean language plpgsql security definer set search_path='' as $$
declare r crm.commercial_routes%rowtype; previous crm.commercial_submissions%rowtype; fingerprint text; new_lead uuid;
begin
  if p_submission is null or jsonb_typeof(p_contact)<>'object' or octet_length(p_contact::text)>4096
  or exists(select 1 from jsonb_object_keys(p_contact) k where k not in ('nome','telefone','email','interesse','empresa_contato'))
  or length(btrim(coalesce(p_contact->>'nome',''))) not between 2 and 160 or coalesce(p_contact->>'interesse','')=''
  or exists(select 1 from jsonb_each(p_contact) e where jsonb_typeof(e.value)<>'string')
  or (coalesce(p_contact->>'telefone','')='' and coalesce(p_contact->>'email','')='')
  or (coalesce(p_contact->>'email','')<>'' and (length(p_contact->>'email')>254 or p_contact->>'email' !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'))
  or (coalesce(p_contact->>'telefone','')<>'' and (p_contact->>'telefone' !~ '^\+?[0-9 ()-]{8,32}$' or length(regexp_replace(p_contact->>'telefone','[^0-9]','','g'))<8))
  or length(coalesce(p_contact->>'empresa_contato',''))>160 then raise exception using errcode='22023',message='INVALID_CONTACT'; end if;
  -- Serialize retries globally; never perform customer lookup by submitted identifiers.
  perform pg_advisory_xact_lock(hashtextextended(p_submission::text,0));
  fingerprint:=encode(sha256(convert_to(p_contact::text,'UTF8')),'hex');
  select * into previous from crm.commercial_submissions where submission=p_submission;
  if found then if previous.fingerprint<>fingerprint then raise exception using errcode='40001',message='SUBMISSION_CONFLICT'; end if; return true; end if;
  select route.* into r from crm.commercial_routes route join comercial_360.produtos p on p.produto_id=route.product join comercial_360.empresas e on e.empresa_id=route.company
  where p.codigo=p_contact->>'interesse' and p.ativo and e.ativa and route.enabled and p.empresa_id=route.company
  and exists(select 1 from comercial_360.crm_usuarios u where u.auth_user_id=route.responsible and u.ativo);
  if not found then raise exception using errcode='22023',message='INTAKE_ROUTE_UNAVAILABLE'; end if;
  perform pg_advisory_xact_lock(hashtextextended(r.product::text,1));
  if (select count(*) from crm.commercial_submissions s where s.product=r.product and s.received_at>now()-interval '1 hour')>=r.hourly_limit then raise exception using errcode='22023',message='INTAKE_LIMIT'; end if;
  insert into comercial_360.leads(produto_id,nome,telefone,email,origem,origem_tipo,origem_registro_id,status,detalhes,criado_por,data_entrada)
  values(r.product,btrim(p_contact->>'nome'),nullif(p_contact->>'telefone',''),nullif(lower(p_contact->>'email'),''),'Portal: formulário comercial','manual',p_submission::text,'novo',
  jsonb_build_object('company',r.company,'responsible',r.responsible,'empresa_contato',coalesce(p_contact->>'empresa_contato',''),'intake_version',1),null,now()) returning lead_id into new_lead;
  insert into crm.commercial_submissions(submission,fingerprint,lead,product) values(p_submission,fingerprint,new_lead,r.product);
  return true;
end; $$;
create function api_comercial.commercial_get_journey(p_opportunity uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare o crm.oportunidades%rowtype; v_company uuid; v_state jsonb; template jsonb;
begin
  select * into o from crm.oportunidades where oportunidade_id=p_opportunity;
  select p.empresa_id into v_company from comercial_360.produtos p where p.produto_id=o.produto_id;
  if not seguranca_comercial.commercial_allowed(v_company,'comercial') and not seguranca_comercial.commercial_allowed(v_company,'juridico') then raise exception using errcode='42501',message='ACCESS_DENIED'; end if;
  if o.fechada_em is not null then
    if not exists(select 1 from crm.commercial_journeys j where j.opportunity=p_opportunity) then raise exception using errcode='22023',message='EXISTING_CLOSING_REQUIRES_REVIEW'; end if;
  end if;
  select j.state into v_state from crm.commercial_journeys j where j.opportunity=p_opportunity;
  if v_state is not null and ((v_state->>'company')::uuid is distinct from v_company or (v_state->>'product')::uuid is distinct from o.produto_id or (v_state->>'client')::uuid is distinct from o.cliente_id_global) then raise exception using errcode='40001',message='CRM_STATE_CHANGED'; end if;
  if v_state is null then
    v_state:=jsonb_build_object('id',p_opportunity,'lead',(select l.lead_id from comercial_360.leads l where l.produto_id=o.produto_id and l.detalhes->>'crm_oportunidade_id'=p_opportunity::text),'client',o.cliente_id_global,'company',v_company,'opportunity',p_opportunity,'product',o.produto_id,'stage',case when o.cliente_id_global is null then 'lead' else 'qualified' end,'proposal',null,'contract',null,'version',0,'source','crm_new','closedAt',null);
  end if;
  select t.definition into template from crm.commercial_templates t where t.product=o.produto_id;
  return jsonb_build_object('journey',v_state,'template',template);
end; $$;
create function api_comercial.commercial_apply_command(p_opportunity uuid,p_command jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare snapshot jsonb; s jsonb; t jsonb; c jsonb; action text; company uuid; expected integer; req uuid; prior crm.commercial_requests%rowtype; f jsonb; item jsonb; result jsonb; amount numeric:=0; v integer;
begin
  if jsonb_typeof(p_command)<>'object' or octet_length(p_command::text)>32768 then raise exception using errcode='22023',message='INVALID_COMMAND'; end if;
  action:=p_command->>'action'; req:=(p_command->>'request')::uuid; expected:=(p_command->>'expectedVersion')::integer;
  if req is null or expected is null or action not in ('qualify','propose','accept','complete','formalize','close')
  or exists(select 1 from jsonb_object_keys(p_command) k where k not in ('action','request','expectedVersion','client','opportunity','proposal','fields','documents','contractId','signatureEvidence','legalApproved','closedAt')) then raise exception using errcode='22023',message='INVALID_COMMAND'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_opportunity::text,2));
  -- Lock the existing CRM row too: an unrelated CRM updater does not use our
  -- advisory key and must not change client/product concurrently with closing.
  perform 1 from crm.oportunidades o where o.oportunidade_id=p_opportunity for update;
  snapshot:=api_comercial.commercial_get_journey(p_opportunity); s:=snapshot->'journey'; t:=snapshot->'template'; company:=(s->>'company')::uuid;
  if not seguranca_comercial.commercial_allowed(company,case when action='formalize' then 'juridico' else 'comercial' end,true) then raise exception using errcode='42501',message='ACCESS_DENIED'; end if;
  select * into prior from crm.commercial_requests where opportunity=p_opportunity and request=req;
  if found then if prior.actor<>auth.uid() or prior.command<>p_command then raise exception using errcode='40001',message='COMMAND_CONFLICT'; end if; return prior.response; end if;
  if expected<>(s->>'version')::integer then raise exception using errcode='40001',message='VERSION_CONFLICT'; end if;
  if s->>'stage'='closed' then
    if action<>'close' or (p_command->>'closedAt')::timestamptz<>(s->>'closedAt')::timestamptz then raise exception using errcode='22023',message='CLOSED_IMMUTABLE'; end if;
    return snapshot;
  end if;
  if action='qualify' then
    if s->>'stage'<>'lead' or p_command->>'opportunity'<>p_opportunity::text or not exists(select 1 from crm.commercial_client_links l where l.opportunity=p_opportunity and l.client=(p_command->>'client')::uuid) then raise exception using errcode='22023',message='APPROVED_CLIENT_LINK_REQUIRED'; end if;
    s:=s||jsonb_build_object('client',p_command->>'client','stage','qualified');
    update crm.oportunidades set cliente_id_global=(s->>'client')::uuid where oportunidade_id=p_opportunity;
  elsif action='propose' then
    c:=p_command->'proposal';
    if s->>'stage' not in ('qualified','proposal') or coalesce(jsonb_typeof(c),'')<>'object' or coalesce(c->>'id','')='' or coalesce(c->>'accepted','')<>'false' or length(btrim(coalesce(c->>'conditions',''))) not between 1 and 4000 or coalesce(jsonb_typeof(c->'items'),'')<>'array' or jsonb_array_length(c->'items') not between 1 and 100 then raise exception using errcode='22023',message='INVALID_PROPOSAL'; end if;
    if (select count(distinct i->>'id') from jsonb_array_elements(c->'items') i)<>jsonb_array_length(c->'items') then raise exception using errcode='22023',message='DUPLICATE_ITEM'; end if;
    for item in select value from jsonb_array_elements(c->'items') loop
      if coalesce(item->>'id','')='' or coalesce(item->>'product','')<>s->>'product' or coalesce(item->>'description','')='' or coalesce(item->>'quantity','') !~ '^[1-9][0-9]{0,5}$' or (item->>'quantity')::integer>100000 or coalesce(item->>'unitPrice','') !~ '^(0|[1-9][0-9]{0,11})\.[0-9]{2}$' then raise exception using errcode='22023',message='INVALID_ITEM'; end if;
    end loop;
    s:=s||jsonb_build_object('proposal',c,'stage','proposal');
  elsif action='accept' then
    if s->>'stage'<>'proposal' then raise exception using errcode='22023',message='PROPOSAL_REQUIRED'; end if;
    s:=jsonb_set(s,'{proposal,accepted}','true')||jsonb_build_object('stage','accepted');
  elsif action in ('complete','formalize','close') then
    if t is null or t='null'::jsonb or coalesce(t->>'approved','')<>'true' or coalesce(t->>'product','')<>s->>'product' or coalesce(jsonb_typeof(t->'fields'),'')<>'array' or coalesce(jsonb_typeof(t->'documents'),'')<>'array' or coalesce(jsonb_typeof(t->'signatureRequired'),'')<>'boolean' then raise exception using errcode='22023',message='APPROVED_TEMPLATE_REQUIRED'; end if;
    if exists(select 1 from jsonb_array_elements(t->'fields') f where coalesce(f->>'name','') !~ '^[a-z][a-z0-9_]{0,63}$' or coalesce(f->>'maxLength','') !~ '^[1-9][0-9]{0,3}$' or (f->>'maxLength')::integer>2000 or coalesce(jsonb_typeof(f->'required'),'')<>'boolean') then raise exception using errcode='22023',message='INVALID_TEMPLATE'; end if;
    if action='complete' then
      if s->>'stage' not in ('accepted','preparing_contract','awaiting_signature') or coalesce(p_command->>'contractId','')='' or ((s->'contract')<>'null'::jsonb and s#>>'{contract,id}'<>p_command->>'contractId') then raise exception using errcode='22023',message='SAME_CONTRACT_REQUIRED'; end if;
      c:=jsonb_build_object('id',p_command->>'contractId','template',t->>'id','templateVersion',t->'version','fields',p_command->'fields','documents',p_command->'documents','signatureEvidence',null,'legalApproved',false);
    else c:=s->'contract'; end if;
    if c is null or c='null'::jsonb or c->>'template' is distinct from t->>'id' or c->'templateVersion' is distinct from t->'version' or coalesce(jsonb_typeof(c->'fields'),'')<>'object' or coalesce(jsonb_typeof(c->'documents'),'')<>'object' then raise exception using errcode='22023',message='CONTRACT_REQUIRED'; end if;
    if exists(select 1 from jsonb_each(c->'fields') e where jsonb_typeof(e.value)<>'string') or exists(select 1 from jsonb_each(c->'documents') e where jsonb_typeof(e.value)<>'string') then raise exception using errcode='22023',message='INVALID_CONTRACT_VALUE'; end if;
    if exists(select 1 from jsonb_object_keys(c->'fields') k where not exists(select 1 from jsonb_array_elements(t->'fields') f where f->>'name'=k)) or exists(select 1 from jsonb_object_keys(c->'documents') k where not (t->'documents' ? k)) then raise exception using errcode='22023',message='UNEXPECTED_CONTRACT_FIELD'; end if;
    for f in select value from jsonb_array_elements(t->'fields') loop
      if ((f->>'required')::boolean and length(btrim(coalesce(c->'fields'->>(f->>'name'),'')))=0) or length(coalesce(c->'fields'->>(f->>'name'),''))>(f->>'maxLength')::integer then raise exception using errcode='22023',message='CONTRACT_FIELD_REQUIRED'; end if;
    end loop;
    if exists(select 1 from jsonb_array_elements_text(t->'documents') d where length(coalesce(c->'documents'->>d,'')) not between 1 and 500) then raise exception using errcode='22023',message='DOCUMENT_REQUIRED'; end if;
    if action='complete' then s:=s||jsonb_build_object('contract',c,'stage','preparing_contract');
    elsif action='formalize' then
      if s->>'stage' not in ('preparing_contract','awaiting_signature') or length(coalesce(p_command->>'signatureEvidence',''))>500 then raise exception using errcode='22023',message='FORMALIZATION_REQUIRED'; end if;
      c:=c||jsonb_build_object('signatureEvidence',nullif(btrim(p_command->>'signatureEvidence'),''),'legalApproved',coalesce(p_command->>'legalApproved','')='true'); s:=s||jsonb_build_object('contract',c,'stage','awaiting_signature');
    else
      if s->>'stage'<>'awaiting_signature' or coalesce(c->>'legalApproved','')<>'true' or ((t->>'signatureRequired')::boolean and coalesce(c->>'signatureEvidence','')='') or coalesce(s->>'client','')='' or coalesce(s#>>'{proposal,accepted}','')<>'true' or coalesce(p_command->>'closedAt','') !~ '^\d{4}-\d{2}-\d{2}T' then raise exception using errcode='22023',message='CLOSING_REQUIREMENTS'; end if;
      perform (p_command->>'closedAt')::timestamptz;
      s:=s||jsonb_build_object('stage','closed','closedAt',p_command->>'closedAt');
    end if;
  end if;
  v:=(s->>'version')::integer+1; s:=s||jsonb_build_object('version',v);
  insert into crm.commercial_journeys(opportunity,company,state,version) values(p_opportunity,company,s,v) on conflict(opportunity) do update set state=excluded.state,version=excluded.version;
  if action='close' then
    for item in select value from jsonb_array_elements(s#>'{proposal,items}') loop amount:=amount+(item->>'unitPrice')::numeric*(item->>'quantity')::integer; end loop;
    result:=jsonb_build_object('id',p_opportunity,'version',v,'business',p_opportunity,'client',s->>'client','company',company,'opportunity',p_opportunity,'proposal',s#>>'{proposal,id}','items',s#>'{proposal,items}','total',to_char(amount,'FM9999999999999999999999990.00'),'conditions',s#>>'{proposal,conditions}','contract',s->'contract','formalization','completed','closedAt',s->>'closedAt','source','crm_new','originReferences','[]'::jsonb,'triggersNewSale',true,'affectsInvestmentPositions',false);
    insert into crm.commercial_outputs(business,version,company,payload) values(p_opportunity,v,company,result);
    update crm.oportunidades set etapa_id=(select etapa_id from crm.pipeline_etapas where codigo='FECHADO' and ativo),probabilidade=100,fechada_em=(s->>'closedAt')::timestamptz,motivo_perda=null where oportunidade_id=p_opportunity;
    -- Deliberately no conversion RPC, investment UPDATE, financial job or outbox.
  end if;
  result:=jsonb_build_object('journey',s,'template',t);
  insert into crm.commercial_requests(opportunity,request,command,response,actor) values(p_opportunity,req,p_command,result,auth.uid());
  return result;
end; $$;
create function api_comercial.commercial_consume_outputs(p_company uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not seguranca_comercial.commercial_allowed(p_company,'financeiro') then raise exception using errcode='42501',message='ACCESS_DENIED'; end if;
  return (select coalesce(jsonb_agg(jsonb_set(o.payload,'{contract,fields}','{}'::jsonb) order by o.recorded_at),'[]'::jsonb) from crm.commercial_outputs o where o.company=p_company);
end; $$;
revoke all on function seguranca_comercial.commercial_allowed(uuid,text,boolean) from public,anon,authenticated;
revoke all on function api_comercial.commercial_intake_catalog(),api_comercial.commercial_receive_input(uuid,jsonb),api_comercial.commercial_get_journey(uuid),api_comercial.commercial_apply_command(uuid,jsonb),api_comercial.commercial_consume_outputs(uuid) from public,anon,authenticated;
grant execute on function api_comercial.commercial_intake_catalog(),api_comercial.commercial_receive_input(uuid,jsonb) to anon,authenticated;
grant execute on function api_comercial.commercial_get_journey(uuid),api_comercial.commercial_apply_command(uuid,jsonb),api_comercial.commercial_consume_outputs(uuid) to authenticated;
-- Ownership of SECURITY DEFINER routines must be reviewed: a dedicated non-login
-- owner with only these table privileges, never the public/anon/authenticated role.
-- No role creation or ownership changes are executed by this proposal.
rollback;
