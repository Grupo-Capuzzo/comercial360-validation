import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const company = n => `20000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const product = n => `30000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const opportunity = n => `40000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const client = "50000000-0000-4000-8000-000000000001";
const task = n => `70000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const lead = n => `80000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
test("company CRM: PostgreSQL authorization, old RPCs, views and rollback", async t => {
 const db = await PGlite.create();
 try {
 await db.exec(await readFile(new URL("../../tools/crm-scope/fixture.sql",import.meta.url),"utf8"));
 for(let n=1;n<=5;n++){
  await db.query("INSERT INTO auth.users VALUES($1,$2,now())",[uid(n),`synthetic-${n}@example.invalid`]);
  if(n<5) {
   await db.query("INSERT INTO erp.portal_usuarios VALUES($1,'Synthetic',$2,$3,1)",[n,`synthetic-${n}@example.invalid`,n===1?"admin":"usuario"]);
   await db.query("INSERT INTO comercial_360.crm_usuarios VALUES($1,true)",[uid(n)]);
   await db.query("INSERT INTO seguranca_comercial.usuarios VALUES($1,$1,true,'operador',true,$2)",[uid(n),n!==3]);
  }
 }
 await db.exec("INSERT INTO erp.portal_usuario_empresas VALUES(2,'cred'),(3,'ethernexus'),(4,'cred'); INSERT INTO erp.portal_usuario_modulos VALUES(4,'_grupo','crm')");
 await db.query("INSERT INTO comercial_360.categorias_produto VALUES($1,'TEST','Test')",[uid(99)]);
 for(let n=1;n<=3;n++){
  await db.query("INSERT INTO comercial_360.empresas VALUES($1,$2)",[company(n),`Synthetic company ${n}`]);
  await db.query("INSERT INTO comercial_360.produtos VALUES($1,$2,$3,$4,$5)",[product(n),company(n),uid(99),`P${n}`,`Synthetic product ${n}`]);
  await db.query("INSERT INTO crm.oportunidades VALUES($1,$2,$3,$4,$5,'aberta')",[opportunity(n),client,product(n),`Synthetic opportunity ${n}`,n*100]);
  await db.query("INSERT INTO crm.tarefas VALUES($1,$2,$3,'Synthetic task','pendente')",[task(n),opportunity(n),client]);
  await db.query("INSERT INTO comercial_360.leads(lead_id,produto_id,nome,status) VALUES($1,$2,'Synthetic lead','novo')",[lead(n),product(n)]);
  await db.query("INSERT INTO comercial_360.cliente_produtos VALUES($1,$2,$3,$4,$5,'ativo','2026-01-01','2027-01-01',now())",[uid(n+20),client,product(n),`P${n}`,`Synthetic product ${n}`]);
  for(const user of [1,2,3,4]) await db.query("INSERT INTO portal_acesso.permissoes VALUES($1,$2,'comercial',true,true)",[uid(user),company(n)]);
 }
 await db.query("INSERT INTO comercial_360.clientes VALUES($1,'Shared synthetic identity')",[client]);
 await db.query("INSERT INTO crm.tarefas VALUES($1,NULL,$2,'Unclassified task','pendente')",[task(9),client]);
 await db.exec(await readFile(new URL("../../supabase/migrations/20261118125652_crm_company_scope.sql",import.meta.url),"utf8"));
 const asUser = async n => { await db.exec("RESET ROLE"); await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[uid(n)]); await db.exec("SET ROLE authenticated"); };
 const rows=async(scope,kind,page=0)=>(await db.query("SELECT api_comercial.crm_escopo_consultar($1,$2,$3) result",[scope,kind,page])).rows[0].result;
 const ctx=async(scope)=>(await db.query("SELECT api_comercial.crm_escopo_contexto($1) result",[scope])).rows[0].result;
 const op=async(scope,action,payload)=>db.query("SELECT api_comercial.crm_escopo_operar($1,$2,$3)",[scope,action,payload]);
 const denied=fn=>assert.rejects(fn,error=>error.code==="42501");
 await t.test("unmapped ERP company has pending context and no operational rows",async()=>{await asUser(2);assert.equal((await ctx("cred")).mapped,false);await denied(()=>rows("cred","opportunities"));});
 await db.exec("RESET ROLE");
 // Explicitly approved SYNTHETIC mappings only. Production mappings stay NULL.
 await db.query("UPDATE crm_scope_private.company_map SET empresa_id=$1,validated_at=now(),validated_by=$2,evidence='synthetic test approval' WHERE slug='cred'",[company(1),uid(1)]);
 await db.query("UPDATE crm_scope_private.company_map SET empresa_id=$1,validated_at=now(),validated_by=$2,evidence='synthetic test approval' WHERE slug='ethernexus'",[company(2),uid(1)]);
 await t.test("company-only user sees only own opportunities/tasks/leads/products",async()=>{await asUser(2);for(const kind of ["opportunities","tasks","leads","products"]){const r=await rows("cred",kind);assert.equal(r.rows.length,1,kind);} await denied(()=>rows("ethernexus","opportunities"));await denied(()=>rows("geral","opportunities"));});
 await t.test("shared customer keeps one identity with scoped relationships",async()=>{await asUser(2);const a=(await rows("cred","clients")).rows[0];assert.equal(a.cliente_id_global,client);assert.equal(a.total_vinculos_produto,1);assert.equal(a.produtos.length,1);assert.equal(JSON.stringify(a).includes("must_not_leak"),false);await asUser(3);const b=(await rows("ethernexus","clients")).rows[0];assert.equal(a.cliente_id_global,b.cliente_id_global);assert.notEqual(a.produtos[0].produto_codigo,b.produtos[0].produto_codigo);});
 await t.test("general CRM consolidates authorized businesses, excludes other companies",async()=>{await asUser(4);assert.equal((await rows("geral","opportunities")).rows.length,1);const d=(await rows("geral","dashboard")).rows[0];assert.equal(d.executive.clientes_total,1);assert.equal(d.products.length,1);});
 await t.test("unrestricted administrator sees historical pending classification",async()=>{await asUser(1);const r=await rows("geral","opportunities");assert.equal(r.rows.length,3);assert.equal(r.rows.filter(o=>o.classificacao==="pendente").length,1);assert.equal((await rows("geral","tasks")).rows.length,4);});
 await t.test("Auth enrollment alone grants no CRM",async()=>{await asUser(5);await denied(()=>ctx("geral"));await denied(()=>ctx("cred"));});
 await t.test("company UUID and slug have identical permissions",async()=>{await asUser(2);assert.deepEqual((await rows(company(1),"opportunities")).rows,(await rows("cred","opportunities")).rows);await denied(()=>rows(company(2),"opportunities"));});
 await t.test("forged opportunity/task/product IDs denied in new RPC",async()=>{await asUser(2);await denied(()=>op("cred","crm_atualizar_oportunidade",{oportunidade_id:opportunity(2)}));await denied(()=>op("cred","crm_concluir_tarefa",{tarefa_id:task(2)}));await denied(()=>op("cred","lead_create",{produto_id:product(2),nome:"Synthetic"}));await denied(()=>op("cred","lead_status",{lead_id:lead(2),status:"perdido"}));});
 await t.test("extra payload fields cannot change company or identity",async()=>{await asUser(2);for(const field of ["empresa_id","responsavel_usuario_id","criado_por","items"])await denied(()=>op("cred","crm_atualizar_oportunidade",{oportunidade_id:opportunity(1),[field]:company(2)}));});
 await t.test("existing legacy RPC and security function cannot bypass scope",async()=>{await asUser(2);await denied(()=>db.query("SELECT api_comercial.crm_concluir_tarefa($1)",[{tarefa_id:task(2)}]));await denied(()=>db.query("SELECT seguranca_comercial.crm_concluir_tarefa($1)",[{tarefa_id:task(2),oportunidade_id:opportunity(1)}]));await denied(()=>db.query("SELECT * FROM api_comercial.crm_oportunidades"));await asUser(4);await denied(()=>db.query("SELECT seguranca_comercial.crm_concluir_tarefa($1)",[{tarefa_id:task(2),oportunidade_id:opportunity(1)}]));});
 await t.test("private originals are not executable by browser roles",async()=>{await asUser(2);await denied(()=>db.query("SELECT * FROM crm_scope_private.original_crm_oportunidades_seguro()"));});
 await t.test("existing REST tables restricted despite permissive legacy RLS",async()=>{await asUser(2);assert.equal((await db.query("SELECT * FROM comercial_360.leads")).rows.length,1);assert.equal((await db.query("SELECT * FROM comercial_360.produtos")).rows.length,1);assert.equal((await db.query("SELECT * FROM comercial_360.clientes")).rows.length,1);});
 await t.test("authorized mutations preserve original audit and nested validation",async()=>{await asUser(2);await op("cred","crm_mover_oportunidade",{oportunidade_id:opportunity(1),etapa_codigo:"PROPOSTA"});await op("cred","crm_criar_tarefa",{oportunidade_id:opportunity(1),titulo:"Scoped synthetic task"});await op("cred","crm_concluir_tarefa",{tarefa_id:task(1)});await db.exec("RESET ROLE");assert.equal((await db.query("SELECT * FROM crm.audit")).rows.length,2);});
 await t.test("financial closing guard exists on the RPC, not only UI",async()=>{await asUser(2);await denied(()=>op("cred","crm_mover_oportunidade",{oportunidade_id:opportunity(1),etapa_codigo:"FECHADO"}));});
 await t.test("read-only permission denies writes, preserves reads",async()=>{await db.exec("RESET ROLE");await db.query("UPDATE portal_acesso.permissoes SET pode_gravar=false WHERE usuario_id=$1",[uid(2)]);await asUser(2);assert.equal((await ctx("cred")).can_write,false);assert.equal((await rows("cred","opportunities")).rows.length,1);await denied(()=>op("cred","crm_atualizar_oportunidade",{oportunidade_id:opportunity(1)}));});
 await t.test("value masking from original projection is preserved",async()=>{await asUser(3);assert.equal((await rows("ethernexus","opportunities")).rows[0].valor_potencial,null);});
 await t.test("revoked session immediately blocks all scope access",async()=>{await asUser(2);await db.query("SELECT set_config('test.revoked','yes',false)");await denied(()=>ctx("cred"));await db.query("SELECT set_config('test.revoked','',false)");});
 await t.test("ERP company/module revocation and inactive company immediately deny direct access",async()=>{await db.exec("RESET ROLE");await db.exec("INSERT INTO erp.portal_usuario_modulos VALUES(2,'cred','financas')");await asUser(2);await denied(()=>ctx("cred"));await db.exec("RESET ROLE");await db.exec("DELETE FROM erp.portal_usuario_modulos WHERE usuario_id=2");await db.exec("INSERT INTO erp.portal_empresa_status VALUES('cred','inativo')");await asUser(2);await denied(()=>ctx("cred"));await db.exec("RESET ROLE");await db.exec("DELETE FROM erp.portal_empresa_status");await db.exec("DELETE FROM erp.portal_usuario_empresas WHERE usuario_id=2");await asUser(2);await denied(()=>ctx("cred"));});
 await t.test("database pagination returns all records without default API truncation",async()=>{await db.exec("RESET ROLE");await db.query("INSERT INTO comercial_360.leads(lead_id,produto_id,nome) SELECT gen_random_uuid(),$1,'Page synthetic' FROM generate_series(1,405)",[product(2)]);await asUser(3);let page=0,total=0;do{const r=await rows("ethernexus","leads",page);total+=r.rows.length;page=r.next;}while(page!==null);assert.equal(total,406);});
 await t.test("rollback restores original definitions and keeps business rows",async()=>{await db.exec("RESET ROLE");const before=(await db.query("SELECT count(*) n FROM crm.oportunidades")).rows[0].n;await db.exec(await readFile(new URL("../../tools/crm-scope/rollback.review.sql",import.meta.url),"utf8"));assert.equal((await db.query("SELECT count(*) n FROM crm.oportunidades")).rows[0].n,before);assert.equal((await db.query("SELECT to_regnamespace('crm_scope_private') n")).rows[0].n,null);});
 } finally { await db.close(); }
});
